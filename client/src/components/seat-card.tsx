import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, X, Ban } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export interface SeatData {
  id: string;
  contestantName?: string;
  age?: number;
  gender?: "Male" | "Female" | "Other";
  groupId?: string;
  assignmentId?: string; // Backend assignment ID for API updates
  contestantId?: string; // Backend contestant ID
  attendingWith?: string;
  availabilityStatus?: string;
}

interface SeatCardProps {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isDragging?: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
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

export function SeatCard({ seat, blockIndex, seatIndex, isDragging = false, onEmptySeatClick, onRemove, onCancel }: SeatCardProps) {
  const isEmpty = !seat.contestantName;
  const groupColorClass = seat.groupId
    ? groupColors[parseInt(seat.groupId.replace(/\D/g, "")) % groupColors.length]
    : "";

  // Extract seat label from ID (e.g., "A1", "B3")
  const seatLabel = seat.id.split('-').pop() || '';

  // Fetch full contestant details on hover (only for occupied seats)
  const { data: contestantDetails } = useQuery({
    queryKey: ['/api/contestants', seat.contestantId],
    queryFn: async () => {
      if (!seat.contestantId) return null;
      const response = await fetch(`/api/contestants/${seat.contestantId}`);
      if (!response.ok) throw new Error('Failed to fetch contestant details');
      return response.json();
    },
    enabled: !isEmpty && !!seat.contestantId,
  });

  const handleClick = (e: React.MouseEvent) => {
    // Stop propagation to prevent drag-and-drop from interfering
    e.stopPropagation();
    
    if (isEmpty && onEmptySeatClick) {
      onEmptySeatClick(blockIndex + 1, seatLabel);
    }
  };

  const seatContent = (
    <Card
      className={`p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity ${
        isEmpty
          ? "border-dashed bg-muted/30 cursor-pointer hover-elevate"
          : `${groupColorClass} border-2 hover-elevate`
      } ${isDragging ? "opacity-50" : ""}`}
      data-testid={`seat-${blockIndex}-${seatIndex}`}
      onClick={handleClick}
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

  // Wrap occupied seats with HoverCard for details
  if (!isEmpty) {
    return (
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          {seatContent}
        </HoverCardTrigger>
        <HoverCardContent className="w-80" data-testid="hovercard-contestant-details">
          <div className="space-y-3">
            {contestantDetails ? (
              <>
                <div>
                  <h4 className="text-sm font-semibold">{contestantDetails.name}</h4>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Age</label>
                    <p>{contestantDetails.age}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Gender</label>
                    <p>{contestantDetails.gender}</p>
                  </div>
                </div>

                {contestantDetails.attendingWith && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Attending With</label>
                    <p>{contestantDetails.attendingWith}</p>
                  </div>
                )}

                {contestantDetails.groupId && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Group</label>
                    <p>Group {contestantDetails.groupId}</p>
                  </div>
                )}

                <div className="text-sm">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <div className="mt-1">
                    <Badge variant="secondary">
                      {contestantDetails.availabilityStatus}
                    </Badge>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">
                Loading contestant details...
              </div>
            )}

            {seat.assignmentId && (
              <div className="flex gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove?.(seat.assignmentId!);
                  }}
                  data-testid={`button-remove-${seat.assignmentId}`}
                >
                  <X className="h-3 w-3 mr-1" />
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel?.(seat.assignmentId!);
                  }}
                  data-testid={`button-cancel-${seat.assignmentId}`}
                >
                  <Ban className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  return seatContent;
}
