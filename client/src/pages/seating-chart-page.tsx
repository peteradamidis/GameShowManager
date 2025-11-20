import { SeatingChart } from "@/components/seating-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SeatData } from "@/components/seat-card";

export default function SeatingChartPage() {
  const { toast } = useToast();

  const mockSeats: SeatData[][] = Array(7).fill(null).map((_, blockIdx) =>
    Array(20).fill(null).map((_, seatIdx) => {
      const shouldFill = Math.random() > 0.3;
      return {
        id: `block${blockIdx}-seat${seatIdx}`,
        ...(shouldFill && {
          contestantName: `Person ${blockIdx * 20 + seatIdx + 1}`,
          age: Math.floor(Math.random() * 40) + 20,
          gender: Math.random() > 0.4 ? ("Female" as const) : ("Male" as const),
          groupId: Math.random() > 0.6 ? `GRP${Math.floor(Math.random() * 5) + 1}` : undefined,
        }),
      };
    })
  );

  const handleAutoAssign = () => {
    toast({
      title: "Auto-assign started",
      description: "Intelligently assigning contestants to seats with demographic balancing...",
    });
  };

  const handleReset = () => {
    toast({
      title: "Seating reset",
      description: "All seat assignments have been cleared.",
    });
  };

  const handleSave = () => {
    toast({
      title: "Changes saved",
      description: "Seating chart has been updated successfully.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Seating Chart</h1>
            <Badge variant="secondary">December 15, 2025</Badge>
          </div>
          <p className="text-muted-foreground">
            Drag and drop contestants to arrange seating blocks
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset} data-testid="button-reset-seating">
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button variant="outline" onClick={handleAutoAssign} data-testid="button-auto-assign">
            <Wand2 className="h-4 w-4 mr-2" />
            Auto-Assign Seats
          </Button>
          <Button onClick={handleSave} data-testid="button-save-seating">
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg p-4">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-2 border-blue-500"></div>
            <span>Group 1</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-2 border-green-500"></div>
            <span>Group 2</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-2 border-purple-500"></div>
            <span>Group 3</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-dashed"></div>
            <span>Empty Seat</span>
          </div>
        </div>
      </div>

      <SeatingChart recordDayId="dec-15-2025" initialSeats={mockSeats} />
    </div>
  );
}
