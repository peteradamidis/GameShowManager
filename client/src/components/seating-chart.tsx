import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  useDraggable,
  useDroppable,
  DragOverlay,
  CollisionDetection,
} from "@dnd-kit/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeatCard, SeatData, NeighborSeat } from "./seat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { BlockType } from "@shared/schema";
import { Link2, AlertTriangle, ChevronUp, ChevronDown, User, Check, Gift, X, Users, Phone, Mail, GripVertical, Briefcase, MapPin, ShieldAlert, Heart, StickyNote, MousePointerClick, Plus, ArrowDown } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import stageBackdropImage from "@/assets/stage-backdrop.png";
import podiumSetImage from "@/assets/podium-set.png";
import centreStageImage from "@/assets/centre-stage.png";
import { useRef } from "react";

// Debounced input for block notes - uses local state for instant feedback
function DebouncedBlockNoteInput({ 
  value, 
  onChange, 
  blockIndex 
}: { 
  value: string; 
  onChange: (value: string) => void; 
  blockIndex: number;
}) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync local value when external value changes (e.g., from server)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue); // Instant local update
    
    // Debounce the parent callback
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300);
  };
  
  return (
    <input
      type="text"
      placeholder="Add block notes..."
      value={localValue}
      onChange={handleChange}
      className={`w-full text-xs px-2 py-1 rounded border transition-colors ${
        localValue 
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100' 
          : 'bg-muted/50 border-transparent hover:border-muted-foreground/20'
      } focus:outline-none focus:ring-1 focus:ring-primary/50`}
      data-testid={`block-note-input-${blockIndex}`}
    />
  );
}

