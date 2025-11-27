import { ContestantTable, Contestant } from "@/components/contestant-table";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, UserPlus, TestTube, Filter, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
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

const BLOCKS = [1, 2, 3, 4, 5, 6, 7];
const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

type ContestantWithAvailability = {
  id: string;
  contestantId: string;
  recordDayId: string;
  responseValue: string;
  respondedAt: string | null;
  notes: string | null;
  contestant: Contestant;
};

export default function Contestants() {
  const { toast } = useToast();
  const [selectedContestants, setSelectedContestants] = useState<string[]>([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("");
  const [selectedBlock, setSelectedBlock] = useState<string>("");
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [filterRecordDayId, setFilterRecordDayId] = useState<string>("all");
  const [filterResponseValue, setFilterResponseValue] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGender, setFilterGender] = useState<string>("all");
  const [filterRating, setFilterRating] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");

  // Fetch all contestants
  const { data: contestants = [], isLoading: loadingContestants, refetch: refetchContestants } = useQuery<Contestant[]>({
    queryKey: ['/api/contestants'],
  });

  // Fetch filtered contestants by availability
  const { data: filteredAvailability = [], isLoading: loadingFiltered } = useQuery<ContestantWithAvailability[]>({
    queryKey: ['/api/availability/record-day', filterRecordDayId],
    enabled: !!filterRecordDayId,
  });

  // Fetch record days
  const { data: recordDays = [], refetch: refetchRecordDays } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  // Fetch all seat assignments for rating/location filtering
  const { data: allSeatAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments'],
  });

  // Get unique values for filter dropdowns
  const uniqueGenders = Array.from(new Set(contestants.map(c => c.gender).filter(Boolean)));
  const uniqueRatings = Array.from(new Set(allSeatAssignments.map((a: any) => a.rating).filter(Boolean)));
  const uniqueLocations = Array.from(new Set(allSeatAssignments.map((a: any) => a.location).filter(Boolean)));

  // Determine which contestants to display
  let displayedContestants = filterRecordDayId && filterRecordDayId !== "all"
    ? filteredAvailability
        .filter(item => !filterResponseValue || filterResponseValue === "all" || item.responseValue === filterResponseValue)
        .map(item => item.contestant)
    : contestants;

  // Apply additional filters
  if (filterStatus !== "all") {
    displayedContestants = displayedContestants.filter(c => c.availabilityStatus === filterStatus);
  }
  if (filterGender !== "all") {
    displayedContestants = displayedContestants.filter(c => c.gender === filterGender);
  }
  if (filterRating !== "all") {
    // Filter contestants who have a seat assignment with this rating
    const contestantIdsWithRating = new Set(
      allSeatAssignments
        .filter((a: any) => a.rating === filterRating)
        .map((a: any) => a.contestantId)
    );
    displayedContestants = displayedContestants.filter(c => contestantIdsWithRating.has(c.id));
  }
  if (filterLocation !== "all") {
    // Filter contestants who have a seat assignment with this location
    const contestantIdsWithLocation = new Set(
      allSeatAssignments
        .filter((a: any) => a.location === filterLocation)
        .map((a: any) => a.contestantId)
    );
    displayedContestants = displayedContestants.filter(c => contestantIdsWithLocation.has(c.id));
  }

  const isLoading = loadingContestants || (filterRecordDayId && loadingFiltered);

  const generateFakeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/contestants/generate-fake', {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Fake contestants generated",
        description: `Created ${data.count} contestants with ${data.groups} groups for testing.`,
      });
    },
    onError: () => {
      toast({
        title: "Generation failed",
        description: "Could not generate fake contestants.",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }
      
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/groups'] });
      toast({
        title: "Import successful",
        description: `Imported ${data.contestantsCreated} contestants${data.groupsCreated > 0 ? ` and ${data.groupsCreated} groups` : ''}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message || "Could not import the Excel file. Please check the file format.",
        variant: "destructive",
      });
    },
  });

  const handleSendAvailabilityForms = () => {
    toast({
      title: "Availability forms sent",
      description: "Forms have been sent to all pending contestants.",
    });
  };

  // Fetch occupied seats for the selected record day
  const { data: occupiedSeats = [] } = useQuery({
    queryKey: ['/api/seat-assignments', selectedRecordDay],
    enabled: !!selectedRecordDay,
    queryFn: async () => {
      const response = await fetch(`/api/seat-assignments/${selectedRecordDay}`);
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error('Failed to fetch seat assignments');
      }
      return response.json();
    },
  });

  // Generate available seats for selected block
  const availableSeats = selectedBlock ? (() => {
    const blockNum = parseInt(selectedBlock);
    const occupied = new Set(
      occupiedSeats
        .filter((a: any) => a.blockNumber === blockNum)
        .map((a: any) => a.seatLabel)
    );
    
    const allSeats: string[] = [];
    SEAT_ROWS.forEach(row => {
      for (let i = 1; i <= row.count; i++) {
        const seatLabel = `${row.label}${i}`;
        if (!occupied.has(seatLabel)) {
          allSeats.push(seatLabel);
        }
      }
    });
    return allSeats;
  })() : [];

  const handleOpenAssignDialog = () => {
    refetchRecordDays(); // Refresh record days when opening dialog
    setAssignDialogOpen(true);
  };

  const handleAssignToSeat = async () => {
    if (!selectedRecordDay || !selectedBlock || !selectedSeat || selectedContestants.length === 0) return;

    try {
      // For single contestant, assign to specific seat
      if (selectedContestants.length === 1) {
        await apiRequest('POST', '/api/seat-assignments', {
          recordDayId: selectedRecordDay,
          contestantId: selectedContestants[0],
          blockNumber: parseInt(selectedBlock),
          seatLabel: selectedSeat,
        });
        
        toast({
          title: "Contestant assigned",
          description: `Assigned to Block ${selectedBlock}, Seat ${selectedSeat}`,
        });
      } else {
        // For multiple contestants, mark as assigned to record day (will auto-assign later)
        await apiRequest('POST', `/api/record-days/${selectedRecordDay}/contestants`, {
          contestantIds: selectedContestants,
        });
        
        toast({
          title: "Contestants assigned to record day",
          description: `${selectedContestants.length} contestants assigned. Use Auto-Assign to seat them.`,
        });
      }

      await refetchContestants();
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', selectedRecordDay] });
      
      setAssignDialogOpen(false);
      setSelectedContestants([]);
      setSelectedRecordDay("");
      setSelectedBlock("");
      setSelectedSeat("");
    } catch (error) {
      toast({
        title: "Assignment failed",
        description: "Could not assign contestant(s).",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contestants</h1>
          <p className="text-muted-foreground">
            Manage auditioned applicants and their availability
          </p>
        </div>
        <div className="flex gap-2">
          {selectedContestants.length > 0 && (
            <Button 
              onClick={handleOpenAssignDialog} 
              data-testid="button-assign-contestants"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign {selectedContestants.length} to Record Day
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={() => generateFakeMutation.mutate()}
            disabled={generateFakeMutation.isPending}
            data-testid="button-generate-fake"
          >
            <TestTube className="h-4 w-4 mr-2" />
            {generateFakeMutation.isPending ? "Generating..." : "Generate Test Data"}
          </Button>
          <Button variant="outline" onClick={handleSendAvailabilityForms} data-testid="button-send-availability">
            <Mail className="h-4 w-4 mr-2" />
            Send Availability Forms
          </Button>
          <ImportExcelDialog onImport={(file) => importMutation.mutate(file)} />
        </div>
      </div>

      {/* Filter Controls */}
      <div className="space-y-4">
        <div className="flex gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium mb-2 block">
              <Filter className="w-3 h-3 inline mr-1" />
              Status
            </label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-testid="select-filter-status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium mb-2 block">Gender</label>
            <Select value={filterGender} onValueChange={setFilterGender}>
              <SelectTrigger data-testid="select-filter-gender">
                <SelectValue placeholder="All genders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                {uniqueGenders.map((gender) => (
                  <SelectItem key={gender} value={gender}>
                    {gender}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium mb-2 block">Rating</label>
            <Select 
              value={filterRating} 
              onValueChange={setFilterRating}
              disabled={uniqueRatings.length === 0}
            >
              <SelectTrigger data-testid="select-filter-rating">
                <SelectValue placeholder={uniqueRatings.length === 0 ? "No ratings available" : "All ratings"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                {uniqueRatings.map((rating) => (
                  <SelectItem key={rating} value={rating}>
                    {rating}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {uniqueRatings.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Ratings are assigned in Booking Master
              </p>
            )}
          </div>

          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium mb-2 block">Location</label>
            <Select 
              value={filterLocation} 
              onValueChange={setFilterLocation}
              disabled={uniqueLocations.length === 0}
            >
              <SelectTrigger data-testid="select-filter-location">
                <SelectValue placeholder={uniqueLocations.length === 0 ? "No locations available" : "All locations"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {uniqueLocations.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {uniqueLocations.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Locations are assigned in Booking Master
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium mb-2 block">Record Day</label>
            <Select value={filterRecordDayId} onValueChange={(value) => {
              setFilterRecordDayId(value);
              setFilterResponseValue("all");
            }}>
              <SelectTrigger data-testid="select-filter-record-day">
                <SelectValue placeholder="All record days" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All record days</SelectItem>
                {recordDays.map((day: any) => (
                  <SelectItem key={day.id} value={day.id}>
                    {new Date(day.date).toLocaleDateString('en-US', { 
                      weekday: 'short', 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filterRecordDayId && filterRecordDayId !== "all" && (
            <div className="flex-1 min-w-[200px] max-w-xs">
              <label className="text-sm font-medium mb-2 block">Availability Response</label>
              <Select value={filterResponseValue} onValueChange={setFilterResponseValue}>
                <SelectTrigger data-testid="select-filter-response">
                  <SelectValue placeholder="All responses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All responses</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="maybe">Maybe</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {(filterStatus !== "all" || filterGender !== "all" || filterRating !== "all" || 
            filterLocation !== "all" || filterRecordDayId !== "all") && (
            <Button 
              variant="outline" 
              onClick={() => {
                setFilterStatus("all");
                setFilterGender("all");
                setFilterRating("all");
                setFilterLocation("all");
                setFilterRecordDayId("all");
                setFilterResponseValue("all");
              }}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-2" />
              Clear All Filters
            </Button>
          )}
        </div>
      </div>

      {/* Results Summary */}
      {(filterStatus !== "all" || filterGender !== "all" || filterRating !== "all" || 
        filterLocation !== "all" || filterRecordDayId !== "all") && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" data-testid="badge-filter-count">
            {displayedContestants.length} contestant{displayedContestants.length !== 1 ? 's' : ''}
          </Badge>
          <span className="text-sm text-muted-foreground">matching:</span>
          {filterStatus !== "all" && (
            <Badge variant="outline">Status: {filterStatus}</Badge>
          )}
          {filterGender !== "all" && (
            <Badge variant="outline">Gender: {filterGender}</Badge>
          )}
          {filterRating !== "all" && (
            <Badge variant="outline">Rating: {filterRating}</Badge>
          )}
          {filterLocation !== "all" && (
            <Badge variant="outline">Location: {filterLocation}</Badge>
          )}
          {filterRecordDayId !== "all" && (
            <Badge variant="outline">
              Record Day: {new Date(recordDays.find((d: any) => d.id === filterRecordDayId)?.date).toLocaleDateString()}
            </Badge>
          )}
          {filterRecordDayId !== "all" && filterResponseValue !== "all" && (
            <Badge variant="outline">Response: {filterResponseValue}</Badge>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading contestants...
        </div>
      ) : (
        <ContestantTable 
          contestants={displayedContestants}
          selectedIds={selectedContestants}
          onSelectionChange={setSelectedContestants}
        />
      )}

      {/* Assign to Seat Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent data-testid="dialog-assign-seat">
          <DialogHeader>
            <DialogTitle>Assign to Seat</DialogTitle>
            <DialogDescription>
              {selectedContestants.length === 1 
                ? "Select record day, block, and seat for this contestant."
                : `Assigning ${selectedContestants.length} contestants to record day.`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Record Day</label>
              <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
                <SelectTrigger data-testid="select-record-day">
                  <SelectValue placeholder="Select a record day" />
                </SelectTrigger>
                <SelectContent>
                  {recordDays.map((day: any) => (
                    <SelectItem key={day.id} value={day.id}>
                      {new Date(day.date).toLocaleDateString()} - {day.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedContestants.length === 1 && selectedRecordDay && (
              <>
                <div>
                  <label className="text-sm font-medium mb-2 block">Block</label>
                  <Select value={selectedBlock} onValueChange={setSelectedBlock}>
                    <SelectTrigger data-testid="select-block">
                      <SelectValue placeholder="Select a block" />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOCKS.map(block => (
                        <SelectItem key={block} value={block.toString()}>
                          Block {block}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedBlock && (
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Seat ({availableSeats.length} available)
                    </label>
                    <Select value={selectedSeat} onValueChange={setSelectedSeat}>
                      <SelectTrigger data-testid="select-seat">
                        <SelectValue placeholder="Select a seat" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSeats.map(seat => (
                          <SelectItem key={seat} value={seat}>
                            {seat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAssignToSeat} 
              disabled={!selectedRecordDay || (selectedContestants.length === 1 && (!selectedBlock || !selectedSeat))}
              data-testid="button-confirm-assign"
            >
              {selectedContestants.length === 1 ? "Assign to Seat" : "Assign to Record Day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
