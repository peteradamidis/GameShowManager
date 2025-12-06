import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User, X, Ban, Plus } from "lucide-react";
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
  auditionRating?: string; // A+, A, B+, B, C
  medicalQuestion?: string; // Y/N from booking master
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

// Rating-based background colors - use inline styles for better portability
const ratingColors: Record<string, { light: string; dark: string; borderLight: string; borderDark: string }> = {
  'A+': {
    light: 'hsl(134 61% 88%)',
    dark: 'hsl(134 61% 25%)',
    borderLight: 'hsl(134 65% 31%)',
    borderDark: 'hsl(134 65% 50%)',
  },
  'A': {
    light: 'hsl(134 57% 90%)',
    dark: 'hsl(134 57% 25%)',
    borderLight: 'hsl(134 60% 34%)',
    borderDark: 'hsl(134 60% 52%)',
  },
  'B+': {
    light: 'hsl(38 92% 92%)',
    dark: 'hsl(38 92% 25%)',
    borderLight: 'hsl(38 97% 40%)',
    borderDark: 'hsl(38 97% 60%)',
  },
  'B': {
    light: 'hsl(30 84% 90%)',
    dark: 'hsl(30 84% 25%)',
    borderLight: 'hsl(30 89% 40%)',
    borderDark: 'hsl(30 89% 60%)',
  },
  'C': {
    light: 'hsl(0 84% 88%)',
    dark: 'hsl(0 84% 25%)',
    borderLight: 'hsl(0 74% 42%)',
    borderDark: 'hsl(0 74% 58%)',
  },
};

export function SeatCard({ seat, blockIndex, seatIndex, isDragging = false, onEmptySeatClick, onRemove, onCancel }: SeatCardProps) {
  const isEmpty = !seat.contestantName;
  
  // Determine colors
  const ratingColorObj = seat.auditionRating ? ratingColors[seat.auditionRating] : null;
  const isDarkMode = typeof window !== 'undefined' && document.documentElement.classList.contains('dark');
  
  const bgColor = ratingColorObj 
    ? (isDarkMode ? ratingColorObj.dark : ratingColorObj.light)
    : 'transparent';
  const borderColor = ratingColorObj
    ? (isDarkMode ? ratingColorObj.borderDark : ratingColorObj.borderLight)
    : 'transparent';
  
  const groupColorClass = !ratingColorObj && seat.groupId
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
      className={`p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity border-2 ${
        isEmpty
          ? "border-dashed bg-muted/30 cursor-pointer hover-elevate"
          : `${groupColorClass} hover-elevate`
      } ${isDragging ? "opacity-50" : ""}`}
      style={ratingColorObj ? {
        backgroundColor: bgColor,
        borderColor: borderColor,
        color: isDarkMode ? '#e0e0e0' : '#1a1a1a',
      } : undefined}
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
