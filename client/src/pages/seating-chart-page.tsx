import { SeatingChart } from "@/components/seating-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SeatData } from "@/components/seat-card";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Generate seats with the proper row structure
const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

function generateEmptyBlocks(): SeatData[][] {
  return Array(7).fill(null).map((_, blockIdx) => {
    const seats: SeatData[] = [];
    SEAT_ROWS.forEach(row => {
      for (let i = 1; i <= row.count; i++) {
        seats.push({
          id: `block${blockIdx}-${row.label}${i}`,
        });
      }
    });
    return seats;
  });
}

export default function SeatingChartPage() {
  const { toast } = useToast();
  
  // Get record day ID from query parameter
  const searchParams = new URLSearchParams(window.location.search);
  const recordDayId = searchParams.get('day') || 'default';

  // Fetch seat assignments for this record day
  const { data: assignments, isLoading, refetch } = useQuery({
    queryKey: ['/api/seat-assignments', recordDayId],
    queryFn: async () => {
      const response = await fetch(`/api/seat-assignments/${recordDayId}`);
      if (!response.ok) {
        if (response.status === 404) {
          return []; // No assignments yet
        }
        throw new Error('Failed to fetch seat assignments');
      }
      return response.json();
    },
  });

  // Build seat data from assignments
  const seats: SeatData[][] = generateEmptyBlocks();
  
  if (assignments && Array.isArray(assignments)) {
    assignments.forEach((assignment: any) => {
      const blockIdx = assignment.blockNumber - 1;
      if (blockIdx >= 0 && blockIdx < 7 && seats[blockIdx]) {
        const seatIdx = seats[blockIdx].findIndex(seat => 
          seat.id.endsWith(`-${assignment.seatLabel}`)
        );
        if (seatIdx !== -1) {
          seats[blockIdx][seatIdx] = {
            ...seats[blockIdx][seatIdx],
            contestantName: assignment.contestantName,
            age: assignment.age,
            gender: assignment.gender,
            groupId: assignment.groupId,
            assignmentId: assignment.assignmentId,
            contestantId: assignment.contestantId,
          };
        }
      }
    });
  }

  const handleAutoAssign = async () => {
    try {
      await apiRequest('POST', `/api/auto-assign/${recordDayId}`, {});
      await refetch();
      toast({
        title: "Auto-assign completed",
        description: "Contestants have been intelligently assigned to seats.",
      });
    } catch (error) {
      toast({
        title: "Auto-assign failed",
        description: "Could not assign contestants to seats.",
        variant: "destructive",
      });
    }
  };

  const handleReset = async () => {
    try {
      // Delete all seat assignments for this record day
      if (assignments && Array.isArray(assignments)) {
        await Promise.all(
          assignments.map((a: any) => 
            apiRequest('DELETE', `/api/seat-assignments/${a.assignmentId}`, {})
          )
        );
      }
      await refetch();
      toast({
        title: "Seating reset",
        description: "All seat assignments have been cleared.",
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: "Could not clear seat assignments.",
        variant: "destructive",
      });
    }
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
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg p-4">
        <div className="flex items-center gap-6 text-sm flex-wrap">
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
          <div className="ml-auto text-muted-foreground">
            Rows: A-E (5-5-4-4-4 seats)
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading seating chart...
        </div>
      ) : (
        <SeatingChart 
          recordDayId={recordDayId} 
          initialSeats={seats}
          onRefreshNeeded={refetch}
        />
      )}
    </div>
  );
}
