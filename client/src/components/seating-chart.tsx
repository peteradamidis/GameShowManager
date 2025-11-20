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
  verticalListSortingStrategy,
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

  return (
    <Card data-testid={`block-${blockIndex}`} className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{blockLabel}</CardTitle>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div>{stats.total}/20 filled</div>
          <Badge variant="secondary" className="text-xs w-fit">
            {stats.femalePercent}% F
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={allSeatIds} strategy={verticalListSortingStrategy}>
            {block.map((seat, seatIdx) => (
              <SortableSeat
                key={seat.id}
                seat={seat}
                blockIndex={blockIndex}
                seatIndex={seatIdx}
              />
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

export function SeatingChart({ recordDayId, initialSeats }: SeatingChartProps) {
  const [blocks, setBlocks] = useState<SeatData[][]>(
    initialSeats || Array(7).fill(null).map((_, blockIdx) =>
      Array(20).fill(null).map((_, seatIdx) => ({
        id: `${recordDayId}-block${blockIdx}-seat${seatIdx}`,
      }))
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