// Photo-only seat for Podium Visualiser mode
function PhotoOnlySeat({ seat, seatLabel, blockIndex, seatIndex }: { 
  seat: SeatData; 
  seatLabel: string;
  blockIndex: number;
  seatIndex: number;
}) {
  const isEmpty = !seat.contestantName;
  
  return (
    <div 
      className="aspect-square rounded-lg overflow-hidden bg-muted/30 border border-border flex items-center justify-center"
      data-testid={`podium-seat-${blockIndex}-${seatIndex}`}
    >
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center text-muted-foreground" data-testid={`seat-empty-${blockIndex}-${seatIndex}`}>
          <User className="h-4 w-4 opacity-40" />
          <span className="text-[9px] font-mono mt-1">{seatLabel}</span>
        </div>
      ) : (
        <div className="relative w-full h-full" data-testid={`seat-photo-${seat.contestantId}`}>
          {seat.photoUrl ? (
            <img 
              src={seat.photoUrl} 
              alt={seat.contestantName || 'Contestant'} 
              className="w-full h-full object-cover"
              data-testid={`img-contestant-${seat.contestantId}`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
              <span className="text-2xl font-bold text-muted-foreground/60" data-testid={`text-initials-${seat.contestantId}`}>
                {seat.contestantName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
            <p className="text-[9px] text-white truncate text-center font-medium" data-testid={`text-name-${seat.contestantId}`}>
              {seat.contestantName?.split(' ')[0]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Pending swap operation type
interface PendingSwap {
  sourceSeat: { blockIdx: number; seatIdx: number; seat: SeatData };
  targetSeat: { blockIdx: number; seatIdx: number; seat: SeatData };
  sourceLocation: { blockNumber: number; seatLabel: string };
  targetLocation: { blockNumber: number; seatLabel: string };
}

// Standby data type
interface StandbyData {
  id: string;
  contestantId: string;
  recordDayId: string;
  status: string;
  priority?: number;
  standbyGroupId?: string | null;
  standbyMovementNotes?: string | null;
  assignedToSeat?: string | null;
  signedIn?: string | null;
  contestant: {
    id: string;
    name: string;
    gender: string;
    age: number;
    auditionRating?: string;
    phone?: string | null;
    email?: string | null;
    attendingWith?: string | null;
    groupId?: string | null;
    suburb?: string | null;
    location?: string | null;
    photoUrl?: string | null;
    medicalInfo?: string | null;
    mobilityNotes?: string | null;
    criminalRecord?: string | null;
    availabilityNotes?: string | null;
    availabilityStatus?: string | null;
    podiumStory?: boolean;
  };
}

export interface OverflowAssignment {
  id: string;
  contestantId: string;
  contestantName: string;
  gender?: string;
  age?: number;
  auditionRating?: string;
  groupId?: string;
  attendingWith?: string;
  photoUrl?: string;
  seatLabel?: string;
  bookingEmailSent?: boolean;
  confirmedRsvp?: boolean;
  availabilityStatus?: string;
  mobilityNotes?: string;
  isTemporary?: boolean;
  isTestSubject?: boolean;
  phone?: string;
  email?: string;
  contestantLocation?: string;
  medicalInfo?: string;
  criminalRecord?: string;
  availabilityNotes?: string;
  podiumStory?: boolean;
  attendingWithRaw?: string;
  availableForStandby?: boolean;
}

interface SeatingChartProps {
  recordDayId: string;
  initialSeats?: SeatData[][];
  onRefreshNeeded?: () => void;
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
  isLocked?: boolean;
  standbys?: StandbyData[];
  onStandbySeated?: () => void;
  isPodiumVisualizerMode?: boolean;
  searchQuery?: string;
  blockNotes?: Record<number, string>;
  onBlockNoteChange?: (blockNumber: number, notes: string) => void;
  showBookingStatus?: boolean;
  onRatingChange?: (contestantId: string, newRating: string) => void;
  overflowAssignments?: OverflowAssignment[];
  onAddOverflow?: () => void;
  onRemoveOverflow?: (assignmentId: string) => void;
  onMoveOverflowToSeat?: (overflowAssignment: OverflowAssignment) => void;
  onMoveToOverflow?: (assignmentId: string) => void;
}

function DraggableDroppableSeat({
  seat,
  blockIndex,
  seatIndex,
  isOver,
  isGlobalDragging,
  isRXDayLocked,
  isHighlighted,
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
  neighbors,
  onLinkWithNeighbor,
  isQuickMoveMode,
  isQuickMoveSelected,
  onQuickMoveClick,
  showBookingStatus,
  onRatingChange,
}: {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isOver: boolean;
  isGlobalDragging?: boolean;
  isRXDayLocked?: boolean;
  isHighlighted?: boolean;
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
  neighbors?: NeighborSeat[];
  onLinkWithNeighbor?: (contestantId: string, neighborContestantId: string) => void;
  isQuickMoveMode?: boolean;
  isQuickMoveSelected?: boolean;
  onQuickMoveClick?: (seatId: string) => void;
  showBookingStatus?: boolean;
  onRatingChange?: (contestantId: string, newRating: string) => void;
}) {
  // Make occupied seats draggable (but not in Quick Move mode)
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: seat.id,
    disabled: !seat.contestantName || isQuickMoveMode,
  });

  // Make all seats droppable
  const { setNodeRef: setDropRef } = useDroppable({
    id: seat.id,
  });

  // Combine refs
  const setRefs = (element: HTMLDivElement | null) => {
    setDragRef(element);
    setDropRef(element);
  };

  const highlightClass = isHighlighted 
    ? "ring-4 ring-yellow-400 dark:ring-yellow-500 rounded-lg animate-pulse" 
    : "";
  const overClass = isOver ? "ring-4 ring-primary rounded-lg scale-105 transition-all" : "";
  const quickMoveSelectedClass = isQuickMoveSelected
    ? "ring-4 ring-cyan-500 dark:ring-cyan-400 rounded-lg shadow-lg shadow-cyan-500/30"
    : "";
  const quickMoveCursorClass = isQuickMoveMode ? "cursor-pointer" : "";
  
  const handleClick = (e: React.MouseEvent) => {
    if (isQuickMoveMode && onQuickMoveClick) {
      e.preventDefault();
      e.stopPropagation();
      onQuickMoveClick(seat.id);
    }
  };
  
  return (
    <div 
      ref={setRefs} 
      {...(isQuickMoveMode ? {} : attributes)} 
      {...(isQuickMoveMode ? {} : listeners)}
      onClick={handleClick}
      className={`${overClass} ${highlightClass} ${quickMoveSelectedClass} ${quickMoveCursorClass}`.trim()}
      style={isOver || isHighlighted || isQuickMoveSelected ? { zIndex: 10 } : undefined}
    >
      <SeatCard
        seat={seat}
        blockIndex={blockIndex}
        seatIndex={seatIndex}
        isDragging={isDragging}
        isGlobalDragging={isGlobalDragging}
        isRXDayLocked={isRXDayLocked}
        isQuickMoveMode={isQuickMoveMode}
        onEmptySeatClick={onEmptySeatClick}
        onRemove={onRemove}
        onCancel={onCancel}
        onWinningMoneyClick={onWinningMoneyClick}
        onRemoveWinningMoney={onRemoveWinningMoney}
        onReturnToStandby={onReturnToStandby}
        onNoShow={onNoShow}
        onEarlyLeaver={onEarlyLeaver}
        onNoLongerWantToAttend={onNoLongerWantToAttend}
        onPrizeWinner={onPrizeWinner}
        onEditTempContestant={onEditTempContestant}
        onDeleteTestSubject={onDeleteTestSubject}
        neighbors={neighbors}
        onLinkWithNeighbor={onLinkWithNeighbor}
        showBookingStatus={showBookingStatus}
        onRatingChange={onRatingChange}
      />
    </div>
  );
}

// Helper function to check if a medical field has meaningful content (not NA/N/A/No/None/empty)
const hasMeaningfulMedicalNote = (value: string | undefined | null): boolean => {
  if (!value) return false;
  const trimmed = value.trim().toUpperCase();
  const ignoredValues = ['', 'NA', 'N/A', 'N / A', 'NO', 'N', 'NONE', '-'];
  return !ignoredValues.includes(trimmed);
};

// Sortable Standby Item with hover card
function SortableStandbyItem({
  standby,
  isLocked,
  isInGroup,
  isFirstInGroup,
  isLastInGroup,
  groupMemberNames,
  onSeatSelect,
  onUnseat,
  returningInfo,
}: {
  standby: StandbyData;
  isLocked?: boolean;
  isInGroup?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  groupMemberNames?: string[];
  onSeatSelect?: (standby: StandbyData) => void;
  onUnseat?: (standby: StandbyData) => void;
  returningInfo?: Array<{ recordDayId: string; date: string; label: string; type: string; blockType?: string }>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: standby.id,
    data: { type: 'sortable-standby', standby },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const ratingColors: Record<string, string> = {
    'A+': 'bg-emerald-500 text-white',
    'A': 'bg-green-500 text-white',
    'B+': 'bg-amber-500 text-white',
    'B': 'bg-orange-500 text-white',
    'C': 'bg-red-500 text-white',
    'R': 'bg-violet-400 text-white',
  };

  // Group styling
  const groupBorderClass = isInGroup 
    ? isLastInGroup 
      ? 'border-b-[3px] border-b-muted-foreground/30' 
      : 'border-b-transparent'
    : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? 'opacity-50 z-50' : ''}`}
      data-testid={`standby-item-${standby.id}`}
    >
      <HoverCard openDelay={300} closeDelay={50}>
        <HoverCardTrigger asChild>
          <div 
            {...attributes}
            {...listeners}
            className={`flex items-center gap-2 p-2 rounded-md bg-background border ${groupBorderClass} ${
              isInGroup && !isFirstInGroup ? 'rounded-t-none border-t-0' : ''
            } ${
              isInGroup && !isLastInGroup ? 'rounded-b-none' : ''
            } ${
              isInGroup ? 'ml-3 border-l-2 border-l-purple-400 dark:border-l-purple-600' : ''
            } ${isLocked ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed'} hover:bg-muted/50 transition-colors`}
            onClick={() => isLocked && onSeatSelect && onSeatSelect(standby)}
          >
            {/* Drag handle icon */}
            <div 
              className={`flex-shrink-0 p-1 rounded ${isLocked ? '' : 'opacity-40'}`}
              title={isLocked ? "Drag to reorder or drop on a seat" : "Lock RX Day to enable dragging"}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
            
            {/* Content */}
            <div className="flex-1 min-w-0">
              {returningInfo && returningInfo.length > 0 && (() => {
                const uniquePrevDays = new Set(returningInfo.map((h: any) => h.recordDayId));
                const hasMultiple = uniquePrevDays.size >= 1; // already filtered current
                if (!hasMultiple) return null;
                
                const rxDaysList = Array.from(new Map(returningInfo.map((h: any) => [h.recordDayId, h.label])).values()).join(", ");
                
                return (
                  <div className="flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 text-[9px] text-red-700 dark:text-red-300 font-bold animate-pulse">
                    <ShieldAlert className="h-3 w-3" />
                    MULTIPLE EPISODES ({rxDaysList})
                  </div>
                );
              })()}
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-sm truncate">{standby.contestant.name}</p>
                {isInGroup && isFirstInGroup && (
                  <span title="Group"><Users className="h-3 w-3 text-purple-500 flex-shrink-0" /></span>
                )}
                {returningInfo && returningInfo.length > 0 && (() => {
                  const wasStandbyOnly = returningInfo.every((h: any) => h.type === 'standby');
                  return (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Badge 
                        variant="outline" 
                        className={`text-[8px] px-0.5 py-0 h-3.5 cursor-help flex-shrink-0 relative z-[5] ${wasStandbyOnly ? 'border-purple-500 bg-purple-100 text-purple-700 dark:border-purple-600 dark:bg-purple-900/30 dark:text-purple-300' : 'border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300'}`} 
                        data-testid={`badge-returning-standby-${standby.id}`}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {wasStandbyOnly ? 'RTN-S' : 'RTN'}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent 
                      side="top" 
                      className="text-xs max-w-[200px] z-[9999] bg-popover text-popover-foreground border shadow-md p-2" 
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseEnter={(e) => e.stopPropagation()}
                    >
                      <div className="space-y-1">
                        <p className="font-bold border-b pb-1 mb-1">{wasStandbyOnly ? 'Returning Standby' : 'Returning Contestant'}</p>
                        {returningInfo.map((info, idx) => (
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
                {standby.signedIn && isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-green-500 dark:bg-green-600 flex-shrink-0">
                        <Check className="h-2.5 w-2.5 text-white" style={{ strokeWidth: 3 }} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p>Signed in</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                  {standby.contestant.gender === "Female" ? "F" : "M"}
                </Badge>
                {standby.contestant.age && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                    {standby.contestant.age}
                  </Badge>
                )}
                {standby.contestant.auditionRating && (
                  <Badge className={`text-[10px] px-1 py-0 h-4 ${ratingColors[standby.contestant.auditionRating] || 'bg-gray-500 text-white'}`}>
                    {standby.contestant.auditionRating}
                  </Badge>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-1 flex-shrink-0">
              {standby.status === 'seated' && standby.assignedToSeat && (
                <Badge 
                  variant="outline" 
                  className="text-[10px] h-5 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                >
                  {standby.assignedToSeat}
                </Badge>
              )}
              <Badge 
                variant="secondary" 
                className={`text-[10px] h-5 ${
                  standby.status === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
                  standby.status === 'seated' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100' :
                  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
                }`}
              >
                {standby.status === 'pending' ? 'Assigned' : 
                 standby.status === 'email_sent' ? 'Invited' : 
                 standby.status === 'seated' ? 'Seated' :
                 standby.status}
              </Badge>
              {standby.status === 'seated' && onUnseat && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnseat(standby);
                  }}
                  title="Remove from seat and return to standby list"
                  data-testid={`unseat-standby-${standby.id}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-80" side="left" align="start">
          <div className="space-y-3">
            {/* Header with photo and basic info */}
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12">
                {standby.contestant.photoUrl ? (
                  <AvatarImage 
                    src={standby.contestant.photoUrl} 
                    alt={standby.contestant.name}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback>
                  {standby.contestant.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <h4 className="text-sm font-semibold">{standby.contestant.name}</h4>
                    {standby.contestant.availableForStandby && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700">
                        S
                      </Badge>
                    )}
                  </div>
                  {standby.contestant.auditionRating && (
                    <span className={`text-sm font-bold ${
                      standby.contestant.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                      standby.contestant.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                      standby.contestant.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                      standby.contestant.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                      standby.contestant.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' : ''
                    }`}>
                      {standby.contestant.auditionRating}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{standby.contestant.age} years old • {standby.contestant.gender}</p>
                {standby.contestant.location && (
                  <p className="text-xs text-muted-foreground">{standby.contestant.location}</p>
                )}
              </div>
            </div>

            {/* Contact info */}
            {standby.contestant.phone && (
              <div className="flex items-center gap-2 text-xs">
                <Phone className="h-3 w-3 text-muted-foreground" />
                <span>{standby.contestant.phone}</span>
              </div>
            )}
            
            {standby.contestant.email && (
              <div className="flex items-center gap-2 text-xs">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{standby.contestant.email}</span>
              </div>
            )}

            {/* Attending With */}
            {(standby.contestant.attendingWith || (groupMemberNames && groupMemberNames.length > 0)) && (
              <div className="text-sm">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  Attending With
                </label>
                {standby.contestant.attendingWith ? (
                  <p className="text-xs mt-0.5">{standby.contestant.attendingWith}</p>
                ) : groupMemberNames && groupMemberNames.length > 0 ? (
                  <ul className="mt-0.5 space-y-0.5">
                    {groupMemberNames.map((name, idx) => (
                      <li key={idx} className="text-xs text-muted-foreground">
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}

            {/* Availability Notes */}
            {standby.contestant.availabilityNotes && (
              <div className="text-sm">
                <label className="text-xs font-medium text-muted-foreground">Availability Notes</label>
                <p className="text-xs">{standby.contestant.availabilityNotes}</p>
              </div>
            )}

            {/* Medical Info */}
            {hasMeaningfulMedicalNote(standby.contestant.medicalInfo) && (
              <div className="text-sm">
                <label className="text-xs font-medium text-muted-foreground">Medical Info</label>
                <p className="text-xs">{standby.contestant.medicalInfo}</p>
              </div>
            )}

            {/* Mobility/Access Notes */}
            {hasMeaningfulMedicalNote(standby.contestant.mobilityNotes) && (
              <div className="text-sm p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
                <label className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  Mobility/Access Notes
                </label>
                <p className="text-xs mt-0.5">{standby.contestant.mobilityNotes}</p>
              </div>
            )}

            {/* Criminal Record */}
            {standby.contestant.criminalRecord && (
              <div className="text-sm">
                <label className="text-xs font-medium text-muted-foreground">Criminal Record</label>
                <p className="text-xs">{standby.contestant.criminalRecord}</p>
              </div>
            )}

            {/* Movement Notes */}
            {standby.standbyMovementNotes && (
              <div className="text-sm p-2 bg-blue-50 dark:bg-blue-950/50 rounded-md border border-blue-200 dark:border-blue-800">
                <label className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1">
                  <StickyNote className="h-3 w-3" />
                  Movement Notes
                </label>
                <p className="text-xs mt-0.5">{standby.standbyMovementNotes}</p>
              </div>
            )}

            {/* Status */}
            <div className="text-sm">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <div className="mt-1">
                <Badge variant="secondary">
                  {standby.contestant.availabilityStatus || 'Standby'}
                </Badge>
                {standby.contestant.podiumStory && (
                  <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 h-4 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800">
                    <Heart className="h-2.5 w-2.5 mr-0.5" />
                    Story
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

// Legacy Draggable Standby Item (for drag-to-seat functionality)
function DraggableStandby({
  standby,
  isLocked,
  returningInfo,
}: {
  standby: StandbyData;
  isLocked?: boolean;
  returningInfo?: Array<{ recordDayId: string; date: string; label: string; type: string; blockType?: string }>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `standby-${standby.id}`,
    data: { type: 'standby', standby },
    disabled: !isLocked,
  });

  const ratingColors: Record<string, string> = {
    'A+': 'bg-emerald-500 text-white',
    'A': 'bg-green-500 text-white',
    'B+': 'bg-amber-500 text-white',
    'B': 'bg-orange-500 text-white',
    'C': 'bg-red-500 text-white',
    'R': 'bg-violet-400 text-white',
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-2 border rounded-md ${isDragging ? 'opacity-50' : ''} ${
        isLocked 
          ? 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 cursor-grab' 
          : 'border-muted cursor-not-allowed opacity-60'
      }`}
      data-testid={`draggable-standby-${standby.id}`}
    >
      <div className="flex items-center gap-1.5">
        <p className="font-medium text-sm truncate">{standby.contestant.name}</p>
        {returningInfo && returningInfo.length > 0 && (() => {
          const wasStandbyOnly = returningInfo.every((h: any) => h.type === 'standby');
          return (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Badge 
                variant="outline" 
                className={`text-[8px] px-0.5 py-0 h-3.5 cursor-help flex-shrink-0 relative z-[5] ${wasStandbyOnly ? 'border-purple-500 bg-purple-100 text-purple-700 dark:border-purple-600 dark:bg-purple-900/30 dark:text-purple-300' : 'border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300'}`}
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
                <p className="font-medium mb-1">{wasStandbyOnly ? 'Returning Standby' : 'Returning Contestant'}</p>
                {returningInfo.map((info, idx) => (
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
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
          {standby.contestant.gender === "Female" ? "F" : "M"}
        </Badge>
        {standby.contestant.auditionRating && (
          <Badge className={`text-[10px] px-1 py-0 h-4 ${ratingColors[standby.contestant.auditionRating] || 'bg-gray-500 text-white'}`}>
            {standby.contestant.auditionRating}
          </Badge>
        )}
      </div>
    </div>
  );
}

// Define the row structure: [rowLabel, numSeats]
const SEAT_ROWS = [
  { label: 'E', count: 4 },
  { label: 'D', count: 4 },
  { label: 'C', count: 4 },
  { label: 'B', count: 5 },
  { label: 'A', count: 5 },
];

// DOND CELEB: Playing blocks have 26 seats (adds an F row at the back)
const SEAT_ROWS_CELEB_PB = [
  { label: 'F', count: 4 },
  { label: 'E', count: 4 },
  { label: 'D', count: 4 },
  { label: 'C', count: 4 },
  { label: 'B', count: 5 },
  { label: 'A', count: 5 },
];

function SeatingBlock({ 
  block, 
  blockIndex, 
  blockLabel,
  reverseRows = false,
  overId,
  isGlobalDragging,
  isRXDayLocked,
  matchedSeatIds,
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
  blockType,
  onBlockTypeChange,
  isCeleb = false,
  seatRows: activeSeatRows = SEAT_ROWS,
  isPodiumVisualizerMode = false,
  getNeighborsForSeat,
  onLinkWithNeighbor,
  blockNote,
  onBlockNoteChange,
  quickMoveEnabled,
  quickMoveSelectedSeatId,
  onQuickMoveClick,
  showBookingStatus,
  onRatingChange,
}: { 
  block: SeatData[]; 
  blockIndex: number;
  blockLabel: string;
  reverseRows?: boolean;
  overId: string | null;
  isGlobalDragging?: boolean;
  isRXDayLocked?: boolean;
  matchedSeatIds?: Set<string>;
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
  blockType?: 'PB' | 'NPB' | 'AUDIENCE';
  onBlockTypeChange?: (blockNumber: number, newType: 'PB' | 'NPB' | 'AUDIENCE') => void;
  isCeleb?: boolean;
  seatRows?: typeof SEAT_ROWS;
  isPodiumVisualizerMode?: boolean;
  getNeighborsForSeat?: (blockIndex: number, seatIndex: number) => NeighborSeat[];
  onLinkWithNeighbor?: (contestantId: string, neighborContestantId: string) => void;
  blockNote?: string;
  onBlockNoteChange?: (blockNumber: number, notes: string) => void;
  quickMoveEnabled?: boolean;
  quickMoveSelectedSeatId?: string | null;
  onQuickMoveClick?: (seatId: string) => void;
  showBookingStatus?: boolean;
  onRatingChange?: (contestantId: string, newRating: string) => void;
}) {
  const stats = calculateBlockStats(block);

  // Group separation detection is handled at the page level (seating-chart-page.tsx)
  // which has visibility across ALL blocks for accurate cross-block detection.
  // The isGroupSeparated flag is already set on each seat before reaching this component.

  // Organize seats by row using the provided (or default) seat rows
  let seatIdx = 0;
  const seatsByRow = activeSeatRows.map(row => {
    const rowSeats = block.slice(seatIdx, seatIdx + row.count);
    seatIdx += row.count;
    return { ...row, seats: rowSeats };
  });

  // activeSeatRows is in E/F,D,C,B,A order (top to bottom for blocks 1-3)
  // For blocks 4-7 (reverseRows=true), flip to A,B,C,D,E/F (A at top)
  const displayRows = reverseRows ? [...seatsByRow].reverse() : seatsByRow;

  const totalSeatsInBlock = activeSeatRows.reduce((sum, r) => sum + r.count, 0);

  const handleBlockTypeToggle = () => {
    if (onBlockTypeChange) {
      // In CELEB mode: cycle PB ↔ AUDIENCE (no NPB)
      // In DOND mode:  cycle PB ↔ NPB
      const newType = isCeleb
        ? (blockType === 'PB' ? 'AUDIENCE' : 'PB')
        : (blockType === 'PB' ? 'NPB' : 'PB');
      onBlockTypeChange(blockIndex + 1, newType);
    }
  };

  return (
    <Card data-testid={`block-${blockIndex}`} className="w-full">
      <CardHeader className={isPodiumVisualizerMode ? "pb-1 pt-2" : "pb-3"}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{blockLabel}</CardTitle>
          {isPodiumVisualizerMode ? (
            <Badge 
              variant={blockType === 'PB' ? 'default' : blockType === 'NPB' ? 'secondary' : 'outline'}
              className="text-xs font-medium"
            >
              {blockType || '—'}
            </Badge>
          ) : (
            <Button
              size="sm"
              variant={blockType === 'PB' ? 'default' : blockType === 'NPB' ? 'secondary' : blockType === 'AUDIENCE' ? 'outline' : 'outline'}
              className={`h-6 px-2 text-xs font-medium${blockType === 'AUDIENCE' ? ' border-teal-500 text-teal-700 dark:text-teal-400' : ''}`}
              onClick={handleBlockTypeToggle}
              data-testid={`block-type-toggle-${blockIndex}`}
            >
              {blockType || '—'}
            </Button>
          )}
        </div>
        {!isPodiumVisualizerMode && (
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <div>
              <span>{stats.total}/{totalSeatsInBlock} filled</span>
            </div>
            {stats.total > 0 && (
              <>
                <div className="flex flex-wrap gap-1">
                  {stats.ratingCounts['A+'] > 0 && (
                    <Badge className="text-[10px] px-1 py-0 h-4 bg-emerald-500 hover:bg-emerald-600 text-white">
                      A+:{stats.ratingCounts['A+']}
                    </Badge>
                  )}
                  {stats.ratingCounts['A'] > 0 && (
                    <Badge className="text-[10px] px-1 py-0 h-4 bg-green-500 hover:bg-green-600 text-white">
                      A:{stats.ratingCounts['A']}
                    </Badge>
                  )}
                  {stats.ratingCounts['B+'] > 0 && (
                    <Badge className="text-[10px] px-1 py-0 h-4 bg-amber-500 hover:bg-amber-600 text-white">
                      B+:{stats.ratingCounts['B+']}
                    </Badge>
                  )}
                  {stats.ratingCounts['B'] > 0 && (
                    <Badge className="text-[10px] px-1 py-0 h-4 bg-orange-500 hover:bg-orange-600 text-white">
                      B:{stats.ratingCounts['B']}
                    </Badge>
                  )}
                  {stats.ratingCounts['C'] > 0 && (
                    <Badge className="text-[10px] px-1 py-0 h-4 bg-red-500 hover:bg-red-600 text-white">
                      C:{stats.ratingCounts['C']}
                    </Badge>
                  )}
                  {stats.ratingCounts['R'] > 0 && (
                    <Badge className="text-[10px] px-1 py-0 h-4 bg-violet-400 hover:bg-violet-500 text-white">
                      R:{stats.ratingCounts['R']}
                    </Badge>
                  )}
                </div>
                {stats.avgAge > 0 && (
                  <Badge variant="secondary" className="text-[10px] w-fit">
                    Age: {stats.minAge}-{stats.maxAge} (avg {stats.avgAge})
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px] w-fit">
                  {stats.femalePercent}% F
                </Badge>
              </>
            )}
          </div>
        )}
        {/* Block Notes - editable text area for producer notes */}
        {!isPodiumVisualizerMode && onBlockNoteChange && (
          <div className="mt-2">
            <DebouncedBlockNoteInput
              value={blockNote || ''}
              onChange={(value) => onBlockNoteChange(blockIndex + 1, value)}
              blockIndex={blockIndex}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className={isPodiumVisualizerMode ? "space-y-1 pt-0" : "space-y-2"}>
        {displayRows.map((row, displayIdx) => {
          // Find the original row index in SEAT_ROWS
          const originalRowIdx = SEAT_ROWS.findIndex(r => r.label === row.label);
          // Get the next row in display order (for vertical linking)
          const nextDisplayRow = displayIdx < displayRows.length - 1 ? displayRows[displayIdx + 1] : null;
          
          return (
            <div key={row.label} className={isPodiumVisualizerMode ? "" : "space-y-1"}>
              {!isPodiumVisualizerMode && (
                <div className="text-xs font-medium text-amber-600 dark:text-amber-400 px-1 font-bold">
                  Row {row.label}
                </div>
              )}
              <div className="relative">
                <div className="grid gap-1 relative" style={{ gridTemplateColumns: `repeat(${row.count}, minmax(0, 1fr))` }}>
                  {row.seats.map((seat, seatIdxInRow) => {
                    const absoluteSeatIdx = SEAT_ROWS.slice(0, originalRowIdx).reduce((sum, r) => sum + r.count, 0) + seatIdxInRow;
                    const nextSeat = seatIdxInRow < row.seats.length - 1 ? row.seats[seatIdxInRow + 1] : null;
                    const hasLinkToNext = nextSeat && shouldShowLink(seat, nextSeat);
                    
                    // Check for vertical link to seat in next row (same column position)
                    // Only check if seat position exists in next row (rows have different counts)
                    const seatBelowInNextRow = nextDisplayRow && seatIdxInRow < nextDisplayRow.seats.length 
                      ? nextDisplayRow.seats[seatIdxInRow] 
                      : null;
                    const hasVerticalLink = seatBelowInNextRow && shouldShowLink(seat, seatBelowInNextRow);
                    
                    // Calculate seat label for display
                    // For blocks 4, 5, 6 (reverseRows=true), numbers go right to left (5,4,3,2,1 visually but labeled 1,2,3,4,5)
                    const seatNumber = reverseRows 
                      ? (row.count - seatIdxInRow)  // Reverse: rightmost is 1, leftmost is 5
                      : (seatIdxInRow + 1);          // Normal: leftmost is 1, rightmost is 5
                    const seatLabel = `${row.label}${seatNumber}`;
                    
                    // In Podium Visualiser mode, show only photos
                    if (isPodiumVisualizerMode) {
                      return (
                        <PhotoOnlySeat
                          key={seat.id}
                          seat={seat}
                          seatLabel={seatLabel}
                          blockIndex={blockIndex}
                          seatIndex={absoluteSeatIdx}
                        />
                      );
                    }
                    
                    return (
                      <div key={seat.id} className="relative">
                        <DraggableDroppableSeat
                          seat={seat}
                          blockIndex={blockIndex}
                          seatIndex={absoluteSeatIdx}
                          isOver={overId === seat.id}
                          isGlobalDragging={isGlobalDragging}
                          isRXDayLocked={isRXDayLocked}
                          isHighlighted={matchedSeatIds?.has(seat.id)}
                          onEmptySeatClick={onEmptySeatClick}
                          onRemove={onRemove}
                          onCancel={onCancel}
                          onWinningMoneyClick={onWinningMoneyClick}
                          onRemoveWinningMoney={onRemoveWinningMoney}
                          onReturnToStandby={onReturnToStandby}
                          onNoShow={onNoShow}
                          onEarlyLeaver={onEarlyLeaver}
                          onNoLongerWantToAttend={onNoLongerWantToAttend}
                          onPrizeWinner={onPrizeWinner}
                          onEditTempContestant={onEditTempContestant}
                          onDeleteTestSubject={onDeleteTestSubject}
                          neighbors={getNeighborsForSeat?.(blockIndex, absoluteSeatIdx) || []}
                          onLinkWithNeighbor={onLinkWithNeighbor}
                          isQuickMoveMode={quickMoveEnabled}
                          isQuickMoveSelected={quickMoveSelectedSeatId === seat.id}
                          onQuickMoveClick={onQuickMoveClick}
                          showBookingStatus={showBookingStatus}
                          onRatingChange={onRatingChange}
                        />
                        {/* Horizontal link to next seat in same row */}
                        {hasLinkToNext && (
                          <div 
                            className="absolute top-1/2 right-0 transform -translate-y-1/2 translate-x-1/2 z-30"
                            data-testid={`link-icon-h-${row.label}-${seatIdxInRow}`}
                          >
                            <Link2
                              className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400"
                              strokeWidth={2.5}
                            />
                          </div>
                        )}
                        {/* Vertical link to seat in row below */}
                        {hasVerticalLink && (
                          <div 
                            className="absolute bottom-0 left-1/2 transform translate-y-1/2 -translate-x-1/2 z-30"
                            data-testid={`link-icon-v-${row.label}-${seatIdxInRow}`}
                          >
                            <Link2
                              className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 rotate-90"
                              strokeWidth={2.5}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Helper function to check if two seats should be linked (attending with each other)
function shouldShowLink(seat1: SeatData, seat2: SeatData): boolean {
  if (!seat1.contestantId || !seat2.contestantId) return false;
  
  // attendingWith can be comma-separated IDs
  const seat1Links = seat1.attendingWith ? seat1.attendingWith.split(',').map(id => id.trim()) : [];
  const seat2Links = seat2.attendingWith ? seat2.attendingWith.split(',').map(id => id.trim()) : [];
  
  return seat1Links.includes(seat2.contestantId) || seat2Links.includes(seat1.contestantId);
}

function calculateBlockStats(block: SeatData[]) {
  const filled = block.filter((s) => s.contestantName);
  const femaleCount = filled.filter((s) => s.gender === "Female").length;
  const maleCount = filled.filter((s) => s.gender === "Male").length;
  const total = filled.length;
  const femalePercent = total > 0 ? Math.round((femaleCount / total) * 100) : 0;

  // Audition rating breakdown
  const ratingCounts: Record<string, number> = {
    'A+': 0, 'A': 0, 'B+': 0, 'B': 0, 'C': 0, 'R': 0
  };
  filled.forEach(s => {
    if (s.auditionRating && ratingCounts.hasOwnProperty(s.auditionRating)) {
      ratingCounts[s.auditionRating]++;
    }
  });

  // Age stats
  const ages = filled.filter(s => s.age).map(s => s.age as number);
  const avgAge = ages.length > 0 ? Math.round(ages.reduce((sum, a) => sum + a, 0) / ages.length) : 0;
  const minAge = ages.length > 0 ? Math.min(...ages) : 0;
  const maxAge = ages.length > 0 ? Math.max(...ages) : 0;

  return { total, femaleCount, maleCount, femalePercent, ratingCounts, avgAge, minAge, maxAge };
}

// Generate seat IDs based on the row structure
// For blocks 4, 5, 6 (indices 3, 4, 5), seat numbering is reversed (1-5 from right to left)
function generateBlockSeats(recordDayId: string, blockIdx: number): SeatData[] {
  const seats: SeatData[] = [];
  const reverseNumbering = blockIdx >= 3 && blockIdx <= 5; // Blocks 4, 5, 6
  
  SEAT_ROWS.forEach(row => {
    for (let i = 1; i <= row.count; i++) {
      // For reversed blocks, seat 1 is on the right (visually last), seat 5 is on the left (visually first)
      // So visual position i gets label (count - i + 1)
      const seatNumber = reverseNumbering ? (row.count - i + 1) : i;
      seats.push({
        id: `${recordDayId}-block${blockIdx}-${row.label}${seatNumber}`,
      });
    }
  });
  return seats;
}

function OverflowDropZone({ 
  children, 
  isOver, 
  isGlobalDragging,
}: { 
  children: React.ReactNode; 
  isOver: boolean; 
  isGlobalDragging: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: 'overflow-drop-zone' });

  const showDropIndicator = isGlobalDragging;

  return (
    <div 
      ref={setNodeRef}
      className={`border-t pt-6 transition-all ${
        isOver ? 'ring-2 ring-primary rounded-lg bg-primary/5' : ''
      } ${showDropIndicator ? 'ring-1 ring-dashed ring-muted-foreground/30 rounded-lg' : ''}`}
      data-testid="overflow-section"
    >
      {showDropIndicator && !isOver && (
        <div className="text-center text-xs text-muted-foreground mb-2 flex items-center justify-center gap-1">
          <ArrowDown className="h-3 w-3" />
          Drop here to move to overflow
        </div>
      )}
      {children}
    </div>
  );
}

export function SeatingChart({ recordDayId, initialSeats, onRefreshNeeded, onEmptySeatClick, onRemove, onCancel, onWinningMoneyClick, onRemoveWinningMoney, onReturnToStandby, onNoShow, onEarlyLeaver, onNoLongerWantToAttend, onPrizeWinner, onEditTempContestant, onDeleteTestSubject, isLocked = false, standbys = [], onStandbySeated, isPodiumVisualizerMode = false, searchQuery = "", blockNotes = {}, onBlockNoteChange, showBookingStatus = false, onRatingChange, overflowAssignments = [], onAddOverflow, onRemoveOverflow, onMoveOverflowToSeat, onMoveToOverflow }: SeatingChartProps) {
  // Fetch returning contestants data for standby badges
  const { data: returningContestantsMap = {} } = useQuery<Record<string, Array<{ recordDayId: string; date: string; label: string; type: string; blockType?: string }>>>({
    queryKey: ['/api/returning-contestants'],
    queryFn: async () => {
      const response = await fetch('/api/returning-contestants', { credentials: 'include' });
      if (!response.ok) return {};
      return response.json();
    },
    staleTime: 30 * 1000,
  });

  // Use initialSeats as source of truth - derive blocks from props, not state
  // Only use local state for temporary overrides during active drag operations
  const defaultBlocks = useMemo(() => 
    Array(7).fill(null).map((_, blockIdx) => generateBlockSeats(recordDayId, blockIdx)),
    [recordDayId]
  );
  
  // Track a version number to know when to accept prop updates
  const [propsVersion, setPropsVersion] = useState(0);
  const [localBlocks, setLocalBlocks] = useState<SeatData[][] | null>(null);
  
  // The active blocks are either from props (primary) or local override (during optimistic updates)
  const blocks = localBlocks ?? initialSeats ?? defaultBlocks;
  
  // Calculate which seats match the search query
  const matchedSeatIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const query = searchQuery.toLowerCase().trim();
    const matches = new Set<string>();
    blocks.forEach(block => {
      block.forEach(seat => {
        if (seat.contestantName && seat.contestantName.toLowerCase().includes(query)) {
          matches.add(seat.id);
        }
      });
    });
    return matches;
  }, [blocks, searchQuery]);
  
  // Clear local overrides when props change (after API confirms changes)
  useEffect(() => {
    if (initialSeats) {
      // When initialSeats updates, clear any local overrides
      setLocalBlocks(null);
      setPropsVersion(v => v + 1);
    }
  }, [initialSeats]);
  
  // Helper to set blocks (for optimistic updates during drag)
  const setBlocks = (newBlocks: SeatData[][] | ((prev: SeatData[][]) => SeatData[][])) => {
    if (typeof newBlocks === 'function') {
      setLocalBlocks(prev => newBlocks(prev ?? initialSeats ?? defaultBlocks));
    } else {
      setLocalBlocks(newBlocks);
    }
  };
  
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null);
  const [standbyError, setStandbyError] = useState<string | null>(null);
  
  // Quick Move Mode - click-to-select, click-to-move (faster than drag-drop for RX Day)
  const [quickMoveEnabled, setQuickMoveEnabled] = useState(false);
  const [quickMoveSelectedSeatId, setQuickMoveSelectedSeatId] = useState<string | null>(null);
  const [pendingStandbyAssign, setPendingStandbyAssign] = useState<{
    standby: StandbyData;
    targetBlockNumber: number;
    targetSeatLabel: string;
  } | null>(null);
  const [standbyMovementNotes, setStandbyMovementNotes] = useState("");
  // Seat selection dialog for standbys (alternative to drag-and-drop)
  const [seatSelectionStandby, setSeatSelectionStandby] = useState<StandbyData | null>(null);
  const [selectedSeatForStandby, setSelectedSeatForStandby] = useState<string>("");
  const [seatSelectionNotes, setSeatSelectionNotes] = useState("");
  const { toast } = useToast();

  // Fetch block types for this record day
  const { data: blockTypesData } = useQuery<BlockType[]>({
    queryKey: ['/api/record-days', recordDayId, 'block-types'],
  });

  // Fetch block configuration status (workspace-aware: 5PB+2NPB for DOND, 3PB+4AUDIENCE for CELEB)
  const { data: blockConfigStatus } = useQuery<{complete: boolean; pbCount: number; npbCount: number; audienceCount: number}>({
    queryKey: ['/api/record-days', recordDayId, 'block-config-status'],
  });

  // Fetch prize winners for this record day (always fetch so cache is populated)
  const { data: prizeWinners = [] } = useQuery<{id: string; contestantId: string; contestantName: string; blockNumber: number; seatLabel: string; hasPresent: boolean; hasBriefcase: boolean; addedAt: string}[]>({
    queryKey: ['/api/record-days', recordDayId, 'prize-winners'],
    staleTime: 5000,
  });

  // Mutation to update prize winner toggle states
  const updatePrizeWinnerMutation = useMutation({
    mutationFn: async ({ id, hasPresent, hasBriefcase }: { id: string; hasPresent?: boolean; hasBriefcase?: boolean }) => {
      await apiRequest('PATCH', `/api/prize-winners/${id}`, { hasPresent, hasBriefcase });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', recordDayId, 'prize-winners'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating prize winner",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to remove prize winner
  const removePrizeWinnerMutation = useMutation({
    mutationFn: async (prizeWinnerId: string) => {
      await apiRequest('DELETE', `/api/prize-winners/${prizeWinnerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', recordDayId, 'prize-winners'] });
      toast({
        title: "Removed from Prize Draw",
        description: "Contestant has been removed from the prize draw list.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error removing from prize draw",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Workspace detection (staleTime=Infinity so it never refetches unnecessarily)
  const { data: workspaceData } = useQuery<{ workspace: string }>({
    queryKey: ['/api/workspace'],
    staleTime: Infinity,
  });
  const isCeleb = workspaceData?.workspace === 'celeb';

  // Create a map of block number to block type
  const blockTypeMap: Record<number, 'PB' | 'NPB' | 'AUDIENCE'> = {};
  if (blockTypesData) {
    blockTypesData.forEach(bt => {
      blockTypeMap[bt.blockNumber] = bt.blockType as 'PB' | 'NPB' | 'AUDIENCE';
    });
  }

  // Derive the correct seat rows for each block
  const getSeatRowsForBlock = (blockNum: number): typeof SEAT_ROWS => {
    return (isCeleb && blockTypeMap[blockNum] === 'PB') ? SEAT_ROWS_CELEB_PB : SEAT_ROWS;
  };

  // Check if blocks are fully configured
  const isBlockConfigComplete = blockConfigStatus?.complete ?? false;

  // Workspace-aware config requirement label
  const configRequirementLabel = isCeleb
    ? '3 Playing Blocks (PB) and 4 Audience Blocks (AUDIENCE)'
    : '5 Playing Blocks (PB) and 2 Non-Playing Blocks (NPB)';

  // Wrap onEmptySeatClick to check block config
  const handleEmptySeatClick = (blockNumber: number, seatLabel: string) => {
    if (!isBlockConfigComplete) {
      toast({
        title: "Block configuration required",
        description: `You must configure all 7 blocks (${configRequirementLabel}) before booking seats.`,
        variant: "destructive",
      });
      return;
    }
    onEmptySeatClick?.(blockNumber, seatLabel);
  };

  // Mutation to update block type
  const updateBlockTypeMutation = useMutation({
    mutationFn: async ({ blockNumber, blockType }: { blockNumber: number; blockType: 'PB' | 'NPB' | 'AUDIENCE' }) => {
      const response = await apiRequest(
        'PUT',
        `/api/record-days/${recordDayId}/block-types/${blockNumber}`,
        { blockType }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', recordDayId, 'block-types'] });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', recordDayId, 'block-config-status'] });
      toast({
        title: "Block type updated",
        description: "The block type has been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating block type",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation to link two contestants together
  const linkContestantsMutation = useMutation({
    mutationFn: async ({ contestantId, neighborContestantId }: { contestantId: string; neighborContestantId: string }) => {
      // Find the contestants to check if either is already in a group
      const allSeats = blocks.flat();
      const contestantSeat = allSeats.find(s => s.contestantId === contestantId);
      const neighborSeat = allSeats.find(s => s.contestantId === neighborContestantId);
      
      // If neighbor already has a group, link contestant to that group
      if (neighborSeat?.groupId) {
        const response = await apiRequest('POST', `/api/contestants/${contestantId}/link-to-group`, {
          groupId: neighborSeat.groupId,
        });
        return response.json();
      }
      // If contestant already has a group, link neighbor to that group
      else if (contestantSeat?.groupId) {
        const response = await apiRequest('POST', `/api/contestants/${neighborContestantId}/link-to-group`, {
          groupId: contestantSeat.groupId,
        });
        return response.json();
      }
      // Neither in a group - create a new group with both
      else {
        const response = await apiRequest('POST', '/api/groups/manual', {
          contestantIds: [contestantId, neighborContestantId],
        });
        return response.json();
      }
    },
    onSuccess: (data) => {
      // Refresh all relevant queries
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      onRefreshNeeded?.();
      toast({
        title: "Contestants Linked",
        description: data.message || "The contestants have been linked into a group.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error linking contestants",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Helper to get neighbors for a seat (adjacent occupied seats in the SAME ROW only)
  const getNeighborsForSeat = useCallback((blockIndex: number, seatIndex: number): NeighborSeat[] => {
    const block = blocks[blockIndex];
    if (!block) return [];
    
    // Calculate row boundaries based on SEAT_ROWS structure
    // E: 4 seats (0-3), D: 4 seats (4-7), C: 4 seats (8-11), B: 5 seats (12-16), A: 5 seats (17-21)
    const rowBoundaries = [
      { start: 0, end: 3 },   // Row E (4 seats)
      { start: 4, end: 7 },   // Row D (4 seats)
      { start: 8, end: 11 },  // Row C (4 seats)
      { start: 12, end: 16 }, // Row B (5 seats)
      { start: 17, end: 21 }, // Row A (5 seats)
    ];
    
    // Find which row this seat is in
    const currentRow = rowBoundaries.find(row => seatIndex >= row.start && seatIndex <= row.end);
    if (!currentRow) return [];
    
    const neighbors: NeighborSeat[] = [];
    
    // Only check neighbors within the same row
    for (let offset = -1; offset <= 1; offset += 2) {
      const neighborIdx = seatIndex + offset;
      // Check if neighbor is within the same row boundaries
      if (neighborIdx >= currentRow.start && neighborIdx <= currentRow.end) {
        const neighbor = block[neighborIdx];
        if (neighbor?.contestantId && neighbor.contestantName) {
          neighbors.push({
            contestantId: neighbor.contestantId,
            contestantName: neighbor.contestantName,
            groupId: neighbor.groupId,
            blockNumber: blockIndex + 1,
            seatLabel: neighbor.id.split('-').pop() || '',
            photoUrl: neighbor.photoUrl,
          });
        }
      }
    }
    
    return neighbors;
  }, [blocks]);

  // Handler for linking with neighbor
  const handleLinkWithNeighbor = useCallback((contestantId: string, neighborContestantId: string) => {
    linkContestantsMutation.mutate({ contestantId, neighborContestantId });
  }, [linkContestantsMutation]);

  const handleBlockTypeChange = (blockNumber: number, newType: 'PB' | 'NPB' | 'AUDIENCE') => {
    updateBlockTypeMutation.mutate({ blockNumber, blockType: newType });
  };

  // Mutation to unseat a standby (remove from seat and return to standby list)
  const unseatStandbyMutation = useMutation({
    mutationFn: async (standby: StandbyData) => {
      // Call the assign-seat endpoint with empty seatLabel to clear the seat
      const response = await apiRequest('POST', '/api/standbys/assign-seat', {
        recordDayId,
        contestantName: standby.contestant.name,
        seatLabel: null, // Clear the seat assignment
      });
      return response.json();
    },
    onSuccess: (_, standby) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', recordDayId, 'seat-assignments'] });
      toast({
        title: "Standby unseated",
        description: `${standby.contestant.name} has been returned to the standby list.`,
      });
    },
    onError: (error: any, standby) => {
      toast({
        title: "Error unseating standby",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUnseatStandby = (standby: StandbyData) => {
    unseatStandbyMutation.mutate(standby);
  };

  // Standby reorder handler
  const handleStandbyReorder = async (
    standbyId: string, 
    fromIndex: number, 
    toIndex: number, 
    currentList: StandbyData[]
  ) => {
    if (toIndex < 0 || toIndex >= currentList.length) return;
    
    // Create new ordered list
    const newOrder = [...currentList];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    
    // Send reorder request
    try {
      await apiRequest('POST', '/api/standbys/reorder', {
        recordDayId,
        orderedIds: newOrder.map(s => s.id),
      });
      
      // Invalidate standbys query to refresh
      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
      
      toast({
        title: "Priority updated",
        description: `${moved.contestant.name} moved to priority ${toIndex + 1}`,
      });
    } catch (error: any) {
      toast({
        title: "Failed to update priority",
        description: error?.message || "Could not update standby priority",
        variant: "destructive",
      });
    }
  };


  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before dragging starts
      },
    })
  );

  // Clear quick move selection when mode is disabled
  useEffect(() => {
    if (!quickMoveEnabled) {
      setQuickMoveSelectedSeatId(null);
    }
  }, [quickMoveEnabled]);

  // Escape key to deselect in quick move mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && quickMoveSelectedSeatId) {
        setQuickMoveSelectedSeatId(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [quickMoveSelectedSeatId]);

  // Quick Move is now available in both locked and unlocked modes
  // No auto-disable needed

  // Custom collision detection: prioritize where the pointer actually is (more intuitive)
  // Falls back to rectangle intersection if pointer isn't directly over a droppable
  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    // First try pointerWithin - this checks if pointer is inside a droppable
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    // Fall back to rectangle intersection for edge cases
    return rectIntersection(args);
  }, []);

  // Helper to find seat by ID across all blocks
  const findSeat = (seatId: string): { blockIdx: number; seatIdx: number; seat: SeatData } | null => {
    for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
      const seatIdx = blocks[blockIdx].findIndex(s => s.id === seatId);
      if (seatIdx !== -1) {
        return { blockIdx, seatIdx, seat: blocks[blockIdx][seatIdx] };
      }
    }
    return null;
  };

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over?.id as string | null);
  };

  // Helper to extract block number and seat label from seat IDs
  const getBlockAndSeat = (seatId: string) => {
    // ID format: "recordDayId-blockX-seatLabel"
    const parts = seatId.split('-');
    const blockPart = parts[parts.length - 2]; // e.g., "block0"
    const seatLabel = parts[parts.length - 1]; // e.g., "A1"
    const blockNumber = parseInt(blockPart.replace('block', '')) + 1; // Convert to 1-indexed
    return { blockNumber, seatLabel };
  };

  // Execute the actual swap operation
  const executeSwap = async (
    sourceSeat: PendingSwap['sourceSeat'],
    targetSeat: PendingSwap['targetSeat'],
    sourceLocation: PendingSwap['sourceLocation'],
    targetLocation: PendingSwap['targetLocation'],
    useTrackedEndpoint: boolean
  ) => {
    // Update local state immediately for responsive UI
    setBlocks(prevBlocks => {
      const newBlocks = prevBlocks.map(block => [...block]);
      
      // Swap contestant data between the two seats
      const sourceData = { ...sourceSeat.seat };
      const targetData = { ...targetSeat.seat };
      
      newBlocks[sourceSeat.blockIdx][sourceSeat.seatIdx] = {
        id: sourceSeat.seat.id,
        contestantName: targetData.contestantName,
        age: targetData.age,
        gender: targetData.gender,
        groupId: targetData.groupId,
        assignmentId: targetData.assignmentId,
        contestantId: targetData.contestantId,
        auditionRating: targetData.auditionRating,
        attendingWith: targetData.attendingWith,
        originalBlockNumber: targetData.originalBlockNumber,
        originalSeatLabel: targetData.originalSeatLabel,
      };
      
      newBlocks[targetSeat.blockIdx][targetSeat.seatIdx] = {
        id: targetSeat.seat.id,
        contestantName: sourceData.contestantName,
        age: sourceData.age,
        gender: sourceData.gender,
        groupId: sourceData.groupId,
        assignmentId: sourceData.assignmentId,
        contestantId: sourceData.contestantId,
        auditionRating: sourceData.auditionRating,
        attendingWith: sourceData.attendingWith,
        originalBlockNumber: sourceData.originalBlockNumber,
        originalSeatLabel: sourceData.originalSeatLabel,
      };
      
      return newBlocks;
    });

    // Update backend using atomic swap endpoint
    try {
      // Only proceed if source has an assignment ID (skip for mock/unassigned data)
      if (!sourceSeat.seat.assignmentId) {
        toast({
          title: "Cannot move",
          description: "This seat is not part of a record day assignment.",
          variant: "destructive",
        });
        
        // Revert UI
        setBlocks(prevBlocks => {
          const newBlocks = prevBlocks.map(block => [...block]);
          newBlocks[sourceSeat.blockIdx][sourceSeat.seatIdx] = sourceSeat.seat;
          newBlocks[targetSeat.blockIdx][targetSeat.seatIdx] = targetSeat.seat;
          return newBlocks;
        });
        return;
      }

      // Use tracked endpoint when in RX Day Mode
      if (targetSeat.seat.assignmentId) {
        // Swapping two assigned seats
        const swapEndpoint = useTrackedEndpoint 
          ? '/api/seat-assignments/swap-tracked' 
          : '/api/seat-assignments/swap';
        await apiRequest(
          'POST',
          swapEndpoint,
          {
            sourceAssignmentId: sourceSeat.seat.assignmentId,
            targetAssignmentId: targetSeat.seat.assignmentId,
          }
        );
      } else {
        // Moving to empty seat - use tracked endpoint if locked
        const moveEndpoint = useTrackedEndpoint 
          ? '/api/seat-assignments/move-tracked' 
          : '/api/seat-assignments/swap';
        await apiRequest(
          'POST',
          moveEndpoint,
          {
            sourceAssignmentId: sourceSeat.seat.assignmentId,
            blockNumber: targetLocation.blockNumber,
            seatLabel: targetLocation.seatLabel,
          }
        );
      }

      // Invalidate seat assignments, contestants, and standbys to keep all views accurate
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });

      toast({
        title: "Seats updated",
        description: `${sourceSeat.seat.contestantName} moved to ${targetLocation.seatLabel}${targetSeat.seat.contestantName ? `, ${targetSeat.seat.contestantName} moved to ${sourceLocation.seatLabel}` : ''}`,
      });
    } catch (error) {
      console.error('Failed to swap seats:', error);
      
      // Revert UI state on any error
      setBlocks(prevBlocks => {
        const newBlocks = prevBlocks.map(block => [...block]);
        newBlocks[sourceSeat.blockIdx][sourceSeat.seatIdx] = sourceSeat.seat;
        newBlocks[targetSeat.blockIdx][targetSeat.seatIdx] = targetSeat.seat;
        return newBlocks;
      });

      toast({
        title: "Error updating seats",
        description: "The change could not be saved. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Handle quick move click - select first, then execute move/swap on second click
  const handleQuickMoveClick = async (clickedSeatId: string) => {
    if (!quickMoveEnabled) return;

    const clickedSeat = findSeat(clickedSeatId);
    if (!clickedSeat) return;

    // If no seat is selected, select this one (if it has a contestant)
    if (!quickMoveSelectedSeatId) {
      if (clickedSeat.seat.contestantName) {
        setQuickMoveSelectedSeatId(clickedSeatId);
      }
      return;
    }

    // If clicking the same seat, deselect
    if (quickMoveSelectedSeatId === clickedSeatId) {
      setQuickMoveSelectedSeatId(null);
      return;
    }

    // Execute the move/swap
    const sourceSeat = findSeat(quickMoveSelectedSeatId);
    if (!sourceSeat) {
      setQuickMoveSelectedSeatId(null);
      return;
    }

    const sourceLocation = getBlockAndSeat(sourceSeat.seat.id);
    const targetLocation = getBlockAndSeat(clickedSeat.seat.id);

    // Clear selection
    setQuickMoveSelectedSeatId(null);

    if (isLocked) {
      // Locked (RX Day Mode) - show confirmation dialog
      setPendingSwap({
        sourceSeat,
        targetSeat: clickedSeat,
        sourceLocation,
        targetLocation,
      });
    } else {
      // Not locked - execute swap immediately without prompt
      await executeSwap(sourceSeat, clickedSeat, sourceLocation, targetLocation, false);
    }
  };

  // Handle drag end - check if locked and require confirmation
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveId(null);
    setOverId(null);

    if (!over || active.id === over.id) return;

    const activeIdStr = active.id as string;
    const activeData = active.data?.current as { type: string; standby?: StandbyData } | undefined;
    
    // Check if this is a sortable standby being dragged
    if (activeData?.type === 'sortable-standby' && activeData.standby) {
      const overData = over.data?.current as { type: string; standby?: StandbyData } | undefined;
      
      // If dropped on another sortable standby, reorder them
      if (overData?.type === 'sortable-standby' && overData.standby) {
        const activeStandbys = standbys.filter(s => s.status !== 'seated');
        const sortedStandbys = [...activeStandbys].sort((a, b) => (a.priority || 999) - (b.priority || 999));
        
        const oldIndex = sortedStandbys.findIndex(s => s.id === active.id);
        const newIndex = sortedStandbys.findIndex(s => s.id === over.id);
        
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          // Reorder priorities
          const reorderedList = arrayMove(sortedStandbys, oldIndex, newIndex);
          
          // Update priorities for all affected items
          const priorityUpdates = reorderedList.map((standby, idx) => ({
            id: standby.id,
            priority: idx + 1,
          }));
          
          // Optimistic update - immediately update the cache
          const queryKey = ['/api/standbys/record-day', recordDayId];
          const previousData = queryClient.getQueryData(queryKey);
          
          queryClient.setQueryData(queryKey, (old: StandbyData[] | undefined) => {
            if (!old) return old;
            return old.map(s => {
              const update = priorityUpdates.find(u => u.id === s.id);
              if (update) {
                return { ...s, priority: update.priority };
              }
              return s;
            });
          });
          
          // Call batch API to update all priorities at once
          try {
            await apiRequest('POST', '/api/standbys/batch-update-priorities', { updates: priorityUpdates });
          } catch (error) {
            // Rollback on error
            queryClient.setQueryData(queryKey, previousData);
            toast({
              title: "Error reordering standbys",
              description: "Failed to save the new order. Please try again.",
              variant: "destructive",
            });
          }
        }
        return;
      }
      
      // If dropped on a seat, handle seat assignment
      const targetSeat = findSeat(over.id as string);
      if (targetSeat) {
        const standby = activeData.standby;
        
        // Check if day is locked (RX mode required)
        if (!isLocked) {
          setStandbyError("Standbys can only be seated when the day is in RX Mode (locked).");
          return;
        }
        
        // Check if target seat is occupied
        if (targetSeat.seat.contestantName) {
          setStandbyError("Cannot seat standby in an occupied seat. Please choose an empty seat.");
          return;
        }
        
        // Get target location details
        const targetLocation = getBlockAndSeat(targetSeat.seat.id);
        
        // Seat is empty and day is locked - proceed with assignment
        setPendingStandbyAssign({
          standby,
          targetBlockNumber: targetLocation.blockNumber,
          targetSeatLabel: targetLocation.seatLabel,
        });
        return;
      }
      return;
    }
    
    // Check if this is a legacy standby being dragged to a seat (fallback)
    if (activeIdStr.startsWith('standby-')) {
      const standbyData = active.data?.current as { type: string; standby: StandbyData } | undefined;
      if (!standbyData || standbyData.type !== 'standby') return;
      
      const standby = standbyData.standby;
      const targetSeat = findSeat(over.id as string);
      
      if (!targetSeat) return;
      
      // Check if day is locked (RX mode required)
      if (!isLocked) {
        setStandbyError("Standbys can only be seated when the day is in RX Mode (locked).");
        return;
      }
      
      // Check if target seat is occupied
      if (targetSeat.seat.contestantName) {
        setStandbyError("Cannot seat standby in an occupied seat. Please choose an empty seat.");
        return;
      }
      
      // Get target location details
      const targetLocation = getBlockAndSeat(targetSeat.seat.id);
      
      // Seat is empty and day is locked - proceed with assignment
      setPendingStandbyAssign({
        standby,
        targetBlockNumber: targetLocation.blockNumber,
        targetSeatLabel: targetLocation.seatLabel,
      });
      return;
    }

    // Check if dropped onto the overflow zone ("To Seat on Day")
    if (over.id === 'overflow-drop-zone') {
      const sourceSeat = findSeat(active.id as string);
      if (sourceSeat && sourceSeat.seat.assignmentId && sourceSeat.seat.contestantName && onMoveToOverflow) {
        onMoveToOverflow(sourceSeat.seat.assignmentId);
      }
      return;
    }

    const sourceSeat = findSeat(active.id as string);
    const targetSeat = findSeat(over.id as string);

    if (!sourceSeat || !targetSeat) return;

    // Don't allow swapping if source is empty
    if (!sourceSeat.seat.contestantName) return;

    const sourceLocation = getBlockAndSeat(sourceSeat.seat.id);
    const targetLocation = getBlockAndSeat(targetSeat.seat.id);

    // If locked, show confirmation dialog instead of immediate swap
    if (isLocked) {
      setPendingSwap({
        sourceSeat,
        targetSeat,
        sourceLocation,
        targetLocation,
      });
      return;
    }

    // Not locked - execute swap immediately
    await executeSwap(sourceSeat, targetSeat, sourceLocation, targetLocation, false);
  };
  
  const handleConfirmStandbyAssignInternal = async (standby: StandbyData, targetBlockNumber: number, targetSeatLabel: string, notes?: string, skipPostcodeWarning = false) => {
    try {
      // Get block type from the block configuration (default to NPB if not configured)
      const blockType = blockTypeMap[targetBlockNumber] || 'NPB';
      
      // First update the standby status to 'seated' - this removes the standby block
      await apiRequest('PATCH', `/api/standbys/${standby.id}`, {
        status: 'seated',
        assignedToSeat: `${targetBlockNumber}${targetSeatLabel}`,
      });
      
      // Now create the seat assignment (standby check will pass since status is 'seated')
      // Block type is automatically determined from the block configuration
      await apiRequest('POST', `/api/seat-assignments`, {
        recordDayId,
        contestantId: standby.contestantId,
        blockNumber: targetBlockNumber,
        seatLabel: targetSeatLabel,
        seatedAsBlockType: blockType,
        seatedFromStandby: true,
        standbyMovementNotes: notes || undefined,
        skipPostcodeWarning,
      });
      
      const blockTypeLabel = blockType === 'PB' ? 'Case Holder' : 'Non Playing Block';
      toast({
        title: "Standby seated",
        description: `${standby.contestant.name} has been assigned to Block ${targetBlockNumber}, Seat ${targetSeatLabel} as ${blockTypeLabel}.`,
      });
      
      // Refresh data
      onRefreshNeeded?.();
      onStandbySeated?.();
      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
    } catch (error: any) {
      // Try to parse the error message as JSON (API errors come as "status: {json}")
      let parsedError: any = null;
      try {
        const errorMsg = error?.message || '';
        const jsonMatch = errorMsg.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          parsedError = JSON.parse(jsonMatch[1]);
        }
      } catch (e) {
        // Not JSON, continue with regular error handling
      }
      
      // Check if this is an OUTSIDE_VICTORIA warning that requires confirmation
      if (parsedError?.code === 'OUTSIDE_VICTORIA' && parsedError?.requiresConfirmation) {
        const confirmed = window.confirm(
          `⚠️ INTERSTATE CONTESTANT\n\n${parsedError.contestantName} is from ${parsedError.state || 'outside Victoria'}.\n\nDo you want to proceed with seating this standby?`
        );
        if (confirmed) {
          // Retry with skip flag
          handleConfirmStandbyAssignInternal(standby, targetBlockNumber, targetSeatLabel, notes, true);
        } else {
          // Revert the standby status change
          await apiRequest('PATCH', `/api/standbys/${standby.id}`, {
            status: 'confirmed',
            assignedToSeat: null,
          });
        }
        return;
      }
      
      const errorMessage = parsedError?.error || error?.message || "Could not assign standby to seat.";
      toast({
        title: "Failed to seat standby",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // Handle standby seat assignment
  const handleConfirmStandbyAssign = async () => {
    if (!pendingStandbyAssign) return;
    
    const { standby, targetBlockNumber, targetSeatLabel } = pendingStandbyAssign;
    const notes = standbyMovementNotes.trim();
    setPendingStandbyAssign(null);
    setStandbyMovementNotes(""); // Reset for next time
    
    await handleConfirmStandbyAssignInternal(standby, targetBlockNumber, targetSeatLabel, notes || undefined);
  };

  // Handle confirmation of locked swap
  const handleConfirmLockedSwap = async () => {
    if (!pendingSwap) return;
    
    const { sourceSeat, targetSeat, sourceLocation, targetLocation } = pendingSwap;
    setPendingSwap(null);
    
    // Execute swap with tracked endpoint
    await executeSwap(sourceSeat, targetSeat, sourceLocation, targetLocation, true);
  };

  // Handle cancel of locked swap
  const handleCancelLockedSwap = () => {
    setPendingSwap(null);
  };

  // Split blocks: 0-2 (top row), 3-5 (bottom row), 6 (standing)
  const topBlocks = blocks.slice(0, 3);
  const bottomBlocks = blocks.slice(3, 6);
  const standingBlock = blocks[6];

  // Bottom blocks need to be reordered: 6, 5, 4 (swap 4 and 6)
  const reorderedBottomBlocks = [bottomBlocks[2], bottomBlocks[1], bottomBlocks[0]]; // blocks 5, 4, 3 -> display as 6, 5, 4

  // Get active seat for drag overlay
  const activeSeat = activeId ? findSeat(activeId)?.seat : null;
  
  // Get active standby for drag overlay
  const activeStandby = activeId?.toString().startsWith('standby-') 
    ? standbys.find(s => `standby-${s.id}` === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
        <div className="space-y-8">
          {/* Block Configuration Warning */}
          {!isBlockConfigComplete && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <h4 className="font-medium text-amber-800 dark:text-amber-200">
                    Block Configuration Required
                  </h4>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {isCeleb
                      ? <>You must select exactly <strong>3 Playing Blocks (PB)</strong> and <strong>4 Audience Blocks (AUDIENCE)</strong> before you can book seats.</>
                      : <>You must select exactly <strong>5 Playing Blocks (PB)</strong> and <strong>2 Non-Playing Blocks (NPB)</strong> before you can book seats.</>
                    }
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    {isCeleb
                      ? <>Current: {blockConfigStatus?.pbCount ?? 0} PB, {blockConfigStatus?.audienceCount ?? 0} AUDIENCE</>
                      : <>Current: {blockConfigStatus?.pbCount ?? 0} PB, {blockConfigStatus?.npbCount ?? 0} NPB</>
                    }
                    {(blockConfigStatus?.pbCount ?? 0) + ((isCeleb ? (blockConfigStatus?.audienceCount ?? 0) : (blockConfigStatus?.npbCount ?? 0))) < 7 && (
                      <span> — Click the block type badges below to configure each block</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Quick Move Mode Controls - Available in both locked and unlocked modes */}
          <div className="flex items-center gap-3 mb-4">
            <Button
              variant={quickMoveEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setQuickMoveEnabled(!quickMoveEnabled)}
              data-testid="button-quick-move-toggle"
            >
              <MousePointerClick className="h-4 w-4 mr-2" />
              {quickMoveEnabled ? "Quick Move ON" : "Quick Move"}
            </Button>
            {quickMoveEnabled && (
              <span className="text-sm text-muted-foreground">
                Click a person to select, then click another seat to move/swap
              </span>
            )}
          </div>

          {/* Quick Move Selection Indicator */}
          {quickMoveEnabled && quickMoveSelectedSeatId && (
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50">
              <div className="bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
                <MousePointerClick className="h-5 w-5" />
                <span className="font-medium">
                  Moving: {findSeat(quickMoveSelectedSeatId)?.seat.contestantName || 'Unknown'}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setQuickMoveSelectedSeatId(null)}
                  className="h-6 px-2"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Circular Seating Area */}
          <div>
            <div className="space-y-6">
            {/* Top Row - 3 Blocks (E at top, A at bottom - facing stage) */}
            <div className="grid grid-cols-3 gap-4">
              {topBlocks.map((block, idx) => (
                <SeatingBlock
                  key={idx}
                  block={block}
                  blockIndex={idx}
                  blockLabel={`Block ${idx + 1} (Top)`}
                  reverseRows={false}
                  overId={overId}
                  isGlobalDragging={!!activeId}
                  isRXDayLocked={isLocked}
                  matchedSeatIds={matchedSeatIds}
                  onEmptySeatClick={handleEmptySeatClick}
                  onRemove={onRemove}
                  onCancel={onCancel}
                  onWinningMoneyClick={onWinningMoneyClick}
                  onRemoveWinningMoney={onRemoveWinningMoney}
                  onReturnToStandby={onReturnToStandby}
                  onNoShow={onNoShow}
                  onEarlyLeaver={onEarlyLeaver}
                  onNoLongerWantToAttend={onNoLongerWantToAttend}
                  onPrizeWinner={onPrizeWinner}
                  onEditTempContestant={onEditTempContestant}
                  onDeleteTestSubject={onDeleteTestSubject}
                  blockType={blockTypeMap[idx + 1]}
                  onBlockTypeChange={handleBlockTypeChange}
                  isCeleb={isCeleb}
                  seatRows={getSeatRowsForBlock(idx + 1)}
                  isPodiumVisualizerMode={isPodiumVisualizerMode}
                  getNeighborsForSeat={getNeighborsForSeat}
                  onLinkWithNeighbor={handleLinkWithNeighbor}
                  blockNote={blockNotes[idx + 1]}
                  onBlockNoteChange={onBlockNoteChange}
                  quickMoveEnabled={quickMoveEnabled}
                  quickMoveSelectedSeatId={quickMoveSelectedSeatId}
                  onQuickMoveClick={handleQuickMoveClick}
                  showBookingStatus={showBookingStatus}
                  onRatingChange={onRatingChange}
                />
              ))}
            </div>

            {/* Center Stage Indicator with Podium */}
            <div className="relative flex items-center justify-between py-6">
              {/* Podium Set Image - Left Edge */}
              <div className="flex items-center justify-start">
                <img 
                  src={podiumSetImage} 
                  alt="Podium Set" 
                  className="object-contain"
                  style={{ height: '260px', transform: 'rotate(-90deg)' }}
                />
              </div>
              
              {/* Centre Stage Image */}
              <div className="flex items-center justify-start flex-1" style={{ marginLeft: '-60px' }}>
                <img 
                  src={centreStageImage} 
                  alt="Centre Stage" 
                  className="object-contain"
                  style={{ height: '200px' }}
                />
              </div>
              
              {/* Stage Backdrop Image - Right Edge */}
              <div className="flex items-center justify-end">
                <img 
                  src={stageBackdropImage} 
                  alt="Stage Backdrop" 
                  className="object-contain"
                  style={{ height: '220px', transform: 'rotate(90deg)' }}
                />
              </div>
            </div>

            {/* Bottom Row - 3 Blocks (reordered: 6, 5, 4) - A at top, E at bottom */}
            <div className="grid grid-cols-3 gap-4">
              {reorderedBottomBlocks.map((block, idx) => {
                const originalIdx = 5 - idx; // Maps to 5, 4, 3 (blocks 6, 5, 4 for display)
                return (
                  <SeatingBlock
                    key={originalIdx}
                    block={block}
                    blockIndex={originalIdx}
                    blockLabel={`Block ${originalIdx + 1} (Bottom)`}
                    reverseRows={true}
                    overId={overId}
                    isGlobalDragging={!!activeId}
                    isRXDayLocked={isLocked}
                    matchedSeatIds={matchedSeatIds}
                    onEmptySeatClick={handleEmptySeatClick}
                    onRemove={onRemove}
                    onCancel={onCancel}
                    onWinningMoneyClick={onWinningMoneyClick}
                    onRemoveWinningMoney={onRemoveWinningMoney}
                    onReturnToStandby={onReturnToStandby}
                    onNoShow={onNoShow}
                    onEarlyLeaver={onEarlyLeaver}
                    onNoLongerWantToAttend={onNoLongerWantToAttend}
                    onPrizeWinner={onPrizeWinner}
                    onEditTempContestant={onEditTempContestant}
                    onDeleteTestSubject={onDeleteTestSubject}
                    blockType={blockTypeMap[originalIdx + 1]}
                    onBlockTypeChange={handleBlockTypeChange}
                    isCeleb={isCeleb}
                    seatRows={getSeatRowsForBlock(originalIdx + 1)}
                    isPodiumVisualizerMode={isPodiumVisualizerMode}
                    getNeighborsForSeat={getNeighborsForSeat}
                    onLinkWithNeighbor={handleLinkWithNeighbor}
                    blockNote={blockNotes[originalIdx + 1]}
                    onBlockNoteChange={onBlockNoteChange}
                    quickMoveEnabled={quickMoveEnabled}
                    quickMoveSelectedSeatId={quickMoveSelectedSeatId}
                    onQuickMoveClick={handleQuickMoveClick}
                    showBookingStatus={showBookingStatus}
                    onRatingChange={onRatingChange}
                  />
                );
              })}
            </div>
            </div>
          </div>

          {/* Standing Block and Standbys - Side by Side */}
          <div className="border-t pt-6">
            <div className="text-center mb-4">
              <Badge variant="outline" className="text-sm">Standing Side of Set</Badge>
            </div>
            <div className="flex gap-6 justify-center items-start">
              {/* Block 7 (Standing) */}
              <div className="w-full max-w-sm">
                <SeatingBlock
                  block={standingBlock}
                  blockIndex={6}
                  blockLabel="Block 7 (Standing)"
                  reverseRows={true}
                  overId={overId}
                  isGlobalDragging={!!activeId}
                  isRXDayLocked={isLocked}
                  matchedSeatIds={matchedSeatIds}
                  onEmptySeatClick={handleEmptySeatClick}
                  onRemove={onRemove}
                  onCancel={onCancel}
                  onWinningMoneyClick={onWinningMoneyClick}
                  onRemoveWinningMoney={onRemoveWinningMoney}
                  onReturnToStandby={onReturnToStandby}
                  onNoShow={onNoShow}
                  onEarlyLeaver={onEarlyLeaver}
                  onNoLongerWantToAttend={onNoLongerWantToAttend}
                  onPrizeWinner={onPrizeWinner}
                  onEditTempContestant={onEditTempContestant}
                  onDeleteTestSubject={onDeleteTestSubject}
                  blockType={blockTypeMap[7]}
                  onBlockTypeChange={handleBlockTypeChange}
                  isCeleb={isCeleb}
                  seatRows={getSeatRowsForBlock(7)}
                  isPodiumVisualizerMode={isPodiumVisualizerMode}
                  getNeighborsForSeat={getNeighborsForSeat}
                  onLinkWithNeighbor={handleLinkWithNeighbor}
                  blockNote={blockNotes[7]}
                  onBlockNoteChange={onBlockNoteChange}
                  quickMoveEnabled={quickMoveEnabled}
                  quickMoveSelectedSeatId={quickMoveSelectedSeatId}
                  onQuickMoveClick={handleQuickMoveClick}
                  showBookingStatus={showBookingStatus}
                  onRatingChange={onRatingChange}
                />
              </div>
              
              {/* Standbys Panel - Redesigned with static tier numbers */}
              <Card className="w-full max-w-sm" data-testid="standbys-panel">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">Standbys</span>
                    {(() => {
                      const totalNonSeated = standbys.filter(s => s.status !== 'seated').length;
                      const checkedInCount = standbys.filter(s => s.status !== 'seated' && s.signedIn).length;
                      
                      if (isLocked) {
                        // In RX Lock mode, show checked-in count with total in parentheses
                        return (
                          <Badge variant="secondary" className="text-[10px] px-1">
                            {checkedInCount} checked in{totalNonSeated > checkedInCount ? ` (${totalNonSeated} total)` : ''}
                          </Badge>
                        );
                      }
                      return (
                        <Badge variant="secondary" className="text-[10px] px-1">
                          {totalNonSeated}
                        </Badge>
                      );
                    })()}
                  </div>
                  {!isLocked && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Lock RX Day mode to reorder and drag standbys into seats
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {(() => {
                    // Filter standbys: not seated, and in RX Lock mode only show those who have checked in
                    const activeStandbys = standbys.filter(s => {
                      if (s.status === 'seated') return false;
                      // In RX Lock mode, only show standbys who have checked in (signedIn is set)
                      if (isLocked && !s.signedIn) return false;
                      return true;
                    });
                    
                    // Count total non-seated standbys (before check-in filter) for info message
                    const totalNonSeatedStandbys = standbys.filter(s => s.status !== 'seated').length;
                    const notCheckedInCount = totalNonSeatedStandbys - activeStandbys.length;
                    
                    if (activeStandbys.length === 0) {
                      return (
                        <div className="text-center py-4">
                          <p className="text-sm text-muted-foreground">
                            {isLocked && notCheckedInCount > 0 
                              ? `No checked-in standbys (${notCheckedInCount} not yet checked in)`
                              : 'No standbys for this day'
                            }
                          </p>
                        </div>
                      );
                    }
                    
                    // Sort by priority
                    const sortedStandbys = [...activeStandbys].sort((a, b) => (a.priority || 999) - (b.priority || 999));
                    
                    // Group standbys by standbyGroupId or contestant groupId
                    const groupedStandbys: { groupId: string | null; members: StandbyData[] }[] = [];
                    const processedIds = new Set<string>();
                    
                    for (const standby of sortedStandbys) {
                      if (processedIds.has(standby.id)) continue;
                      
                      const groupId = standby.standbyGroupId || standby.contestant.groupId;
                      
                      if (groupId) {
                        // Find all members of this group in the standby list
                        const groupMembers = sortedStandbys.filter(s => 
                          (s.standbyGroupId === groupId || s.contestant.groupId === groupId) && 
                          !processedIds.has(s.id)
                        );
                        
                        if (groupMembers.length > 1) {
                          groupedStandbys.push({ groupId, members: groupMembers });
                          groupMembers.forEach(m => processedIds.add(m.id));
                        } else {
                          // Single member, treat as ungrouped
                          groupedStandbys.push({ groupId: null, members: [standby] });
                          processedIds.add(standby.id);
                        }
                      } else {
                        // Ungrouped standby
                        groupedStandbys.push({ groupId: null, members: [standby] });
                        processedIds.add(standby.id);
                      }
                    }
                    
                    // Flatten for tier numbering while preserving group info
                    const flatListWithGroupInfo = groupedStandbys.flatMap(group => 
                      group.members.map((member, idx) => ({
                        standby: member,
                        isInGroup: group.groupId !== null && group.members.length > 1,
                        isFirstInGroup: idx === 0,
                        isLastInGroup: idx === group.members.length - 1,
                        groupMemberNames: group.members
                          .filter(m => m.id !== member.id)
                          .map(m => m.contestant.name),
                      }))
                    );
                    
                    return (
                      <>
                        <div>
                          <SortableContext 
                            items={flatListWithGroupInfo.map(item => item.standby.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="space-y-1">
                              {flatListWithGroupInfo.map((item, idx) => {
                                // Use the standby's actual priority (original order) rather than display position
                                const tierNumber = item.standby.priority || (idx + 1);
                                return (
                                <div key={item.standby.id} className="flex items-center gap-1">
                                  {/* Tier number badge - uses original priority to preserve order across check-ins */}
                                  <div className="flex-shrink-0 w-7 flex items-center justify-center">
                                    <span 
                                      className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center"
                                      title={`Tier ${tierNumber}`}
                                    >
                                      {tierNumber}
                                    </span>
                                  </div>
                                  {/* Standby card */}
                                  <div className="flex-1 min-w-0">
                                    <SortableStandbyItem
                                      standby={item.standby}
                                      isLocked={isLocked}
                                      isInGroup={item.isInGroup}
                                      isFirstInGroup={item.isFirstInGroup}
                                      isLastInGroup={item.isLastInGroup}
                                      groupMemberNames={item.groupMemberNames}
                                      onSeatSelect={setSeatSelectionStandby}
                                      onUnseat={handleUnseatStandby}
                                      returningInfo={(returningContestantsMap[item.standby.contestantId] || []).filter(r => r.recordDayId !== recordDayId)}
                                    />
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </SortableContext>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
              
              {/* Prize Winners Panel - Only visible in RX mode */}
              {isLocked && (
                <Card className="w-full max-w-sm bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800" data-testid="prize-winners-panel">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span className="font-medium text-sm text-amber-700 dark:text-amber-300">Prize Draw</span>
                      <Badge variant="secondary" className="text-[10px] px-1 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        {prizeWinners.length}
                      </Badge>
                    </div>
                    <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">
                      Contestants entered in the prize draw
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {prizeWinners.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No prize draw entries yet
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {prizeWinners.map((winner) => {
                          return (
                            <div 
                              key={winner.id} 
                              className="flex items-center justify-between gap-2 p-2 rounded-md bg-amber-100/50 dark:bg-amber-900/30 border border-amber-200/50 dark:border-amber-800/50"
                              data-testid={`prize-winner-${winner.id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate text-amber-900 dark:text-amber-100">
                                  {winner.contestantName}
                                </p>
                                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                  Block {winner.blockNumber} - {winner.seatLabel}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                {/* Present toggle button */}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={`h-6 w-6 transition-colors ${
                                    winner.hasPresent 
                                      ? 'text-white bg-pink-500 hover:bg-pink-600 dark:bg-pink-600 dark:hover:bg-pink-500' 
                                      : 'text-gray-400 hover:text-pink-500 hover:bg-pink-100 dark:hover:bg-pink-900/30'
                                  }`}
                                  onClick={() => updatePrizeWinnerMutation.mutate({ id: winner.id, hasPresent: !winner.hasPresent })}
                                  disabled={updatePrizeWinnerMutation.isPending}
                                  data-testid={`button-prize-toggle-${winner.id}`}
                                  title={winner.hasPresent ? "Prize selected" : "Select prize"}
                                >
                                  <Gift className="h-3.5 w-3.5" />
                                </Button>
                                {/* Briefcase toggle button */}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className={`h-6 w-6 transition-colors ${
                                    winner.hasBriefcase 
                                      ? 'text-white bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500' 
                                      : 'text-gray-400 hover:text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                                  }`}
                                  onClick={() => updatePrizeWinnerMutation.mutate({ id: winner.id, hasBriefcase: !winner.hasBriefcase })}
                                  disabled={updatePrizeWinnerMutation.isPending}
                                  data-testid={`button-briefcase-toggle-${winner.id}`}
                                  title={winner.hasBriefcase ? "Briefcase selected" : "Select briefcase"}
                                >
                                  <Briefcase className="h-3.5 w-3.5" />
                                </Button>
                                {/* Remove button */}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-amber-600 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
                                  onClick={() => removePrizeWinnerMutation.mutate(winner.id)}
                                  disabled={removePrizeWinnerMutation.isPending}
                                  data-testid={`button-remove-prize-winner-${winner.id}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* To Seat on Day - Overflow Section */}
          {!isPodiumVisualizerMode && (
            <OverflowDropZone 
              isOver={overId === 'overflow-drop-zone'} 
              isGlobalDragging={!!activeId && !activeId.toString().startsWith('standby-') && !activeId.toString().startsWith('sortable-standby-')}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-sm">To Seat on Day</Badge>
                  {overflowAssignments.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1">
                      {overflowAssignments.length}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {quickMoveEnabled && quickMoveSelectedSeatId && onMoveToOverflow && (() => {
                    const sourceSeat = findSeat(quickMoveSelectedSeatId);
                    if (!sourceSeat?.seat.contestantName) return null;
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-cyan-500 text-cyan-600 dark:text-cyan-400"
                        onClick={() => {
                          if (sourceSeat.seat.assignmentId) {
                            onMoveToOverflow(sourceSeat.seat.assignmentId);
                            setQuickMoveSelectedSeatId(null);
                          }
                        }}
                        data-testid="button-quick-move-to-overflow"
                      >
                        <ArrowDown className="h-4 w-4 mr-1" />
                        Move {sourceSeat.seat.contestantName} Here
                      </Button>
                    );
                  })()}
                  {onAddOverflow && !isLocked && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAddOverflow()}
                      data-testid="button-add-overflow"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  )}
                </div>
              </div>
              {overflowAssignments.length === 0 ? (
                <div className={`text-center py-4 text-sm text-muted-foreground border border-dashed rounded-md transition-colors ${
                  overId === 'overflow-drop-zone' ? 'border-primary bg-primary/5' : ''
                }`}>
                  {overId === 'overflow-drop-zone' ? 'Drop here to move to overflow' : 'No overflow contestants'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {overflowAssignments.map((oa) => (
                    <HoverCard key={oa.id} openDelay={300} closeDelay={50}>
                      <HoverCardTrigger asChild>
                        <Card 
                          className="relative cursor-pointer hover-elevate" 
                          data-testid={`overflow-card-${oa.id}`}
                          onClick={() => onMoveOverflowToSeat?.(oa)}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                  {oa.photoUrl ? (
                                    <img src={oa.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                      <User className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="font-medium text-sm truncate" data-testid={`overflow-name-${oa.id}`}>{oa.contestantName}</p>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {oa.gender && (
                                        <Badge variant="secondary" className="text-[10px] px-1">
                                          {oa.gender === 'Female' ? 'F' : oa.gender === 'Male' ? 'M' : 'O'}
                                        </Badge>
                                      )}
                                      {oa.age && (
                                        <span className="text-[10px] text-muted-foreground">{oa.age}y</span>
                                      )}
                                      {oa.auditionRating && (
                                        <Badge variant="outline" className="text-[10px] px-1">{oa.auditionRating}</Badge>
                                      )}
                                      {oa.contestantId && returningContestantsMap[oa.contestantId] && 
                                        returningContestantsMap[oa.contestantId].some(r => r.recordDayId !== recordDayId) && (() => {
                                        const prevApps = returningContestantsMap[oa.contestantId].filter(r => r.recordDayId !== recordDayId);
                                        const wasStandbyOnly = prevApps.length > 0 && prevApps.every((h: any) => h.type === 'standby');
                                        return (
                                        <Tooltip delayDuration={0}>
                                          <TooltipTrigger asChild>
                                            <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 cursor-help border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300`} data-testid={`badge-returning-overflow-${oa.contestantId}`}>
                                              {wasStandbyOnly ? 'RTN-S' : 'RTN'}
                                            </Badge>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="text-xs max-w-[200px] z-[9999] bg-popover text-popover-foreground border shadow-md p-2" onPointerDown={(e) => e.stopPropagation()}>
                                            <div className="space-y-1">
                                              <p className="font-bold border-b pb-1 mb-1">{wasStandbyOnly ? 'Returning Standby' : 'Returning Contestant'}</p>
                                              {prevApps.map((info, idx) => (
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
                                      {oa.seatLabel && (
                                        <span className="text-[10px] text-muted-foreground">({oa.seatLabel})</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {oa.attendingWith && (
                                  <p className="text-[10px] text-muted-foreground mt-1 truncate">
                                    <Users className="inline h-3 w-3 mr-0.5" />{oa.attendingWith}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col gap-1 flex-shrink-0">
                                {showBookingStatus && (
                                  <Badge 
                                    variant={oa.confirmedRsvp ? "default" : "secondary"} 
                                    className={`text-[9px] px-1 ${oa.confirmedRsvp ? 'bg-green-600 text-white' : ''}`}
                                  >
                                    {oa.confirmedRsvp ? 'CONF' : 'PENDING'}
                                  </Badge>
                                )}
                                {onRemoveOverflow && !isLocked && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); onRemoveOverflow(oa.id); }}
                                    data-testid={`button-remove-overflow-${oa.id}`}
                                    title="Remove from record day"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80" side="top" align="start">
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-12 w-12">
                              {oa.photoUrl ? (
                                <AvatarImage src={oa.photoUrl} alt={oa.contestantName} className="object-cover" />
                              ) : null}
                              <AvatarFallback>
                                {oa.contestantName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  <h4 className="text-sm font-semibold">{oa.contestantName}</h4>
                                  {oa.availableForStandby && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700">
                                      S
                                    </Badge>
                                  )}
                                </div>
                                {oa.auditionRating && (
                                  <span className={`text-sm font-bold ${
                                    oa.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                                    oa.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                                    oa.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                                    oa.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                                    oa.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' : ''
                                  }`}>
                                    {oa.auditionRating}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {oa.age ? `${oa.age} years old` : ''}{oa.age && oa.gender ? ' \u2022 ' : ''}{oa.gender || ''}
                              </p>
                              {oa.contestantLocation && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />{oa.contestantLocation}
                                </p>
                              )}
                            </div>
                          </div>

                          {oa.phone && (
                            <div className="flex items-center gap-2 text-xs">
                              <Phone className="h-3 w-3 text-muted-foreground" />
                              <span>{oa.phone}</span>
                            </div>
                          )}

                          {oa.email && (
                            <div className="flex items-center gap-2 text-xs">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="truncate">{oa.email}</span>
                            </div>
                          )}

                          {oa.attendingWithRaw && (
                            <div className="text-sm">
                              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                Attending With
                              </label>
                              <p className="text-xs mt-0.5">{oa.attendingWithRaw}</p>
                            </div>
                          )}

                          {oa.availabilityNotes && (
                            <div className="text-sm">
                              <label className="text-xs font-medium text-muted-foreground">Availability Notes</label>
                              <p className="text-xs">{oa.availabilityNotes}</p>
                            </div>
                          )}

                          {hasMeaningfulMedicalNote(oa.medicalInfo) && (
                            <div className="text-sm">
                              <label className="text-xs font-medium text-muted-foreground">Medical Info</label>
                              <p className="text-xs">{oa.medicalInfo}</p>
                            </div>
                          )}

                          {hasMeaningfulMedicalNote(oa.mobilityNotes) && (
                            <div className="text-sm p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
                              <label className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                                <ShieldAlert className="h-3 w-3" />
                                Mobility/Access Notes
                              </label>
                              <p className="text-xs mt-0.5">{oa.mobilityNotes}</p>
                            </div>
                          )}

                          {oa.criminalRecord && (
                            <div className="text-sm">
                              <label className="text-xs font-medium text-muted-foreground">Criminal Record</label>
                              <p className="text-xs">{oa.criminalRecord}</p>
                            </div>
                          )}

                          <div className="text-sm">
                            <label className="text-xs font-medium text-muted-foreground">Status</label>
                            <div className="mt-1 flex items-center gap-1 flex-wrap">
                              <Badge variant="secondary">To Seat on Day</Badge>
                              {oa.podiumStory && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800">
                                  <Heart className="h-2.5 w-2.5 mr-0.5" />
                                  Story
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  ))}
                </div>
              )}
            </OverflowDropZone>
          )}
        </div>
        
        <DragOverlay dropAnimation={null}>
          {activeSeat ? (
            <div className="opacity-80">
              <SeatCard
                seat={activeSeat}
                blockIndex={0}
                seatIndex={0}
                isDragging={true}
                isGlobalDragging={true}
                onEmptySeatClick={undefined}
              />
            </div>
          ) : activeStandby ? (
            <div className="opacity-80 p-2 border rounded-md border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 cursor-grabbing">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{activeStandby.contestant.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                      {activeStandby.contestant.gender === "Female" ? "F" : "M"}
                    </Badge>
                  </div>
                </div>
                <Badge 
                  variant="secondary" 
                  className="text-[10px] h-5 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                >
                  {activeStandby.status === 'pending' ? 'Assigned' : 
                   activeStandby.status === 'email_sent' ? 'Invited' : 
                   activeStandby.status === 'seated' ? 'Assigned' :
                   activeStandby.status}
                </Badge>
              </div>
            </div>
          ) : null}
        </DragOverlay>

        {/* Standby Seat Selection Dialog */}
        <Dialog open={!!seatSelectionStandby} onOpenChange={(open) => { 
          if (!open) {
            setSeatSelectionStandby(null);
            setSelectedSeatForStandby("");
            setSeatSelectionNotes("");
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Assign Standby to Seat</DialogTitle>
              <DialogDescription>
                Select an available seat for {seatSelectionStandby?.contestant.name}. The block type (PB/NPB) is determined automatically from the block configuration. You can also record any movement details in the notes box below.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Available Seat</Label>
                <Select value={selectedSeatForStandby} onValueChange={setSelectedSeatForStandby}>
                  <SelectTrigger data-testid="select-standby-seat">
                    <SelectValue placeholder="Choose a seat..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {blocks.map((block, bIdx) => {
                      const emptySeats = block.filter(s => !s.contestantName);
                      if (emptySeats.length === 0) return null;
                      const blockType = blockTypeMap[bIdx + 1] || 'NPB';
                      return (
                        <div key={bIdx}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                            Block {bIdx + 1} ({blockType})
                          </div>
                          {emptySeats.map(seat => {
                            const label = seat.id.split('-').pop() || '';
                            return (
                              <SelectItem key={seat.id} value={seat.id}>
                                Block {bIdx + 1} - {label}
                              </SelectItem>
                            );
                          })}
                        </div>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Movement Notes (Optional)</Label>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSeatSelectionNotes(prev => 
                      prev ? `${prev}\nReplaced players` : "Replaced players"
                    )}
                    data-testid="button-replaced-players"
                  >
                    Replaced Players
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Record any standby movements such as who they replaced, seat swaps, or other seating changes made during the day.
                </p>
                <Textarea
                  placeholder="Record any movement details..."
                  value={seatSelectionNotes}
                  onChange={(e) => setSeatSelectionNotes(e.target.value)}
                  className="min-h-[80px]"
                  data-testid="input-movement-notes"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setSeatSelectionStandby(null);
                setSelectedSeatForStandby("");
                setSeatSelectionNotes("");
              }}>
                Cancel
              </Button>
              <Button 
                onClick={async () => {
                  if (!seatSelectionStandby) return;
                  const notes = seatSelectionNotes.trim();
                  
                  try {
                    if (selectedSeatForStandby) {
                      const { blockNumber, seatLabel } = getBlockAndSeat(selectedSeatForStandby);
                      await handleConfirmStandbyAssignInternal(seatSelectionStandby, blockNumber, seatLabel, notes || undefined);
                    } else if (notes) {
                      // Just update the standby with notes without seating them
                      await apiRequest("PATCH", `/api/standbys/${seatSelectionStandby.id}`, {
                        standbyMovementNotes: notes
                      });
                      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
                      toast({
                        title: "Notes Updated",
                        description: `Notes for ${seatSelectionStandby.contestant.name} have been saved.`,
                      });
                    }
                  } catch (error) {
                    toast({
                      title: "Error",
                      description: "Failed to update standby. Please try again.",
                      variant: "destructive",
                    });
                  }
                  
                  setSeatSelectionStandby(null);
                  setSelectedSeatForStandby("");
                  setSeatSelectionNotes("");
                }}
                data-testid="button-confirm-standby-seat"
              >
                Confirm {selectedSeatForStandby ? "Seating" : "Notes Only"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Locked Swap Confirmation Dialog */}
        <AlertDialog open={!!pendingSwap} onOpenChange={(open) => !open && handleCancelLockedSwap()}>
          <AlertDialogContent data-testid="dialog-locked-swap">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Seating Chart is Locked
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <span className="block">
                    This seating chart is currently in <strong className="text-amber-600">RX Day Mode</strong>. 
                    Moving contestants will be tracked for audit purposes.
                  </span>
                  {pendingSwap && (
                    <div className="mt-3 p-3 bg-muted rounded-lg text-sm">
                      <span className="block font-medium text-foreground">
                        Move <span className="text-primary">{pendingSwap.sourceSeat.seat.contestantName}</span>
                        {' '}from seat <strong>{String(pendingSwap.sourceLocation.blockNumber).padStart(2, '0')}-{pendingSwap.sourceLocation.seatLabel}</strong>
                        {' '}to <strong>{String(pendingSwap.targetLocation.blockNumber).padStart(2, '0')}-{pendingSwap.targetLocation.seatLabel}</strong>
                      </span>
                      {pendingSwap.targetSeat.seat.contestantName && (
                        <span className="block mt-1 text-foreground">
                          <span className="text-primary">{pendingSwap.targetSeat.seat.contestantName}</span>
                          {' '}will move to <strong>{String(pendingSwap.sourceLocation.blockNumber).padStart(2, '0')}-{pendingSwap.sourceLocation.seatLabel}</strong>
                        </span>
                      )}
                    </div>
                  )}
                  <span className="block text-muted-foreground text-xs">
                    This move will be recorded and visible with a "MOVED" indicator.
                  </span>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-locked-swap-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                data-testid="button-locked-swap-confirm"
                className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={handleConfirmLockedSwap}
              >
                Confirm Move
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Standby Error Dialog */}
        <AlertDialog open={!!standbyError} onOpenChange={(open) => !open && setStandbyError(null)}>
          <AlertDialogContent data-testid="dialog-standby-error">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Cannot Seat Standby
              </AlertDialogTitle>
              <AlertDialogDescription>
                {standbyError}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setStandbyError(null)}>
                OK
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Standby Seat Assignment Confirmation Dialog */}
        <AlertDialog open={!!pendingStandbyAssign} onOpenChange={(open) => { 
          if (!open) {
            setPendingStandbyAssign(null);
            setStandbyMovementNotes("");
          }
        }}>
          <AlertDialogContent data-testid="dialog-standby-assign">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Seat Standby
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4 text-sm text-muted-foreground">
                  <span className="block">
                    You are about to assign a standby to a seat. This action will be recorded.
                  </span>
                  {pendingStandbyAssign && (
                    <div className="p-3 bg-muted rounded-lg text-sm">
                      <span className="block font-medium text-foreground">
                        Assign <span className="text-primary">{pendingStandbyAssign.standby.contestant.name}</span>
                        {' '}to seat <strong>{String(pendingStandbyAssign.targetBlockNumber).padStart(2, '0')}-{pendingStandbyAssign.targetSeatLabel}</strong>
                        {' '}as <strong>{blockTypeMap[pendingStandbyAssign.targetBlockNumber] || 'NPB'}</strong>
                      </span>
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="block font-medium text-foreground text-sm">
                        Movement Notes (Optional)
                      </span>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setStandbyMovementNotes(prev => 
                          prev ? `${prev}\nReplaced players` : "Replaced players"
                        )}
                        data-testid="button-replaced-players-drag"
                      >
                        Replaced Players
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Record any movement details..."
                      value={standbyMovementNotes}
                      onChange={(e) => setStandbyMovementNotes(e.target.value)}
                      className="min-h-[80px]"
                      data-testid="input-movement-notes-drag"
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-standby-assign-cancel" onClick={() => {
                setPendingStandbyAssign(null);
                setStandbyMovementNotes("");
              }}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                data-testid="button-standby-assign-confirm"
                className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={handleConfirmStandbyAssign}
              >
                Confirm Seating
              </AlertDialogAction>
              <Button
                variant="outline"
                className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                onClick={async () => {
                  if (!pendingStandbyAssign) return;
                  const notes = standbyMovementNotes.trim();
                  if (notes) {
                    try {
                      await apiRequest("PATCH", `/api/standbys/${pendingStandbyAssign.standby.id}`, {
                        standbyMovementNotes: notes
                      });
                      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
                      toast({
                        title: "Notes Updated",
                        description: `Notes for ${pendingStandbyAssign.standby.contestant.name} have been saved.`,
                      });
                    } catch (error) {
                      toast({
                        title: "Error",
                        description: "Failed to update movement notes.",
                        variant: "destructive",
                      });
                    }
                  }
                  setPendingStandbyAssign(null);
                  setStandbyMovementNotes("");
                }}
                data-testid="button-standby-notes-only"
              >
                Notes Only
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </DndContext>
  );
}
