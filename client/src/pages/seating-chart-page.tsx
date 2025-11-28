import { SeatingChart } from "@/components/seating-chart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SeatData } from "@/components/seat-card";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useMemo } from "react";
import { format } from "date-fns";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Generate seats with the proper row structure
const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

function generateEmptyBlocks(recordDayId: string): SeatData[][] {
  return Array(7).fill(null).map((_, blockIdx) => {
    const seats: SeatData[] = [];
    SEAT_ROWS.forEach(row => {
      for (let i = 1; i <= row.count; i++) {
        seats.push({
          id: `${recordDayId}-block${blockIdx}-${row.label}${i}`,
        });
      }
    });
    return seats;
  });
}

export default function SeatingChartPage() {
  const { toast } = useToast();
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<number>(0);
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [selectedContestant, setSelectedContestant] = useState<string>("");
  
  // Cancel dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelAssignmentId, setCancelAssignmentId] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");
  
  // Get record day ID from query parameter or fetch first available
  const searchParams = new URLSearchParams(window.location.search);
  const urlRecordDayId = searchParams.get('day');

  // Fetch all record days
  const { data: recordDays } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  // Use URL ID or first available record day
  const recordDayId = urlRecordDayId || recordDays?.[0]?.id || null;

  // Find the current record day from the list
  const currentRecordDay = useMemo(() => {
    if (!recordDays || !recordDayId) return null;
    return recordDays.find((rd: any) => rd.id === recordDayId);
  }, [recordDays, recordDayId]);

  // Fetch seat assignments for this record day
  const { data: assignments, isLoading, refetch } = useQuery({
    queryKey: ['/api/seat-assignments', recordDayId],
    queryFn: async () => {
      if (!recordDayId) return [];
      const response = await fetch(`/api/seat-assignments/${recordDayId}`);
      if (!response.ok) {
        if (response.status === 404) {
          return []; // No assignments yet
        }
        throw new Error('Failed to fetch seat assignments');
      }
      return response.json();
    },
    enabled: !!recordDayId, // Only fetch when we have a valid record day ID
  });

  // Fetch all contestants
  const { data: allContestants = [] } = useQuery({
    queryKey: ['/api/contestants'],
  });

  // Derive available contestants from assignments and all contestants
  // This eliminates staleness issues since it's computed from latest data
  const availableContestants = useMemo(() => {
    if (!assignments || !allContestants || !Array.isArray(allContestants)) return [];
    const seatedIds = new Set(assignments.map((a: any) => a.contestantId));
    return allContestants.filter((c: any) => !seatedIds.has(c.id));
  }, [assignments, allContestants]);

  // Show loading or error if no record day
  if (!recordDayId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">No record days available. Please create a record day first.</p>
        </div>
      </div>
    );
  }

  // Build seat data from assignments
  const seats: SeatData[][] = generateEmptyBlocks(recordDayId);
  
  if (assignments && Array.isArray(assignments)) {
    assignments.forEach((assignment: any) => {
      const blockIdx = assignment.blockNumber - 1;
      if (blockIdx >= 0 && blockIdx < 7 && seats[blockIdx]) {
        // Match exact seat ID: recordDayId-blockX-seatLabel
        const expectedId = `${recordDayId}-block${blockIdx}-${assignment.seatLabel}`;
        const seatIdx = seats[blockIdx].findIndex(seat => seat.id === expectedId);
        
        if (seatIdx !== -1) {
          seats[blockIdx][seatIdx] = {
            ...seats[blockIdx][seatIdx],
            contestantName: assignment.contestantName,
            age: assignment.age,
            gender: assignment.gender,
            groupId: assignment.groupId,
            assignmentId: assignment.id,
            contestantId: assignment.contestantId,
          };
        }
      }
    });
  }

  const handleAutoAssign = async () => {
    try {
      const result: any = await apiRequest('POST', `/api/auto-assign/${recordDayId}`, {});
      await refetch();
      
      const demographics = result.demographics;
      const blockCount = result.blockStats?.length || 0;
      
      const description = demographics.warning 
        ? `⚠️ ${demographics.warning}. Assigned ${demographics.femaleCount + demographics.maleCount} contestants (${demographics.femalePercentage}% female).`
        : `Assigned ${demographics.femaleCount + demographics.maleCount} contestants across ${blockCount} blocks. Gender ratio: ${demographics.femalePercentage}% female (target: ${demographics.targetRange})`;
      
      toast({
        title: demographics.meetsTarget ? "Auto-assign completed" : "Auto-assign completed with warning",
        description,
        variant: demographics.meetsTarget ? "default" : "default",
      });
    } catch (error: any) {
      const errorMsg = error?.message || "Could not assign contestants to seats.";
      toast({
        title: "Auto-assign failed",
        description: errorMsg,
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

  const handleEmptySeatClick = (blockNumber: number, seatLabel: string) => {
    setSelectedBlock(blockNumber);
    setSelectedSeat(seatLabel);
    setSelectedContestant("");
    setAssignDialogOpen(true);
  };

  const handleAssignContestant = async () => {
    if (!selectedContestant || !selectedBlock || !selectedSeat) return;

    try {
      await apiRequest('POST', '/api/seat-assignments', {
        recordDayId,
        contestantId: selectedContestant,
        blockNumber: selectedBlock,
        seatLabel: selectedSeat,
      });
      
      // Invalidate all seat assignment queries to update both Seating Chart and Booking Master
      await queryClient.invalidateQueries({ 
        queryKey: ['/api/seat-assignments']
      });
      await refetch();
      
      toast({
        title: "Contestant assigned",
        description: `Assigned to Block ${selectedBlock}, Seat ${selectedSeat}`,
      });

      setAssignDialogOpen(false);
      setSelectedContestant("");
    } catch (error: any) {
      // Refresh to get latest seat assignments
      await refetch();
      
      const errorMessage = error?.message || "Could not assign contestant to seat.";
      toast({
        title: "Assignment failed",
        description: errorMessage,
        variant: "destructive",
      });
      // Keep dialog open so user can try a different contestant/seat
    }
  };

  const handleRemove = async (assignmentId: string) => {
    try {
      await apiRequest('DELETE', `/api/seat-assignments/${assignmentId}`, {});
      // Invalidate all seat assignment queries to update both Seating Chart and Booking Master
      await queryClient.invalidateQueries({ 
        queryKey: ['/api/seat-assignments']
      });
      await refetch();
      toast({
        title: "Contestant removed",
        description: "Contestant has been removed from this record day.",
      });
    } catch (error: any) {
      toast({
        title: "Remove failed",
        description: error?.message || "Could not remove contestant.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = (assignmentId: string) => {
    setCancelAssignmentId(assignmentId);
    setCancelReason("");
    setCancelDialogOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancelAssignmentId) return;
    
    try {
      await apiRequest('POST', `/api/seat-assignments/${cancelAssignmentId}/cancel`, {
        reason: cancelReason || "No reason provided",
      });
      // Invalidate all seat assignment queries to update both Seating Chart and Booking Master
      await queryClient.invalidateQueries({ 
        queryKey: ['/api/seat-assignments']
      });
      await refetch();
      setCancelDialogOpen(false);
      setCancelAssignmentId("");
      setCancelReason("");
      toast({
        title: "Contestant canceled",
        description: "Contestant has been moved to the reschedule list.",
      });
    } catch (error: any) {
      toast({
        title: "Cancel failed",
        description: error?.message || "Could not cancel contestant.",
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
            {currentRecordDay && (
              <Badge variant="secondary">
                {format(new Date(currentRecordDay.date), "MMMM d, yyyy")}
                {currentRecordDay.showCode && ` - ${currentRecordDay.showCode}`}
              </Badge>
            )}
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
          onEmptySeatClick={handleEmptySeatClick}
          onRemove={handleRemove}
          onCancel={handleCancel}
        />
      )}

      {/* Assign Contestant to Empty Seat Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent data-testid="dialog-assign-contestant-to-seat">
          <DialogHeader>
            <DialogTitle>Assign Contestant to Seat</DialogTitle>
            <DialogDescription>
              Select a contestant to assign to Block {selectedBlock}, Seat {selectedSeat}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {availableContestants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No available contestants. All contestants are already seated in this record day.
              </p>
            ) : (
              <Select value={selectedContestant} onValueChange={setSelectedContestant}>
                <SelectTrigger data-testid="select-contestant">
                  <SelectValue placeholder="Select a contestant" />
                </SelectTrigger>
                <SelectContent>
                  {availableContestants.map((contestant: any) => (
                    <SelectItem key={contestant.id} value={contestant.id}>
                      {contestant.name} ({contestant.age}, {contestant.gender})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAssignContestant} 
              disabled={!selectedContestant || availableContestants.length === 0}
              data-testid="button-confirm-seat-assign"
            >
              Assign to Seat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Reason Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent data-testid="dialog-cancel-reason">
          <DialogHeader>
            <DialogTitle>Cancel Contestant</DialogTitle>
            <DialogDescription>
              This contestant will be moved to the reschedule list.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-2">
            <Label htmlFor="cancel-reason">Reason for cancellation</Label>
            <Textarea
              id="cancel-reason"
              placeholder="Enter reason for cancellation..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="min-h-[100px]"
              data-testid="textarea-cancel-reason"
            />
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setCancelDialogOpen(false);
                setCancelAssignmentId("");
                setCancelReason("");
              }}
              data-testid="button-cancel-dialog-close"
            >
              Go Back
            </Button>
            <Button 
              variant="destructive"
              onClick={handleConfirmCancel}
              data-testid="button-confirm-cancel"
            >
              Confirm Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
