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
  arrayMove,
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

  const calculateBlockStats = (block: SeatData[]) => {
    const filled = block.filter((s) => s.contestantName);
    const femaleCount = filled.filter((s) => s.gender === "Female").length;
    const maleCount = filled.filter((s) => s.gender === "Male").length;
    const total = filled.length;
    const femalePercent = total > 0 ? Math.round((femaleCount / total) * 100) : 0;

    return { total, femaleCount, maleCount, femalePercent };
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-2">
        {blocks.map((block, blockIdx) => {
          const stats = calculateBlockStats(block);
          const allSeatIds = block.map((s) => s.id);

          return (
            <Card key={blockIdx} data-testid={`block-${blockIdx}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Block {blockIdx + 1}</CardTitle>
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <div>{stats.total}/20 filled</div>
                  <Badge variant="secondary" className="text-xs">
                    {stats.femalePercent}% F
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={allSeatIds} strategy={verticalListSortingStrategy}>
                    {block.map((seat, seatIdx) => (
                      <SortableSeat
                        key={seat.id}
                        seat={seat}
                        blockIndex={blockIdx}
                        seatIndex={seatIdx}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
