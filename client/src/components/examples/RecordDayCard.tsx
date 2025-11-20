import { RecordDayCard } from '../record-day-card';

const mockRecordDays = [
  {
    id: "1",
    date: "December 15, 2025",
    totalSeats: 140,
    filledSeats: 140,
    femalePercent: 65,
    status: "Ready" as const,
  },
  {
    id: "2",
    date: "December 22, 2025",
    totalSeats: 140,
    filledSeats: 98,
    femalePercent: 62,
    status: "Draft" as const,
  },
];

export default function RecordDayCardExample() {
  return (
    <div className="grid grid-cols-2 gap-4 p-6">
      {mockRecordDays.map((day) => (
        <RecordDayCard
          key={day.id}
          recordDay={day}
          onViewSeating={() => console.log('View seating for', day.date)}
          onSendInvitations={() => console.log('Send invitations for', day.date)}
        />
      ))}
    </div>
  );
}
