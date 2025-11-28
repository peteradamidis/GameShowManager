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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { BlockType } from "@shared/schema";

interface SeatingChartProps {
  recordDayId: string;
  initialSeats?: SeatData[][];
  onRefreshNeeded?: () => void; // Callback to trigger data refetch from parent
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
}

function DraggableDroppableSeat({
  seat,
  blockIndex,
  seatIndex,
  isOver,
  onEmptySeatClick,
  onRemove,
  onCancel,
}: {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
  isOver: boolean;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
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
        onEmptySeatClick={onEmptySeatClick}
        onRemove={onRemove}
        onCancel={onCancel}
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
  onEmptySeatClick,
  onRemove,
  onCancel,
  blockType,
  onBlockTypeChange,
}: { 
  block: SeatData[]; 
  blockIndex: number;
  blockLabel: string;
  reverseRows?: boolean;
  overId: string | null;
  onEmptySeatClick?: (blockNumber: number, seatLabel: string) => void;
  onRemove?: (assignmentId: string) => void;
  onCancel?: (assignmentId: string) => void;
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
          <div className="flex items-center justify-between">
            <span>{stats.total}/22 filled</span>
            <Badge variant="secondary" className="text-xs">
              {stats.femalePercent}% F
            </Badge>
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
                <div className="text-[10px] text-muted-foreground">
                  Age: {stats.minAge}-{stats.maxAge} (avg {stats.avgAge})
                </div>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {displayRows.map((row, displayIdx) => {
          // Find the original row index in SEAT_ROWS
          const originalRowIdx = SEAT_ROWS.findIndex(r => r.label === row.label);
          
          return (
            <div key={row.label} className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground px-1">
                Row {row.label}
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${row.count}, minmax(0, 1fr))` }}>
                {row.seats.map((seat, seatIdxInRow) => {
                  const absoluteSeatIdx = SEAT_ROWS.slice(0, originalRowIdx).reduce((sum, r) => sum + r.count, 0) + seatIdxInRow;
                  return (
                    <DraggableDroppableSeat
                      key={seat.id}
                      seat={seat}
                      blockIndex={blockIndex}
                      seatIndex={absoluteSeatIdx}
                      isOver={overId === seat.id}
                      onEmptySeatClick={onEmptySeatClick}
                      onRemove={onRemove}
                      onCancel={onCancel}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
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

export function SeatingChart({ recordDayId, initialSeats, onRefreshNeeded, onEmptySeatClick, onRemove, onCancel }: SeatingChartProps) {
  const [blocks, setBlocks] = useState<SeatData[][]>(
    initialSeats || Array(7).fill(null).map((_, blockIdx) => 
      generateBlockSeats(recordDayId, blockIdx)
    )
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
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

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over?.id as string | null);
  };

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

    // Extract block number and seat label from seat IDs
    const getBlockAndSeat = (seatId: string) => {
      // ID format: "recordDayId-blockX-seatLabel"
      const parts = seatId.split('-');
      const blockPart = parts[parts.length - 2]; // e.g., "block0"
      const seatLabel = parts[parts.length - 1]; // e.g., "A1"
      const blockNumber = parseInt(blockPart.replace('block', '')) + 1; // Convert to 1-indexed
      return { blockNumber, seatLabel };
    };

    const sourceLocation = getBlockAndSeat(sourceSeat.seat.id);
    const targetLocation = getBlockAndSeat(targetSeat.seat.id);

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
      };
      
      newBlocks[targetSeat.blockIdx][targetSeat.seatIdx] = {
        id: targetSeat.seat.id,
        contestantName: sourceData.contestantName,
        age: sourceData.age,
        gender: sourceData.gender,
        groupId: sourceData.groupId,
        assignmentId: sourceData.assignmentId,
        contestantId: sourceData.contestantId,
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

      // Use atomic swap endpoint
      if (targetSeat.seat.assignmentId) {
        // Swapping two assigned seats
        await apiRequest(
          'POST',
          '/api/seat-assignments/swap',
          {
            sourceAssignmentId: sourceSeat.seat.assignmentId,
            targetAssignmentId: targetSeat.seat.assignmentId,
          }
        );
      } else {
        // Moving to empty seat
        await apiRequest(
          'POST',
          '/api/seat-assignments/swap',
          {
            sourceAssignmentId: sourceSeat.seat.assignmentId,
            blockNumber: targetLocation.blockNumber,
            seatLabel: targetLocation.seatLabel,
          }
        );
      }

      // Invalidate all seat assignment queries to update both Seating Chart and Booking Master
      await queryClient.invalidateQueries({ 
        queryKey: ['/api/seat-assignments']
      });
      
      // Also call onRefreshNeeded if provided for backwards compatibility
      if (onRefreshNeeded) {
        await onRefreshNeeded();
      }

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
                  onEmptySeatClick={onEmptySeatClick}
                  onRemove={onRemove}
                  onCancel={onCancel}
                  blockType={blockTypeMap[idx + 1]}
                  onBlockTypeChange={handleBlockTypeChange}
                />
              ))}
            </div>

            {/* Center Stage Indicator */}
            <div className="flex items-center justify-center py-6">
              <div className="border-2 border-dashed border-primary rounded-lg px-12 py-8 text-center">
                <p className="text-lg font-semibold text-primary">STAGE</p>
                <p className="text-xs text-muted-foreground mt-1">Performance Area</p>
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
                    onEmptySeatClick={onEmptySeatClick}
                    onRemove={onRemove}
                    onCancel={onCancel}
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
                onEmptySeatClick={onEmptySeatClick}
                onRemove={onRemove}
                onCancel={onCancel}
                blockType={blockTypeMap[7]}
                onBlockTypeChange={handleBlockTypeChange}
              />
            </div>
          </div>
        </div>
        
        <DragOverlay>
          {activeSeat ? (
            <div className="opacity-80">
              <SeatCard
                seat={activeSeat}
                blockIndex={0}
                seatIndex={0}
                isDragging={true}
                onEmptySeatClick={undefined}
              />
            </div>
          ) : null}
        </DragOverlay>
    </DndContext>
  );
}
