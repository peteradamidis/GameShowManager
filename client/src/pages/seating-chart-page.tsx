import { SeatingChart } from "@/components/seating-chart";
import { WinningMoneyModal } from "@/components/winning-money-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, RotateCcw, Lock, Unlock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SeatData } from "@/components/seat-card";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";

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
  
  // Reset confirmation dialog state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  
  // Auto-assign block selection dialog state
  const [autoAssignDialogOpen, setAutoAssignDialogOpen] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [onlyConfirmedAvailability, setOnlyConfirmedAvailability] = useState(false);
  
  
  // RX Day Mode lock state
  const [lockConfirmDialogOpen, setLockConfirmDialogOpen] = useState(false);
  const [unlockConfirmDialogOpen, setUnlockConfirmDialogOpen] = useState(false);
  
  // Winning money modal state
  const [winningMoneyModalOpen, setWinningMoneyModalOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");
  const [winningMoneyLoading, setWinningMoneyLoading] = useState(false);
  
  // Get record day ID from query parameter or fetch first available
  const searchParams = new URLSearchParams(window.location.search);
  const urlRecordDayId = searchParams.get('day');

  // Fetch all record days
  const { data: recordDays, isLoading: recordDaysLoading } = useQuery<any[]>({
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

  // Check if record day is locked (RX Day Mode)
  const isLocked = currentRecordDay?.lockedAt != null;

  // Lock/Unlock mutations
  const lockMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', `/api/record-days/${recordDayId}/lock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      setLockConfirmDialogOpen(false);
      toast({
        title: "RX Day Mode Enabled",
        description: "Seat swaps will now be tracked for the master list.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Lock failed",
        description: error?.message || "Could not lock record day.",
        variant: "destructive",
      });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', `/api/record-days/${recordDayId}/unlock`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      setUnlockConfirmDialogOpen(false);
      toast({
        title: "RX Day Mode Disabled",
        description: "Seat tracking has been turned off.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Unlock failed",
        description: error?.message || "Could not unlock record day.",
        variant: "destructive",
      });
    },
  });

  // Show loading state if record days are still loading
  if (recordDaysLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show error if no record day and loading is complete
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
            auditionRating: assignment.auditionRating,
            playerType: assignment.playerType,
            attendingWith: assignment.attendingWith,
            originalBlockNumber: assignment.originalBlockNumber,
            originalSeatLabel: assignment.originalSeatLabel,
            swappedAt: assignment.swappedAt,
            rxNumber: assignment.rxNumber,
            caseNumber: assignment.caseNumber,
            winningMoneyRole: assignment.winningMoneyRole,
            winningMoneyAmount: assignment.winningMoneyAmount,
          };
        }
      }
    });
  }

  const handleBlockToggle = (blockNum: number) => {
    setSelectedBlocks(prev => 
      prev.includes(blockNum) 
        ? prev.filter(b => b !== blockNum)
        : [...prev, blockNum].sort((a, b) => a - b)
    );
  };

  const handleSelectAllBlocks = () => {
    if (selectedBlocks.length === 7) {
      setSelectedBlocks([]);
    } else {
      setSelectedBlocks([1, 2, 3, 4, 5, 6, 7]);
    }
  };

  const handleAutoAssign = async () => {
    if (selectedBlocks.length === 0) {
      toast({
        title: "No blocks selected",
        description: "Please select at least one block to auto-assign.",
        variant: "destructive",
      });
      return;
    }

    setIsAutoAssigning(true);
    try {
      const result: any = await apiRequest('POST', `/api/auto-assign/${recordDayId}`, {
        blocks: selectedBlocks,
        onlyConfirmedAvailability
      });
      // Invalidate contestants query to update their status to "Assigned"
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
      ]);
      await refetch();
      setAutoAssignDialogOpen(false);
      
      const demographics = result.demographics;
      const blockCount = result.blockStats?.length || 0;
      
      // Handle case where demographics might not be returned (e.g., no contestants assigned)
      if (!demographics) {
        toast({
          title: "Auto-assign completed",
          description: result.message || "Seat assignment completed.",
        });
        return;
      }
      
      const blocksText = selectedBlocks.length === 7 
        ? "all blocks" 
        : `Block${selectedBlocks.length > 1 ? 's' : ''} ${selectedBlocks.join(', ')}`;
      
      const assignedCount = demographics.femaleCount + demographics.maleCount;
      const skippedCount = result.skippedBundles?.length || 0;
      const skippedAPlusCount = result.skippedAPlusCount || 0;
      
      let description = `Assigned ${assignedCount} contestants to ${blocksText}. Gender ratio: ${demographics.femalePercentage}% female (target: ${demographics.targetRange})`;
      
      if (demographics.warning) {
        description = `⚠️ ${demographics.warning}. ${description}`;
      }
      
      if (skippedCount > 0 || skippedAPlusCount > 0) {
        const skippedParts = [];
        if (skippedAPlusCount > 0) {
          skippedParts.push(`${skippedAPlusCount} A+ contestants (manual only)`);
        }
        if (skippedCount > 0) {
          skippedParts.push(`${skippedCount} group(s) couldn't fit`);
        }
        description += ` Skipped: ${skippedParts.join(', ')}.`;
      }
      
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
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleConfirmReset = async () => {
    try {
      // Delete all seat assignments for this record day
      if (assignments && Array.isArray(assignments)) {
        await Promise.all(
          assignments.map((a: any) => 
            apiRequest('DELETE', `/api/seat-assignments/${a.id}`, {})
          )
        );
      }
      await refetch();
      setResetDialogOpen(false);
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
      
      // Invalidate ALL related queries for consistent state across tabs
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
      ]);
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
      // Invalidate ALL related queries for consistent state across tabs
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
      ]);
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

  const handleWinningMoneyClick = (assignmentId: string) => {
    setSelectedAssignmentId(assignmentId);
    setWinningMoneyModalOpen(true);
  };

  // Find current winning money data for the selected assignment
  const currentAssignment = assignments?.find((a: any) => a.id === selectedAssignmentId);
  const currentWinningMoneyData = {
    rxNumber: currentAssignment?.rxNumber || "",
    caseNumber: currentAssignment?.caseNumber || "",
    role: currentAssignment?.winningMoneyRole || "player",
    amount: currentAssignment?.winningMoneyAmount || 0,
  };

  const handleWinningMoneySave = async (role: string, amount: number, rxNumber: string, caseNumber: string) => {
    if (!selectedAssignmentId) return;
    
    setWinningMoneyLoading(true);
    try {
      await apiRequest('PATCH', `/api/seat-assignments/${selectedAssignmentId}/winning-money`, {
        rxNumber,
        caseNumber,
        winningMoneyRole: role,
        winningMoneyAmount: amount,
      });
      await refetch();
      setWinningMoneyModalOpen(false);
      setSelectedAssignmentId("");
      toast({
        title: "Winning money updated",
        description: `Amount saved: $${amount}`,
      });
    } catch (error: any) {
      toast({
        title: "Error updating winning money",
        description: error?.message || "Could not update winning money.",
        variant: "destructive",
      });
    } finally {
      setWinningMoneyLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelAssignmentId) return;
    
    try {
      await apiRequest('POST', `/api/seat-assignments/${cancelAssignmentId}/cancel`, {
        reason: cancelReason || "No reason provided",
      });
      // Invalidate ALL related queries for consistent state across tabs
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
      ]);
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
                {currentRecordDay.rxNumber && `${currentRecordDay.rxNumber} - `}
                {format(new Date(currentRecordDay.date), "MMMM d, yyyy")}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Drag and drop contestants to arrange seating blocks
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {isLocked ? (
            <Badge 
              variant="secondary" 
              className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 gap-1"
            >
              <Lock className="h-3 w-3" />
              RX Day Mode
            </Badge>
          ) : null}
          <Button 
            variant={isLocked ? "default" : "outline"} 
            onClick={() => isLocked ? setUnlockConfirmDialogOpen(true) : setLockConfirmDialogOpen(true)} 
            data-testid="button-toggle-lock"
            className={isLocked ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
          >
            {isLocked ? (
              <>
                <Unlock className="h-4 w-4 mr-2" />
                Unlock
              </>
            ) : (
              <>
                <Lock className="h-4 w-4 mr-2" />
                Lock for RX Day
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => setResetDialogOpen(true)} data-testid="button-reset-seating">
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button variant="outline" onClick={() => setAutoAssignDialogOpen(true)} data-testid="button-auto-assign">
            <Wand2 className="h-4 w-4 mr-2" />
            Auto-Assign Seats
          </Button>
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
          onWinningMoneyClick={isLocked ? handleWinningMoneyClick : undefined}
          isLocked={isLocked}
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
          
          <div className="py-4 space-y-4">
            {availableContestants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No available contestants. All contestants are already seated in this record day.
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="contestant-select">Contestant</Label>
                <Select value={selectedContestant} onValueChange={setSelectedContestant}>
                  <SelectTrigger id="contestant-select" data-testid="select-contestant">
                    <SelectValue placeholder="Select a contestant" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableContestants.map((contestant: any) => (
                      <SelectItem key={contestant.id} value={contestant.id}>
                        <span className="flex items-center gap-2">
                          <span>{contestant.name}</span>
                          <span className="text-muted-foreground text-xs">
                            ({contestant.auditionRating || "?"} / {contestant.gender === "Female" ? "F" : "M"})
                          </span>
                          {contestant.attendingWith && (
                            <span className="text-muted-foreground text-xs italic">
                              w/ {contestant.attendingWith}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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

      {/* Winning Money Modal */}
      <WinningMoneyModal 
        open={winningMoneyModalOpen}
        onOpenChange={setWinningMoneyModalOpen}
        onSubmit={handleWinningMoneySave}
        isLoading={winningMoneyLoading}
        currentRxNumber={currentWinningMoneyData.rxNumber}
        currentCaseNumber={currentWinningMoneyData.caseNumber}
        currentRole={currentWinningMoneyData.role}
        currentAmount={currentWinningMoneyData.amount}
      />

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent data-testid="dialog-reset-confirmation">
          <DialogHeader>
            <DialogTitle>Reset Seating Chart</DialogTitle>
            <DialogDescription>
              Are you sure you want to reset all seat assignments? This will remove all contestants from their seats for this record day.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setResetDialogOpen(false)}
              data-testid="button-reset-cancel"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleConfirmReset}
              data-testid="button-reset-confirm"
            >
              Yes, Reset All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto-Assign Block Selection Dialog */}
      <Dialog open={autoAssignDialogOpen} onOpenChange={setAutoAssignDialogOpen}>
        <DialogContent data-testid="dialog-auto-assign-blocks">
          <DialogHeader>
            <DialogTitle>Auto-Assign Seats</DialogTitle>
            <DialogDescription>
              Select which blocks to include in the auto-assignment. The system will assign available contestants while balancing demographics and ratings.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox 
                id="select-all-blocks"
                checked={selectedBlocks.length === 7}
                onCheckedChange={handleSelectAllBlocks}
                data-testid="checkbox-select-all-blocks"
              />
              <Label htmlFor="select-all-blocks" className="font-medium cursor-pointer">
                Select All Blocks
              </Label>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map(blockNum => (
                <div key={blockNum} className="flex items-center gap-2">
                  <Checkbox 
                    id={`block-${blockNum}`}
                    checked={selectedBlocks.includes(blockNum)}
                    onCheckedChange={() => handleBlockToggle(blockNum)}
                    data-testid={`checkbox-block-${blockNum}`}
                  />
                  <Label htmlFor={`block-${blockNum}`} className="cursor-pointer">
                    Block {blockNum}
                  </Label>
                </div>
              ))}
            </div>
            
            {selectedBlocks.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedBlocks.length === 7 
                  ? "All 7 blocks selected" 
                  : `${selectedBlocks.length} block${selectedBlocks.length > 1 ? 's' : ''} selected: ${selectedBlocks.join(', ')}`}
              </p>
            )}
            
            <div className="pt-4 border-t">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="only-confirmed-availability"
                  checked={onlyConfirmedAvailability}
                  onCheckedChange={(checked) => setOnlyConfirmedAvailability(checked === true)}
                  data-testid="checkbox-only-confirmed-availability"
                />
                <Label htmlFor="only-confirmed-availability" className="cursor-pointer">
                  Only assign contestants who confirmed availability for this record day
                </Label>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                When checked, only contestants who responded "Yes" to availability for this specific date will be considered.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setAutoAssignDialogOpen(false)}
              data-testid="button-auto-assign-cancel"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAutoAssign}
              disabled={selectedBlocks.length === 0 || isAutoAssigning}
              data-testid="button-auto-assign-confirm"
            >
              {isAutoAssigning ? "Assigning..." : `Auto-Assign to ${selectedBlocks.length === 7 ? 'All Blocks' : `${selectedBlocks.length} Block${selectedBlocks.length > 1 ? 's' : ''}`}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock Confirmation Dialog */}
      <Dialog open={lockConfirmDialogOpen} onOpenChange={setLockConfirmDialogOpen}>
        <DialogContent data-testid="dialog-lock-confirmation">
          <DialogHeader>
            <DialogTitle>Enable RX Day Mode</DialogTitle>
            <DialogDescription>
              This locks the seating chart for recording day. Any seat swaps made after locking will be tracked and highlighted, allowing the master list to show both original and current seat positions.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setLockConfirmDialogOpen(false)}
              data-testid="button-lock-cancel"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => lockMutation.mutate()}
              disabled={lockMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="button-lock-confirm"
            >
              {lockMutation.isPending ? "Locking..." : "Enable RX Day Mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Confirmation Dialog */}
      <Dialog open={unlockConfirmDialogOpen} onOpenChange={setUnlockConfirmDialogOpen}>
        <DialogContent data-testid="dialog-unlock-confirmation">
          <DialogHeader>
            <DialogTitle>Disable RX Day Mode</DialogTitle>
            <DialogDescription>
              This will disable swap tracking. Existing swap history will be preserved, but new swaps will no longer be tracked until you re-enable RX Day Mode.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setUnlockConfirmDialogOpen(false)}
              data-testid="button-unlock-cancel"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => unlockMutation.mutate()}
              disabled={unlockMutation.isPending}
              data-testid="button-unlock-confirm"
            >
              {unlockMutation.isPending ? "Unlocking..." : "Disable RX Day Mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
