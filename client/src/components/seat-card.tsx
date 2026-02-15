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
  criminalRecord?: string; // Criminal record notes
  isTemporary?: boolean; // True if contestant was created as temporary (not from Cast It Reach)
  isTestSubject?: boolean; // True if contestant is a test subject that can be deleted from any page
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
            {seat.isFromReschedule && (
              <Badge variant="outline" className="text-[7px] px-0.5 py-0 h-3 border-red-400 bg-red-100 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300" title="Rebooked from reschedule list">
                RSCH
              </Badge>
            )}
            {seat.wasStandby && (
              <Badge variant="outline" className="text-[7px] px-0.5 py-0 h-3 border-purple-400 bg-purple-100 text-purple-700 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300" title="Originally booked as standby">
                STBY
              </Badge>
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
                      <p>{distanceInfo.distance}km from Docklands (over 60km)</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return null;
            })()}
            {hasMeaningfulMedicalNote(seat.criminalRecord) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`criminal-icon-${seat.assignmentId}`}>
                    <ShieldAlert className="h-3 w-3 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has criminal record notes</p>
                </TooltipContent>
              </Tooltip>
            )}
            {seat.podiumStory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span 
                    className="inline-flex items-center justify-center px-1 h-3.5 rounded bg-purple-200/70 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400 text-[9px] font-bold flex-shrink-0" 
                    data-testid={`podium-story-icon-${seat.assignmentId}`}
                  >
                    PS
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has podium story</p>
                </TooltipContent>
              </Tooltip>
            )}
            {seat.availabilityStatus === 'rescheduled' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`rescheduled-icon-${seat.assignmentId}`}>
                    <Clock className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0" style={{ strokeWidth: 2.5 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Reschedule contestant</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1">
            {seat.playerType && (
              <Badge 
                variant="outline"
                className={`h-5 px-1.5 text-[9px] font-semibold ${
                  seat.playerType === 'player' ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700' :
                  seat.playerType === 'backup' ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700' :
                  'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-500 border-emerald-200 dark:border-emerald-800'
                }`}>
                {seat.playerType === 'player' ? 'P' : seat.playerType === 'backup' ? 'B' : 'PP'}
              </Badge>
            )}
            {isRXDayLocked && seat.winningMoneyAmount != null && seat.winningMoneyRole && (
              <div title={`$${seat.winningMoneyAmount}`}>
                <DollarSign className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 opacity-70 text-[10px]">
            <span>{seat.age}</span>
            <span>•</span>
            <span>{seat.gender?.[0]}</span>
          </div>
        </div>
      )}
    </Card>
  );

  // Filter neighbors that can be linked (not already in the same group)
  const linkableNeighbors = neighbors.filter(n => {
    // Can't link with self
    if (n.contestantId === seat.contestantId) return false;
    // If both already in the same group, can't link
    if (seat.groupId && n.groupId && seat.groupId === n.groupId) return false;
    return true;
  });
  
  // Wrap occupied seats with HoverCard for details (disabled during drag)
  if (!isEmpty && !isGlobalDragging) {
    return (
      <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                {seatContent}
              </HoverCardTrigger>
        <HoverCardContent 
          className="w-80 z-[100] max-h-[80vh] overflow-y-auto" 
          side="bottom" 
          align="center"
          sideOffset={8}
          avoidCollisions={true}
          collisionPadding={{ top: 150, bottom: 50, left: 20, right: 20 }}
          sticky="partial"
          data-testid="hovercard-contestant-details"
        >
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
                      <div className="flex items-center gap-1">
                        <h4 className="text-sm font-semibold">{contestantDetails.name}</h4>
                        {contestantDetails.isTemporary && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">
                            TEMP
                          </Badge>
                        )}
                        {contestantDetails.isTestSubject && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                            TEST
                          </Badge>
                        )}
                      </div>
                      {contestantDetails.auditionRating && (
                        <div className="flex flex-col items-center">
                          <span className={`text-sm font-bold ${
                            contestantDetails.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                            contestantDetails.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                            contestantDetails.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                            contestantDetails.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                            contestantDetails.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' :
                            contestantDetails.auditionRating === 'P' ? 'text-purple-600 dark:text-purple-400' : ''
                          }`}>
                            {contestantDetails.auditionRating}
                          </span>
                          {onRatingChange && seat.contestantId && (
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="p-0.5 rounded hover:bg-muted/50 transition-colors opacity-40 hover:opacity-100"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  data-testid={`button-edit-rating-${seat.contestantId}`}
                                >
                                  <Edit2 className="w-2.5 h-2.5 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent 
                                align="end" 
                                className="min-w-0 z-[11000]"
                                onPointerDownOutside={(e) => e.preventDefault()}
                                onCloseAutoFocus={(e) => e.preventDefault()}
                              >
                                <div className="flex flex-wrap gap-1 p-1">
                                  {['A+', 'A', 'P', 'B+', 'B', 'C'].map((rating) => {
                                    const isSelected = contestantDetails?.auditionRating === rating;
                                    const colors = isDarkMode ? ratingColorsDark[rating] : ratingColorsLight[rating];
                                    return (
                                      <button
                                        key={rating}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!isSelected) {
                                            onRatingChange(seat.contestantId!, rating);
                                          }
                                        }}
                                        className={`px-2 py-0.5 text-xs font-bold rounded border transition-colors ${
                                          isSelected 
                                            ? '' 
                                            : 'opacity-50 hover:opacity-100'
                                        }`}
                                        style={{
                                          backgroundColor: colors?.bg || 'transparent',
                                          borderColor: colors?.border || 'currentColor',
                                          color: colors?.text || 'inherit',
                                        }}
                                        data-testid={`button-rating-${rating}-${seat.contestantId}`}
                                      >
                                        {rating}
                                      </button>
                                    );
                                  })}
                                </div>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{contestantDetails.age} years old • {contestantDetails.gender}</p>
                    {contestantDetails.location && (
                      <p className="text-xs text-muted-foreground">{contestantDetails.location}</p>
                    )}
                  </div>
                </div>

                {/* Player Type - clickable badges (only for A+, A, and P rated contestants) */}
                {(seat.auditionRating === 'A+' || seat.auditionRating === 'A' || seat.auditionRating === 'P') && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Player Type</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayerTypeChange(localPlayerType === 'player' ? 'none' : 'player');
                        }}
                        disabled={updatePlayerTypeMutation.isPending}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                          localPlayerType === 'player' 
                            ? 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:border-blue-500' 
                            : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700 hover:bg-blue-500/20'
                        } disabled:opacity-50`}
                        data-testid={`button-player-type-player-${seat.assignmentId}`}
                      >
                        Player
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayerTypeChange(localPlayerType === 'backup' ? 'none' : 'backup');
                        }}
                        disabled={updatePlayerTypeMutation.isPending}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                          localPlayerType === 'backup' 
                            ? 'bg-amber-500 text-white border-amber-600 dark:bg-amber-600 dark:border-amber-500' 
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-500/20'
                        } disabled:opacity-50`}
                        data-testid={`button-player-type-backup-${seat.assignmentId}`}
                      >
                        Backup
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayerTypeChange(localPlayerType === 'player_partner' ? 'none' : 'player_partner');
                        }}
                        disabled={updatePlayerTypeMutation.isPending}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                          localPlayerType === 'player_partner' 
                            ? 'bg-emerald-500 text-white border-emerald-600 dark:bg-emerald-600 dark:border-emerald-500' 
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-500/20'
                        } disabled:opacity-50`}
                        data-testid={`button-player-type-partner-${seat.assignmentId}`}
                      >
                        Partner
                      </button>
                      {localPlayerType && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayerTypeChange('none');
                          }}
                          disabled={updatePlayerTypeMutation.isPending}
                          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          data-testid={`button-player-type-clear-${seat.assignmentId}`}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Podium Story Toggle - compact inline */}
                {seat.contestantId && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePodiumStoryToggle();
                    }}
                    disabled={togglePodiumStoryMutation.isPending}
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                      localPodiumStory 
                        ? 'bg-pink-500 text-white' 
                        : 'text-pink-400 hover:text-pink-600 hover:bg-pink-500/10'
                    } disabled:opacity-50`}
                    data-testid={`button-podium-story-toggle-${seat.contestantId}`}
                  >
                    {localPodiumStory ? 'PS' : '+PS'}
                  </button>
                )}

                {/* Attending With - shows original and allows override editing */}
                <div className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <UserCheck className="h-3 w-3" />
                      Attending With
                    </label>
                    {!isRXDayLocked && seat.assignmentId && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditingAttendingWith(!isEditingAttendingWith);
                        }}
                        data-testid={`button-edit-attending-with-${seat.assignmentId}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  
                  {isEditingAttendingWith ? (
                    <div className="space-y-2">
                      <Input
                        value={localAttendingWith}
                        onChange={(e) => setLocalAttendingWith(e.target.value)}
                        placeholder="Override attending with..."
                        className="h-8 text-xs"
                        data-testid={`input-attending-with-${seat.assignmentId}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAttendingWithSave();
                          if (e.key === 'Escape') {
                            setLocalAttendingWith(seat.attendingWithOverride || '');
                            setIsEditingAttendingWith(false);
                          }
                        }}
                      />
                      <div className="flex gap-1">
                        <Button size="sm" className="h-6 text-xs" onClick={handleAttendingWithSave}>
                          Save
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-6 text-xs"
                          onClick={() => {
                            setLocalAttendingWith(seat.attendingWithOverride || '');
                            setIsEditingAttendingWith(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      {contestantDetails?.attendingWith && (
                        <p className="text-[10px] text-muted-foreground">
                          Original: {contestantDetails.attendingWith}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      {/* Show effective attending with (override takes precedence) */}
                      {seat.attendingWithOverride ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                              UPDATED
                            </Badge>
                            <span className="text-sm">{seat.attendingWithOverride}</span>
                          </div>
                          {contestantDetails?.attendingWith && contestantDetails.attendingWith !== seat.attendingWithOverride && (
                            <p className="text-[10px] text-muted-foreground line-through">
                              Original: {contestantDetails.attendingWith}
                            </p>
                          )}
                        </div>
                      ) : contestantDetails?.attendingWith ? (
                        <p>{contestantDetails.attendingWith}</p>
                      ) : (
                        <p className="text-muted-foreground italic text-xs">Not specified</p>
                      )}
                    </div>
                  )}
                </div>

                {contestantDetails.availabilityNotes && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Availability Notes</label>
                    <p className="text-xs">{contestantDetails.availabilityNotes}</p>
                  </div>
                )}

                {hasMeaningfulMedicalNote(contestantDetails.medicalInfo) && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Medical Info</label>
                    <p className="text-xs">{contestantDetails.medicalInfo}</p>
                  </div>
                )}

                {(hasMeaningfulMedicalNote(contestantDetails.mobilityNotes) || hasMeaningfulMedicalNote(seat.mobilityNotesOverride)) && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Mobility/Access Notes</label>
                    {seat.mobilityNotesOverride ? (
                      <div>
                        <div className="flex items-center gap-1">
                          <Badge className="text-[9px] px-1 py-0 h-4 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                            UPDATED
                          </Badge>
                          <span className="text-xs">{seat.mobilityNotesOverride}</span>
                        </div>
                        {contestantDetails.mobilityNotes && contestantDetails.mobilityNotes !== seat.mobilityNotesOverride && (
                          <p className="text-[10px] text-muted-foreground line-through">
                            Original: {contestantDetails.mobilityNotes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs">{contestantDetails.mobilityNotes}</p>
                    )}
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

                {/* Notes - editable notes that sync with Booking Master NOTES column */}
                {seat.assignmentId && (
                  <div className="text-sm p-2 bg-muted/30 rounded-md border">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        Notes
                      </label>
                      {!isEditingNotes && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingNotes(true);
                          }}
                          data-testid={`button-edit-notes-${seat.assignmentId}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {isEditingNotes ? (
                      <>
                        <Textarea
                          value={localNotes}
                          onChange={(e) => handleNotesChange(e.target.value)}
                          placeholder="Add notes (syncs with Booking Master)..."
                          className="min-h-[60px] text-xs resize-none"
                          data-testid={`textarea-notes-${seat.assignmentId}`}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => setIsEditingNotes(false)}
                          autoFocus
                        />
                        {updateSeatDetailsMutation.isPending && (
                          <p className="text-[10px] text-muted-foreground mt-1">Saving...</p>
                        )}
                      </>
                    ) : (
                      <p 
                        className="text-xs text-muted-foreground min-h-[20px] cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditingNotes(true);
                        }}
                      >
                        {localNotes || <span className="italic">No notes</span>}
                      </p>
                    )}
                  </div>
                )}

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

                {isRXDayLocked && seat.winningMoneyAmount != null && seat.winningMoneyRole && (
                  <div className="text-sm p-2 bg-green-50 dark:bg-green-950/50 rounded-md border border-green-200 dark:border-green-800">
                    <label className="text-xs font-medium text-green-700 dark:text-green-300 block mb-2">Winning Money</label>
                    <div className="space-y-1 text-xs text-green-600 dark:text-green-400">
                      <p><strong>Role:</strong> {seat.winningMoneyRole === 'player' ? 'Player' : 'Case Holder'}</p>
                      <p><strong>Amount:</strong> ${seat.winningMoneyAmount}</p>
                      {seat.rxNumber && <p><strong>RX:</strong> {seat.rxNumber}</p>}
                      {seat.caseNumber && <p><strong>Case:</strong> {seat.caseNumber}</p>}
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
                {/* Edit button for temporary contestants */}
                {contestantDetails?.isTemporary && seat.contestantId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditTempContestant?.(seat.contestantId!);
                    }}
                    data-testid={`button-edit-temp-${seat.contestantId}`}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Edit Temporary Contestant
                  </Button>
                )}
                {/* Test subject delete button */}
                {seat.contestantId && (seat.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(seat.contestantName || '')) && onDeleteTestSubject && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-destructive border-destructive/50 hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove test subject ${seat.contestantName}?`)) {
                        onDeleteTestSubject(seat.contestantId!);
                      }
                    }}
                    data-testid={`button-delete-test-subject-${seat.contestantId}`}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remove Test Subject
                  </Button>
                )}
                {isRXDayLocked && seat.winningMoneyAmount != null && seat.winningMoneyRole && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWinningMoneyClick?.(seat.assignmentId!);
                    }}
                    data-testid={`button-edit-winning-money-${seat.assignmentId}`}
                  >
                    Edit Winning Money
                  </Button>
                )}
                {seat.wasStandby && seat.contestantId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReturnToStandby?.(seat.assignmentId!, seat.contestantId!);
                    }}
                    data-testid={`button-return-standby-${seat.assignmentId}`}
                  >
                    <Undo2 className="h-3 w-3 mr-1" />
                    Return to Standby
                  </Button>
                )}
                {isRXDayLocked && seat.contestantId && (
                  <>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 px-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          const seatLabel = seat.id.split('-').pop() || '';
                          onNoShow?.(seat.assignmentId!, seat.contestantId!, blockIndex + 1, seatLabel);
                        }}
                        data-testid={`button-no-show-${seat.assignmentId}`}
                      >
                        <UserX className="h-3 w-3 mr-0.5" />
                        <span className="text-[10px]">No Show</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 px-2 bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-100 dark:hover:bg-orange-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          const seatLabel = seat.id.split('-').pop() || '';
                          onEarlyLeaver?.(seat.assignmentId!, seat.contestantId!, blockIndex + 1, seatLabel);
                        }}
                        data-testid={`button-early-leaver-${seat.assignmentId}`}
                      >
                        <Clock className="h-3 w-3 mr-0.5" />
                        <span className="text-[10px]">Early</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 px-2 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          const seatLabel = seat.id.split('-').pop() || '';
                          onPrizeWinner?.(seat.contestantId!, seat.contestantName || '', blockIndex + 1, seatLabel);
                        }}
                        data-testid={`button-prize-winner-${seat.assignmentId}`}
                      >
                        <Gift className="h-3 w-3 mr-0.5" />
                        <span className="text-[10px]">Prize</span>
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full px-2 bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900"
                      onClick={(e) => {
                        e.stopPropagation();
                        const seatLabel = seat.id.split('-').pop() || '';
                        onNoLongerWantToAttend?.(seat.assignmentId!, seat.contestantId!, blockIndex + 1, seatLabel);
                      }}
                      data-testid={`button-no-longer-attend-${seat.assignmentId}`}
                    >
                      <XCircle className="h-3 w-3 mr-0.5" />
                      <span className="text-[10px]">No Longer Wants to Attend</span>
                    </Button>
                  </>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRemoveConfirm(true);
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
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {linkableNeighbors.length > 0 && onLinkWithNeighbor && seat.contestantId && (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Link2 className="mr-2 h-4 w-4" />
                  <span>Link with Neighbor</span>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-56">
                  {linkableNeighbors.map((neighbor) => (
                    <ContextMenuItem
                      key={neighbor.contestantId}
                      onClick={() => onLinkWithNeighbor(seat.contestantId!, neighbor.contestantId)}
                      data-testid={`context-link-neighbor-${neighbor.contestantId}`}
                    >
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          {neighbor.photoUrl ? (
                            <AvatarImage src={neighbor.photoUrl} className="object-cover" />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {neighbor.contestantName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{neighbor.contestantName}</p>
                          <p className="text-xs text-muted-foreground">
                            Block {neighbor.blockNumber} Seat {neighbor.seatLabel}
                            {neighbor.groupId && ' (in group)'}
                          </p>
                        </div>
                      </div>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          {linkableNeighbors.length === 0 && (
            <ContextMenuItem disabled>
              <span className="text-muted-foreground text-xs">No neighbors to link with</span>
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Contestant from Seat?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{seat.contestantName}</strong> from this seat? 
              They will be returned to the unassigned pool.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onRemove?.(seat.assignmentId!);
                setShowRemoveConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
    );
  }

  return seatContent;
}
