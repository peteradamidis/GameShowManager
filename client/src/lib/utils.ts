import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getNextRecordDayId(recordDays: { id: string; date: string }[] | undefined) {
  if (!recordDays || recordDays.length === 0) return null;

  const now = new Date();
  // We stay on the record day until the day AFTER it is over.
  // This means if today is May 11th, and the record day was May 10th, 
  // we still treat May 10th as the "current/next" if there are no other days in between.
  // More precisely: we want the first record day where recordDate >= yesterday at 00:00:00
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const sortedDays = [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  const nextDay = sortedDays.find(rd => {
    const rdDate = new Date(rd.date);
    return rdDate >= yesterday;
  });

  return nextDay ? nextDay.id : sortedDays[0].id;
}
