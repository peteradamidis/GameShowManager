import { ContestantTable, Contestant, getDistanceFromDocklands, isLocationInterstate } from "@/components/contestant-table";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { ImportGalleryDialog } from "@/components/import-gallery-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { UserPlus, UserMinus, Filter, X, ChevronLeft, ChevronRight, UserCheck, Trash2, Users, AlertTriangle, RefreshCw, Link, Unlink, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { broadcastContestantChange, broadcastSeatingChange } from "@/lib/crossTabSync";
import { useState, useMemo, useEffect } from "react";
import { getGroupSizeFromAttendingWith, getPartnerNames, attendingWithMentionsName, isSoloContestant, normalizeName } from "@shared/attendingWithParser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    available: "border-green-300 bg-green-500/10 text-green-700 dark:border-green-700 dark:text-green-400",
    assigned: "border-blue-300 bg-blue-500/10 text-blue-700 dark:border-blue-700 dark:text-blue-400",
    invited: "border-purple-300 bg-purple-500/10 text-purple-700 dark:border-purple-700 dark:text-purple-400",
    confirmed: "border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-700 dark:text-sky-400",
    returning_standby: "border-orange-300 bg-orange-500/10 text-orange-700 dark:border-orange-700 dark:text-orange-400",
    rescheduled: "border-red-400 bg-red-900/10 text-red-900 dark:border-red-700 dark:text-red-400",
  };
  
  const displayLabels: Record<string, string> = {
    returning_standby: "Returning Standby",
    rescheduled: "Reschedule",
  };
  
  const colorClasses = colors[status.toLowerCase()] || colors.available;
  const displayLabel = displayLabels[status.toLowerCase()] || status;
  
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${colorClasses}`}>
      {displayLabel}
    </span>
  );
};

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
  const [standbyIncludeGroups, setStandbyIncludeGroups] = useState(true);
  const [groupPreviewOpen, setGroupPreviewOpen] = useState(false);
  const [groupPreviewMembers, setGroupPreviewMembers] = useState<Contestant[]>([]);
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
  const [filterGroupSize, setFilterGroupSize] = useState<string>("all");
  const [filterState, setFilterState] = useState<string>("all");
  const [postcodeFrom, setPostcodeFrom] = useState<string>("");
  const [postcodeTo, setPostcodeTo] = useState<string>("");
  const [filterPodiumStory, setFilterPodiumStory] = useState(false);
  const [filterWithin60km, setFilterWithin60km] = useState(false);
  const [filterWithin20km, setFilterWithin20km] = useState(false);
  const [filterOver60km, setFilterOver60km] = useState(false);
  const [filterAllGroupAvailable, setFilterAllGroupAvailable] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<1 | 2>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [removeSeatDialogOpen, setRemoveSeatDialogOpen] = useState(false);
  const [testContestantDialogOpen, setTestContestantDialogOpen] = useState(false);
  const [testContestantForm, setTestContestantForm] = useState({
    name: "",
    gender: "Female" as "Male" | "Female",
    age: "",
    phone: "",
    email: "",
  });
  
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

  // Fetch canceled assignments (for reschedule status)
  const { data: canceledAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/canceled-assignments'],
  });

  // Create a set of contestant IDs who are ACTIVE standbys (exclude inactive/stale entries)
  const standbyContestantIds = useMemo(() => {
    return new Set(
      allStandbys
        .filter((s: any) => !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended')
        .map((s: any) => s.contestantId)
    );
  }, [allStandbys]);

  // Create a set of contestant IDs who have been moved to reschedule (from standby) and NOT yet rebooked
  const rescheduleContestantIds = useMemo(() => {
    return new Set(
      canceledAssignments
        .filter((ca: any) => ca.isFromStandby && !ca.rebookedToRecordDayId)
        .map((ca: any) => ca.contestantId)
    );
  }, [canceledAssignments]);

  // Create a set of contestant IDs who are standbys for the specific record day
  const standbyForRecordDayIds = useMemo(() => {
    if (!filterRecordDayId) return new Set<string>();
    return new Set(
      allStandbys
        .filter((s: any) => s.recordDayId === filterRecordDayId)
        .map((s: any) => s.contestantId)
    );
  }, [allStandbys, filterRecordDayId]);

  // Check if a single selected contestant has a seat assignment
  const selectedContestantAssignment = useMemo(() => {
    if (selectedContestants.length !== 1) return null;
    const contestantId = selectedContestants[0];
    return allSeatAssignments.find((sa: any) => sa.contestantId === contestantId) || null;
  }, [selectedContestants, allSeatAssignments]);

  // Check if the selected contestant's assignment is on a locked day
  const isSelectedAssignmentOnLockedDay = useMemo(() => {
    if (!selectedContestantAssignment) return false;
    const day = recordDays.find((d: any) => d.id === selectedContestantAssignment.recordDayId);
    return day?.isLocked === true;
  }, [selectedContestantAssignment, recordDays]);

  // Create a map of contestantId to seat assignment for quick lookup
  const seatAssignmentMap = useMemo(() => {
    return new Map(allSeatAssignments.map((sa: any) => [sa.contestantId, sa]));
  }, [allSeatAssignments]);

  // Create a map of contestantId to paperwork status (combining seat assignments and canceled assignments)
  const paperworkStatusMap = useMemo(() => {
    const map = new Map<string, { status: 'received' | 'sent' | 'none'; receivedAt?: string; sentAt?: string }>();
    
    // First, add active seat assignments
    allSeatAssignments.forEach((sa: any) => {
      if (sa.paperworkReceived) {
        map.set(sa.contestantId, { 
          status: 'received', 
          receivedAt: sa.paperworkReceived,
          sentAt: sa.paperworkSent 
        });
      } else if (sa.paperworkSent) {
        map.set(sa.contestantId, { 
          status: 'sent', 
          sentAt: sa.paperworkSent 
        });
      }
    });
    
    // Then, check canceled assignments (for rescheduled contestants)
    canceledAssignments.forEach((ca: any) => {
      // Only add if not already in map from active assignment
      if (!map.has(ca.contestantId)) {
        if (ca.paperworkReceived) {
          map.set(ca.contestantId, { 
            status: 'received', 
            receivedAt: ca.paperworkReceived,
            sentAt: ca.paperworkSent 
          });
        } else if (ca.paperworkSent) {
          map.set(ca.contestantId, { 
            status: 'sent', 
            sentAt: ca.paperworkSent 
          });
        }
      }
    });
    
    return map;
  }, [allSeatAssignments, canceledAssignments]);

  // Find group members for the single selected contestant (for "Book with Group" button)
  const selectedContestantGroupMembers = useMemo(() => {
    if (selectedContestants.length !== 1) return [];
    const contestantId = selectedContestants[0];
    const selectedContestant = contestants.find(c => c.id === contestantId);
    if (!selectedContestant) return [];
    
    // If contestant has a groupId, use that to find group members
    if (selectedContestant.groupId) {
      return contestants.filter(c => 
        c.groupId === selectedContestant.groupId &&
        c.availabilityStatus !== 'Assigned' &&
        !seatAssignmentMap.has(c.id)
      );
    }
    
    // Otherwise, try to find group by matching attendingWith names
    // Use shared parser functions for consistent partner name extraction
    if (selectedContestant.attendingWith) {
      const partnerNames = getPartnerNames(selectedContestant.attendingWith);
      
      // If this is a solo contestant, no group members
      if (partnerNames.length === 0) {
        return [];
      }
      
      // Find people this person is attending with
      const groupMemberSet = new Set<string>([selectedContestant.id]);
      
      contestants.forEach(c => {
        if (c.id === selectedContestant.id) return;
        
        // Check if this person's name is in the selected contestant's attendingWith
        if (attendingWithMentionsName(selectedContestant.attendingWith, c.name)) {
          groupMemberSet.add(c.id);
        }
        
        // Check if selected contestant's name is in this person's attendingWith
        if (attendingWithMentionsName(c.attendingWith, selectedContestant.name)) {
          groupMemberSet.add(c.id);
        }
      });
      
      // Return eligible group members (not already assigned)
      return contestants.filter(c => 
        groupMemberSet.has(c.id) &&
        c.availabilityStatus !== 'Assigned' &&
        !seatAssignmentMap.has(c.id)
      );
    }
    
    return [];
  }, [selectedContestants, contestants, seatAssignmentMap]);

  // Check if "Book with Group" button should be shown
  const showBookWithGroupButton = selectedContestants.length === 1 && 
    selectedContestantGroupMembers.length > 1 && 
    !selectedContestantAssignment;

  // Check if selected contestants can be linked (2+ contestants, none already in a group)
  const selectedContestantsForLinking = useMemo(() => {
    return selectedContestants.map(id => contestants.find(c => c.id === id)).filter(Boolean) as Contestant[];
  }, [selectedContestants, contestants]);

  // Check if all selected contestants are already in the same group
  const allInSameGroup = useMemo(() => {
    if (selectedContestantsForLinking.length < 2) return false;
    const firstGroupId = selectedContestantsForLinking[0]?.groupId;
    if (!firstGroupId) return false;
    return selectedContestantsForLinking.every(c => c.groupId === firstGroupId);
  }, [selectedContestantsForLinking]);

  // Check if selected contestants appear related via attendingWith but aren't formally linked
  const appearRelatedViaAttendingWith = useMemo(() => {
    if (selectedContestantsForLinking.length < 2) return false;
    // Check if any selected contestant mentions any other selected contestant in attendingWith
    for (const c1 of selectedContestantsForLinking) {
      for (const c2 of selectedContestantsForLinking) {
        if (c1.id !== c2.id && c1.attendingWith && attendingWithMentionsName(c1.attendingWith, c2.name)) {
          return true;
        }
      }
    }
    return false;
  }, [selectedContestantsForLinking]);

  // Check if any selected contestant is already assigned to a record day
  const anySelectedHasSeatAssignment = useMemo(() => {
    return selectedContestants.some(id => seatAssignmentMap.has(id));
  }, [selectedContestants, seatAssignmentMap]);

  // Show "Link Together" only if:
  // - 2+ contestants selected
  // - None already have a groupId (or they're not all in the same group)
  // - NOT if they're all already in the same formal group
  // - None are already assigned to a record day (use right-click linking instead)
  const canLinkSelected = selectedContestants.length >= 2 && 
    selectedContestantsForLinking.every(c => !c.groupId) &&
    !allInSameGroup &&
    !anySelectedHasSeatAssignment;

  // Check if a single selected contestant can be unlinked (has a groupId)
  const canUnlinkSelected = selectedContestants.length === 1 && 
    selectedContestantsForLinking.length === 1 && 
    !!selectedContestantsForLinking[0]?.groupId;

  // Get group members for unlink preview
  const selectedContestantGroupForUnlink = useMemo(() => {
    if (selectedContestants.length !== 1) return [];
    const selected = selectedContestantsForLinking[0];
    if (!selected?.groupId) return [];
    return contestants.filter(c => c.groupId === selected.groupId);
  }, [selectedContestants, selectedContestantsForLinking, contestants]);

  // Get all contestants to book as standbys including their group members
  const standbyContestantsWithGroups = useMemo(() => {
    if (!standbyIncludeGroups) {
      return selectedContestantsForLinking;
    }
    
    const allIds = new Set<string>(selectedContestants);
    
    // For each selected contestant, find their group members
    selectedContestantsForLinking.forEach(contestant => {
      if (contestant.groupId) {
        // Find all group members by groupId
        contestants.forEach(c => {
          if (c.groupId === contestant.groupId) {
            allIds.add(c.id);
          }
        });
      } else if (contestant.attendingWith) {
        // Find group members by attendingWith matching
        contestants.forEach(c => {
          if (c.id === contestant.id) return;
          if (attendingWithMentionsName(contestant.attendingWith, c.name)) {
            allIds.add(c.id);
          }
          if (attendingWithMentionsName(c.attendingWith, contestant.name)) {
            allIds.add(c.id);
          }
        });
      }
    });
    
    return contestants.filter(c => allIds.has(c.id));
  }, [selectedContestants, selectedContestantsForLinking, contestants, standbyIncludeGroups]);

  // Get unique values for filter dropdowns
  const uniqueGenders = Array.from(new Set(contestants.map(c => c.gender).filter(Boolean)));
  const uniqueCities = Array.from(new Set(contestants.map(c => c.location).filter((loc): loc is string => Boolean(loc)))).sort();
  const uniqueStates = Array.from(new Set(contestants.map(c => c.state).filter((s): s is string => Boolean(s)))).sort();
  
  // Australian states for dropdown
  const australianStates = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

  // Determine which contestants to display
  // Important: When filtering by record day, only use filteredAvailability when it's fully loaded
  // While loading, fall back to contestants to prevent empty search results during loading
  const isAvailabilityFilterReady = shouldFetchAvailability && !loadingFiltered;
  let displayedContestants = isAvailabilityFilterReady
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
    // Filter by standby status: "available_for_standby" = marked in import, "booked_standby" = actually booked
    if (filterStandbyStatus === "available_for_standby") {
      displayedContestants = displayedContestants.filter(c => c.availableForStandby);
    } else if (filterStandbyStatus === "booked_standby") {
      displayedContestants = displayedContestants.filter(c => standbyContestantIds.has(c.id));
    } else if (filterStandbyStatus === "not_standby") {
      displayedContestants = displayedContestants.filter(c => !standbyContestantIds.has(c.id) && !c.availableForStandby);
    }
  }
  if (filterGroupSize !== "all") {
    displayedContestants = displayedContestants.filter(c => {
      // Use shared parser for consistent group size calculation across the system
      const groupSize = getGroupSizeFromAttendingWith(c.attendingWith);
      if (filterGroupSize === "1") return groupSize === 1;
      if (filterGroupSize === "2") return groupSize === 2;
      if (filterGroupSize === "3+") return groupSize >= 3;
      return true;
    });
  }

  // All group members available filter: only show contestants where every group partner
  // is also not currently seated, on active standby, previously attended, or interstate
  if (filterAllGroupAvailable) {
    const unavailableIds = new Set<string>();
    // Seated on any record day
    (allSeatAssignments as any[]).forEach((sa: any) => unavailableIds.add(sa.contestantId));
    // Active standby on any record day (exclude stale/inactive entries)
    (allStandbys as any[])
      .filter((s: any) => !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended')
      .forEach((s: any) => unavailableIds.add(s.contestantId));
    // Previously attended (seated on a locked/completed record day)
    const lockedDayIds = new Set((recordDays as any[]).filter((d: any) => d.lockedAt).map((d: any) => d.id));
    (allSeatAssignments as any[])
      .filter((sa: any) => lockedDayIds.has(sa.recordDayId))
      .forEach((sa: any) => unavailableIds.add(sa.contestantId));
    // Interstate (not from Victoria — check both postcode and location string)
    contestants.forEach((c: any) => {
      const postcodeCode = parseInt(c.postcode || '', 10);
      const postcodeInterstate = !isNaN(postcodeCode) &&
        !(postcodeCode >= 3000 && postcodeCode <= 3999) &&
        !(postcodeCode >= 8000 && postcodeCode <= 8999);
      const locationInterstate = isLocationInterstate(c.location).isInterstate;
      if (postcodeInterstate || locationInterstate) unavailableIds.add(c.id);
    });

    const availableNameSet = new Set(
      contestants
        .filter((c: any) => !unavailableIds.has(c.id))
        .map((c: any) => normalizeName(c.name || ''))
        .filter(Boolean)
    );
    displayedContestants = displayedContestants.filter(c => {
      // Solo contestants always pass
      if (isSoloContestant(c.attendingWith)) return true;
      const partnerNames = getPartnerNames(c.attendingWith);
      return partnerNames.every(pName => availableNameSet.has(normalizeName(pName)));
    });
  }

  // Apply postcode range filter
  if (postcodeFrom || postcodeTo) {
    displayedContestants = displayedContestants.filter(c => {
      if (!c.postcode) return false;
      const postcode = parseInt(c.postcode, 10);
      if (isNaN(postcode)) return false;
      const from = postcodeFrom ? parseInt(postcodeFrom, 10) : 0;
      const to = postcodeTo ? parseInt(postcodeTo, 10) : 9999;
      return postcode >= from && postcode <= to;
    });
  }
  
  // Apply state filter
  if (filterState !== "all") {
    displayedContestants = displayedContestants.filter(c => c.state === filterState);
  }

  // Apply podium story filter
  if (filterPodiumStory) {
    displayedContestants = displayedContestants.filter(c => c.podiumStory);
  }

  // Apply within 60km of Docklands filter
  if (filterWithin60km) {
    displayedContestants = displayedContestants.filter(c => {
      const distanceInfo = getDistanceFromDocklands(c.location);
      // Only include contestants within 60km (exclude those over 60km or unknown)
      return distanceInfo !== null && !distanceInfo.isOver60km;
    });
  }

  // Apply within 20km of Docklands filter
  if (filterWithin20km) {
    displayedContestants = displayedContestants.filter(c => {
      const distanceInfo = getDistanceFromDocklands(c.location);
      // Only include contestants within 20km
      return distanceInfo !== null && distanceInfo.distance <= 20;
    });
  }

  // Apply over 60km from Docklands filter
  if (filterOver60km) {
    displayedContestants = displayedContestants.filter(c => {
      const distanceInfo = getDistanceFromDocklands(c.location);
      return distanceInfo !== null && distanceInfo.isOver60km;
    });
  }

  // Apply search filter (searches across ALL pages before pagination)
  if (searchTerm.trim()) {
    const search = searchTerm.toLowerCase();
    displayedContestants = displayedContestants.filter(c => 
      c.name.toLowerCase().includes(search) ||
      (c.attendingWith?.toLowerCase().includes(search) ?? false) ||
      (c.phone?.toLowerCase().includes(search) ?? false)
    );
  }

  const isLoading = loadingContestants || (filterRecordDayId && loadingFiltered);

  // Reset page when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, filterGender, filterRating, filterLocation, filterRecordDayId, filterResponseValue, filterStandbyStatus, filterGroupSize, filterState, filterAllGroupAvailable, filterOver60km, searchTerm]);

  // Pagination calculations
  const totalPages = Math.ceil(displayedContestants.length / ITEMS_PER_PAGE);
  const paginatedContestants = displayedContestants.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Excel export for filtered contestants
  const handleExportToExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      
      const exportData = displayedContestants.map(c => ({
        'Name': c.name,
        'Email': c.email || '',
        'Phone': c.phone ? `${c.phone},` : '',
        'Age': c.age || '',
        'Gender': c.gender || '',
        'State': c.state || '',
        'Suburb': c.suburb || '',
        'Location': c.location || '',
        'Rating': c.auditionRating || '',
        'Status': c.availabilityStatus || '',
        'Attending With': c.attendingWith || '',
        'Group Size': c.groupSize || 1,
        'Podium Story': c.podiumStory ? 'Yes' : 'No',
        'Notes': c.notes || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Contestants');

      const timestamp = format(new Date(), 'yyyy-MM-dd_HHmm');
      XLSX.writeFile(workbook, `contestants_export_${timestamp}.xlsx`);

      toast({ title: "Exported", description: `${displayedContestants.length} contestants exported to Excel` });
    } catch (error) {
      console.error('Export error:', error);
      toast({ title: "Export Failed", description: "Could not export contestants", variant: "destructive" });
    }
  };

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
          let errorMsg = `Import failed: Server returned ${response.status}`;
          try { errorMsg = JSON.parse(responseText).error || errorMsg; } catch {}
          throw new Error(errorMsg);
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
      broadcastContestantChange();
      
      let description = `Imported ${data.contestantsCreated} contestants`;
      if (data.groupsCreated > 0) {
        description += ` and ${data.groupsCreated} groups`;
      }
      if (data.skippedDuplicates > 0) {
        description += `. Skipped ${data.skippedDuplicates} duplicate${data.skippedDuplicates > 1 ? 's' : ''}`;
      }
      description += '.';
      
      toast({
        title: data.skippedDuplicates > 0 ? "Import completed with duplicates skipped" : "Import successful",
        description,
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

  const importSurveyMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const url = `${window.location.origin}/api/contestants/import-survey`;
      const response = await fetch(url, { method: 'POST', body: formData, credentials: 'same-origin' });
      const responseText = await response.text();
      if (!response.ok) {
        let errorMsg = `Import failed: Server returned ${response.status}`;
        try { errorMsg = JSON.parse(responseText).error || errorMsg; } catch {}
        throw new Error(errorMsg);
      }
      return JSON.parse(responseText);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/groups'] });
      broadcastContestantChange();
      const parts: string[] = [];
      if (data.contestantsCreated > 0) parts.push(`${data.contestantsCreated} new contestant${data.contestantsCreated !== 1 ? 's' : ''} (rated R)`);
      if (data.temporaryContestantsUpdated > 0) parts.push(`${data.temporaryContestantsUpdated} temp contestant${data.temporaryContestantsUpdated !== 1 ? 's' : ''} updated`);
      if (data.skippedDuplicates > 0) parts.push(`${data.skippedDuplicates} duplicate${data.skippedDuplicates !== 1 ? 's' : ''} skipped`);
      const description = parts.length > 0 ? parts.join(', ') + '.' : 'No new contestants imported.';
      const hasNew = data.contestantsCreated > 0 || data.temporaryContestantsUpdated > 0;
      toast({ title: hasNew ? "Survey import successful" : "Survey import complete", description });
    },
    onError: (error: Error) => {
      toast({ title: "Survey import failed", description: error.message || "Could not import the survey file.", variant: "destructive" });
    },
  });

  // Add as standby mutation
  const addStandbyMutation = useMutation({
    mutationFn: async ({ contestantIds, recordDayId }: { contestantIds: string[]; recordDayId: string }) => {
      return apiRequest('POST', '/api/standbys', { contestantIds, recordDayId });
    },
    onSuccess: (data: any) => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
      broadcastSeatingChange();
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
    onError: (error: Error, variables: { contestantIds: string[]; recordDayId: string }) => {
      let parsedError: any = null;
      try {
        const errorMsg = error?.message || '';
        const jsonMatch = errorMsg.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          parsedError = JSON.parse(jsonMatch[1]);
        }
      } catch {}
      
      if (parsedError?.isReturning) {
        const confirmed = window.confirm(
          `RETURNING CONTESTANT\n\n${parsedError.contestantName || 'This contestant'} previously appeared on ${parsedError.previousLabel || parsedError.previousDay || 'a completed episode'}.\n\nDo you want to add them as a returning standby?`
        );
        if (confirmed) {
          apiRequest('POST', '/api/standbys', { contestantIds: variables.contestantIds, recordDayId: variables.recordDayId, allowReturning: true })
            .then((data: any) => {
              queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
              queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
              queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
              queryClient.invalidateQueries({ queryKey: ['/api/returning-contestants'] });
              broadcastSeatingChange();
              setStandbyDialogOpen(false);
              setSelectedContestants([]);
              setSelectedRecordDay("");
              toast({ title: "Returning standby added", description: `Successfully added as returning standby` });
            })
            .catch((retryError: any) => {
              toast({ title: "Failed to add standby", description: retryError.message, variant: "destructive" });
            });
        }
        return;
      }
      
      toast({
        title: "Failed to add standbys",
        description: parsedError?.error || error.message,
        variant: "destructive",
      });
    },
  });

  // Remove from seat mutation
  const removeSeatMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest('DELETE', `/api/seat-assignments/${assignmentId}`, {});
    },
    onSuccess: () => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
      broadcastSeatingChange();
      setSelectedContestants([]);
      toast({
        title: "Removed from seat",
        description: "Contestant has been removed and set back to available status.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove from seat",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete contestant mutation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteContestantMutation = useMutation({
    mutationFn: async (contestantId: string) => {
      return apiRequest('DELETE', `/api/contestants/${contestantId}`, {});
    },
    onSuccess: () => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/groups'], exact: false });
      broadcastContestantChange();
      setSelectedContestants([]);
      setDeleteConfirmOpen(false);
      toast({
        title: "Contestant deleted",
        description: "The contestant has been permanently removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete ALL contestants mutation (with double confirmation)
  const [deleteAllStep, setDeleteAllStep] = useState<0 | 1 | 2>(0); // 0=closed, 1=first confirm, 2=second confirm
  const deleteAllContestantsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', '/api/contestants/all', {});
    },
    onSuccess: (data: any) => {
      // Invalidate ALL related queries
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/groups'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/availability'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/booking-confirmations'], exact: false });
      broadcastContestantChange();
      setSelectedContestants([]);
      setDeleteAllStep(0);
      toast({
        title: "All contestants deleted",
        description: data.message || `Deleted ${data.deletedCount} contestants and all related data.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete all contestants",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Manual group linking mutation
  const linkContestantsMutation = useMutation({
    mutationFn: async (contestantIds: string[]) => {
      const res = await apiRequest('POST', '/api/groups/manual', { contestantIds });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/groups'], exact: false });
      broadcastContestantChange();
      setSelectedContestants([]);
      setLinkDialogOpen(false);
      toast({
        title: "Contestants linked",
        description: data.message || `Successfully linked ${data.contestants?.length || 0} contestants into a group.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to link contestants",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Unlink contestant from group mutation
  const unlinkContestantMutation = useMutation({
    mutationFn: async (contestantId: string) => {
      const res = await apiRequest('POST', `/api/contestants/${contestantId}/unlink-group`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/groups'], exact: false });
      broadcastContestantChange();
      setSelectedContestants([]);
      setUnlinkDialogOpen(false);
      toast({
        title: "Contestant unlinked",
        description: data.message || "Contestant has been removed from their group.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to unlink contestant",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createTestContestantMutation = useMutation({
    mutationFn: async (data: { name: string; gender: string; age?: number; phone?: string; email?: string }) => {
      const res = await apiRequest('POST', '/api/contestants/test-subject', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      broadcastContestantChange();
      setTestContestantDialogOpen(false);
      setTestContestantForm({ name: "", gender: "Female", age: "", phone: "", email: "" });
      toast({
        title: "Test contestant created",
        description: "The test contestant has been added and can be deleted from any page.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create test contestant",
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

  const handleAssignToSeat = async (skipPostcodeWarning = false) => {
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
          skipPostcodeWarning,
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
          skipPostcodeWarning,
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
      // Try to parse the error message as JSON (API errors come as "status: {json}")
      let parsedError: any = null;
      try {
        const errorMsg = error?.message || '';
        const jsonMatch = errorMsg.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          parsedError = JSON.parse(jsonMatch[1]);
        }
      } catch (e) {
        // Not JSON, continue with regular error handling
      }
      
      // Check if this is an OUTSIDE_VICTORIA warning that requires confirmation
      if (parsedError?.code === 'OUTSIDE_VICTORIA' && parsedError?.requiresConfirmation) {
        const confirmed = window.confirm(
          `⚠️ INTERSTATE CONTESTANT\n\n${parsedError.contestantName} is from ${parsedError.state || 'outside Victoria'}.\n\nDo you want to proceed with booking?`
        );
        if (confirmed) {
          // Retry with skip flag
          handleAssignToSeat(true);
        }
        return;
      }
      
      const errorMessage = parsedError?.error || error?.message || "Could not assign contestant(s).";
      toast({
        title: "Assignment failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => {
        setDeleteConfirmOpen(open);
        if (!open) setDeleteConfirmStep(1);
      }}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-500 flex-shrink-0" />
              <DialogTitle className="text-red-600 dark:text-red-500">
                {deleteConfirmStep === 1 ? "Delete Contestants" : "FINAL WARNING"}
              </DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              {deleteConfirmStep === 1 ? (
                <>
                  You are about to delete <strong>{selectedContestants.length} contestant{selectedContestants.length !== 1 ? 's' : ''}</strong>. 
                  This will remove all their data including availability responses, booking confirmations, and seat assignments.
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-800 rounded-md">
                    <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-500 flex-shrink-0" />
                    <span className="font-semibold text-red-700 dark:text-red-400">
                      This action is PERMANENT and CANNOT be undone!
                    </span>
                  </div>
                  <p>
                    Are you absolutely sure you want to permanently delete <strong>{selectedContestants.length} contestant{selectedContestants.length !== 1 ? 's' : ''}</strong>?
                  </p>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setDeleteConfirmOpen(false);
              setDeleteConfirmStep(1);
            }}>Cancel</Button>
            {deleteConfirmStep === 1 ? (
              <Button 
                variant="destructive" 
                onClick={() => setDeleteConfirmStep(2)}
              >
                Continue to Delete
              </Button>
            ) : (
              <Button 
                variant="destructive" 
                onClick={() => {
                  selectedContestants.forEach(id => {
                    deleteContestantMutation.mutate(id);
                  });
                }}
                disabled={deleteContestantMutation.isPending}
              >
                {deleteContestantMutation.isPending ? "Deleting..." : "Yes, Delete Permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Contestants</h1>
              <p className="text-muted-foreground">
                Manage auditioned applicants and their availability
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                refetchContestants();
                queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
                queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
                queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'] });
                toast({ title: "Refreshed", description: "Contestant data has been refreshed" });
              }}
              title="Refresh contestant data"
              data-testid="button-refresh-contestants"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {/* Booking action buttons - grouped together */}
          <div className="flex gap-2">
            {selectedContestants.length > 0 && (
              <>
                {selectedContestantAssignment ? (
                  <Button 
                    variant="destructive"
                    onClick={() => setRemoveSeatDialogOpen(true)}
                    disabled={removeSeatMutation.isPending || isSelectedAssignmentOnLockedDay}
                    title={isSelectedAssignmentOnLockedDay ? "Cannot remove - day is locked" : undefined}
                    data-testid="button-remove-from-seat"
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    {removeSeatMutation.isPending ? "Removing..." : isSelectedAssignmentOnLockedDay ? "Day Locked" : "Remove from Seat"}
                  </Button>
                ) : (
                  <>
                    <Button 
                      className="bg-amber-400/80 hover:bg-amber-500/80 text-amber-950"
                      onClick={() => {
                        refetchRecordDays();
                        setStandbyDialogOpen(true);
                      }} 
                      data-testid="button-add-standbys"
                    >
                      <UserCheck className="h-4 w-4 mr-2" />
                      Book {selectedContestants.length} as Standby
                    </Button>
                    {showBookWithGroupButton && (
                      <Button 
                        className="bg-slate-200/80 hover:bg-slate-300/80 text-slate-900"
                        onClick={() => {
                          // Show group preview dialog
                          setGroupPreviewMembers(selectedContestantGroupMembers);
                          setGroupPreviewOpen(true);
                        }} 
                        data-testid="button-book-with-group"
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Book with Group ({selectedContestantGroupMembers.length})
                      </Button>
                    )}
                    <Button 
                      onClick={handleOpenAssignDialog} 
                      data-testid="button-assign-contestants"
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Assign {selectedContestants.length} to Record Day
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {/* Import/Export buttons - always visible */}
        <div className="flex gap-2 justify-end flex-wrap">
          <ImportExcelDialog onImport={(file) => importMutation.mutate(file)} />
          <ImportExcelDialog
            onImport={(file) => importSurveyMutation.mutate(file)}
            previewEndpoint="/api/contestants/import-survey-preview"
            triggerLabel="Import Survey"
            dialogTitle="Import Survey Responses"
            dialogDescription="Upload a Microsoft Forms survey Excel export. All imported contestants will be rated R."
            data-testid="button-import-survey"
          />
          <Button 
            variant="outline"
            onClick={handleExportToExcel}
            disabled={displayedContestants.length === 0}
            data-testid="button-export-contestants"
          >
            <Download className="h-4 w-4 mr-2" />
            Export ({displayedContestants.length})
          </Button>
          <ImportGalleryDialog />
          <Button 
            variant="outline"
            className="border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
            onClick={() => setTestContestantDialogOpen(true)}
            data-testid="button-create-test-contestant"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Test Contestant
          </Button>
          <Button 
            variant="outline"
            className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            onClick={() => setDeleteAllStep(1)}
            data-testid="button-delete-all-contestants"
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            Delete All
          </Button>
          {selectedContestants.length > 0 && (
            <Button 
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                setDeleteConfirmStep(1);
                setDeleteConfirmOpen(true);
              }}
              data-testid="button-mass-delete"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete {selectedContestants.length}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Controls */}
      <div className="space-y-4">
        {/* Basic Filters Row - Always visible */}
        <div className="flex gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <label className="text-sm font-medium mb-2 block">
              <Filter className="w-3 h-3 inline mr-1" />
              Status
            </label>
            <Select value={filterStatus} onValueChange={(value) => {
              setSelectedContestants([]);
              setFilterStatus(value);
            }}>
              <SelectTrigger data-testid="select-filter-status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="rescheduled">Reschedule</SelectItem>
                <SelectItem value="returning_standby">Returning Standby</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <label className="text-sm font-medium mb-2 block">Rating</label>
            <Select 
              value={filterRating} 
              onValueChange={(value) => {
                setSelectedContestants([]);
                setFilterRating(value);
              }}
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
                <SelectItem value="R">R</SelectItem>
                <SelectItem value="DNU">DNU (Do Not Use)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[180px]">
            <label className="text-sm font-medium mb-2 block">Group Size</label>
            <Select value={filterGroupSize} onValueChange={(value) => {
              setSelectedContestants([]);
              setFilterGroupSize(value);
            }}>
              <SelectTrigger data-testid="select-filter-group-size">
                <SelectValue placeholder="All Groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                <SelectItem value="1">Solo (1)</SelectItem>
                <SelectItem value="2">Pair (2)</SelectItem>
                <SelectItem value="3+">3+ Group</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button 
            variant={showAdvancedSearch ? "secondary" : "outline"}
            onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
            data-testid="button-advanced-search"
          >
            <Filter className="h-4 w-4 mr-2" />
            {showAdvancedSearch ? "Hide Advanced" : "Advanced Search"}
          </Button>

          {(filterStatus !== "all" || filterGender !== "all" || filterRating !== "all" || 
            filterLocation !== "all" || filterRecordDayId || filterStandbyStatus !== "all" || 
            filterGroupSize !== "all" || filterState !== "all" || postcodeFrom || postcodeTo || filterPodiumStory || filterWithin60km || filterWithin20km || filterOver60km || filterAllGroupAvailable) && (
            <Button 
              variant="outline" 
              onClick={() => {
                setFilterStatus("all");
                setFilterGender("all");
                setFilterRating("all");
                setFilterLocation("all");
                setFilterState("all");
                setFilterRecordDayId("");
                setFilterResponseValue("all");
                setFilterStandbyStatus("all");
                setPostcodeFrom("");
                setPostcodeTo("");
                setFilterGroupSize("all");
                setFilterPodiumStory(false);
                setFilterWithin60km(false);
                setFilterWithin20km(false);
                setFilterOver60km(false);
                setFilterAllGroupAvailable(false);
              }}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          )}
        </div>

        {/* Advanced Filters - Collapsible */}
        {showAdvancedSearch && (
          <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 min-w-[150px] max-w-[180px]">
                <label className="text-sm font-medium mb-2 block">Gender</label>
                <Select value={filterGender} onValueChange={(value) => {
                  setSelectedContestants([]);
                  setFilterGender(value);
                }}>
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

              <div className="flex-1 min-w-[150px] max-w-[180px]">
                <label className="text-sm font-medium mb-2 block">State</label>
                <Select value={filterState} onValueChange={(value) => {
                  setSelectedContestants([]);
                  setFilterState(value);
                }}>
                  <SelectTrigger data-testid="select-filter-state">
                    <SelectValue placeholder="All states" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All states</SelectItem>
                    {australianStates.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[150px] max-w-[180px]">
                <label className="text-sm font-medium mb-2 block">City</label>
                <Select 
                  value={filterLocation} 
                  onValueChange={(value) => {
                    setSelectedContestants([]);
                    setFilterLocation(value);
                  }}
                  disabled={uniqueCities.length === 0}
                >
                  <SelectTrigger data-testid="select-filter-location">
                    <SelectValue placeholder={uniqueCities.length === 0 ? "No cities" : "All cities"} />
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

              <div className="flex-1 min-w-[150px] max-w-[180px]">
                <label className="text-sm font-medium mb-2 block">Standby</label>
                <Select value={filterStandbyStatus} onValueChange={(value) => {
                  setSelectedContestants([]);
                  setFilterStandbyStatus(value);
                }}>
                  <SelectTrigger data-testid="select-filter-standby">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="available_for_standby">Available for Standby</SelectItem>
                    <SelectItem value="booked_standby">Booked as Standby</SelectItem>
                    <SelectItem value="not_standby">Not Standby</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 min-w-[150px] max-w-[180px]">
                <label className="text-sm font-medium mb-2 block">Availability</label>
                <Select value={filterRecordDayId || "na"} onValueChange={(value) => {
                  setSelectedContestants([]);
                  setFilterRecordDayId(value === "na" ? "" : value);
                  setFilterResponseValue(value === "na" ? "all" : "yes");
                }}>
                  <SelectTrigger data-testid="select-filter-availability">
                    <SelectValue placeholder="N/A" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="na">N/A</SelectItem>
                    {recordDays.map((day: any) => (
                      <SelectItem key={day.id} value={day.id}>
                        {new Date(day.date).toLocaleDateString('en-AU', { 
                          weekday: 'short', 
                          day: 'numeric', 
                          month: 'short' 
                        })}
                        {day.rxNumber ? ` (${day.rxNumber})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {filterRecordDayId && (
                <div className="flex-1 min-w-[150px] max-w-[180px]">
                  <label className="text-sm font-medium mb-2 block">Response</label>
                  <Select value={filterResponseValue} onValueChange={(value) => {
                    setSelectedContestants([]);
                    setFilterResponseValue(value);
                  }}>
                    <SelectTrigger data-testid="select-filter-response">
                      <SelectValue placeholder="Available" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Available</SelectItem>
                      <SelectItem value="no">Not Available</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="all">All responses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex-1 min-w-[200px] max-w-xs">
                <label className="text-sm font-medium mb-2 block">Postcode Range</label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="text"
                    placeholder="From"
                    value={postcodeFrom}
                    onChange={(e) => {
                      setSelectedContestants([]);
                      setPostcodeFrom(e.target.value.replace(/\D/g, '').slice(0, 4));
                    }}
                    className="w-20"
                    data-testid="input-postcode-from"
                  />
                  <span className="text-muted-foreground">-</span>
                  <Input
                    type="text"
                    placeholder="To"
                    value={postcodeTo}
                    onChange={(e) => {
                      setSelectedContestants([]);
                      setPostcodeTo(e.target.value.replace(/\D/g, '').slice(0, 4));
                    }}
                    className="w-20"
                    data-testid="input-postcode-to"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-6">
                <Checkbox
                  id="filter-podium-story"
                  checked={filterPodiumStory}
                  onCheckedChange={(checked) => {
                    setSelectedContestants([]);
                    setFilterPodiumStory(checked as boolean);
                  }}
                  data-testid="checkbox-filter-podium-story"
                />
                <label 
                  htmlFor="filter-podium-story"
                  className="text-sm font-medium cursor-pointer"
                >
                  Podium Story
                </label>
              </div>

              <div className="flex items-center gap-4 mt-6">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="filter-within-20km"
                    checked={filterWithin20km}
                    onCheckedChange={(checked) => {
                      setSelectedContestants([]);
                      setFilterWithin20km(checked as boolean);
                    }}
                    data-testid="checkbox-filter-within-20km"
                  />
                  <label 
                    htmlFor="filter-within-20km"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Within 20km
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="filter-within-60km"
                    checked={filterWithin60km}
                    onCheckedChange={(checked) => {
                      setSelectedContestants([]);
                      setFilterWithin60km(checked as boolean);
                    }}
                    data-testid="checkbox-filter-within-60km"
                  />
                  <label 
                    htmlFor="filter-within-60km"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Within 60km
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="filter-over-60km"
                    checked={filterOver60km}
                    onCheckedChange={(checked) => {
                      setSelectedContestants([]);
                      setFilterOver60km(checked as boolean);
                    }}
                    data-testid="checkbox-filter-over-60km"
                  />
                  <label 
                    htmlFor="filter-over-60km"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Over 60km
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="filter-all-group-available"
                    checked={filterAllGroupAvailable}
                    onCheckedChange={(checked) => {
                      setSelectedContestants([]);
                      setFilterAllGroupAvailable(checked as boolean);
                    }}
                    data-testid="checkbox-filter-all-group-available"
                  />
                  <label 
                    htmlFor="filter-all-group-available"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Full group available
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Summary */}
      {(filterStatus !== "all" || filterGender !== "all" || filterRating !== "all" || 
        filterLocation !== "all" || filterRecordDayId || filterStandbyStatus !== "all" || 
        filterGroupSize !== "all" || filterState !== "all" || postcodeFrom || postcodeTo || filterPodiumStory || filterWithin60km || filterWithin20km || filterOver60km || filterAllGroupAvailable) && (
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
            <Badge variant="outline">City: {filterLocation}</Badge>
          )}
          {filterState !== "all" && (
            <Badge variant="outline">State: {filterState}</Badge>
          )}
          {filterRecordDayId && (
            <Badge variant="outline">
              Availability: {new Date(recordDays.find((d: any) => d.id === filterRecordDayId)?.date).toLocaleDateString()} ({filterResponseValue === "all" ? "all" : filterResponseValue === "yes" ? "available" : filterResponseValue === "no" ? "not available" : "pending"})
            </Badge>
          )}
          {filterStandbyStatus !== "all" && (
            <Badge variant="outline">
              Standby: {filterStandbyStatus === "is_standby" ? "Yes" : "No"}
            </Badge>
          )}
          {filterGroupSize !== "all" && (
            <Badge variant="outline">
              Group: {filterGroupSize === "1" ? "Solo" : filterGroupSize === "2" ? "Pair" : "3+"}
            </Badge>
          )}
          {(postcodeFrom || postcodeTo) && (
            <Badge variant="outline">
              Postcode: {postcodeFrom || '0'}-{postcodeTo || '9999'}
            </Badge>
          )}
          {filterPodiumStory && (
            <Badge variant="outline">
              Podium Story: Yes
            </Badge>
          )}
          {filterWithin20km && (
            <Badge variant="outline">
              Within 20km of Docklands
            </Badge>
          )}
          {filterWithin60km && (
            <Badge variant="outline">
              Within 60km of Docklands
            </Badge>
          )}
          {filterOver60km && (
            <Badge variant="outline">
              Over 60km from Docklands
            </Badge>
          )}
          {filterAllGroupAvailable && (
            <Badge variant="outline">
              Full group available
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
          {/* Top Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, displayedContestants.length)} of {displayedContestants.length} contestants
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  data-testid="button-prev-page-top"
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
                          data-testid={`button-page-top-${page}`}
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
                  data-testid="button-next-page-top"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
          
          <ContestantTable 
            contestants={paginatedContestants}
            selectedIds={selectedContestants}
            onSelectionChange={setSelectedContestants}
            seatAssignments={allSeatAssignments}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            rescheduleContestantIds={rescheduleContestantIds}
            standbyContestantIds={standbyContestantIds}
            paperworkStatusMap={paperworkStatusMap}
            allContestants={contestants}
            onBookWithGroup={(contestantIds) => {
              // Reset assign dialog state before opening for group booking
              setSelectedRecordDay("");
              setSelectedBlock("");
              setSelectedSeat("");
              setSelectedContestants(contestantIds);
              handleOpenAssignDialog();
            }}
            onDeleteContestant={(contestantId) => {
              deleteContestantMutation.mutate(contestantId);
            }}
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

      {/* Group Preview Dialog */}
      <Dialog open={groupPreviewOpen} onOpenChange={setGroupPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Book Group Together
            </DialogTitle>
            <DialogDescription>
              Review group members before booking them to a record day
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              The following {groupPreviewMembers.length} contestants will be booked together:
            </div>
            
            <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {groupPreviewMembers.map((member) => (
                <div 
                  key={member.id} 
                  className="flex items-center gap-3 p-3"
                  data-testid={`group-member-${member.id}`}
                >
                  <Avatar className="h-10 w-10">
                    {member.photoUrl ? (
                      <AvatarImage src={member.photoUrl} alt={member.name} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="text-xs">
                      {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{member.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{member.gender}</span>
                      <span>•</span>
                      <span>{member.age} yrs</span>
                      {member.auditionRating && (
                        <>
                          <span>•</span>
                          <span className="font-medium">{member.auditionRating}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={member.availabilityStatus} />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setGroupPreviewOpen(false)}
              data-testid="button-cancel-group-booking"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                const groupMemberIds = groupPreviewMembers.map(c => c.id);
                setSelectedRecordDay("");
                setSelectedBlock("");
                setSelectedSeat("");
                setSelectedContestants(groupMemberIds);
                setGroupPreviewOpen(false);
                handleOpenAssignDialog();
              }}
              className="gap-1"
              data-testid="button-confirm-group-booking"
            >
              <Users className="h-4 w-4" />
              Proceed to Book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  {format(parseISO(selectedRecordDayDetails.date.split('T')[0]), 'd MMMM yyyy')}
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
              onClick={() => handleAssignToSeat()} 
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
        <DialogContent className="max-w-lg" data-testid="dialog-add-standby">
          <DialogHeader>
            <DialogTitle>Book as Standby</DialogTitle>
            <DialogDescription>
              Book contestants as standby for a record day.
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
                      {format(parseISO(rd.date), 'EEE, d MMM yyyy')}
                      {rd.rxNumber && ` (${rd.rxNumber})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Include group members toggle */}
            {standbyContestantsWithGroups.length > selectedContestants.length && (
              <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium">Include group members</span>
                </div>
                <Switch 
                  checked={standbyIncludeGroups} 
                  onCheckedChange={setStandbyIncludeGroups}
                  data-testid="switch-include-groups"
                />
              </div>
            )}

            {/* List of contestants to book */}
            <div>
              <label className="text-sm font-medium mb-2 block">
                Contestants to book ({standbyContestantsWithGroups.length})
              </label>
              <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                {standbyContestantsWithGroups.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {!selectedContestants.includes(c.id) && (
                        <span className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                          group member
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {c.gender}, {c.age}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStandbyDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-amber-400/80 hover:bg-amber-500/80 text-amber-950"
              onClick={() => {
                if (selectedRecordDay && standbyContestantsWithGroups.length > 0) {
                  addStandbyMutation.mutate({
                    contestantIds: standbyContestantsWithGroups.map(c => c.id),
                    recordDayId: selectedRecordDay,
                  });
                }
              }}
              disabled={!selectedRecordDay || addStandbyMutation.isPending}
              data-testid="button-confirm-add-standby"
            >
              {addStandbyMutation.isPending ? "Booking..." : `Book ${standbyContestantsWithGroups.length} as Standby`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sticky Floating Action Bar - appears when contestants are selected */}
      {selectedContestants.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t shadow-lg z-50 py-3 px-4" data-testid="floating-action-bar">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="bg-primary text-primary-foreground px-2 py-1 rounded-md">
                {selectedContestants.length}
              </span>
              <span className="text-muted-foreground">
                contestant{selectedContestants.length !== 1 ? 's' : ''} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedContestants([])}
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-clear-selection"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {selectedContestantAssignment ? (
                <Button 
                  variant="destructive"
                  onClick={() => setRemoveSeatDialogOpen(true)}
                  disabled={removeSeatMutation.isPending || isSelectedAssignmentOnLockedDay}
                  title={isSelectedAssignmentOnLockedDay ? "Cannot remove - day is locked" : undefined}
                  data-testid="floating-button-remove-from-seat"
                >
                  <UserMinus className="h-4 w-4 mr-2" />
                  {removeSeatMutation.isPending ? "Removing..." : isSelectedAssignmentOnLockedDay ? "Day Locked" : "Remove from Seat"}
                </Button>
              ) : (
                <>
                  <Button 
                    className="bg-amber-400/80 hover:bg-amber-500/80 text-amber-950"
                    onClick={() => {
                      refetchRecordDays();
                      setStandbyDialogOpen(true);
                    }} 
                    data-testid="floating-button-add-standbys"
                  >
                    <UserCheck className="h-4 w-4 mr-2" />
                    Book as Standby
                  </Button>
                  {canLinkSelected && (
                    <Button 
                      variant="outline"
                      className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950"
                      onClick={() => setLinkDialogOpen(true)}
                      data-testid="floating-button-link-contestants"
                      title={appearRelatedViaAttendingWith ? "These contestants appear related but aren't formally linked in the database" : "Create a formal database link between these contestants"}
                    >
                      <Link className="h-4 w-4 mr-2" />
                      {appearRelatedViaAttendingWith ? "Formally Link" : "Link Together"}
                    </Button>
                  )}
                  {anySelectedHasSeatAssignment && selectedContestants.length >= 2 && 
                    selectedContestantsForLinking.every(c => !c.groupId) && !allInSameGroup && (
                    <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300 px-3 py-1" title="Use right-click on the seating chart to link seated contestants">
                      <Link className="h-4 w-4 mr-2" />
                      Use Seating Chart to Link
                    </Badge>
                  )}
                  {allInSameGroup && selectedContestants.length >= 2 && (
                    <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-300 px-3 py-1">
                      <Users className="h-4 w-4 mr-2" />
                      Already Linked
                    </Badge>
                  )}
                  {canUnlinkSelected && (
                    <Button 
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950"
                      onClick={() => setUnlinkDialogOpen(true)}
                      data-testid="floating-button-unlink-contestant"
                    >
                      <Unlink className="h-4 w-4 mr-2" />
                      Unlink from Group
                    </Button>
                  )}
                  {showBookWithGroupButton && (
                    <Button 
                      className="bg-slate-200/80 hover:bg-slate-300/80 text-slate-900"
                      onClick={() => {
                        setGroupPreviewMembers(selectedContestantGroupMembers);
                        setGroupPreviewOpen(true);
                      }} 
                      data-testid="floating-button-book-with-group"
                    >
                      <Users className="h-4 w-4 mr-2" />
                      Book with Group ({selectedContestantGroupMembers.length})
                    </Button>
                  )}
                  <Button 
                    onClick={handleOpenAssignDialog} 
                    data-testid="floating-button-assign-contestants"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Assign to Record Day
                  </Button>
                </>
              )}
              <Button 
                variant="destructive"
                className="bg-red-600 hover:bg-red-700"
                onClick={() => {
                  setDeleteConfirmStep(1);
                  setDeleteConfirmOpen(true);
                }}
                data-testid="floating-button-mass-delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete ALL Contestants - First Confirmation Dialog */}
      <Dialog open={deleteAllStep === 1} onOpenChange={(open) => !open && setDeleteAllStep(0)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Delete All Contestants?
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>You are about to delete <strong className="text-foreground">{contestants.length} contestants</strong> and all their related data:</p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>All seat assignments</li>
                <li>All standby bookings</li>
                <li>All availability responses</li>
                <li>All booking confirmations</li>
                <li>All groups</li>
              </ul>
              <p className="font-medium text-red-600 pt-2">This action cannot be undone.</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteAllStep(0)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => setDeleteAllStep(2)}
              data-testid="button-delete-all-first-confirm"
            >
              Yes, Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete ALL Contestants - Second (Final) Confirmation Dialog */}
      <Dialog open={deleteAllStep === 2} onOpenChange={(open) => !open && setDeleteAllStep(0)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Final Confirmation Required
            </DialogTitle>
            <DialogDescription className="space-y-3">
              <p className="text-base font-medium text-foreground">
                Are you absolutely sure you want to permanently delete all {contestants.length} contestants?
              </p>
              <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-800 dark:text-red-300">
                <p className="font-semibold">This is your final warning!</p>
                <p>All contestant data will be permanently removed from the system.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteAllStep(0)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteAllContestantsMutation.mutate()}
              disabled={deleteAllContestantsMutation.isPending}
              data-testid="button-delete-all-final-confirm"
            >
              {deleteAllContestantsMutation.isPending ? "Deleting..." : "Delete Everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Link Contestants Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
              <Link className="h-5 w-5" />
              Link Contestants Together
            </DialogTitle>
            <DialogDescription>
              You are about to manually link these <strong className="text-foreground">{selectedContestants.length} contestants</strong> into a group:
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2 py-2">
            {selectedContestantsForLinking.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                <Avatar className="h-8 w-8">
                  {c.photoUrl && <AvatarImage src={c.photoUrl} alt={c.name} />}
                  <AvatarFallback>{c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.gender}, {c.age}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Once linked, these contestants will be treated as a group and can be booked together.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => linkContestantsMutation.mutate(selectedContestants)}
              disabled={linkContestantsMutation.isPending}
              data-testid="button-confirm-link"
            >
              {linkContestantsMutation.isPending ? "Linking..." : "Link Contestants"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink Contestant Dialog */}
      <Dialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <Unlink className="h-5 w-5" />
              Unlink Contestant from Group
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                {selectedContestantsForLinking[0] && (
                  <span>Remove <strong className="text-foreground">{selectedContestantsForLinking[0].name}</strong> from their group?</span>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          {selectedContestantGroupForUnlink.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Current group members:</p>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {selectedContestantGroupForUnlink.map(c => (
                  <div 
                    key={c.id} 
                    className={`flex items-center gap-3 p-2 rounded-md ${c.id === selectedContestants[0] ? 'bg-orange-100 dark:bg-orange-950 border border-orange-300 dark:border-orange-700' : 'bg-muted/50'}`}
                  >
                    <Avatar className="h-8 w-8">
                      {c.photoUrl && <AvatarImage src={c.photoUrl} alt={c.name} />}
                      <AvatarFallback>{c.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.gender}, {c.age}</p>
                    </div>
                    {c.id === selectedContestants[0] && (
                      <Badge variant="outline" className="border-orange-400 text-orange-700 dark:text-orange-400">
                        Will be unlinked
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              {selectedContestantGroupForUnlink.length === 2 && (
                <p className="text-sm text-muted-foreground italic">
                  Note: The remaining member will also be unlinked since groups require at least 2 members.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUnlinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => {
                if (selectedContestants[0]) {
                  unlinkContestantMutation.mutate(selectedContestants[0]);
                }
              }}
              disabled={unlinkContestantMutation.isPending}
              data-testid="button-confirm-unlink"
            >
              {unlinkContestantMutation.isPending ? "Unlinking..." : "Unlink Contestant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove from Seat Confirmation Dialog */}
      <Dialog open={removeSeatDialogOpen} onOpenChange={setRemoveSeatDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <UserMinus className="h-5 w-5" />
              Remove from Seat
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                {selectedContestantAssignment && (
                  <>
                    <p>
                      Are you sure you want to remove this contestant from their seat?
                    </p>
                    <div className="p-3 bg-muted rounded-md">
                      <p className="font-medium">
                        {contestants.find(c => c.id === selectedContestantAssignment.contestantId)?.name || 'Unknown'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Block {selectedContestantAssignment.blockNumber}, Seat {selectedContestantAssignment.seatLabel}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      They will be returned to the available contestant pool.
                    </p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveSeatDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => {
                if (selectedContestantAssignment) {
                  removeSeatMutation.mutate(selectedContestantAssignment.id);
                  setRemoveSeatDialogOpen(false);
                }
              }}
              disabled={removeSeatMutation.isPending}
              data-testid="button-confirm-remove-seat"
            >
              {removeSeatMutation.isPending ? "Removing..." : "Yes, Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Test Contestant Dialog */}
      <Dialog open={testContestantDialogOpen} onOpenChange={setTestContestantDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <UserPlus className="h-5 w-5" />
              Create Test Contestant
            </DialogTitle>
            <DialogDescription>
              Create a test contestant that can be deleted from any page in the system. Useful for testing workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <Input
                value={testContestantForm.name}
                onChange={(e) => setTestContestantForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Test Contestant Name"
                data-testid="input-test-contestant-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Gender *</label>
              <Select 
                value={testContestantForm.gender} 
                onValueChange={(v) => setTestContestantForm(prev => ({ ...prev, gender: v as "Male" | "Female" }))}
              >
                <SelectTrigger data-testid="select-test-contestant-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Male">Male</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Age</label>
              <Input
                type="number"
                value={testContestantForm.age}
                onChange={(e) => setTestContestantForm(prev => ({ ...prev, age: e.target.value }))}
                placeholder="30"
                data-testid="input-test-contestant-age"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input
                value={testContestantForm.phone}
                onChange={(e) => setTestContestantForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="0400 000 000"
                data-testid="input-test-contestant-phone"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={testContestantForm.email}
                onChange={(e) => setTestContestantForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="test@example.com"
                data-testid="input-test-contestant-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestContestantDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                if (!testContestantForm.name.trim()) {
                  toast({ title: "Name is required", variant: "destructive" });
                  return;
                }
                createTestContestantMutation.mutate({
                  name: testContestantForm.name.trim(),
                  gender: testContestantForm.gender,
                  age: testContestantForm.age ? parseInt(testContestantForm.age) : undefined,
                  phone: testContestantForm.phone.trim() || undefined,
                  email: testContestantForm.email.trim() || undefined,
                });
              }}
              disabled={createTestContestantMutation.isPending}
              data-testid="button-confirm-create-test-contestant"
            >
              {createTestContestantMutation.isPending ? "Creating..." : "Create Test Contestant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
