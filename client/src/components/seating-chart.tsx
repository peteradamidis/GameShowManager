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
import { Link2, AlertTriangle } from "lucide-react";

// Pending swap operation type
interface PendingSwap {
  sourceSeat: { blockIdx: number; seatIdx: number; seat: SeatData };
  targetSeat: { blockIdx: number; seatIdx: number; seat: SeatData };
  sourceLocation: { blockNumber: number; seatLabel: string };
  targetLocation: { blockNumber: number; seatLabel: string };
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
  isLocked?: boolean; // RX Day Mode - when true, use tracked swap endpoint
}

function DraggableDroppableSeat({
  seat,
  blockIndex,
  seatIndex,
  isOver,
  isRXDayLocked,
  onEmptySeatClick,
  onRemove,
  onCancel,
  onWinningMoneyClick,
  onRemoveWinningMoney,
}: {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isOver: boolean;
  isRXDayLocked?: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
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
        isRXDayLocked={isRXDayLocked}
        onEmptySeatClick={onEmptySeatClick}
        onRemove={onRemove}
        onCancel={onCancel}
        onWinningMoneyClick={onWinningMoneyClick}
        onRemoveWinningMoney={onRemoveWinningMoney}
      />
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
  isRXDayLocked,
  onEmptySeatClick,
  onRemove,
  onCancel,
  onWinningMoneyClick,
  onRemoveWinningMoney,
  blockType,
  onBlockTypeChange,
}: { 
  block: SeatData[]; 
  blockIndex: number;
  blockLabel: string;
  reverseRows?: boolean;
  overId: string | null;
  isRXDayLocked?: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
  onWinningMoneyClick?: (assignmentId: string) => void;
  onRemoveWinningMoney?: (assignmentId: string) => void;
  blockType?: 'PB' | 'NPB';
  onBlockTypeChange?: (blockNumber: number, newType: 'PB' | 'NPB') => void;
}) {
  const stats = calculateBlockStats(block);

  // Organize seats by row
  let seatIdx = 0;
  const seatsByRow = SEAT_ROWS.map(row => {
    const rowSeats = block.slice(seatIdx, seatIdx + row.count);
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{blockLabel}</CardTitle>
          <Button
            size="sm"
            variant={blockType === 'PB' ? 'default' : blockType === 'NPB' ? 'secondary' : 'outline'}
            className="h-6 px-2 text-xs font-medium"
            onClick={handleBlockTypeToggle}
            data-testid={`block-type-toggle-${blockIndex}`}
          >
            {blockType || '—'}
          </Button>
        </div>
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
      </CardHeader>
      <CardContent className="space-y-2">
        {displayRows.map((row, displayIdx) => {
          // Find the original row index in SEAT_ROWS
          const originalRowIdx = SEAT_ROWS.findIndex(r => r.label === row.label);
          // Get the next row in display order (for vertical linking)
          const nextDisplayRow = displayIdx < displayRows.length - 1 ? displayRows[displayIdx + 1] : null;
          
          return (
            <div key={row.label} className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground px-1">
                Row {row.label}
              </div>
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
                    
                    return (
                      <div key={seat.id} className="relative">
                        <DraggableDroppableSeat
                          seat={seat}
                          blockIndex={blockIndex}
                          seatIndex={absoluteSeatIdx}
                          isOver={overId === seat.id}
                          isRXDayLocked={isRXDayLocked}
                          onEmptySeatClick={onEmptySeatClick}
                          onRemove={onRemove}
                          onCancel={onCancel}
                          onWinningMoneyClick={onWinningMoneyClick}
                          onRemoveWinningMoney={onRemoveWinningMoney}
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
function generateBlockSeats(recordDayId: string, blockIdx: number): SeatData[] {
  const seats: SeatData[] = [];
  SEAT_ROWS.forEach(row => {
    for (let i = 1; i <= row.count; i++) {
      seats.push({
        id: `${recordDayId}-block${blockIdx}-${row.label}${i}`,
      });
    }
  });
  return seats;
}

// Group move operation type
interface GroupMoveOperation {
  assignments: Array<{
    assignmentId: string;
    contestantName: string;
    fromBlock: number;
    fromSeat: string;
    toBlock: number;
    toSeat: string;
  }>;
}

export function SeatingChart({ recordDayId, initialSeats, onRefreshNeeded, onEmptySeatClick, onRemove, onCancel, onWinningMoneyClick, onRemoveWinningMoney, isLocked = false }: SeatingChartProps) {
  const [blocks, setBlocks] = useState<SeatData[][]>(
    initialSeats || Array(7).fill(null).map((_, blockIdx) => 
      generateBlockSeats(recordDayId, blockIdx)
    )
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null);
  const [pendingGroupMove, setPendingGroupMove] = useState<GroupMoveOperation | null>(null);
  const [activeDragGroup, setActiveDragGroup] = useState<SeatData[]>([]);
  const { toast } = useToast();

  // Fetch block types for this record day
  const { data: blockTypesData } = useQuery<BlockType[]>({
    queryKey: ['/api/record-days', recordDayId, 'block-types'],
  });

  // Create a map of block number to block type
  const blockTypeMap: Record<number, 'PB' | 'NPB'> = {};
  if (blockTypesData) {
    blockTypesData.forEach(bt => {
      blockTypeMap[bt.blockNumber] = bt.blockType as 'PB' | 'NPB';
    });
  }

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

  // Helper to find all seated group members for a given contestant
  const findSeatedGroupMembers = (contestantId: string, currentBlockIdx: number): Array<{ blockIdx: number; seatIdx: number; seat: SeatData }> => {
    const members: Array<{ blockIdx: number; seatIdx: number; seat: SeatData }> = [];
    
    // Find the source seat first to get the groupId
    let sourceGroupId: string | null = null;
    let sourceAttendingWith: string[] = [];
    
    for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
      for (let seatIdx = 0; seatIdx < blocks[blockIdx].length; seatIdx++) {
        const seat = blocks[blockIdx][seatIdx];
        if (seat.contestantId === contestantId) {
          sourceGroupId = seat.groupId || null;
          sourceAttendingWith = seat.attendingWith ? seat.attendingWith.split(',').map(id => id.trim()) : [];
          members.push({ blockIdx, seatIdx, seat });
          break;
        }
      }
    }
    
    if (members.length === 0) return [];
    
    // Find other group members - only in the same block for simpler group movement
    const block = blocks[currentBlockIdx];
    for (let seatIdx = 0; seatIdx < block.length; seatIdx++) {
      const seat = block[seatIdx];
      if (!seat.contestantId || seat.contestantId === contestantId) continue;
      
      // Check if this seat belongs to the same group
      const isGroupMember = 
        (sourceGroupId && seat.groupId === sourceGroupId) ||
        sourceAttendingWith.includes(seat.contestantId) ||
        (seat.attendingWith && seat.attendingWith.split(',').map(id => id.trim()).includes(contestantId));
      
      if (isGroupMember) {
        members.push({ blockIdx: currentBlockIdx, seatIdx, seat });
      }
    }
    
    return members;
  };

  // Calculate seat offset within a block (for relative positioning)
  const getSeatOffset = (seatIdx: number): { rowIdx: number; colIdx: number } => {
    let remaining = seatIdx;
    for (let rowIdx = 0; rowIdx < SEAT_ROWS.length; rowIdx++) {
      if (remaining < SEAT_ROWS[rowIdx].count) {
        return { rowIdx, colIdx: remaining };
      }
      remaining -= SEAT_ROWS[rowIdx].count;
    }
    return { rowIdx: 0, colIdx: 0 };
  };

  // Convert row/col offset back to seat index
  const offsetToSeatIdx = (rowIdx: number, colIdx: number): number | null => {
    if (rowIdx < 0 || rowIdx >= SEAT_ROWS.length) return null;
    if (colIdx < 0 || colIdx >= SEAT_ROWS[rowIdx].count) return null;
    
    let seatIdx = 0;
    for (let r = 0; r < rowIdx; r++) {
      seatIdx += SEAT_ROWS[r].count;
    }
    return seatIdx + colIdx;
  };

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
    
    // Check if this seat is part of a group and set activeDragGroup
    const seat = findSeat(event.active.id);
    if (seat && seat.seat.contestantId) {
      const groupMembers = findSeatedGroupMembers(seat.seat.contestantId, seat.blockIdx);
      if (groupMembers.length > 1) {
        setActiveDragGroup(groupMembers.map(m => m.seat));
      } else {
        setActiveDragGroup([]);
      }
    } else {
      setActiveDragGroup([]);
    }
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

  // Execute a group move operation
  const executeGroupMove = async (
    groupMoves: Array<{
      assignmentId: string;
      contestantName: string;
      fromBlockIdx: number;
      fromSeatIdx: number;
      toBlockIdx: number;
      toSeatIdx: number;
    }>,
    useTrackedEndpoint: boolean
  ) => {
    // Capture original state for potential revert
    const originalBlocks = blocks.map(block => block.map(seat => ({ ...seat })));
    
    // Optimistically update UI
    setBlocks(prevBlocks => {
      const newBlocks = prevBlocks.map(block => [...block]);
      
      // First, collect all source data
      const sourceData = groupMoves.map(move => ({
        ...newBlocks[move.fromBlockIdx][move.fromSeatIdx]
      }));
      
      // Clear source seats
      groupMoves.forEach(move => {
        newBlocks[move.fromBlockIdx][move.fromSeatIdx] = {
          id: newBlocks[move.fromBlockIdx][move.fromSeatIdx].id
        };
      });
      
      // Place at target seats
      groupMoves.forEach((move, idx) => {
        const targetId = newBlocks[move.toBlockIdx][move.toSeatIdx].id;
        newBlocks[move.toBlockIdx][move.toSeatIdx] = {
          ...sourceData[idx],
          id: targetId,
        };
      });
      
      return newBlocks;
    });

    try {
      // Build the API request payload
      const moves = groupMoves.map(move => {
        const targetLocation = getBlockAndSeat(blocks[move.toBlockIdx][move.toSeatIdx].id);
        return {
          assignmentId: move.assignmentId,
          blockNumber: targetLocation.blockNumber,
          seatLabel: targetLocation.seatLabel,
        };
      });

      const endpoint = useTrackedEndpoint 
        ? '/api/seat-assignments/group-move-tracked' 
        : '/api/seat-assignments/group-move';
      
      await apiRequest('POST', endpoint, { moves });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });

      toast({
        title: "Group moved successfully",
        description: `Moved ${groupMoves.length} contestants together.`,
      });
    } catch (error) {
      console.error('Failed to execute group move:', error);
      
      // Revert UI state
      setBlocks(originalBlocks);

      toast({
        title: "Error moving group",
        description: "The group could not be moved. Please try again.",
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

    const sourceSeat = findSeat(active.id as string);
    const targetSeat = findSeat(over.id as string);

    if (!sourceSeat || !targetSeat) return;

    // Don't allow swapping if source is empty
    if (!sourceSeat.seat.contestantName) return;

    const sourceLocation = getBlockAndSeat(sourceSeat.seat.id);
    const targetLocation = getBlockAndSeat(targetSeat.seat.id);

    // Check if this contestant has group members in the same block
    const groupMembers = sourceSeat.seat.contestantId 
      ? findSeatedGroupMembers(sourceSeat.seat.contestantId, sourceSeat.blockIdx)
      : [];
    
    // If there are multiple group members (more than just the dragged contestant)
    if (groupMembers.length > 1 && !targetSeat.seat.contestantName) {
      // Calculate the offset of the dragged seat's position
      const draggedOffset = getSeatOffset(sourceSeat.seatIdx);
      const targetOffset = getSeatOffset(targetSeat.seatIdx);
      
      // Calculate the delta (how much we're moving)
      const rowDelta = targetOffset.rowIdx - draggedOffset.rowIdx;
      const colDelta = targetOffset.colIdx - draggedOffset.colIdx;
      
      // Check if all group members can move to valid positions in the target block
      const groupMoves: Array<{
        assignmentId: string;
        contestantName: string;
        fromBlockIdx: number;
        fromSeatIdx: number;
        toBlockIdx: number;
        toSeatIdx: number;
      }> = [];
      
      let canMoveGroup = true;
      
      for (const member of groupMembers) {
        const memberOffset = getSeatOffset(member.seatIdx);
        const newRowIdx = memberOffset.rowIdx + rowDelta;
        const newColIdx = memberOffset.colIdx + colDelta;
        const newSeatIdx = offsetToSeatIdx(newRowIdx, newColIdx);
        
        if (newSeatIdx === null) {
          canMoveGroup = false;
          break;
        }
        
        // Check if target seat is empty or is another group member's current position
        const targetSeatInBlock = blocks[targetSeat.blockIdx][newSeatIdx];
        const isOccupiedByOther = targetSeatInBlock.contestantId && 
          !groupMembers.some(gm => gm.seat.contestantId === targetSeatInBlock.contestantId);
        
        if (isOccupiedByOther) {
          canMoveGroup = false;
          break;
        }
        
        if (member.seat.assignmentId) {
          groupMoves.push({
            assignmentId: member.seat.assignmentId,
            contestantName: member.seat.contestantName || '',
            fromBlockIdx: member.blockIdx,
            fromSeatIdx: member.seatIdx,
            toBlockIdx: targetSeat.blockIdx,
            toSeatIdx: newSeatIdx,
          });
        }
      }
      
      if (canMoveGroup && groupMoves.length > 0) {
        // Set pending group move if locked, otherwise execute immediately
        if (isLocked) {
          setPendingGroupMove({
            assignments: groupMoves.map(move => {
              const fromLoc = getBlockAndSeat(blocks[move.fromBlockIdx][move.fromSeatIdx].id);
              const toLoc = getBlockAndSeat(blocks[move.toBlockIdx][move.toSeatIdx].id);
              return {
                assignmentId: move.assignmentId,
                contestantName: move.contestantName,
                fromBlock: fromLoc.blockNumber,
                fromSeat: fromLoc.seatLabel,
                toBlock: toLoc.blockNumber,
                toSeat: toLoc.seatLabel,
              };
            }),
          });
        } else {
          await executeGroupMove(groupMoves, false);
        }
        return;
      }
      // If group can't move together, fall through to individual move
    }

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

  // Handle confirmation of group move in locked mode
  const handleConfirmLockedGroupMove = async () => {
    if (!pendingGroupMove) return;
    
    // Build groupMoves array for executeGroupMove
    const groupMoves = pendingGroupMove.assignments.map(a => {
      // Find the seats by their assignment IDs
      for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
        for (let seatIdx = 0; seatIdx < blocks[blockIdx].length; seatIdx++) {
          const seat = blocks[blockIdx][seatIdx];
          if (seat.assignmentId === a.assignmentId) {
            // Find target seat index from block and seat label
            const targetBlockIdx = a.toBlock - 1;
            const targetSeatIdx = blocks[targetBlockIdx].findIndex(s => {
              const loc = getBlockAndSeat(s.id);
              return loc.seatLabel === a.toSeat;
            });
            return {
              assignmentId: a.assignmentId,
              contestantName: a.contestantName,
              fromBlockIdx: blockIdx,
              fromSeatIdx: seatIdx,
              toBlockIdx: targetBlockIdx,
              toSeatIdx: targetSeatIdx,
            };
          }
        }
      }
      return null;
    }).filter(Boolean) as Array<{
      assignmentId: string;
      contestantName: string;
      fromBlockIdx: number;
      fromSeatIdx: number;
      toBlockIdx: number;
      toSeatIdx: number;
    }>;
    
    setPendingGroupMove(null);
    
    if (groupMoves.length > 0) {
      await executeGroupMove(groupMoves, true);
    }
  };

  // Handle cancel of locked group move
  const handleCancelLockedGroupMove = () => {
    setPendingGroupMove(null);
  };

  // Split blocks: 0-2 (top row), 3-5 (bottom row), 6 (standing)
  const topBlocks = blocks.slice(0, 3);
  const bottomBlocks = blocks.slice(3, 6);
  const standingBlock = blocks[6];

  // Bottom blocks need to be reordered: 6, 5, 4 (swap 4 and 6)
  const reorderedBottomBlocks = [bottomBlocks[2], bottomBlocks[1], bottomBlocks[0]]; // blocks 5, 4, 3 -> display as 6, 5, 4

  // Get active seat for drag overlay
  const activeSeat = activeId ? findSeat(activeId)?.seat : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
        <div className="space-y-8">
          {/* Circular Seating Area */}
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
                  isRXDayLocked={isLocked}
                  onEmptySeatClick={onEmptySeatClick}
                  onRemove={onRemove}
                  onCancel={onCancel}
                  onWinningMoneyClick={onWinningMoneyClick}
                  onRemoveWinningMoney={onRemoveWinningMoney}
                  blockType={blockTypeMap[idx + 1]}
                  onBlockTypeChange={handleBlockTypeChange}
                />
              ))}
            </div>

            {/* Center Stage Indicator with Podium */}
            <div className="relative flex items-center justify-center py-6">
              <div className="border-2 border-dashed border-primary rounded-lg px-12 py-8 text-center">
                <p className="text-lg font-semibold text-primary">STAGE</p>
                <p className="text-xs text-muted-foreground mt-1">Performance Area</p>
              </div>
              <div className="absolute right-0 border-2 border-dashed border-muted-foreground rounded-lg px-2 py-6 flex items-center justify-center">
                <p className="text-sm font-semibold text-muted-foreground tracking-widest" style={{ writingMode: 'vertical-rl' }}>PODIUM</p>
              </div>
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
                    isRXDayLocked={isLocked}
                    onEmptySeatClick={onEmptySeatClick}
                    onRemove={onRemove}
                    onCancel={onCancel}
                    onWinningMoneyClick={onWinningMoneyClick}
                    onRemoveWinningMoney={onRemoveWinningMoney}
                    blockType={blockTypeMap[originalIdx + 1]}
                    onBlockTypeChange={handleBlockTypeChange}
                  />
                );
              })}
            </div>
          </div>

          {/* Standing Block - Separate */}
          <div className="border-t pt-6">
            <div className="text-center mb-4">
              <Badge variant="outline" className="text-sm">Standing Side of Set</Badge>
            </div>
            <div className="max-w-sm mx-auto">
              <SeatingBlock
                block={standingBlock}
                blockIndex={6}
                blockLabel="Block 7 (Standing)"
                overId={overId}
                isRXDayLocked={isLocked}
                onEmptySeatClick={onEmptySeatClick}
                onRemove={onRemove}
                onCancel={onCancel}
                onWinningMoneyClick={onWinningMoneyClick}
                onRemoveWinningMoney={onRemoveWinningMoney}
                blockType={blockTypeMap[7]}
                onBlockTypeChange={handleBlockTypeChange}
              />
            </div>
          </div>
        </div>
        
        <DragOverlay>
          {activeSeat ? (
            activeDragGroup.length > 1 ? (
              <div className="opacity-90 flex flex-col gap-1 p-2 bg-blue-100 dark:bg-blue-900 rounded-lg border-2 border-blue-500 shadow-lg">
                <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1 mb-1">
                  <Link2 className="h-3 w-3" />
                  Moving Group ({activeDragGroup.length})
                </div>
                {activeDragGroup.map((seat, idx) => (
                  <div key={idx} className="transform scale-90 origin-top-left">
                    <SeatCard
                      seat={seat}
                      blockIndex={0}
                      seatIndex={idx}
                      isDragging={true}
                      onEmptySeatClick={undefined}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="opacity-80">
                <SeatCard
                  seat={activeSeat}
                  blockIndex={0}
                  seatIndex={0}
                  isDragging={true}
                  onEmptySeatClick={undefined}
                />
              </div>
            )
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

        {/* Locked Group Move Confirmation Dialog */}
        <AlertDialog open={!!pendingGroupMove} onOpenChange={(open) => !open && handleCancelLockedGroupMove()}>
          <AlertDialogContent data-testid="dialog-locked-group-move">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-blue-500" />
                Moving Group Together
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <span className="block">
                    This seating chart is currently in <strong className="text-amber-600">RX Day Mode</strong>. 
                    Group members will be moved together while maintaining their relative positions.
                  </span>
                  {pendingGroupMove && (
                    <div className="mt-3 p-3 bg-muted rounded-lg text-sm space-y-1">
                      {pendingGroupMove.assignments.map((a, idx) => (
                        <span key={idx} className="block font-medium text-foreground">
                          <span className="text-primary">{a.contestantName}</span>
                          {' '}from <strong>{String(a.fromBlock).padStart(2, '0')}-{a.fromSeat}</strong>
                          {' '}to <strong>{String(a.toBlock).padStart(2, '0')}-{a.toSeat}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="block text-muted-foreground text-xs">
                    These moves will be recorded and visible with "MOVED" indicators.
                  </span>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-locked-group-move-cancel">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                data-testid="button-locked-group-move-confirm"
                className="bg-blue-500 hover:bg-blue-600 text-white"
                onClick={handleConfirmLockedGroupMove}
              >
                Move Group
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </DndContext>
  );
}
