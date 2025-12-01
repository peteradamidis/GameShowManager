import { ContestantTable, Contestant } from "@/components/contestant-table";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Filter, X, ChevronLeft, ChevronRight, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useMemo, useEffect } from "react";
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
import type { BlockType } from "@shared/schema";

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
  const [standbyDialogOpen, setStandbyDialogOpen] = useState(false);
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("");
  const [selectedBlock, setSelectedBlock] = useState<string>("");
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [filterRecordDayId, setFilterRecordDayId] = useState<string>("");
  const [filterResponseValue, setFilterResponseValue] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGender, setFilterGender] = useState<string>("all");
  const [filterRating, setFilterRating] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [filterStandbyStatus, setFilterStandbyStatus] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState<string>("");
  
  const ITEMS_PER_PAGE = 50;

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

  // Fetch block types for the selected record day
  const { data: blockTypesData = [] } = useQuery<BlockType[]>({
    queryKey: ['/api/record-days', selectedRecordDay, 'block-types'],
    enabled: Boolean(selectedRecordDay),
  });

  // Create a map of block number to block type
  const blockTypeMap: Record<number, 'PB' | 'NPB'> = {};
  blockTypesData.forEach(bt => {
    blockTypeMap[bt.blockNumber] = bt.blockType as 'PB' | 'NPB';
  });

  // Fetch all seat assignments for rating/location filtering
  const { data: allSeatAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments'],
  });

  // Fetch all standbys for filtering
  const { data: allStandbys = [] } = useQuery<any[]>({
    queryKey: ['/api/standbys'],
  });

  // Create a set of contestant IDs who are standbys
  const standbyContestantIds = useMemo(() => {
    return new Set(allStandbys.map((s: any) => s.contestantId));
  }, [allStandbys]);

  // Create a set of contestant IDs who are standbys for the specific record day
  const standbyForRecordDayIds = useMemo(() => {
    if (!filterRecordDayId) return new Set<string>();
    return new Set(
      allStandbys
        .filter((s: any) => s.recordDayId === filterRecordDayId)
        .map((s: any) => s.contestantId)
    );
  }, [allStandbys, filterRecordDayId]);

  // Get unique values for filter dropdowns
  const uniqueGenders = Array.from(new Set(contestants.map(c => c.gender).filter(Boolean)));
  const uniqueCities = Array.from(new Set(contestants.map(c => c.location).filter((loc): loc is string => Boolean(loc)))).sort();

  // Determine which contestants to display
  let displayedContestants = filterRecordDayId
    ? filteredAvailability
        .filter(item => !filterResponseValue || filterResponseValue === "all" || item.responseValue === filterResponseValue)
        .filter(item => !standbyForRecordDayIds.has(item.contestant.id))
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
    // Filter contestants by their audition rating
    displayedContestants = displayedContestants.filter(c => c.auditionRating === filterRating);
  }
  if (filterLocation !== "all") {
    // Filter contestants by their location
    displayedContestants = displayedContestants.filter(c => c.location === filterLocation);
  }
  if (filterStandbyStatus !== "all") {
    // Filter contestants by standby status
    if (filterStandbyStatus === "is_standby") {
      displayedContestants = displayedContestants.filter(c => standbyContestantIds.has(c.id));
    } else if (filterStandbyStatus === "not_standby") {
      displayedContestants = displayedContestants.filter(c => !standbyContestantIds.has(c.id));
    }
  }

  // Apply search filter (searches across ALL pages before pagination)
  if (searchTerm.trim()) {
    const search = searchTerm.toLowerCase();
    displayedContestants = displayedContestants.filter(c => 
      c.name.toLowerCase().includes(search) ||
      (c.attendingWith?.toLowerCase().includes(search) ?? false)
    );
  }

  const isLoading = loadingContestants || (filterRecordDayId && loadingFiltered);

  // Reset page when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, filterGender, filterRating, filterLocation, filterRecordDayId, filterResponseValue, filterStandbyStatus, searchTerm]);

  // Pagination calculations
  const totalPages = Math.ceil(displayedContestants.length / ITEMS_PER_PAGE);
  const paginatedContestants = displayedContestants.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

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

  // Add as standby mutation
  const addStandbyMutation = useMutation({
    mutationFn: async ({ contestantIds, recordDayId }: { contestantIds: string[]; recordDayId: string }) => {
      return apiRequest('POST', '/api/standbys', { contestantIds, recordDayId });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
      setStandbyDialogOpen(false);
      setSelectedContestants([]);
      setSelectedRecordDay("");
      
      let description = `Added ${data.count} contestant${data.count !== 1 ? 's' : ''} as standbys`;
      if (data.skipped > 0) {
        description += ` (${data.skipped} already existed)`;
      }
      description += '.';
      
      toast({
        title: data.count > 0 ? "Standbys added" : "No new standbys",
        description,
        variant: data.count === 0 ? "default" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add standbys",
        description: error.message,
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
            <>
              <Button 
                variant="outline"
                onClick={() => {
                  refetchRecordDays();
                  setStandbyDialogOpen(true);
                }} 
                data-testid="button-add-standbys"
              >
                <UserCheck className="h-4 w-4 mr-2" />
                Book {selectedContestants.length} as Standby
              </Button>
              <Button 
                onClick={handleOpenAssignDialog} 
                data-testid="button-assign-contestants"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Assign {selectedContestants.length} to Record Day
              </Button>
            </>
          )}
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
            <label className="text-sm font-medium mb-2 block">City</label>
            <Select 
              value={filterLocation} 
              onValueChange={setFilterLocation}
              disabled={uniqueCities.length === 0}
            >
              <SelectTrigger data-testid="select-filter-location">
                <SelectValue placeholder={uniqueCities.length === 0 ? "No cities available" : "All cities"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {uniqueCities.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium mb-2 block">Standby</label>
            <Select value={filterStandbyStatus} onValueChange={setFilterStandbyStatus}>
              <SelectTrigger data-testid="select-filter-standby">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="is_standby">Is Standby</SelectItem>
                <SelectItem value="not_standby">Not Standby</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(filterStatus !== "all" || filterGender !== "all" || filterRating !== "all" || 
            filterLocation !== "all" || filterRecordDayId || filterStandbyStatus !== "all") && (
            <Button 
              variant="outline" 
              onClick={() => {
                setFilterStatus("all");
                setFilterGender("all");
                setFilterRating("all");
                setFilterLocation("all");
                setFilterRecordDayId("");
                setFilterResponseValue("all");
                setFilterStandbyStatus("all");
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
        filterLocation !== "all" || filterRecordDayId || filterStandbyStatus !== "all") && (
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
          {filterStandbyStatus !== "all" && (
            <Badge variant="outline">
              Standby: {filterStandbyStatus === "is_standby" ? "Is Standby" : "Not Standby"}
            </Badge>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading contestants...
        </div>
      ) : (
        <>
          <ContestantTable 
            contestants={paginatedContestants}
            selectedIds={selectedContestants}
            onSelectionChange={setSelectedContestants}
            seatAssignments={allSeatAssignments}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t pt-4 mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, displayedContestants.length)} of {displayedContestants.length} contestants
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                    .map((page, idx, arr) => (
                      <span key={page}>
                        {idx > 0 && arr[idx - 1] !== page - 1 && (
                          <span className="px-1 text-muted-foreground">...</span>
                        )}
                        <Button
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className="w-9"
                          data-testid={`button-page-${page}`}
                        >
                          {page}
                        </Button>
                      </span>
                    ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
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
          
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Record Day</label>
              <div className="border rounded-md p-2">
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
                        <div className="flex flex-col items-center justify-center w-full h-full">
                          <span className="text-sm font-medium">{date.getDate()}</span>
                          {recordDay?.rxNumber && (
                            <span className="text-[8px] leading-tight text-primary text-center whitespace-nowrap">
                              {recordDay.rxNumber}
                            </span>
                          )}
                        </div>
                      );
                    },
                  }}
                  classNames={{
                    months: "flex flex-col w-full",
                    month: "space-y-2 w-full",
                    table: "w-full border-collapse",
                    head_row: "flex w-full",
                    head_cell: "text-muted-foreground rounded-md flex-1 font-medium text-xs",
                    row: "flex w-full mt-1",
                    cell: "flex-1 h-10 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                    day: "h-10 w-full p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground rounded-md",
                    day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                    day_today: "bg-accent text-accent-foreground",
                    day_outside: "day-outside text-muted-foreground opacity-50",
                    day_disabled: "text-muted-foreground opacity-30",
                    nav: "space-x-1 flex items-center",
                    nav_button: "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 border rounded-md",
                    nav_button_previous: "absolute left-1",
                    nav_button_next: "absolute right-1",
                    caption: "flex justify-center pt-1 relative items-center mb-1",
                    caption_label: "text-sm font-semibold",
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
                          {blockTypeMap[block] && (
                            <Badge 
                              variant={blockTypeMap[block] === 'PB' ? 'default' : 'secondary'}
                              className="ml-2 text-xs"
                            >
                              {blockTypeMap[block]}
                            </Badge>
                          )}
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

      {/* Book as Standby Dialog */}
      <Dialog open={standbyDialogOpen} onOpenChange={setStandbyDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-add-standby">
          <DialogHeader>
            <DialogTitle>Book as Standby</DialogTitle>
            <DialogDescription>
              Book {selectedContestants.length} contestant{selectedContestants.length !== 1 ? 's' : ''} as standby for a record day.
              Standbys are backup contestants who receive separate booking emails.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Record Day</label>
              <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
                <SelectTrigger data-testid="select-standby-record-day">
                  <SelectValue placeholder="Select a record day" />
                </SelectTrigger>
                <SelectContent>
                  {recordDays.map((rd: any) => (
                    <SelectItem key={rd.id} value={rd.id}>
                      {format(parseISO(rd.date), 'EEE, MMM d, yyyy')}
                      {rd.rxNumber && ` (${rd.rxNumber})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStandbyDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (selectedRecordDay && selectedContestants.length > 0) {
                  addStandbyMutation.mutate({
                    contestantIds: selectedContestants,
                    recordDayId: selectedRecordDay,
                  });
                }
              }}
              disabled={!selectedRecordDay || addStandbyMutation.isPending}
              data-testid="button-confirm-add-standby"
            >
              {addStandbyMutation.isPending ? "Booking..." : `Book ${selectedContestants.length} as Standby`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
