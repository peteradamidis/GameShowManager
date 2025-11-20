import { Card } from "@/components/ui/card";
import { User } from "lucide-react";

export interface SeatData {
  id: string;
  contestantName?: string;
  age?: number;
  gender?: "Male" | "Female" | "Other";
  groupId?: string;
}

interface SeatCardProps {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isDragging?: boolean;
}

const groupColors = [
  "border-blue-500",
  "border-green-500",
  "border-purple-500",
  "border-orange-500",
  "border-pink-500",
  "border-cyan-500",
  "border-yellow-500",
];

export function SeatCard({ seat, blockIndex, seatIndex, isDragging = false }: SeatCardProps) {
  const isEmpty = !seat.contestantName;
  const groupColorClass = seat.groupId
    ? groupColors[parseInt(seat.groupId.replace(/\D/g, "")) % groupColors.length]
    : "";

  return (
    <Card
      className={`p-2 min-h-[60px] flex flex-col justify-center text-xs transition-opacity ${
        isEmpty
          ? "border-dashed bg-muted/30"
          : `${groupColorClass} border-2`
      } ${isDragging ? "opacity-50" : ""}`}
      data-testid={`seat-${blockIndex}-${seatIndex}`}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <User className="h-3 w-3" />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="font-medium truncate" title={seat.contestantName}>
            {seat.contestantName}
          </p>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>{seat.age}</span>
            <span>•</span>
            <span>{seat.gender?.[0]}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
