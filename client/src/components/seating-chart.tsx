import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SeatCard, SeatData } from "./seat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SeatingChartProps {
  recordDayId: string;
  initialSeats?: SeatData[][];
}

function SortableSeat({
  seat,
  blockIndex,
  seatIndex,
}: {
  seat: SeatData;
  blockIndex: number;
  seatIndex: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: seat.id, disabled: !seat.contestantName });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <SeatCard
        seat={seat}
        blockIndex={blockIndex}
        seatIndex={seatIndex}
        isDragging={isDragging}
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
  sensors,
  onDragEnd 
}: { 
  block: SeatData[]; 
  blockIndex: number;
  blockLabel: string;
  sensors: any;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const stats = calculateBlockStats(block);
  const allSeatIds = block.map((s) => s.id);

  // Organize seats by row
  let seatIdx = 0;
  const seatsByRow = SEAT_ROWS.map(row => {
    const rowSeats = block.slice(seatIdx, seatIdx + row.count);
    seatIdx += row.count;
    return { ...row, seats: rowSeats };
  });

  return (
    <Card data-testid={`block-${blockIndex}`} className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{blockLabel}</CardTitle>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div>{stats.total}/22 filled</div>
          <Badge variant="secondary" className="text-xs w-fit">
            {stats.femalePercent}% F
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={allSeatIds} strategy={rectSortingStrategy}>
            {seatsByRow.map((row, rowIdx) => (
              <div key={row.label} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground px-1">
                  Row {row.label}
                </div>
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${row.count}, minmax(0, 1fr))` }}>
                  {row.seats.map((seat, seatIdxInRow) => {
                    const absoluteSeatIdx = SEAT_ROWS.slice(0, rowIdx).reduce((sum, r) => sum + r.count, 0) + seatIdxInRow;
                    return (
                      <SortableSeat
                        key={seat.id}
                        seat={seat}
                        blockIndex={blockIndex}
                        seatIndex={absoluteSeatIdx}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </SortableContext>
        </DndContext>
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

  return { total, femaleCount, maleCount, femalePercent };
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

export function SeatingChart({ recordDayId, initialSeats }: SeatingChartProps) {
  const [blocks, setBlocks] = useState<SeatData[][]>(
    initialSeats || Array(7).fill(null).map((_, blockIdx) => 
      generateBlockSeats(recordDayId, blockIdx)
    )
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      console.log(`Moved seat ${active.id} to position ${over.id}`);
    }
  };

  // Split blocks: 0-2 (top row), 3-5 (bottom row), 6 (standing)
  const topBlocks = blocks.slice(0, 3);
  const bottomBlocks = blocks.slice(3, 6);
  const standingBlock = blocks[6];

  return (
    <div className="space-y-8">
      {/* Circular Seating Area */}
      <div className="space-y-6">
        <div className="text-center">
          <Badge variant="outline" className="text-sm">Circular Studio Seating</Badge>
        </div>
        
        {/* Top Row - 3 Blocks */}
        <div className="grid grid-cols-3 gap-4">
          {topBlocks.map((block, idx) => (
            <SeatingBlock
              key={idx}
              block={block}
              blockIndex={idx}
              blockLabel={`Block ${idx + 1} (Top)`}
              sensors={sensors}
              onDragEnd={handleDragEnd}
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

        {/* Bottom Row - 3 Blocks */}
        <div className="grid grid-cols-3 gap-4">
          {bottomBlocks.map((block, idx) => (
            <SeatingBlock
              key={idx + 3}
              block={block}
              blockIndex={idx + 3}
              blockLabel={`Block ${idx + 4} (Bottom)`}
              sensors={sensors}
              onDragEnd={handleDragEnd}
            />
          ))}
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
            sensors={sensors}
            onDragEnd={handleDragEnd}
          />
        </div>
      </div>
    </div>
  );
}
