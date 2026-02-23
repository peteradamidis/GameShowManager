import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { User, X, Ban, Plus, ArrowLeftRight, DollarSign, Undo2, Users, UserX, Clock, ShieldAlert, Pencil, MessageSquare, UserCheck, Gift, Trash2, Check, Link2, Edit2, XCircle } from "lucide-react";
import { getDistanceFromDocklands } from "@/components/contestant-table";

// Helper function to check if a medical field has meaningful content (not NA/N/A/No/None/empty)
const hasMeaningfulMedicalNote = (value: string | undefined | null): boolean => {
  if (!value) return false;
  const trimmed = value.trim().toUpperCase();
  const ignoredValues = ['', 'NA', 'N/A', 'N / A', 'NO', 'N', 'NONE', '-'];
  return !ignoredValues.includes(trimmed);
};
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

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
  mobilityNotes?: string; // Mobility/Access/Medical notes
  medicalInfo?: string; // Medical info from contestant profile
  playerType?: "player" | "backup" | "player_partner"; // PLAYER, BACKUP, PLAYER_PARTNER
  originalBlockNumber?: number; // RX Day Mode - original position before swap
  originalSeatLabel?: string; // RX Day Mode - original seat label before swap
  swappedAt?: string; // RX Day Mode - timestamp when swap occurred (only set for locked swaps)
  rxNumber?: string; // RX Day Mode - RX number for winning money
  caseNumber?: string; // RX Day Mode - case number for winning money
  winningMoneyRole?: string; // RX Day Mode - 'player' or 'case_holder'
  winningMoneyAmount?: number; // RX Day Mode - winning money amount
  wasStandby?: boolean; // True if contestant was seated from standby list
  isFromReschedule?: boolean; // True if contestant was rebooked from reschedule list
  isGroupSeparated?: boolean; // True if contestant has a partner/group member not sitting adjacent
  photoUrl?: string; // Contestant photo URL for podium visualiser
  contestantLocation?: string; // Contestant's location for 60km distance check
  customerNotes?: string; // General notes for the contestant
  notes?: string; // Notes (syncs with Booking Master NOTES column)
  attendingWithOverride?: string; // Override for attending with when it changes after invitation
  mobilityNotesOverride?: string; // Override for mobility/medical notes when they change after invitation
  podiumStory?: boolean; // True if contestant has a podium story
  signedIn?: string; // Timestamp when contestant signed in on RX day
  bookingEmailSent?: boolean; // True if booking email has been sent
  confirmedRsvp?: boolean; // True if contestant has confirmed RSVP
  previouslyCanceled?: { // Info about who was previously in this seat (if canceled)
    contestantName: string;
    canceledAt?: string;
    reason?: string;
    wasDeclined?: boolean;
  };
  isReturning?: boolean; // True if contestant previously appeared on a completed episode
  returningInfo?: Array<{ recordDayId: string; date: string; label: string; type: string; blockType?: string }>; // Previous appearance details
  criminalRecord?: string; // Criminal record info
  isTemporary?: boolean; // True if contestant is a temporary placeholder
  isTestSubject?: boolean; // True if contestant is a test subject
}

// Neighbor seat data for linking
export interface NeighborSeat {
  contestantId: string;
  contestantName: string;
  groupId?: string | null;
  blockNumber: number;
  seatLabel: string;
  photoUrl?: string | null;
}

