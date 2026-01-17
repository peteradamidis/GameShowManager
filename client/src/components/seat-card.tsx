import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { User, X, Ban, Plus, ArrowLeftRight, DollarSign, Undo2, Users, UserX, Clock, ShieldAlert, Pencil, MessageSquare, UserCheck } from "lucide-react";
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
  isGroupSeparated?: boolean; // True if contestant has a partner/group member not sitting adjacent
  photoUrl?: string; // Contestant photo URL for podium visualiser
  contestantLocation?: string; // Contestant's location for 60km distance check
  criminalRecord?: string; // Criminal record notes
  isTemporary?: boolean; // True if contestant was created as temporary (not from Cast It Reach)
  otdNotes?: string; // OTD notes (syncs with Booking Master OTD notes column)
  attendingWithOverride?: string; // Override for attending with when it changes after invitation
}

interface SeatCardProps {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isDragging?: boolean;
  isGlobalDragging?: boolean; // True when ANY seat is being dragged - disables hover cards
  isRXDayLocked?: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
  onReturnToStandby?: (assignmentId: string, contestantId: string) => void;
  onNoShow?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onEarlyLeaver?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onEditTempContestant?: (contestantId: string) => void;
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
  'A+': { bg: '#dcfce7', border: '#16a34a' }, // Bright green
  'A': { bg: '#dbeafe', border: '#3b82f6' }, // Faded blue
  'P': { bg: '#e0f2e0', border: '#6aaa6a' }, // Faded/muted green (less saturated than A+)
  'B+': { bg: '#fef3c7', border: '#f59e0b' },
  'B': { bg: '#fed7aa', border: '#f97316' },
  'C': { bg: '#fee2e2', border: '#ef4444' },
};

// Standby styling - purple to distinguish from regular contestants
const standbyColors = { bg: '#f3e8ff', border: '#9333ea' };

export function SeatCard({ 
  seat, 
  blockIndex, 
  seatIndex, 
  isDragging = false, 
  isGlobalDragging = false,
  isRXDayLocked = false,
  onEmptySeatClick, 
  onRemove, 
  onCancel,
  onWinningMoneyClick,
  onRemoveWinningMoney,
  onReturnToStandby,
  onNoShow,
  onEarlyLeaver,
  onEditTempContestant,
}: SeatCardProps) {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [localOtdNotes, setLocalOtdNotes] = useState(seat.otdNotes || '');
  const [localAttendingWith, setLocalAttendingWith] = useState(seat.attendingWithOverride || '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingAttendingWith, setIsEditingAttendingWith] = useState(false);
  const { toast } = useToast();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync local state with prop changes
  useEffect(() => {
    setLocalOtdNotes(seat.otdNotes || '');
  }, [seat.otdNotes]);
  
  useEffect(() => {
    setLocalAttendingWith(seat.attendingWithOverride || '');
  }, [seat.attendingWithOverride]);
  
  const isEmpty = !seat.contestantName;
  
  // Mutation for updating OTD notes and attending with override
  const updateSeatDetailsMutation = useMutation({
    mutationFn: async (data: { otdNotes?: string; attendingWithOverride?: string }) => {
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
  const handleOtdNotesChange = (value: string) => {
    setLocalOtdNotes(value);
    // Guard: only save if we have a valid assignment ID
    if (!seat.assignmentId) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (seat.assignmentId) {
        updateSeatDetailsMutation.mutate({ otdNotes: value });
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
    // Stop propagation to prevent drag-and-drop from interfering
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
            {(hasMeaningfulMedicalNote(seat.mobilityNotes) || hasMeaningfulMedicalNote(seat.medicalInfo)) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div data-testid={`mobility-icon-${seat.assignmentId}`}>
                    <Plus className="h-3 w-3 text-red-600 dark:text-red-400 flex-shrink-0" style={{ strokeWidth: 3 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has mobility/medical notes</p>
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
              if (distanceInfo?.isOver60km) {
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
          </div>
          <div className="flex items-center gap-1">
            {seat.playerType && (
              <Badge 
                variant="outline"
                className={`h-5 px-1.5 text-[9px] font-semibold ${
                  seat.playerType === 'player' ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700' :
                  seat.playerType === 'backup' ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700' :
                  'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700'
                }`}>
                {seat.playerType === 'player' ? 'P' : seat.playerType === 'backup' ? 'B' : 'PP'}
              </Badge>
            )}
            {isRXDayLocked && seat.winningMoneyAmount > 0 && (
              <div title={`$${seat.winningMoneyAmount}`}>
                <DollarSign className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
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

  // Wrap occupied seats with HoverCard for details (disabled during drag)
  if (!isEmpty && !isGlobalDragging) {
    return (
      <>
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
                    {contestantDetails.location && (
                      <p className="text-xs text-muted-foreground">{contestantDetails.location}</p>
                    )}
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

                {hasMeaningfulMedicalNote(contestantDetails.mobilityNotes) && (
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

                {/* OTD Notes - editable notes that sync with Booking Master OTD notes column */}
                {seat.assignmentId && (
                  <div className="text-sm p-2 bg-muted/30 rounded-md border">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        OTD Notes
                      </label>
                    </div>
                    <Textarea
                      value={localOtdNotes}
                      onChange={(e) => handleOtdNotesChange(e.target.value)}
                      placeholder="Add OTD notes (syncs with Booking Master)..."
                      className="min-h-[60px] text-xs resize-none"
                      data-testid={`textarea-otd-notes-${seat.assignmentId}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {updateSeatDetailsMutation.isPending && (
                      <p className="text-[10px] text-muted-foreground mt-1">Saving...</p>
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

                {isRXDayLocked && seat.winningMoneyAmount > 0 && (
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
                {isRXDayLocked && seat.winningMoneyAmount > 0 && (
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
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900"
                      onClick={(e) => {
                        e.stopPropagation();
                        const seatLabel = seat.id.split('-').pop() || '';
                        onNoShow?.(seat.assignmentId!, seat.contestantId!, blockIndex + 1, seatLabel);
                      }}
                      data-testid={`button-no-show-${seat.assignmentId}`}
                    >
                      <UserX className="h-3 w-3 mr-1" />
                      No Show
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-100 dark:hover:bg-orange-900"
                      onClick={(e) => {
                        e.stopPropagation();
                        const seatLabel = seat.id.split('-').pop() || '';
                        onEarlyLeaver?.(seat.assignmentId!, seat.contestantId!, blockIndex + 1, seatLabel);
                      }}
                      data-testid={`button-early-leaver-${seat.assignmentId}`}
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      Early Leaver
                    </Button>
                  </div>
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
