import { Card } from "@/components/ui/card";
import { User } from "lucide-react";

export interface SeatData {
  id: string;
  contestantName?: string;
  age?: number;
  gender?: "Male" | "Female" | "Other";
  groupId?: string;
  assignmentId?: string; // Backend assignment ID for API updates
  contestantId?: string; // Backend contestant ID
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

  // Extract seat label from ID (e.g., "A1", "B3")
  const seatLabel = seat.id.split('-').pop() || '';

  return (
    <Card
      className={`p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity ${
        isEmpty
          ? "border-dashed bg-muted/30"
          : `${groupColorClass} border-2`
      } ${isDragging ? "opacity-50" : ""}`}
      data-testid={`seat-${blockIndex}-${seatIndex}`}
    >
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
          <User className="h-3 w-3" />
          <span className="text-[10px] font-mono">{seatLabel}</span>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-muted-foreground">{seatLabel}</div>
          <p className="font-medium truncate text-xs" title={seat.contestantName}>
            {seat.contestantName}
          </p>
          <div className="flex items-center gap-2 text-muted-foreground text-[10px]">
            <span>{seat.age}</span>
            <span>•</span>
            <span>{seat.gender?.[0]}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
