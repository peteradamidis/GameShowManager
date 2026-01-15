import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  useDraggable,
  useDroppable,
  DragOverlay,
} from "@dnd-kit/core";
import { SeatCard, SeatData } from "./seat-card";
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
import { Link2, AlertTriangle, ChevronUp, ChevronDown, User } from "lucide-react";
import stageBackdropImage from "@/assets/stage-backdrop.png";
import podiumSetImage from "@/assets/podium-set.png";
import centreStageImage from "@/assets/centre-stage.png";

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
  contestant: {
    id: string;
    name: string;
    gender: string;
    age: number;
    auditionRating?: string;
  };
}

interface SeatingChartProps {
  recordDayId: string;
  initialSeats?: SeatData[][];
  onRefreshNeeded?: () => void; // Callback to trigger data refetch from parent
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
  onReturnToStandby?: (assignmentId: string, contestantId: string) => void;
  onNoShow?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onEarlyLeaver?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  isLocked?: boolean; // RX Day Mode - when true, use tracked swap endpoint
  standbys?: StandbyData[]; // Standbys for this record day
  onStandbySeated?: () => void; // Callback when standby is seated
  isPodiumVisualizerMode?: boolean; // Show only contestant photos
}

function DraggableDroppableSeat({
  seat,
  blockIndex,
  seatIndex,
  isOver,
  isGlobalDragging,
  isRXDayLocked,
  onEmptySeatClick,
  onRemove,
  onCancel,
  onWinningMoneyClick,
  onRemoveWinningMoney,
  onReturnToStandby,
  onNoShow,
  onEarlyLeaver,
}: {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isOver: boolean;
  isGlobalDragging?: boolean;
  isRXDayLocked?: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
  onReturnToStandby?: (assignmentId: string, contestantId: string) => void;
  onNoShow?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onEarlyLeaver?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
}) {
  // Make occupied seats draggable
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: seat.id,
    disabled: !seat.contestantName,
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

  return (
    <div 
      ref={setRefs} 
      {...attributes} 
      {...listeners}
      className={isOver ? "ring-4 ring-primary rounded-lg scale-105 transition-all" : ""}
      style={isOver ? { zIndex: 10 } : undefined}
    >
      <SeatCard
        seat={seat}
        blockIndex={blockIndex}
        seatIndex={seatIndex}
        isDragging={isDragging}
        isGlobalDragging={isGlobalDragging}
        isRXDayLocked={isRXDayLocked}
        onEmptySeatClick={onEmptySeatClick}
        onRemove={onRemove}
        onCancel={onCancel}
        onWinningMoneyClick={onWinningMoneyClick}
        onRemoveWinningMoney={onRemoveWinningMoney}
        onReturnToStandby={onReturnToStandby}
        onNoShow={onNoShow}
        onEarlyLeaver={onEarlyLeaver}
      />
    </div>
  );
}