interface SeatCardProps {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isDragging?: boolean;
  isGlobalDragging?: boolean; // True when ANY seat is being dragged - disables hover cards
  isRXDayLocked?: boolean;
  isQuickMoveMode?: boolean; // True when Quick Move mode is active - suppresses click-to-edit-winning-money
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
  onReturnToStandby?: (assignmentId: string, contestantId: string) => void;
  onNoShow?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onEarlyLeaver?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onNoLongerWantToAttend?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onPrizeWinner?: (contestantId: string, contestantName: string, blockNumber: number, seatLabel: string) => void;
  onEditTempContestant?: (contestantId: string) => void;
  onDeleteTestSubject?: (contestantId: string) => void;
  // Neighbor linking props
  neighbors?: NeighborSeat[];
  onLinkWithNeighbor?: (contestantId: string, neighborContestantId: string) => void;
  showBookingStatus?: boolean; // Show CONF/PENDING indicators on seat cards
  onRatingChange?: (contestantId: string, newRating: string) => void; // Change contestant rating
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

// Rating-based colors - with light and dark mode variants (including text color for contrast)
const ratingColorsLight: Record<string, { bg: string; border: string; text: string }> = {
  'A+': { bg: '#dcfce7', border: '#16a34a', text: '#14532d' }, // Bright green - dark text
  'A': { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' }, // Faded blue - dark text
  'P': { bg: '#cffafe', border: '#06b6d4', text: '#164e63' }, // Soft cyan/teal - partner color
  'B+': { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' }, // Amber - dark text
  'B': { bg: '#fed7aa', border: '#f97316', text: '#7c2d12' }, // Orange - dark text
  'C': { bg: '#fee2e2', border: '#ef4444', text: '#7f1d1d' }, // Red - dark text
};

const ratingColorsDark: Record<string, { bg: string; border: string; text: string }> = {
  'A+': { bg: '#14532d', border: '#22c55e', text: '#dcfce7' }, // Dark green bg - light text
  'A': { bg: '#1e3a5f', border: '#60a5fa', text: '#dbeafe' }, // Dark blue bg - light text
  'P': { bg: '#164e63', border: '#22d3ee', text: '#cffafe' }, // Dark cyan/teal bg - partner color
  'B+': { bg: '#451a03', border: '#fbbf24', text: '#fef3c7' }, // Dark amber bg - light text
  'B': { bg: '#431407', border: '#fb923c', text: '#fed7aa' }, // Dark orange bg - light text
  'C': { bg: '#450a0a', border: '#f87171', text: '#fee2e2' }, // Dark red bg - light text
};

// Standby styling - purple to distinguish from regular contestants
const standbyColorsLight = { bg: '#f3e8ff', border: '#9333ea', text: '#581c87' };
const standbyColorsDark = { bg: '#3b0764', border: '#a855f7', text: '#f3e8ff' };

// Hook to detect dark mode
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(() => 
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  
  return isDark;
}

export function SeatCard({ 
  seat, 
  blockIndex, 
  seatIndex, 
  isDragging = false, 
  isGlobalDragging = false,
  isRXDayLocked = false,
  isQuickMoveMode = false,
  onEmptySeatClick, 
  onRemove, 
  onCancel,
  onWinningMoneyClick,
  onRemoveWinningMoney,
  onReturnToStandby,
  onNoShow,
  onEarlyLeaver,
  onNoLongerWantToAttend,
  onPrizeWinner,
  onEditTempContestant,
  onDeleteTestSubject,
  neighbors = [],
  onLinkWithNeighbor,
  showBookingStatus = false,
  onRatingChange,
}: SeatCardProps) {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [localNotes, setLocalNotes] = useState(seat.notes || '');
  const [localAttendingWith, setLocalAttendingWith] = useState(seat.attendingWithOverride || '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingAttendingWith, setIsEditingAttendingWith] = useState(false);
  const { toast } = useToast();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDarkMode = useIsDarkMode();
  
  const ratingColors = isDarkMode ? ratingColorsDark : ratingColorsLight;
  const standbyColors = isDarkMode ? standbyColorsDark : standbyColorsLight;
  
  // Sync local state with prop changes
  useEffect(() => {
    setLocalNotes(seat.notes || '');
  }, [seat.notes]);
  
  useEffect(() => {
    setLocalAttendingWith(seat.attendingWithOverride || '');
  }, [seat.attendingWithOverride]);
  
  const isEmpty = !seat.contestantName;
  
  // Mutation for updating notes and attending with override
  const updateSeatDetailsMutation = useMutation({
    mutationFn: async (data: { notes?: string; attendingWithOverride?: string }) => {
      const response = await apiRequest('PATCH', `/api/seat-assignments/${seat.assignmentId}/workflow`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
      toast({
        title: "Updated",
        description: "Seat details saved",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update",
        variant: "destructive",
      });
    },
  });
  
  // Debounced save for notes - waits 500ms after typing stops
  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    // Guard: only save if we have a valid assignment ID
    if (!seat.assignmentId) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (seat.assignmentId) {
        updateSeatDetailsMutation.mutate({ notes: value });
      }
    }, 500);
  };
  
  // Save attending with override on blur or explicit save
  const handleAttendingWithSave = () => {
    // Guard: only save if we have a valid assignment ID
    if (!seat.assignmentId) return;
    const trimmed = localAttendingWith.trim();
    // Only save if it differs from the original contestant attending with
    updateSeatDetailsMutation.mutate({ attendingWithOverride: trimmed || undefined });
    setIsEditingAttendingWith(false);
  };
  
  // Local state for optimistic player type updates
  const [localPlayerType, setLocalPlayerType] = useState<string | undefined>(seat.playerType);
  
  // Local state for podium story toggle
  const [localPodiumStory, setLocalPodiumStory] = useState<boolean>(!!seat.podiumStory);
  
  // Sync local player type with prop changes
  useEffect(() => {
    setLocalPlayerType(seat.playerType);
  }, [seat.playerType]);
  
  // Sync local podium story with prop changes
  useEffect(() => {
    setLocalPodiumStory(!!seat.podiumStory);
  }, [seat.podiumStory]);
  
  // Mutation for toggling podium story
  const togglePodiumStoryMutation = useMutation({
    mutationFn: async (podiumStory: boolean) => {
      const response = await apiRequest('PATCH', `/api/contestants/${seat.contestantId}`, { podiumStory });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({
        title: localPodiumStory ? "Podium Story Added" : "Podium Story Removed",
        description: localPodiumStory ? "Contestant marked for podium story" : "Podium story tag removed",
      });
    },
    onError: (error: any) => {
      setLocalPodiumStory(!localPodiumStory);
      toast({
        title: "Error",
        description: error.message || "Failed to update podium story",
        variant: "destructive",
      });
    },
  });
  
  // Handle podium story toggle
  const handlePodiumStoryToggle = () => {
    if (!seat.contestantId) return;
    const newValue = !localPodiumStory;
    setLocalPodiumStory(newValue);
    togglePodiumStoryMutation.mutate(newValue);
  };
  
  // Mutation for updating player type
  const updatePlayerTypeMutation = useMutation({
    mutationFn: async (playerType: string | null) => {
      const response = await apiRequest('PATCH', `/api/seat-assignments/${seat.assignmentId}/player-type`, { playerType });
      return response.json();
    },
    onSuccess: () => {
      // Force refetch to get updated data from server
      // Use predicate to match all seat-assignment queries regardless of parameters
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({
        title: "Updated",
        description: "Player type saved",
      });
    },
    onError: (error: any) => {
      // Revert optimistic update on error
      setLocalPlayerType(seat.playerType);
      toast({
        title: "Error",
        description: error.message || "Failed to update player type",
        variant: "destructive",
      });
    },
  });
  
  // Handle player type change with optimistic update
  const handlePlayerTypeChange = (value: string) => {
    if (!seat.assignmentId) return;
    const playerType = value === 'none' ? null : value;
    // Optimistic update - set local state immediately
    setLocalPlayerType(playerType || undefined);
    updatePlayerTypeMutation.mutate(playerType);
  };
  
  // Use standby colors for standbys, then rating-based colors, fallback to group colors if no rating
  // Standbys get purple styling to distinguish them from regular contestants
  const colorInfo = seat.wasStandby 
    ? standbyColors 
    : (seat.auditionRating ? ratingColors[seat.auditionRating] : null);
  
  const groupColorClass = !colorInfo && seat.groupId
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
    // Quick Move mode is active - let the parent DraggableDroppableSeat handle clicks
    if (isQuickMoveMode) {
      return;
    }
    
    // Stop propagation to prevent drag-and-drop from interfering (only when not in quick move)
    e.stopPropagation();
    
    // RX Day Locked: Click occupied seat to edit winning money
    if (isRXDayLocked && !isEmpty && onWinningMoneyClick && seat.assignmentId) {
      onWinningMoneyClick(seat.assignmentId);
    }
    // RX Day Not Locked: Click empty seat to assign contestant
    else if (!isRXDayLocked && isEmpty && onEmptySeatClick) {
      onEmptySeatClick(blockIndex + 1, seatLabel);
    }
  };

  const seatContent = (
    <Card
      className={`p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity border-2 relative ${
        isEmpty
          ? isRXDayLocked 
            ? "border-dashed bg-muted/30 hover-elevate"  // Locked: not clickable
            : "border-dashed bg-muted/30 cursor-pointer hover-elevate"  // Unlocked: clickable to assign
          : isRXDayLocked && !isEmpty
            ? `${groupColorClass} cursor-pointer hover-elevate`  // Locked: occupied seats are clickable
            : `${groupColorClass} hover-elevate`  // Unlocked: occupied seats not directly clickable
      } ${isDragging ? "opacity-50" : ""} ${wasSwapped ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
      style={colorInfo ? {
        backgroundColor: colorInfo.bg,
        borderColor: colorInfo.border,
        color: colorInfo.text,
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
              className="absolute top-0.5 right-0.5 z-10 flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white cursor-help shadow-sm"
            >
              <ArrowLeftRight className="h-2.5 w-2.5" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <p>Originally at: <strong>{originalPosition}</strong></p>
            <p className="text-muted-foreground">Moved during RX Day</p>
          </TooltipContent>
        </Tooltip>
      )}
      {/* Booking status indicator - CONF (teal) or PENDING (red) - only when toggle is on and not in RX day mode */}
      {showBookingStatus && !isRXDayLocked && !isEmpty && seat.confirmedRsvp && (
        <div 
          data-testid={`badge-conf-${seat.assignmentId}`}
          className="absolute top-0.5 right-0.5 z-10 px-1 py-0 rounded text-[6px] font-bold bg-teal-600 text-white shadow-sm"
          title="Booking confirmed"
        >
          CONF
        </div>
      )}
      {showBookingStatus && !isRXDayLocked && !isEmpty && seat.bookingEmailSent && !seat.confirmedRsvp && (
        <div 
          data-testid={`badge-pending-${seat.assignmentId}`}
          className="absolute top-0.5 right-0.5 z-10 px-1 py-0 rounded text-[6px] font-bold bg-red-800 text-white shadow-sm"
          title="Awaiting reply"
        >
          PENDING
        </div>
      )}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
          <User className="h-3 w-3" />
          <span className="text-[10px] font-mono">{seatLabel}</span>
          {seat.previouslyCanceled && (
            <HoverCard openDelay={100} closeDelay={100}>
              <HoverCardTrigger asChild>
                <div className="flex items-center gap-0.5 text-[8px] text-orange-600 dark:text-orange-400 cursor-pointer">
                  <Ban className="h-2 w-2" />
                  <span className="truncate max-w-[60px]">
                    {seat.previouslyCanceled.wasDeclined ? 'Declined' : 'Cancelled'}
                  </span>
                </div>
              </HoverCardTrigger>
              <HoverCardContent 
                side="top" 
                align="center"
                sideOffset={8}
                className="text-xs max-w-[220px] z-[9999] p-3"
                avoidCollisions={true}
                collisionPadding={{ top: 50, bottom: 50, left: 20, right: 20 }}
              >
                <p className="font-medium">{seat.previouslyCanceled.contestantName}</p>
                <p className="text-muted-foreground">
                  {seat.previouslyCanceled.wasDeclined ? 'Declined' : 'Cancelled'}
                  {seat.previouslyCanceled.canceledAt && (
                    <> on {new Date(seat.previouslyCanceled.canceledAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</>
                  )}
                </p>
                {seat.previouslyCanceled.reason && (
                  <p className="text-[10px] text-muted-foreground italic mt-1 break-words">
                    {seat.previouslyCanceled.reason.replace(/^\[DECLINED\]\s*/i, '')}
                  </p>
                )}
              </HoverCardContent>
            </HoverCard>
          )}
        </div>
      ) : (
        <div className="space-y-1 overflow-hidden">
          <div className="flex items-center gap-1 text-[10px] font-mono opacity-70">
            <span>{seatLabel}</span>
          </div>
          <div className="flex items-center gap-1 min-w-0 flex-wrap">
            <p className="font-medium text-xs truncate min-w-0 max-w-[80px]" title={seat.contestantName}>
              {seat.contestantName}
            </p>
            {seat.isReturning && (() => {
              const wasStandbyOnly = seat.returningInfo && seat.returningInfo.length > 0 && seat.returningInfo.every((h: any) => h.type === 'standby');
              return (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className={`h-4 px-1 text-[9px] font-bold cursor-help relative z-[5] ${wasStandbyOnly ? 'border-purple-500 bg-purple-100 text-purple-700 dark:border-purple-600 dark:bg-purple-900/30 dark:text-purple-300' : 'border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300'}`}
                      data-testid={`badge-returning-${seat.assignmentId}`}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      RTN
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent 
                    side="top" 
                    className="text-xs max-w-[200px] z-[9999] bg-popover text-popover-foreground border shadow-md p-2"
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => e.stopPropagation()}
                  >
                    <div className="space-y-1">
                      <p className="font-bold border-b pb-1 mb-1">
                        {wasStandbyOnly ? 'Returning Standby' : 'Returning Contestant'}
                      </p>
                      {seat.returningInfo?.map((info: any, idx: number) => (
                        <div key={idx} className="flex flex-col text-[11px] leading-tight">
                          <span className="font-medium">{info.label} ({info.date})</span>
                          <span className="text-muted-foreground">
                            {info.type === 'standby' ? 'Standby (Not Seated)' : `Seated${info.blockType ? ` - ${info.blockType}` : ''}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })()}
            {seat.isFromReschedule && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="outline" 
                    className="h-4 px-1 bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800 text-[9px] font-bold cursor-help"
                    data-testid={`badge-reschedule-${seat.assignmentId}`}
                  >
                    RESCH
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs font-medium">Rebooked from Reschedule list</p>
                </TooltipContent>
              </Tooltip>
            )}
            {seat.signedIn && isRXDayLocked && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`signed-in-icon-${seat.assignmentId}`} className="flex items-center justify-center w-3 h-3 rounded-full bg-green-500 dark:bg-green-600">
                    <Check className="h-2.5 w-2.5 text-white" style={{ strokeWidth: 3 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Signed in</p>
                </TooltipContent>
              </Tooltip>
            )}
            {seat.isGroupSeparated && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`separated-icon-${seat.assignmentId}`}>
                    <Users className="h-3 w-3 text-red-600 dark:text-red-400 flex-shrink-0" style={{ strokeWidth: 2.5 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Group member not adjacent</p>
                </TooltipContent>
              </Tooltip>
            )}
            {(hasMeaningfulMedicalNote(seat.mobilityNotes) || hasMeaningfulMedicalNote(seat.medicalInfo) || hasMeaningfulMedicalNote(seat.mobilityNotesOverride)) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`mobility-icon-${seat.assignmentId}`}>
                    <Plus className="h-3 w-3 text-red-600 dark:text-red-400 flex-shrink-0" style={{ strokeWidth: 3 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has mobility/medical notes{seat.mobilityNotesOverride ? ' (updated)' : ''}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {seat.age && seat.age >= 70 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`senior-icon-${seat.assignmentId}`}>
                    <Plus className="h-3 w-3 text-blue-600 dark:text-blue-400 flex-shrink-0" style={{ strokeWidth: 3 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Age 70+</p>
                </TooltipContent>
              </Tooltip>
            )}
            {(() => {
              const distanceInfo = getDistanceFromDocklands(seat.contestantLocation);
              if (distanceInfo?.isInterstate) {
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span 
                        className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-red-200/70 text-red-700 dark:bg-red-900/50 dark:text-red-400 text-[8px] font-bold flex-shrink-0" 
                        data-testid={`distance-icon-${seat.assignmentId}`}
                      >
                        !!
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>Interstate: {distanceInfo.state || 'Not Victoria'}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              } else if (distanceInfo?.isOver60km) {
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span 
                        className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-yellow-200/70 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400 text-[9px] font-bold flex-shrink-0" 
                        data-testid={`distance-icon-${seat.assignmentId}`}
                      >
                        !
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>Distance: {distanceInfo.distance?.toFixed(0)}km from Docklands</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return null;
            })()}
            {seat.winningMoneyAmount !== undefined && (
              <div 
                className={`flex items-center gap-0.5 px-1 rounded-sm text-[10px] font-bold bg-green-600 text-white shadow-sm flex-shrink-0 cursor-pointer hover:bg-green-700 transition-colors h-4`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onWinningMoneyClick && seat.assignmentId) {
                    onWinningMoneyClick(seat.assignmentId);
                  }
                }}
                data-testid={`winning-money-badge-${seat.assignmentId}`}
              >
                <DollarSign className="h-2.5 w-2.5" />
                <span>{seat.winningMoneyAmount.toLocaleString()}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] opacity-70">
            <span>{seat.gender === 'Male' ? 'M' : 'F'} / {seat.age || '?'}</span>
            {seat.auditionRating && (
              <Badge 
                variant="outline" 
                className="h-3 px-1 text-[8px] font-bold bg-white/20"
                data-testid={`badge-rating-${seat.assignmentId}`}
              >
                {seat.auditionRating}
              </Badge>
            )}
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {seatContent}
      </ContextMenuTrigger>
      {!isEmpty && (
        <ContextMenuContent className="w-56" data-testid={`context-menu-${seat.assignmentId}`}>
          <div className="px-2 py-1.5 flex flex-col gap-1 border-b mb-1">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                {seat.photoUrl ? (
                  <AvatarImage 
                    src={seat.photoUrl} 
                    alt={seat.contestantName}
                    className="object-cover"
                    data-testid={`avatar-image-${seat.contestantId}`}
                  />
                ) : null}
                <AvatarFallback>{seat.contestantName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-bold truncate leading-tight">{seat.contestantName}</p>
                <p className="text-[10px] text-muted-foreground">{seat.gender} | Age {seat.age || '?'}</p>
              </div>
            </div>
            {seat.auditionRating && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge className={`h-4 px-1 text-[9px] ${ratingColors[seat.auditionRating].bg} ${ratingColors[seat.auditionRating].text} border-${ratingColors[seat.auditionRating].border}`}>
                  {seat.auditionRating}
                </Badge>
                {seat.playerType && (
                  <Badge variant="outline" className="h-4 px-1 text-[9px] bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    {seat.playerType.replace('_', ' ').toUpperCase()}
                  </Badge>
                )}
              </div>
            )}
          </div>

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5"
            onClick={() => {
              if (seat.assignmentId) {
                onWinningMoneyClick?.(seat.assignmentId);
              }
            }}
            data-testid={`menu-item-winning-money-${seat.assignmentId}`}
          >
            <DollarSign className="h-3.5 w-3.5" />
            Winning Money / Role
          </ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger className="flex items-center gap-2 text-xs py-1.5" data-testid={`menu-sub-player-type-${seat.assignmentId}`}>
              <Users className="h-3.5 w-3.5" />
              Change Role (Casting)
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem 
                className={`flex items-center justify-between text-xs ${localPlayerType === 'player' ? 'bg-accent' : ''}`}
                onClick={() => handlePlayerTypeChange('player')}
                data-testid={`menu-item-role-player-${seat.assignmentId}`}
              >
                <span>PLAYER</span>
                {localPlayerType === 'player' && <Check className="h-3.5 w-3.5 ml-auto" />}
              </ContextMenuItem>
              <ContextMenuItem 
                className={`flex items-center justify-between text-xs ${localPlayerType === 'backup' ? 'bg-accent' : ''}`}
                onClick={() => handlePlayerTypeChange('backup')}
                data-testid={`menu-item-role-backup-${seat.assignmentId}`}
              >
                <span>BACKUP</span>
                {localPlayerType === 'backup' && <Check className="h-3.5 w-3.5 ml-auto" />}
              </ContextMenuItem>
              <ContextMenuItem 
                className={`flex items-center justify-between text-xs ${localPlayerType === 'player_partner' ? 'bg-accent' : ''}`}
                onClick={() => handlePlayerTypeChange('player_partner')}
                data-testid={`menu-item-role-partner-${seat.assignmentId}`}
              >
                <span>PARTNER</span>
                {localPlayerType === 'player_partner' && <Check className="h-3.5 w-3.5 ml-auto" />}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem 
                className={`flex items-center justify-between text-xs ${!localPlayerType ? 'bg-accent' : ''}`}
                onClick={() => handlePlayerTypeChange('none')}
                data-testid={`menu-item-role-none-${seat.assignmentId}`}
              >
                <span>None (Default)</span>
                {!localPlayerType && <Check className="h-3.5 w-3.5 ml-auto" />}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger className="flex items-center gap-2 text-xs py-1.5" data-testid={`menu-sub-rating-${seat.assignmentId}`}>
              <ShieldAlert className="h-3.5 w-3.5" />
              Update Audition Rating
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {['A+', 'A', 'B+', 'B', 'C'].map((rating) => (
                <ContextMenuItem 
                  key={rating}
                  className={`flex items-center justify-between text-xs ${seat.auditionRating === rating ? 'bg-accent' : ''}`}
                  onClick={() => onRatingChange?.(seat.contestantId!, rating)}
                  data-testid={`menu-item-rating-${rating}-${seat.assignmentId}`}
                >
                  <span>{rating}</span>
                  {seat.auditionRating === rating && <Check className="h-3.5 w-3.5 ml-auto" />}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5"
            onClick={handlePodiumStoryToggle}
            data-testid={`menu-item-podium-story-${seat.assignmentId}`}
          >
            {localPodiumStory ? <XCircle className="h-3.5 w-3.5 text-red-500" /> : <Plus className="h-3.5 w-3.5 text-green-500" />}
            {localPodiumStory ? "Remove Podium Story" : "Add Podium Story"}
          </ContextMenuItem>

          <ContextMenuSeparator />

          <div className="px-2 py-1.5 space-y-2 border-b">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 mb-1">
                <MessageSquare className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Seating/OTD Notes</span>
              </div>
              <Textarea 
                value={localNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Add private producer notes for this record day..."
                className="text-[11px] min-h-[60px] p-1.5 leading-tight resize-none border-muted focus-visible:ring-primary/20"
                data-testid={`context-textarea-notes-${seat.assignmentId}`}
              />
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 mb-1">
                <UserCheck className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Attending With Override</span>
              </div>
              <div className="flex gap-1">
                <Input 
                  value={localAttendingWith}
                  onChange={(e) => setLocalAttendingWith(e.target.value)}
                  onBlur={handleAttendingWithSave}
                  onKeyDown={(e) => e.key === 'Enter' && handleAttendingWithSave()}
                  placeholder={seat.attendingWith || "Override partner name..."}
                  className="h-7 text-[11px] px-1.5"
                  data-testid={`context-input-attending-with-${seat.assignmentId}`}
                />
              </div>
            </div>
          </div>

          <ContextMenuSeparator />
          
          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5 text-red-600 dark:text-red-400"
            onClick={() => seat.assignmentId && onNoShow?.(seat.assignmentId, seat.contestantId!, blockIndex + 1, seatLabel)}
            data-testid={`menu-item-no-show-${seat.assignmentId}`}
          >
            <UserX className="h-3.5 w-3.5" />
            Mark as No Show
          </ContextMenuItem>

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5 text-orange-600 dark:text-orange-400"
            onClick={() => seat.assignmentId && onEarlyLeaver?.(seat.assignmentId, seat.contestantId!, blockIndex + 1, seatLabel)}
            data-testid={`menu-item-early-leaver-${seat.assignmentId}`}
          >
            <Clock className="h-3.5 w-3.5" />
            Mark as Early Leaver
          </ContextMenuItem>

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5 text-red-600 dark:text-red-400"
            onClick={() => seat.assignmentId && onNoLongerWantToAttend?.(seat.assignmentId, seat.contestantId!, blockIndex + 1, seatLabel)}
            data-testid={`menu-item-cancel-booking-${seat.assignmentId}`}
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel Booking (Will not attend)
          </ContextMenuItem>

          <ContextMenuSeparator />

          {seat.wasStandby && (
            <ContextMenuItem 
              className="flex items-center gap-2 text-xs py-1.5"
              onClick={() => seat.assignmentId && onReturnToStandby?.(seat.assignmentId, seat.contestantId!)}
              data-testid={`menu-item-return-to-standby-${seat.assignmentId}`}
            >
              <Undo2 className="h-3.5 w-3.5" />
              Unseat & Return to Standby List
            </ContextMenuItem>
          )}

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5"
            onClick={() => {
              if (seat.assignmentId) {
                onCancel?.(seat.assignmentId);
              }
            }}
            data-testid={`menu-item-cancel-${seat.assignmentId}`}
          >
            <X className="h-3.5 w-3.5" />
            Cancel Assignment (Not attending)
          </ContextMenuItem>

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5 text-destructive"
            onClick={() => setShowRemoveConfirm(true)}
            data-testid={`menu-item-remove-${seat.assignmentId}`}
          >
            <Ban className="h-3.5 w-3.5" />
            Remove from Seating Chart
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem 
            className="flex items-center gap-2 text-xs py-1.5"
            onClick={() => seat.contestantId && onPrizeWinner?.(seat.contestantId, seat.contestantName!, blockIndex + 1, seatLabel)}
            data-testid={`menu-item-prize-winner-${seat.assignmentId}`}
          >
            <Gift className="h-3.5 w-3.5 text-amber-500" />
            Prize Winner
          </ContextMenuItem>

          {seat.isTemporary && (
            <ContextMenuItem 
              className="flex items-center gap-2 text-xs py-1.5 text-blue-600 dark:text-blue-400"
              onClick={() => seat.contestantId && onEditTempContestant?.(seat.contestantId)}
              data-testid={`menu-item-edit-temp-${seat.assignmentId}`}
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit Temp Contestant
            </ContextMenuItem>
          )}

          {(seat.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(seat.contestantName!)) && (
            <ContextMenuItem 
              className="flex items-center gap-2 text-xs py-1.5 text-destructive"
              onClick={() => seat.contestantId && onDeleteTestSubject?.(seat.contestantId)}
              data-testid={`menu-item-delete-test-${seat.assignmentId}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Test Subject
            </ContextMenuItem>
          )}

          {neighbors.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger className="flex items-center gap-2 text-xs py-1.5">
                  <Link2 className="h-3.5 w-3.5" />
                  Link With Neighbor
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-56">
                  {neighbors.map((neighbor) => (
                    <ContextMenuItem 
                      key={neighbor.contestantId}
                      className="text-xs py-1.5 flex items-center justify-between"
                      onClick={() => onLinkWithNeighbor?.(seat.contestantId!, neighbor.contestantId)}
                      data-testid={`menu-item-link-neighbor-${neighbor.seatLabel}-${seat.assignmentId}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="h-5 w-5 flex-shrink-0">
                          {neighbor.photoUrl ? (
                            <AvatarImage src={neighbor.photoUrl} alt={neighbor.contestantName} className="object-cover" />
                          ) : null}
                          <AvatarFallback className="text-[8px]">{neighbor.contestantName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="truncate">{neighbor.contestantName}</span>
                      </div>
                      <Badge variant="outline" className="text-[8px] h-3 px-1 ml-1 flex-shrink-0">{neighbor.seatLabel}</Badge>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}
          
          <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Contestant?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove <strong>{seat.contestantName}</strong> from block {blockIndex + 1}, seat {seatLabel}. 
                  The contestant will remain in the system.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    if (seat.assignmentId) {
                      onRemove?.(seat.assignmentId);
                    }
                  }}
                  data-testid="button-confirm-remove"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
