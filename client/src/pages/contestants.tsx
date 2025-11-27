import { ContestantTable, Contestant } from "@/components/contestant-table";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus, TestTube, Filter, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useMemo } from "react";
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
import { Calendar } from "@/components/ui/calendar";
import { format, isSameDay, parseISO } from "date-fns";

const BLOCKS = [1, 2, 3, 4, 5, 6, 7];
const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

const MAX_GROUP_SIZE = 4;

// Generate all seats in order for a block
function getAllSeatsInOrder(): string[] {
  const seats: string[] = [];
  SEAT_ROWS.forEach(row => {
    for (let i = 1; i <= row.count; i++) {
      seats.push(`${row.label}${i}`);
    }
  });
  return seats;
}

// Find available consecutive seat groups of a given size (within same row only)
function findConsecutiveSeatGroups(occupiedSeats: Set<string>, groupSize: number): { startSeat: string; seats: string[] }[] {
  const groups: { startSeat: string; seats: string[] }[] = [];
  
  // Check each row separately - groups must stay within the same row
  SEAT_ROWS.forEach(row => {
    // Generate all seats in this row
    const rowSeats: string[] = [];
    for (let i = 1; i <= row.count; i++) {
      rowSeats.push(`${row.label}${i}`);
    }
    
    // Find consecutive available seats within this row
    for (let i = 0; i <= rowSeats.length - groupSize; i++) {
      const potentialGroup = rowSeats.slice(i, i + groupSize);
      const allAvailable = potentialGroup.every(seat => !occupiedSeats.has(seat));
      
      if (allAvailable) {
        groups.push({
          startSeat: potentialGroup[0],
          seats: potentialGroup
        });
      }
    }
  });
  
  return groups;
}

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
  const [filterRecordDayId, setFilterRecordDayId] = useState<string>("");
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
  // Only fetch when we have a valid record day ID (not empty and not "all")
  const shouldFetchAvailability = Boolean(filterRecordDayId && filterRecordDayId !== "all" && filterRecordDayId.length > 0);
  const { data: filteredAvailability = [], isLoading: loadingFiltered } = useQuery<ContestantWithAvailability[]>({
    queryKey: ['/api/availability/record-day', filterRecordDayId],
    enabled: shouldFetchAvailability,
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
  const uniqueLocations = Array.from(new Set(allSeatAssignments.map((a: any) => a.location).filter(Boolean)));

  // Determine which contestants to display
  let displayedContestants = filterRecordDayId
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
      console.log('[Import] Starting import for file:', file.name, 'size:', file.size);
      
      const formData = new FormData();
      formData.append('file', file);
      
      // Use absolute URL to fix Safari "string did not match expected pattern" error
      const baseUrl = window.location.origin;
      const url = `${baseUrl}/api/contestants/import`;
      console.log('[Import] Sending request to:', url);
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
        });
        
        console.log('[Import] Response status:', response.status);
        console.log('[Import] Response headers:', Object.fromEntries(response.headers.entries()));
        
        const responseText = await response.text();
        console.log('[Import] Response body:', responseText);
        
        if (!response.ok) {
          try {
            const error = JSON.parse(responseText);
            throw new Error(error.error || 'Import failed');
          } catch (parseError) {
            throw new Error(`Import failed: Server returned ${response.status} - ${responseText.substring(0, 100)}`);
          }
        }
        
        return JSON.parse(responseText);
      } catch (error: any) {
        console.error('[Import] Error:', error);
        throw error;
      }
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

  // Generate available seats for selected block (single contestant)
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

  // Generate available consecutive seat groups for multiple contestants (2-4)
  const isGroupSeating = selectedContestants.length >= 2 && selectedContestants.length <= MAX_GROUP_SIZE;
  const consecutiveSeatGroups = (selectedBlock && isGroupSeating) ? (() => {
    const blockNum = parseInt(selectedBlock);
    const occupied = new Set<string>(
      occupiedSeats
        .filter((a: any) => a.blockNumber === blockNum)
        .map((a: any) => a.seatLabel as string)
    );
    return findConsecutiveSeatGroups(occupied, selectedContestants.length);
  })() : [];

  // Create a map of dates to record days for the calendar
  const recordDayDates = useMemo(() => {
    const dateMap = new Map<string, any>();
    recordDays.forEach((day: any) => {
      const dateStr = day.date.split('T')[0]; // Get YYYY-MM-DD
      dateMap.set(dateStr, day);
    });
    return dateMap;
  }, [recordDays]);

  // Get the selected record day details
  const selectedRecordDayDetails = useMemo(() => {
    return recordDays.find((day: any) => day.id === selectedRecordDay);
  }, [recordDays, selectedRecordDay]);

  // Handle calendar date selection
  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) {
      setSelectedRecordDay("");
      return;
    }
    const dateStr = format(date, 'yyyy-MM-dd');
    const recordDay = recordDayDates.get(dateStr);
    if (recordDay) {
      setSelectedRecordDay(recordDay.id);
    }
  };

  // Get the currently selected date for the calendar
  const selectedCalendarDate = useMemo(() => {
    if (!selectedRecordDayDetails) return undefined;
    const dateStr = selectedRecordDayDetails.date.split('T')[0];
    return parseISO(dateStr);
  }, [selectedRecordDayDetails]);

  // Determine which dates have record days (for styling)
  const recordDayDatesList = useMemo(() => {
    return recordDays.map((day: any) => parseISO(day.date.split('T')[0]));
  }, [recordDays]);

  const handleOpenAssignDialog = () => {
    refetchRecordDays(); // Refresh record days when opening dialog
    setAssignDialogOpen(true);
  };

  const handleAssignToSeat = async () => {
    if (!selectedRecordDay || selectedContestants.length === 0) return;
    
    // For seat assignment (1-4 contestants), need block and seat
    if (selectedContestants.length <= MAX_GROUP_SIZE) {
      if (!selectedBlock || !selectedSeat) return;
    }

    try {
      if (selectedContestants.length === 1) {
        // Single contestant - assign to specific seat
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
      } else if (selectedContestants.length <= MAX_GROUP_SIZE) {
        // Group seating (2-4 contestants) - assign to consecutive seats
        const result: any = await apiRequest('POST', '/api/seat-assignments/group', {
          recordDayId: selectedRecordDay,
          contestantIds: selectedContestants,
          blockNumber: parseInt(selectedBlock),
          startingSeat: selectedSeat,
        });
        
        const seatRange = result.seats?.map((s: any) => s.seat).join(', ') || selectedSeat;
        toast({
          title: "Group assigned together",
          description: `${selectedContestants.length} contestants assigned to Block ${selectedBlock}, Seats ${seatRange}`,
        });
      } else {
        // More than 4 contestants - just mark as assigned to record day
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
    } catch (error: any) {
      toast({
        title: "Assignment failed",
        description: error?.message || "Could not assign contestant(s).",
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
            >
              <SelectTrigger data-testid="select-filter-rating">
                <SelectValue placeholder="All ratings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                <SelectItem value="A+">A+</SelectItem>
                <SelectItem value="A">A</SelectItem>
                <SelectItem value="B+">B+</SelectItem>
                <SelectItem value="B">B</SelectItem>
                <SelectItem value="C">C</SelectItem>
              </SelectContent>
            </Select>
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
            <label className="text-sm font-medium mb-2 block">Availability</label>
            <Select value={filterRecordDayId || "na"} onValueChange={(value) => {
              setFilterRecordDayId(value === "na" ? "" : value);
              // Default to 'yes' when selecting a date
              setFilterResponseValue(value === "na" ? "all" : "yes");
            }}>
              <SelectTrigger data-testid="select-filter-availability">
                <SelectValue placeholder="N/A" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="na">N/A</SelectItem>
                {recordDays.map((day: any) => (
                  <SelectItem key={day.id} value={day.id}>
                    {new Date(day.date).toLocaleDateString('en-US', { 
                      weekday: 'short', 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                    {day.rxNumber ? ` (${day.rxNumber})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filterRecordDayId && (
            <div className="flex-1 min-w-[200px] max-w-xs">
              <label className="text-sm font-medium mb-2 block">Response</label>
              <Select value={filterResponseValue} onValueChange={setFilterResponseValue}>
                <SelectTrigger data-testid="select-filter-response">
                  <SelectValue placeholder="Yes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="maybe">Maybe</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="all">All responses</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {(filterStatus !== "all" || filterGender !== "all" || filterRating !== "all" || 
            filterLocation !== "all" || filterRecordDayId) && (
            <Button 
              variant="outline" 
              onClick={() => {
                setFilterStatus("all");
                setFilterGender("all");
                setFilterRating("all");
                setFilterLocation("all");
                setFilterRecordDayId("");
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
        filterLocation !== "all" || filterRecordDayId) && (
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
          {filterRecordDayId && (
            <Badge variant="outline">
              Availability: {new Date(recordDays.find((d: any) => d.id === filterRecordDayId)?.date).toLocaleDateString()} ({filterResponseValue === "all" ? "all responses" : filterResponseValue})
            </Badge>
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
          seatAssignments={allSeatAssignments}
        />
      )}

      {/* Assign to Seat Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-assign-seat">
          <DialogHeader>
            <DialogTitle>
              {isGroupSeating ? "Assign Group Together" : "Assign to Seat"}
            </DialogTitle>
            <DialogDescription>
              {selectedContestants.length === 1 
                ? "Select record day, block, and seat for this contestant."
                : isGroupSeating
                  ? `Seat ${selectedContestants.length} contestants in consecutive seats.`
                  : `Assigning ${selectedContestants.length} contestants to record day (use Auto-Assign to seat them).`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Record Day</label>
              <div className="border rounded-md p-3">
                <Calendar
                  mode="single"
                  selected={selectedCalendarDate}
                  onSelect={handleCalendarSelect}
                  defaultMonth={new Date(2026, 1, 1)}
                  disabled={(date) => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    return !recordDayDates.has(dateStr);
                  }}
                  modifiers={{
                    recordDay: recordDayDatesList,
                  }}
                  modifiersStyles={{
                    recordDay: {
                      fontWeight: 'bold',
                    },
                  }}
                  components={{
                    DayContent: ({ date }) => {
                      const dateStr = format(date, 'yyyy-MM-dd');
                      const recordDay = recordDayDates.get(dateStr);
                      return (
                        <div className="flex flex-col items-center justify-center w-full h-full py-1">
                          <span className="text-base font-medium">{date.getDate()}</span>
                          {recordDay?.rxNumber && (
                            <span className="text-[10px] leading-tight text-primary text-center whitespace-nowrap">
                              {recordDay.rxNumber}
                            </span>
                          )}
                        </div>
                      );
                    },
                  }}
                  classNames={{
                    months: "flex flex-col w-full",
                    month: "space-y-4 w-full",
                    table: "w-full border-collapse",
                    head_row: "flex w-full",
                    head_cell: "text-muted-foreground rounded-md flex-1 font-medium text-sm",
                    row: "flex w-full mt-2",
                    cell: "flex-1 h-14 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                    day: "h-14 w-full p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground rounded-md",
                    day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                    day_today: "bg-accent text-accent-foreground",
                    day_outside: "day-outside text-muted-foreground opacity-50",
                    day_disabled: "text-muted-foreground opacity-30",
                    nav: "space-x-1 flex items-center",
                    nav_button: "h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 border rounded-md",
                    nav_button_previous: "absolute left-1",
                    nav_button_next: "absolute right-1",
                    caption: "flex justify-center pt-1 relative items-center mb-2",
                    caption_label: "text-base font-semibold",
                  }}
                  className="w-full"
                  data-testid="calendar-record-day"
                />
              </div>
              {selectedRecordDayDetails && (
                <div className="mt-2 p-2 bg-muted rounded text-sm">
                  <span className="font-medium">Selected: </span>
                  {format(parseISO(selectedRecordDayDetails.date.split('T')[0]), 'MMMM d, yyyy')}
                  {selectedRecordDayDetails.rxNumber && (
                    <span className="ml-2 text-muted-foreground">({selectedRecordDayDetails.rxNumber})</span>
                  )}
                </div>
              )}
            </div>

            {/* Show block/seat selection for 1-4 contestants */}
            {selectedContestants.length <= MAX_GROUP_SIZE && selectedRecordDay && (
              <>
                <div>
                  <label className="text-sm font-medium mb-2 block">Block</label>
                  <Select value={selectedBlock} onValueChange={(val) => { setSelectedBlock(val); setSelectedSeat(""); }}>
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
                    {selectedContestants.length === 1 ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <label className="text-sm font-medium mb-2 block">
                          Starting Seat ({consecutiveSeatGroups.length} available positions for {selectedContestants.length} consecutive seats)
                        </label>
                        <Select value={selectedSeat} onValueChange={setSelectedSeat}>
                          <SelectTrigger data-testid="select-seat-group">
                            <SelectValue placeholder="Select starting position" />
                          </SelectTrigger>
                          <SelectContent>
                            {consecutiveSeatGroups.map(group => (
                              <SelectItem key={group.startSeat} value={group.startSeat}>
                                {group.seats.join(' → ')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {consecutiveSeatGroups.length === 0 && (
                          <p className="text-sm text-muted-foreground mt-1">
                            No positions with {selectedContestants.length} consecutive empty seats in this block.
                          </p>
                        )}
                      </>
                    )}
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
              disabled={
                !selectedRecordDay || 
                (selectedContestants.length <= MAX_GROUP_SIZE && (!selectedBlock || !selectedSeat))
              }
              data-testid="button-confirm-assign"
            >
              {selectedContestants.length === 1 
                ? "Assign to Seat" 
                : isGroupSeating 
                  ? "Assign Group Together"
                  : "Assign to Record Day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
