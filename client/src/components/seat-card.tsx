import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { User, X, Ban, Plus, ArrowLeftRight } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  auditionRating?: string; // A+, A, B+, B, C
  medicalQuestion?: string; // Y/N from booking master
  playerType?: "player" | "backup" | "player_partner"; // PLAYER, BACKUP, PLAYER_PARTNER
  originalBlockNumber?: number; // RX Day Mode - original position before swap
  originalSeatLabel?: string; // RX Day Mode - original seat label before swap
  swappedAt?: string; // RX Day Mode - timestamp when swap occurred (only set for locked swaps)
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

// Rating-based colors - pure inline styles (no Tailwind dependency)
const ratingColors: Record<string, { bg: string; border: string }> = {
  'A+': { bg: '#dcfce7', border: '#16a34a' },
  'A': { bg: '#dcfce7', border: '#22c55e' },
  'B+': { bg: '#fef3c7', border: '#f59e0b' },
  'B': { bg: '#fed7aa', border: '#f97316' },
  'C': { bg: '#fee2e2', border: '#ef4444' },
};

export function SeatCard({ seat, blockIndex, seatIndex, isDragging = false, onEmptySeatClick, onRemove, onCancel }: SeatCardProps) {
  const isEmpty = !seat.contestantName;
  
  // Use rating-based colors, fallback to group colors if no rating
  const ratingColorInfo = seat.auditionRating ? ratingColors[seat.auditionRating] : null;
  
  const groupColorClass = !ratingColorInfo && seat.groupId
    ? groupColors[parseInt(seat.groupId.replace(/\D/g, "")) % groupColors.length]
    : "";

  // Extract seat label from ID (e.g., "A1", "B3")
  const seatLabel = seat.id.split('-').pop() || '';
  
  // Check if this seat was swapped during RX Day Mode (only when swappedAt is set)
  const wasSwapped = !!seat.swappedAt;
  const originalPosition = wasSwapped && seat.originalBlockNumber !== undefined && seat.originalSeatLabel !== undefined
    ? `${String(seat.originalBlockNumber).padStart(2, '0')}-${seat.originalSeatLabel}`
    : null;

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
      className={`p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity border-2 relative ${
        isEmpty
          ? "border-dashed bg-muted/30 cursor-pointer hover-elevate"
          : `${groupColorClass} hover-elevate`
      } ${isDragging ? "opacity-50" : ""} ${wasSwapped ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
      style={ratingColorInfo ? {
        backgroundColor: ratingColorInfo.bg,
        borderColor: ratingColorInfo.border,
      } : undefined}
      data-testid={`seat-${blockIndex}-${seatIndex}`}
      onClick={handleClick}
    >
      {/* MOVED indicator - positioned in top-right corner of the card */}
      {wasSwapped && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              data-testid={`badge-moved-${seat.assignmentId}`}
              className="absolute -top-1.5 -right-1.5 z-10 flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white cursor-help shadow-sm"
            >
              <ArrowLeftRight className="h-3 w-3" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p>Originally at: <strong>{originalPosition}</strong></p>
            <p className="text-muted-foreground">Moved during RX Day</p>
          </TooltipContent>
        </Tooltip>
      )}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
          <User className="h-3 w-3" />
          <span className="text-[10px] font-mono">{seatLabel}</span>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <span>{seatLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <p className="font-medium truncate text-xs flex-1" title={seat.contestantName}>
              {seat.contestantName}
            </p>
            {seat.medicalQuestion === 'Y' && contestantDetails?.medicalInfo && (
              <div title="Medical information">
                <Plus className="h-3 w-3 text-red-600 dark:text-red-400 flex-shrink-0 font-bold" />
              </div>
            )}
          </div>
          {seat.playerType && (
            <div className="flex items-center gap-1">
              <Badge 
                variant="outline"
                className={`h-5 px-1.5 text-[9px] font-semibold ${
                  seat.playerType === 'player' ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700' :
                  seat.playerType === 'backup' ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700' :
                  'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700'
                }`}>
                {seat.playerType === 'player' ? 'P' : seat.playerType === 'backup' ? 'B' : 'PP'}
              </Badge>
            </div>
          )}
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
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    {contestantDetails.photoUrl ? (
                      <AvatarImage 
                        src={contestantDetails.photoUrl} 
                        alt={contestantDetails.name}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback>
                      {contestantDetails.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">{contestantDetails.name}</h4>
                      {contestantDetails.auditionRating && (
                        <span className={`text-sm font-bold ${
                          contestantDetails.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                          contestantDetails.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                          contestantDetails.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                          contestantDetails.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                          contestantDetails.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' : ''
                        }`}>
                          {contestantDetails.auditionRating}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{contestantDetails.age} years old • {contestantDetails.gender}</p>
                  </div>
                </div>

                {contestantDetails.playerType && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Player Type</label>
                    <Badge className={`text-xs mt-1 ${
                      contestantDetails.playerType === 'player' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                      contestantDetails.playerType === 'backup' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' :
                      contestantDetails.playerType === 'player_partner' ? 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' :
                      'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800'
                    }`}>
                      {contestantDetails.playerType === 'player' ? 'Player' :
                       contestantDetails.playerType === 'backup' ? 'Backup' :
                       contestantDetails.playerType === 'player_partner' ? 'Partner' :
                       contestantDetails.playerType}
                    </Badge>
                  </div>
                )}

                {contestantDetails.attendingWith && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Attending With</label>
                    <p>{contestantDetails.attendingWith}</p>
                  </div>
                )}

                {contestantDetails.phone && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Phone</label>
                    <p className="text-xs">{contestantDetails.phone}</p>
                  </div>
                )}

                {contestantDetails.medicalInfo && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Medical Info</label>
                    <p className="text-xs">{contestantDetails.medicalInfo}</p>
                  </div>
                )}

                {contestantDetails.mobilityNotes && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Mobility/Access Notes</label>
                    <p className="text-xs">{contestantDetails.mobilityNotes}</p>
                  </div>
                )}

                {contestantDetails.criminalRecord && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Criminal Record</label>
                    <p className="text-xs">{contestantDetails.criminalRecord}</p>
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

                {wasSwapped && originalPosition && (
                  <div className="text-sm p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <div>
                        <label className="text-xs font-medium text-amber-700 dark:text-amber-300">Moved During RX Day</label>
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Originally at seat <strong>{originalPosition}</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {seat.playerType && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Player Type</label>
                    <div className="mt-1">
                      <Badge className={`${
                        seat.playerType === 'player' ? 'bg-blue-500/20 text-blue-700 border-blue-300 dark:border-blue-700 dark:text-blue-400' :
                        seat.playerType === 'backup' ? 'bg-amber-500/20 text-amber-700 border-amber-300 dark:border-amber-700 dark:text-amber-400' :
                        'bg-purple-500/20 text-purple-700 border-purple-300 dark:border-purple-700 dark:text-purple-400'
                      } border`}>
                        {seat.playerType === 'player' ? 'Player' : seat.playerType === 'backup' ? 'Backup' : 'Player Partner'}
                      </Badge>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">
                Loading contestant details...
              </div>
            )}

            {seat.assignmentId && (
              <div className="space-y-3 pt-3 border-t">
                <div className="flex gap-2">
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
              </div>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  return seatContent;
}