// Draggable Standby Item
function DraggableStandby({
  standby,
  isLocked,
  priorityIndex,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  standby: StandbyData;
  isLocked?: boolean;
  priorityIndex: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `standby-${standby.id}`,
    data: { type: 'standby', standby },
    disabled: !isLocked, // Only draggable when locked (RX mode)
  });

  const ratingColors: Record<string, string> = {
    'A+': 'bg-emerald-500 text-white',
    'A': 'bg-green-500 text-white',
    'B+': 'bg-amber-500 text-white',
    'B': 'bg-orange-500 text-white',
    'C': 'bg-red-500 text-white',
  };

  return (
    <div
      ref={setNodeRef}
      className={`p-2 border rounded-md ${isDragging ? 'opacity-50' : ''} ${
        isLocked 
          ? 'border-amber-500/50 bg-amber-50 dark:bg-amber-950/20' 
          : 'border-muted'
      }`}
      data-testid={`standby-item-${standby.id}`}
    >
      <div className="flex items-center gap-2">
        {/* Priority number */}
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
            disabled={isFirst}
            className={`p-0.5 rounded hover:bg-muted/80 ${isFirst ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
            data-testid={`standby-move-up-${standby.id}`}
            title="Move up in priority"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <span 
            className="w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center"
            title={`Priority ${priorityIndex}`}
          >
            {priorityIndex}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
            disabled={isLast}
            className={`p-0.5 rounded hover:bg-muted/80 ${isLast ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
            data-testid={`standby-move-down-${standby.id}`}
            title="Move down in priority"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        
        {/* Drag handle and content */}
        <div 
          {...attributes}
          {...listeners}
          className={`flex-1 min-w-0 ${isLocked ? 'cursor-grab hover:bg-muted/50' : 'cursor-not-allowed opacity-60'}`}
        >
          <p className="font-medium text-sm truncate">{standby.contestant.name}</p>
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
        
        <Badge 
          variant="secondary" 
          className={`text-[10px] h-5 ${
            standby.status === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
            'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
          }`}
        >
          {standby.status === 'pending' ? 'Assigned' : 
           standby.status === 'email_sent' ? 'Invited' : 
           standby.status === 'seated' ? 'Assigned' :
           standby.status}
        </Badge>
      </div>
    </div>
  );
}

// Define the row structure: [rowLabel, numSeats]
const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

function SeatingBlock({ 
  block, 
  blockIndex, 
  blockLabel,
  reverseRows = false,
  overId,
  isGlobalDragging,
  isRXDayLocked,
  onEmptySeatClick,
  onRemove,
  onCancel,
  onWinningMoneyClick,
  onRemoveWinningMoney,
  onReturnToStandby,
  onNoShow,
  onEarlyLeaver,
  blockType,
  onBlockTypeChange,
  isPodiumVisualizerMode = false,
}: { 
  block: SeatData[]; 
  blockIndex: number;
  blockLabel: string;
  reverseRows?: boolean;
  overId: string | null;
  isGlobalDragging?: boolean;
  isRXDayLocked?: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
  onReturnToStandby?: (assignmentId: string, contestantId: string) => void;
  onNoShow?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  onEarlyLeaver?: (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => void;
  blockType?: 'PB' | 'NPB';
  onBlockTypeChange?: (blockNumber: number, newType: 'PB' | 'NPB') => void;
  isPodiumVisualizerMode?: boolean;
}) {
  const stats = calculateBlockStats(block);

  // Calculate which seats have separated group members
  // A seat is "separated" if the contestant has a group (via attendingWith or groupId)
  // but none of their group members are in adjacent seats
  const seatsWithSeparationInfo = block.map((seat, idx) => {
    // Only check occupied seats that have group information
    if (!seat.contestantId) return seat;
    
    const hasGroup = seat.attendingWith || seat.groupId;
    if (!hasGroup) return seat;
    
    // Get group member IDs (from attendingWith - comma-separated, or groupId for same-group matching)
    const attendingWithIds = seat.attendingWith 
      ? seat.attendingWith.split(',').map(id => id.trim()).filter(Boolean)
      : [];
    
    // Find all group members in this block
    const groupMembersInBlock = block.filter(s => 
      s.contestantId && 
      s.contestantId !== seat.contestantId &&
      (
        // Check if this seat is attending with that contestant
        attendingWithIds.includes(s.contestantId) ||
        // Check if that contestant is attending with this seat
        (s.attendingWith && s.attendingWith.split(',').map(id => id.trim()).includes(seat.contestantId!)) ||
        // Check if they share the same groupId
        (seat.groupId && s.groupId && seat.groupId === s.groupId)
      )
    );
    
    // If no group members in this block at all, this contestant is separated
    if (groupMembersInBlock.length === 0 && (attendingWithIds.length > 0 || seat.groupId)) {
      return { ...seat, isGroupSeparated: true };
    }
    
    // If there are group members, check if any are adjacent
    // Adjacent means: same row (left or right), or same column in adjacent row
    const getRowAndCol = (seatIndex: number) => {
      let cumulative = 0;
      for (let rowIdx = 0; rowIdx < SEAT_ROWS.length; rowIdx++) {
        if (seatIndex < cumulative + SEAT_ROWS[rowIdx].count) {
          return { row: rowIdx, col: seatIndex - cumulative };
        }
        cumulative += SEAT_ROWS[rowIdx].count;
      }
      return null;
    };
    
    const myPos = getRowAndCol(idx);
    if (!myPos) return seat;
    
    // Check if any group member is adjacent
    let hasAdjacentGroupMember = false;
    
    for (const member of groupMembersInBlock) {
      const memberIdx = block.findIndex(s => s.contestantId === member.contestantId);
      if (memberIdx === -1) continue;
      
      const memberPos = getRowAndCol(memberIdx);
      if (!memberPos) continue;
      
      // Check horizontal adjacency (same row, adjacent column)
      if (memberPos.row === myPos.row && Math.abs(memberPos.col - myPos.col) === 1) {
        hasAdjacentGroupMember = true;
        break;
      }
      
      // Check vertical adjacency (adjacent row, same or ±1 column for staggered layout)
      if (Math.abs(memberPos.row - myPos.row) === 1 && Math.abs(memberPos.col - myPos.col) <= 1) {
        hasAdjacentGroupMember = true;
        break;
      }
    }
    
    // Mark as separated if has group members but none are adjacent
    if (groupMembersInBlock.length > 0 && !hasAdjacentGroupMember) {
      return { ...seat, isGroupSeparated: true };
    }
    
    return seat;
  });

  // Organize seats by row
  let seatIdx = 0;
  const seatsByRow = SEAT_ROWS.map(row => {
    const rowSeats = seatsWithSeparationInfo.slice(seatIdx, seatIdx + row.count);
    seatIdx += row.count;
    return { ...row, seats: rowSeats };
  });

  // Reverse rows if needed (for top blocks, A should be at bottom)
  const displayRows = reverseRows ? [...seatsByRow].reverse() : seatsByRow;

  const handleBlockTypeToggle = () => {
    if (onBlockTypeChange) {
      const newType = blockType === 'PB' ? 'NPB' : 'PB';
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
              variant={blockType === 'PB' ? 'default' : blockType === 'NPB' ? 'secondary' : 'outline'}
              className="h-6 px-2 text-xs font-medium"
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
              <span>{stats.total}/22 filled</span>
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
                <div className="text-xs font-medium text-muted-foreground px-1">
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
                    const seatNumber = seatIdxInRow + 1;
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
                          onEmptySeatClick={onEmptySeatClick}
                          onRemove={onRemove}
                          onCancel={onCancel}
                          onWinningMoneyClick={onWinningMoneyClick}
                          onRemoveWinningMoney={onRemoveWinningMoney}
                          onReturnToStandby={onReturnToStandby}
                          onNoShow={onNoShow}
                          onEarlyLeaver={onEarlyLeaver}
                        />
                        {/* Horizontal link to next seat in same row */}
                        {hasLinkToNext && (
                          <div 
                            className="absolute top-1/2 right-0 transform -translate-y-1/2 translate-x-1/2 z-10"
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
                            className="absolute bottom-0 left-1/2 transform translate-y-1/2 -translate-x-1/2 z-10"
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
    'A+': 0, 'A': 0, 'B+': 0, 'B': 0, 'C': 0
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

export function SeatingChart({ recordDayId, initialSeats, onRefreshNeeded, onEmptySeatClick, onRemove, onCancel, onWinningMoneyClick, onRemoveWinningMoney, onReturnToStandby, onNoShow, onEarlyLeaver, isLocked = false, standbys = [], onStandbySeated, isPodiumVisualizerMode = false }: SeatingChartProps) {
  const [blocks, setBlocks] = useState<SeatData[][]>(
    initialSeats || Array(7).fill(null).map((_, blockIdx) => 
      generateBlockSeats(recordDayId, blockIdx)
    )
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null);
  const [standbyError, setStandbyError] = useState<string | null>(null);
  const [pendingStandbyAssign, setPendingStandbyAssign] = useState<{
    standby: StandbyData;
    targetBlockNumber: number;
    targetSeatLabel: string;
  } | null>(null);
  const { toast } = useToast();

  // Fetch block types for this record day
  const { data: blockTypesData } = useQuery<BlockType[]>({
    queryKey: ['/api/record-days', recordDayId, 'block-types'],
  });

  // Fetch block configuration status (5 PB + 2 NPB required)
  const { data: blockConfigStatus } = useQuery<{complete: boolean; pbCount: number; npbCount: number}>({
    queryKey: ['/api/record-days', recordDayId, 'block-config-status'],
  });

  // Create a map of block number to block type
  const blockTypeMap: Record<number, 'PB' | 'NPB'> = {};
  if (blockTypesData) {
    blockTypesData.forEach(bt => {
      blockTypeMap[bt.blockNumber] = bt.blockType as 'PB' | 'NPB';
    });
  }

  // Check if blocks are fully configured
  const isBlockConfigComplete = blockConfigStatus?.complete ?? false;

  // Wrap onEmptySeatClick to check block config
  const handleEmptySeatClick = (blockNumber: number, seatLabel: string) => {
    if (!isBlockConfigComplete) {
      toast({
        title: "Block configuration required",
        description: "You must configure all 7 blocks (5 PB + 2 NPB) before booking seats.",
        variant: "destructive",
      });
      return;
    }
    onEmptySeatClick?.(blockNumber, seatLabel);
  };

  // Mutation to update block type
  const updateBlockTypeMutation = useMutation({
    mutationFn: async ({ blockNumber, blockType }: { blockNumber: number; blockType: 'PB' | 'NPB' }) => {
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

  const handleBlockTypeChange = (blockNumber: number, newType: 'PB' | 'NPB') => {
    updateBlockTypeMutation.mutate({ blockNumber, blockType: newType });
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

  // Update blocks when initialSeats changes (after data loads from API)
  useEffect(() => {
    if (initialSeats) {
      setBlocks(initialSeats);
    }
  }, [initialSeats]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before dragging starts
      },
    })
  );

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

  // Handle drag end - check if locked and require confirmation
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveId(null);
    setOverId(null);

    if (!over || active.id === over.id) return;

    const activeIdStr = active.id as string;
    
    // Check if this is a standby being dragged
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
  
  // Handle standby seat assignment
  const handleConfirmStandbyAssign = async () => {
    if (!pendingStandbyAssign) return;
    
    const { standby, targetBlockNumber, targetSeatLabel } = pendingStandbyAssign;
    setPendingStandbyAssign(null);
    
    try {
      // First update the standby status to 'seated' - this removes the standby block
      await apiRequest('PATCH', `/api/standbys/${standby.id}`, {
        status: 'seated',
        assignedToSeat: `${targetBlockNumber}${targetSeatLabel}`,
      });
      
      // Now create the seat assignment (standby check will pass since status is 'seated')
      await apiRequest('POST', `/api/seat-assignments`, {
        recordDayId,
        contestantId: standby.contestantId,
        blockNumber: targetBlockNumber,
        seatLabel: targetSeatLabel,
      });
      
      toast({
        title: "Standby seated",
        description: `${standby.contestant.name} has been assigned to Block ${targetBlockNumber}, Seat ${targetSeatLabel}.`,
      });
      
      // Refresh data
      onRefreshNeeded?.();
      onStandbySeated?.();
      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
    } catch (error: any) {
      toast({
        title: "Failed to seat standby",
        description: error?.message || "Could not assign standby to seat.",
        variant: "destructive",
      });
    }
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
      collisionDetection={closestCenter}
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
                    You must select exactly <strong>5 Playing Blocks (PB)</strong> and <strong>2 Non-Playing Blocks (NPB)</strong> before you can book seats.
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Current: {blockConfigStatus?.pbCount ?? 0} PB, {blockConfigStatus?.npbCount ?? 0} NPB
                    {(blockConfigStatus?.pbCount ?? 0) + (blockConfigStatus?.npbCount ?? 0) < 7 && (
                      <span> — Click the block type badges below to configure each block</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Circular Seating Area */}
          <div>
            <div className="space-y-6">
            {/* Top Row - 3 Blocks (rows reversed: A at bottom, E at top) */}
            <div className="grid grid-cols-3 gap-4">
              {topBlocks.map((block, idx) => (
                <SeatingBlock
                  key={idx}
                  block={block}
                  blockIndex={idx}
                  blockLabel={`Block ${idx + 1} (Top)`}
                  reverseRows={true}
                  overId={overId}
                  isGlobalDragging={!!activeId}
                  isRXDayLocked={isLocked}
                  onEmptySeatClick={handleEmptySeatClick}
                  onRemove={onRemove}
                  onCancel={onCancel}
                  onWinningMoneyClick={onWinningMoneyClick}
                  onRemoveWinningMoney={onRemoveWinningMoney}
                  onReturnToStandby={onReturnToStandby}
                  onNoShow={onNoShow}
                  onEarlyLeaver={onEarlyLeaver}
                  blockType={blockTypeMap[idx + 1]}
                  onBlockTypeChange={handleBlockTypeChange}
                  isPodiumVisualizerMode={isPodiumVisualizerMode}
                />
              ))}
            </div>

            {/* Center Stage Indicator with Podium */}
            <div className="relative flex items-center justify-between py-6">
              {isPodiumVisualizerMode ? (
                <>
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
                  <div className="flex items-center justify-center">
                    <img 
                      src={centreStageImage} 
                      alt="Centre Stage" 
                      className="object-contain"
                      style={{ height: '120px' }}
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
                </>
              ) : (
                <>
                  <div className="flex-1" />
                  <div className="border-2 border-dashed border-primary text-center rounded-lg px-12 py-8">
                    <p className="text-lg font-semibold text-primary">STAGE</p>
                    <p className="text-xs text-muted-foreground mt-1">Performance Area</p>
                  </div>
                  <div className="flex-1 flex justify-end">
                    <div className="border-2 border-dashed border-muted-foreground rounded-lg px-2 py-6 flex items-center justify-center">
                      <p className="text-sm font-semibold text-muted-foreground tracking-widest" style={{ writingMode: 'vertical-rl' }}>PODIUM</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bottom Row - 3 Blocks (reordered: 6, 5, 4) */}
            <div className="grid grid-cols-3 gap-4">
              {reorderedBottomBlocks.map((block, idx) => {
                const originalIdx = 5 - idx; // Maps to 5, 4, 3 (blocks 6, 5, 4 for display)
                return (
                  <SeatingBlock
                    key={originalIdx}
                    block={block}
                    blockIndex={originalIdx}
                    blockLabel={`Block ${originalIdx + 1} (Bottom)`}
                    reverseRows={false}
                    overId={overId}
                    isGlobalDragging={!!activeId}
                    isRXDayLocked={isLocked}
                    onEmptySeatClick={handleEmptySeatClick}
                    onRemove={onRemove}
                    onCancel={onCancel}
                    onWinningMoneyClick={onWinningMoneyClick}
                    onRemoveWinningMoney={onRemoveWinningMoney}
                    onReturnToStandby={onReturnToStandby}
                    onNoShow={onNoShow}
                    onEarlyLeaver={onEarlyLeaver}
                    blockType={blockTypeMap[originalIdx + 1]}
                    onBlockTypeChange={handleBlockTypeChange}
                    isPodiumVisualizerMode={isPodiumVisualizerMode}
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
                  onEmptySeatClick={handleEmptySeatClick}
                  onRemove={onRemove}
                  onCancel={onCancel}
                  onWinningMoneyClick={onWinningMoneyClick}
                  onRemoveWinningMoney={onRemoveWinningMoney}
                  onReturnToStandby={onReturnToStandby}
                  onNoShow={onNoShow}
                  onEarlyLeaver={onEarlyLeaver}
                  blockType={blockTypeMap[7]}
                  onBlockTypeChange={handleBlockTypeChange}
                  isPodiumVisualizerMode={isPodiumVisualizerMode}
                />
              </div>
              
              {/* Standbys Panel */}
              <Card className="w-full max-w-xs" data-testid="standbys-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium">Standbys</CardTitle>
                    <Badge 
                      variant="secondary" 
                      className={isLocked ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" : ""}
                    >
                      {standbys.filter(s => s.status !== 'seated').length} available
                    </Badge>
                  </div>
                  {!isLocked && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Lock RX Day mode to drag standbys into empty seats
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {standbys.filter(s => s.status !== 'seated').length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No standbys for this day
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {standbys
                        .filter(s => s.status !== 'seated')
                        .sort((a, b) => (a.priority || 999) - (b.priority || 999))
                        .map((standby, idx, arr) => (
                          <DraggableStandby
                            key={standby.id}
                            standby={standby}
                            isLocked={isLocked}
                            priorityIndex={idx + 1}
                            isFirst={idx === 0}
                            isLast={idx === arr.length - 1}
                            onMoveUp={() => handleStandbyReorder(standby.id, idx, idx - 1, arr)}
                            onMoveDown={() => handleStandbyReorder(standby.id, idx, idx + 1, arr)}
                          />
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
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
        <AlertDialog open={!!pendingStandbyAssign} onOpenChange={(open) => !open && setPendingStandbyAssign(null)}>
          <AlertDialogContent data-testid="dialog-standby-assign">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Seat Standby
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <span className="block">
                    You are about to assign a standby to a seat. This action will be recorded.
                  </span>
                  {pendingStandbyAssign && (
                    <div className="mt-3 p-3 bg-muted rounded-lg text-sm">
                      <span className="block font-medium text-foreground">
                        Assign <span className="text-primary">{pendingStandbyAssign.standby.contestant.name}</span>
                        {' '}to seat <strong>{String(pendingStandbyAssign.targetBlockNumber).padStart(2, '0')}-{pendingStandbyAssign.targetSeatLabel}</strong>
                      </span>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-standby-assign-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                data-testid="button-standby-assign-confirm"
                className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={handleConfirmStandbyAssign}
              >
                Confirm Assignment
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </DndContext>
  );
}
