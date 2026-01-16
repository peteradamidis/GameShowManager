import { SeatingChart } from "@/components/seating-chart";
import { WinningMoneyModal } from "@/components/winning-money-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, RotateCcw, Lock, Unlock, AlertTriangle, Search, Users, Check, Eye, User, Mail, Phone, MapPin, ArrowLeftRight, Camera, UserPlus, Pencil, ClipboardCheck, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { SeatData } from "@/components/seat-card";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { broadcastSeatingChange, broadcastRecordDayChange } from "@/lib/crossTabSync";
import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { getGroupSizeFromAttendingWith, getPartnerNames, attendingWithMentionsName, isSoloContestant } from "@shared/attendingWithParser";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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
    // For blocks 4, 5, 6 (indices 3, 4, 5), seat numbering is reversed (1-5 from right to left)
    const reverseNumbering = blockIdx >= 3 && blockIdx <= 5;
    
    SEAT_ROWS.forEach(row => {
      for (let i = 1; i <= row.count; i++) {
        // For reversed blocks, seat 1 is on the right (visually last), seat 5 is on the left (visually first)
        const seatNumber = reverseNumbering ? (row.count - i + 1) : i;
        seats.push({
          id: `${recordDayId}-block${blockIdx}-${row.label}${seatNumber}`,
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
  const [contestantSearch, setContestantSearch] = useState<string>("");
  const [filterRating, setFilterRating] = useState<string>("all");
  const [filterGender, setFilterGender] = useState<string>("all");
  const [filterGroupSize, setFilterGroupSize] = useState<string>("all");
  const [filterAge, setFilterAge] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterStandby, setFilterStandby] = useState<string>("all");
  
  // Cancel dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelAssignmentId, setCancelAssignmentId] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelInitials, setCancelInitials] = useState<string>("");
  
  // Reset confirmation dialog state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmationStep, setResetConfirmationStep] = useState(0);
  const [selectedResetBlocks, setSelectedResetBlocks] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  
  // Auto-assign block selection dialog state
  const [autoAssignDialogOpen, setAutoAssignDialogOpen] = useState(false);
  const [selectedBlocks, setSelectedBlocks] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [onlyConfirmedAvailability, setOnlyConfirmedAvailability] = useState(false);
  
  // Group booking state
  const [seatGroupTogether, setSeatGroupTogether] = useState(false);
  
  // View contestant details state
  const [viewContestantId, setViewContestantId] = useState<string | null>(null);
  
  
  // RX Day Mode lock state
  const [lockConfirmDialogOpen, setLockConfirmDialogOpen] = useState(false);
  const [unlockConfirmDialogOpen, setUnlockConfirmDialogOpen] = useState(false);
  
  // Winning money modal state
  const [winningMoneyModalOpen, setWinningMoneyModalOpen] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");
  const [winningMoneyLoading, setWinningMoneyLoading] = useState(false);
  
  // Producer state
  const [selectedProducer, setSelectedProducer] = useState<string>("");
  const [producerUpdating, setProducerUpdating] = useState(false);
  
  // Swap blocks dialog state
  const [swapBlocksDialogOpen, setSwapBlocksDialogOpen] = useState(false);
  const [swapSourceBlock, setSwapSourceBlock] = useState<string>("");
  const [swapTargetBlock, setSwapTargetBlock] = useState<string>("");
  const [isSwappingBlocks, setIsSwappingBlocks] = useState(false);
  
  // Podium Visualiser mode - shows only contestant photos
  const [isPodiumVisualizerMode, setIsPodiumVisualizerMode] = useState(false);
  
  // Readiness tab state
  const [isReadinessMode, setIsReadinessMode] = useState(false);
  
  // Temporary contestant dialog state
  const [tempContestantDialogOpen, setTempContestantDialogOpen] = useState(false);
  const [tempContestantName, setTempContestantName] = useState("");
  const [tempContestantGender, setTempContestantGender] = useState<string>("");
  const [tempContestantAge, setTempContestantAge] = useState("");
  const [tempContestantPhone, setTempContestantPhone] = useState("");
  const [tempContestantEmail, setTempContestantEmail] = useState("");
  const [tempContestantNotes, setTempContestantNotes] = useState("");
  const [isCreatingTempContestant, setIsCreatingTempContestant] = useState(false);
  
  // Edit temporary contestant dialog state
  const [editTempContestantDialogOpen, setEditTempContestantDialogOpen] = useState(false);
  const [editingContestantId, setEditingContestantId] = useState<string | null>(null);
  const [editTempName, setEditTempName] = useState("");
  const [editTempGender, setEditTempGender] = useState<string>("");
  const [editTempAge, setEditTempAge] = useState("");
  const [editTempPhone, setEditTempPhone] = useState("");
  const [editTempEmail, setEditTempEmail] = useState("");
  const [editTempNotes, setEditTempNotes] = useState("");
  const [isUpdatingTempContestant, setIsUpdatingTempContestant] = useState(false);
  
  // Get record day ID from query parameter, localStorage, or fetch first available
  const searchParams = new URLSearchParams(window.location.search);
  const urlRecordDayId = searchParams.get('day');
  
  // State for the selected record day (persisted in localStorage)
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string | null>(() => {
    // First check URL, then localStorage, will fall back to first record day after query loads
    if (urlRecordDayId) return urlRecordDayId;
    const stored = localStorage.getItem('seating-chart-selected-day');
    return stored || null;
  });

  // Fetch all record days
  const { data: recordDays, isLoading: recordDaysLoading } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  // Use selected ID or first available record day (and save to localStorage)
  const recordDayId = useMemo(() => {
    // Priority: URL param > selected state > first available
    if (urlRecordDayId) return urlRecordDayId;
    if (selectedRecordDayId && recordDays?.some((rd: any) => rd.id === selectedRecordDayId)) {
      return selectedRecordDayId;
    }
    return recordDays?.[0]?.id || null;
  }, [urlRecordDayId, selectedRecordDayId, recordDays]);
  
  // Persist selected record day to localStorage when it changes
  useEffect(() => {
    if (recordDayId) {
      localStorage.setItem('seating-chart-selected-day', recordDayId);
      setSelectedRecordDayId(recordDayId);
    }
  }, [recordDayId]);

  // Find the current record day from the list
  const currentRecordDay = useMemo(() => {
    if (!recordDays || !recordDayId) return null;
    return recordDays.find((rd: any) => rd.id === recordDayId);
  }, [recordDays, recordDayId]);

  // Sync producer state with current record day
  useEffect(() => {
    if (currentRecordDay && !selectedProducer) {
      setSelectedProducer(currentRecordDay.producer || "");
    }
  }, [currentRecordDay?.id]);

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

  // Fetch standbys for this record day
  const { data: standbys = [], refetch: refetchStandbys } = useQuery({
    queryKey: ['/api/standbys/record-day', recordDayId],
    queryFn: async () => {
      if (!recordDayId) return [];
      const response = await fetch(`/api/standbys/record-day/${recordDayId}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!recordDayId,
  });

  // Derive available contestants from assignments and all contestants
  // This eliminates staleness issues since it's computed from latest data
  const availableContestants = useMemo(() => {
    if (!assignments || !allContestants || !Array.isArray(allContestants)) return [];
    const seatedIds = new Set(assignments.map((a: any) => a.contestantId));
    return allContestants.filter((c: any) => 
      !seatedIds.has(c.id) && 
      c.auditionRating?.toUpperCase().trim() !== 'DNU' // Exclude DNU-rated contestants
    );
  }, [assignments, allContestants]);

  // Helper to calculate group size from attendingWith field
  // Uses shared parser for consistent behavior across the system
  const getGroupSize = (attendingWith: string | null | undefined): number => {
    return getGroupSizeFromAttendingWith(attendingWith);
  };
  
  // Helper to find group members for a selected contestant
  // Uses shared parser for consistent partner name extraction
  const getGroupMembers = (contestantId: string): any[] => {
    const contestant = availableContestants.find((c: any) => c.id === contestantId);
    if (!contestant) return [];
    
    // Check if this is a solo contestant
    if (isSoloContestant(contestant.attendingWith)) {
      return [contestant];
    }
    
    // Get partner names using shared parser
    const partnerNamesList = getPartnerNames(contestant.attendingWith);
    if (partnerNamesList.length === 0) {
      return [contestant];
    }
    
    // Find matching available contestants using shared matching logic
    const partners = availableContestants.filter((c: any) => 
      c.id !== contestantId && attendingWithMentionsName(contestant.attendingWith, c.name)
    );
    
    return [contestant, ...partners];
  };
  
  // Helper to get adjacent empty seats in the same row starting from selected seat
  const getAdjacentEmptySeats = (blockNumber: number, seatLabel: string, neededCount: number): string[] => {
    const blockIdx = blockNumber - 1;
    if (!seats[blockIdx]) return [];
    
    const row = seatLabel.charAt(0);
    const seatNum = parseInt(seatLabel.substring(1));
    
    // Get all seats in this row
    const rowSeats = seats[blockIdx].filter((s: SeatData) => {
      const label = s.id.split('-').pop() || '';
      return label.charAt(0) === row;
    });
    
    // Find consecutive empty seats starting from selected seat
    const emptySeats: string[] = [seatLabel]; // Start with selected seat
    
    // Look right (higher numbers)
    for (let i = seatNum + 1; emptySeats.length < neededCount; i++) {
      const nextSeat = rowSeats.find((s: SeatData) => {
        const label = s.id.split('-').pop() || '';
        return label === `${row}${i}` && !s.contestantName;
      });
      if (!nextSeat) break;
      emptySeats.push(`${row}${i}`);
    }
    
    // If still need more, look left (lower numbers)
    for (let i = seatNum - 1; emptySeats.length < neededCount && i >= 1; i--) {
      const prevSeat = rowSeats.find((s: SeatData) => {
        const label = s.id.split('-').pop() || '';
        return label === `${row}${i}` && !s.contestantName;
      });
      if (!prevSeat) break;
      emptySeats.unshift(`${row}${i}`);
    }
    
    return emptySeats;
  };

  // Filter available contestants by search term and filters
  const filteredContestants = useMemo(() => {
    return availableContestants.filter((c: any) => {
      // Name search filter
      if (contestantSearch.trim()) {
        const searchLower = contestantSearch.toLowerCase();
        const matchesSearch = 
          c.name?.toLowerCase().includes(searchLower) ||
          c.attendingWith?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }
      
      // Rating filter
      if (filterRating !== "all" && c.auditionRating !== filterRating) {
        return false;
      }
      
      // Gender filter
      if (filterGender !== "all" && c.gender !== filterGender) {
        return false;
      }
      
      // Group size filter
      if (filterGroupSize !== "all") {
        const groupSize = getGroupSize(c.attendingWith);
        if (filterGroupSize === "1" && groupSize !== 1) return false;
        if (filterGroupSize === "2" && groupSize !== 2) return false;
        if (filterGroupSize === "3+" && groupSize < 3) return false;
      }
      
      // Age filter
      if (filterAge !== "all" && c.age) {
        const age = parseInt(c.age);
        if (!isNaN(age)) {
          if (filterAge === "18-29" && (age < 18 || age > 29)) return false;
          if (filterAge === "30-39" && (age < 30 || age > 39)) return false;
          if (filterAge === "40-49" && (age < 40 || age > 49)) return false;
          if (filterAge === "50-59" && (age < 50 || age > 59)) return false;
          if (filterAge === "60+" && age < 60) return false;
        }
      }
      
      // Status filter
      if (filterStatus !== "all" && c.availabilityStatus !== filterStatus) {
        return false;
      }
      
      // Standby filter (availableForStandby field)
      if (filterStandby !== "all") {
        if (filterStandby === "available" && !c.availableForStandby) return false;
        if (filterStandby === "not_available" && c.availableForStandby) return false;
      }
      
      return true;
    });
  }, [availableContestants, contestantSearch, filterRating, filterGender, filterGroupSize, filterAge, filterStatus, filterStandby]);

  // Check if record day is locked (RX Day Mode)
  const isLocked = currentRecordDay?.lockedAt != null;

  // Calculate block readiness data for the Readiness tab
  // Uses assignments directly instead of seats since seats is built after early returns
  const blockReadiness = useMemo(() => {
    if (!assignments || !Array.isArray(assignments)) return [];
    
    const TOTAL_SEATS_PER_BLOCK = 22; // 5+5+4+4+4 = 22 seats per block
    
    return Array(7).fill(null).map((_, blockIdx) => {
      const blockNumber = blockIdx + 1;
      const blockAssignments = assignments.filter((a: any) => a.blockNumber === blockNumber);
      const totalSeats = TOTAL_SEATS_PER_BLOCK;
      const filledSeats = blockAssignments.length;
      const confirmedSeats = blockAssignments.filter((a: any) => a.confirmedRsvp).length;
      const missingConfirmation = filledSeats - confirmedSeats;
      const hasIssues = blockAssignments.filter((a: any) => a.mobilityNotes).length;
      
      // Calculate readiness status
      let status: 'ready' | 'warning' | 'incomplete' = 'ready';
      if (filledSeats === 0) {
        status = 'incomplete';
      } else if (confirmedSeats < filledSeats) {
        status = 'warning';
      }
      
      const fillPercent = Math.round((filledSeats / totalSeats) * 100);
      const confirmPercent = filledSeats > 0 ? Math.round((confirmedSeats / filledSeats) * 100) : 0;
      
      return {
        blockNumber,
        totalSeats,
        filledSeats,
        confirmedSeats,
        missingConfirmation,
        hasIssues,
        fillPercent,
        confirmPercent,
        status,
        emptySeats: totalSeats - filledSeats,
      };
    });
  }, [assignments]);

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

  // Swap blocks mutation
  const swapBlocksMutation = useMutation({
    mutationFn: async ({ sourceBlock, targetBlock }: { sourceBlock: number; targetBlock: number }) => {
      return await apiRequest('POST', `/api/record-days/${recordDayId}/blocks/swap`, {
        sourceBlock,
        targetBlock,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      broadcastSeatingChange(recordDayId);
      setSwapBlocksDialogOpen(false);
      setSwapSourceBlock("");
      setSwapTargetBlock("");
      setIsSwappingBlocks(false);
      toast({
        title: "Blocks Swapped",
        description: data.message || "All contestants have been swapped between the selected blocks.",
      });
    },
    onError: (error: any) => {
      setIsSwappingBlocks(false);
      toast({
        title: "Swap failed",
        description: error?.message || "Could not swap blocks.",
        variant: "destructive",
      });
    },
  });

  // Producer update handler
  const handleProducerChange = async (newProducer: string) => {
    setSelectedProducer(newProducer);
    setProducerUpdating(true);
    try {
      await apiRequest('PATCH', `/api/record-days/${recordDayId}`, {
        producer: newProducer === "none" ? null : newProducer,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
    } catch (error: any) {
      toast({
        title: "Producer update failed",
        description: error?.message || "Could not update producer.",
        variant: "destructive",
      });
      // Revert on error
      setSelectedProducer(currentRecordDay?.producer || "none");
    } finally {
      setProducerUpdating(false);
    }
  };

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
            mobilityNotes: assignment.mobilityNotes,
            medicalInfo: assignment.medicalInfo,
            wasStandby: assignment.wasStandby,
            photoUrl: assignment.photoUrl,
            contestantLocation: assignment.contestantLocation,
            criminalRecord: assignment.criminalRecord,
            otdNotes: assignment.otdNotes,
            attendingWithOverride: assignment.attendingWithOverride,
          };
        }
      }
    });
  }
  
  // Detect separated groups - mark contestants whose partners are not in adjacent seats
  // Build a map of all assigned contestants for quick lookup
  const assignedContestants = new Map<string, { blockIdx: number; seatIdx: number; seatLabel: string }>();
  seats.forEach((block, blockIdx) => {
    block.forEach((seat, seatIdx) => {
      if (seat.contestantName) {
        // Extract seat label from id (format: recordDayId-blockX-seatLabel)
        const seatLabel = seat.id.split('-').pop() || '';
        assignedContestants.set(seat.contestantName.toLowerCase().trim(), { blockIdx, seatIdx, seatLabel });
      }
    });
  });
  
  // Helper to check if two seats are adjacent (same block, same row, consecutive numbers)
  const areSeatsAdjacent = (
    block1: number, label1: string, 
    block2: number, label2: string
  ): boolean => {
    if (block1 !== block2) return false;
    // Extract row letter and seat number
    const row1 = label1.charAt(0);
    const num1 = parseInt(label1.substring(1));
    const row2 = label2.charAt(0);
    const num2 = parseInt(label2.substring(1));
    // Adjacent if same row and consecutive numbers
    return row1 === row2 && Math.abs(num1 - num2) === 1;
  };
  
  // Mark separated contestants
  seats.forEach((block, blockIdx) => {
    block.forEach((seat, seatIdx) => {
      if (!seat.contestantName || !seat.attendingWith) return;
      
      const partnerName = seat.attendingWith.toLowerCase().trim();
      const partnerLocation = assignedContestants.get(partnerName);
      
      if (!partnerLocation) {
        // Partner not assigned at all - not separated (they're just not here)
        return;
      }
      
      const seatLabel = seat.id.split('-').pop() || '';
      const isAdjacent = areSeatsAdjacent(
        blockIdx, seatLabel,
        partnerLocation.blockIdx, partnerLocation.seatLabel
      );
      
      if (!isAdjacent) {
        seat.isGroupSeparated = true;
      }
    });
  });

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
    // First confirmation
    if (resetConfirmationStep === 0) {
      setResetConfirmationStep(1);
      return;
    }
    
    // Second confirmation - actually reset
    try {
      // Delete seat assignments only from selected blocks for this record day
      if (assignments && Array.isArray(assignments)) {
        const assignmentsToDelete = assignments.filter((a: any) =>
          selectedResetBlocks.includes(a.blockNumber)
        );
        await Promise.all(
          assignmentsToDelete.map((a: any) => 
            apiRequest('DELETE', `/api/seat-assignments/${a.id}`, {})
          )
        );
      }
      await refetch();
      setResetDialogOpen(false);
      setResetConfirmationStep(0);
      const blockText = selectedResetBlocks.length === 7 
        ? "All blocks"
        : `Block${selectedResetBlocks.length > 1 ? 's' : ''} ${selectedResetBlocks.join(', ')}`;
      toast({
        title: "Seating reset",
        description: `${blockText} have been cleared.`,
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: "Could not clear seat assignments.",
        variant: "destructive",
      });
    }
  };

  const handleResetDialogClose = () => {
    setResetDialogOpen(false);
    setResetConfirmationStep(0);
  };

  const handleSelectAllResetBlocks = () => {
    if (selectedResetBlocks.length === 7) {
      setSelectedResetBlocks([]);
    } else {
      setSelectedResetBlocks([1, 2, 3, 4, 5, 6, 7]);
    }
  };

  const handleResetBlockToggle = (blockNum: number) => {
    setSelectedResetBlocks(prev =>
      prev.includes(blockNum)
        ? prev.filter(b => b !== blockNum)
        : [...prev, blockNum].sort()
    );
  };

  // Handle swap blocks action
  const handleSwapBlocks = () => {
    if (!swapSourceBlock || !swapTargetBlock) {
      toast({
        title: "Select both blocks",
        description: "Please select both source and target blocks to swap.",
        variant: "destructive",
      });
      return;
    }
    
    const sourceNum = parseInt(swapSourceBlock);
    const targetNum = parseInt(swapTargetBlock);
    
    if (sourceNum === targetNum) {
      toast({
        title: "Same block selected",
        description: "Source and target blocks must be different.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSwappingBlocks(true);
    swapBlocksMutation.mutate({ sourceBlock: sourceNum, targetBlock: targetNum });
  };

  // Get block occupancy counts for swap dialog
  const getBlockOccupancy = (blockNum: number): number => {
    if (!seats || !seats[blockNum - 1]) return 0;
    return seats[blockNum - 1].filter((s: SeatData) => s.contestantName).length;
  };

  const handleEmptySeatClick = (blockNumber: number, seatLabel: string) => {
    setSelectedBlock(blockNumber);
    setSelectedSeat(seatLabel);
    setSelectedContestant("");
    setContestantSearch("");
    setFilterRating("all");
    setFilterGender("all");
    setFilterGroupSize("all");
    setSeatGroupTogether(false);
    setAssignDialogOpen(true);
  };
  
  // Compute group booking info when a contestant is selected
  const selectedContestantData = selectedContestant 
    ? availableContestants.find((c: any) => c.id === selectedContestant) 
    : null;
  
  const groupMembersToSeat = selectedContestant ? getGroupMembers(selectedContestant) : [];
  const hasGroupToSeat = groupMembersToSeat.length > 1;
  
  const adjacentSeats = selectedBlock && selectedSeat && hasGroupToSeat
    ? getAdjacentEmptySeats(selectedBlock, selectedSeat, groupMembersToSeat.length)
    : [];
  const canSeatGroupTogether = adjacentSeats.length >= groupMembersToSeat.length;

  const handleAssignContestant = async () => {
    if (!selectedContestant || !selectedBlock || !selectedSeat) return;

    try {
      // Determine if we're booking a group or individual
      if (seatGroupTogether && canSeatGroupTogether && groupMembersToSeat.length > 1) {
        // Book all group members
        const seatsToUse = adjacentSeats.slice(0, groupMembersToSeat.length);
        
        for (let i = 0; i < groupMembersToSeat.length; i++) {
          await apiRequest('POST', '/api/seat-assignments', {
            recordDayId,
            contestantId: groupMembersToSeat[i].id,
            blockNumber: selectedBlock,
            seatLabel: seatsToUse[i],
          });
        }
        
        // Invalidate essential queries
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
        broadcastSeatingChange(recordDayId);
        
        const names = groupMembersToSeat.map((m: any) => m.name).join(', ');
        toast({
          title: "Group assigned",
          description: `Assigned ${groupMembersToSeat.length} contestants to Block ${selectedBlock}, Seats ${seatsToUse.join(', ')}`,
        });
      } else {
        // Book individual
        await apiRequest('POST', '/api/seat-assignments', {
          recordDayId,
          contestantId: selectedContestant,
          blockNumber: selectedBlock,
          seatLabel: selectedSeat,
        });
        
        // Invalidate essential queries
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
        broadcastSeatingChange(recordDayId);
        
        toast({
          title: "Contestant assigned",
          description: `Assigned to Block ${selectedBlock}, Seat ${selectedSeat}`,
        });
      }

      setAssignDialogOpen(false);
      setSelectedContestant("");
      setSeatGroupTogether(false);
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
      // Invalidate essential queries - no redundant refetch() needed
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
      broadcastSeatingChange(recordDayId);
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

  // Return a seated standby back to the standby list
  const handleReturnToStandby = async (assignmentId: string, contestantId: string) => {
    try {
      // Find the standby record for this contestant on this record day
      const standbyRecord = standbys?.find((s: any) => s.contestantId === contestantId);
      
      if (!standbyRecord) {
        toast({
          title: "Error",
          description: "Could not find standby record for this contestant.",
          variant: "destructive",
        });
        return;
      }
      
      // Update standby status back to 'pending'
      await apiRequest('PATCH', `/api/standbys/${standbyRecord.id}`, {
        status: 'pending',
        assignedToSeat: null,
      });
      
      // Delete the seat assignment
      await apiRequest('DELETE', `/api/seat-assignments/${assignmentId}`, {});
      
      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      refetchStandbys();
      broadcastSeatingChange(recordDayId);
      
      toast({
        title: "Returned to standby",
        description: "Contestant has been moved back to the standby list.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to return to standby",
        description: error?.message || "Could not return contestant to standby list.",
        variant: "destructive",
      });
    }
  };

  // Handle marking a contestant as No-Show
  const handleNoShow = async (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => {
    if (!confirm("Mark this contestant as a No-Show? This will remove them from the seat and record the issue.")) {
      return;
    }
    
    try {
      await apiRequest('POST', '/api/attendance-issues', {
        contestantId,
        recordDayId,
        blockNumber,
        seatLabel,
        issueType: 'no_show',
        markedBy: 'producer', // TODO: Get actual user
      });
      
      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/attendance-issues'] });
      broadcastSeatingChange(recordDayId);
      
      toast({
        title: "No-Show recorded",
        description: "Contestant has been marked as a no-show and removed from the seat.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to record no-show",
        description: error?.message || "Could not mark contestant as no-show.",
        variant: "destructive",
      });
    }
  };

  // Handle marking a contestant as Early Leaver
  const handleEarlyLeaver = async (assignmentId: string, contestantId: string, blockNumber: number, seatLabel: string) => {
    if (!confirm("Mark this contestant as an Early Leaver? This will remove them from the seat and record the issue.")) {
      return;
    }
    
    try {
      await apiRequest('POST', '/api/attendance-issues', {
        contestantId,
        recordDayId,
        blockNumber,
        seatLabel,
        issueType: 'early_leaver',
        markedBy: 'producer', // TODO: Get actual user
      });
      
      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/attendance-issues'] });
      broadcastSeatingChange(recordDayId);
      
      toast({
        title: "Early leaver recorded",
        description: "Contestant has been marked as an early leaver and removed from the seat.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to record early leaver",
        description: error?.message || "Could not mark contestant as early leaver.",
        variant: "destructive",
      });
    }
  };

  const handleWinningMoneyClick = (assignmentId: string) => {
    setSelectedAssignmentId(assignmentId);
    setWinningMoneyModalOpen(true);
  };

  // Handler to edit temporary contestant
  const handleEditTempContestant = (contestantId: string) => {
    const contestantsArray = allContestants as any[];
    const contestant = contestantsArray.find((c: any) => c.id === contestantId);
    if (!contestant || !contestant.isTemporary) return;
    
    setEditingContestantId(contestantId);
    setEditTempName(contestant.name || "");
    setEditTempGender(contestant.gender || "");
    setEditTempAge(contestant.age ? String(contestant.age) : "");
    setEditTempPhone(contestant.phone || "");
    setEditTempEmail(contestant.email || "");
    setEditTempNotes(contestant.notes || "");
    setEditTempContestantDialogOpen(true);
  };

  // Find current winning money data for the selected assignment
  const currentAssignment = assignments?.find((a: any) => a.id === selectedAssignmentId);
  const currentWinningMoneyData = {
    rxNumber: currentAssignment?.rxNumber || "",
    rxEpNumber: currentAssignment?.rxEpNumber || "",
    caseNumber: currentAssignment?.caseNumber || "",
    role: currentAssignment?.winningMoneyRole || "player",
    amount: currentAssignment?.winningMoneyAmount || 0,
    amountText: currentAssignment?.winningMoneyText || "",
    caseAmount: currentAssignment?.caseAmount,
    quickCash: currentAssignment?.quickCash,
    bankOfferTaken: currentAssignment?.bankOfferTaken || false,
    spinTheWheel: currentAssignment?.spinTheWheel || false,
    prize: currentAssignment?.prize || "",
  };

  interface PlayerFields {
    caseAmount?: number;
    quickCash?: number;
    bankOfferTaken?: boolean;
    spinTheWheel?: boolean;
    prize?: string;
  }

  const handleWinningMoneySave = async (role: string, amount: number | null, rxNumber: string, rxEpNumber: string, caseNumber: string, playerFields?: PlayerFields, amountText?: string) => {
    if (!selectedAssignmentId) return;
    
    setWinningMoneyLoading(true);
    try {
      await apiRequest('PATCH', `/api/seat-assignments/${selectedAssignmentId}/winning-money`, {
        rxNumber,
        rxEpNumber,
        caseNumber,
        winningMoneyRole: role,
        winningMoneyAmount: amount,
        winningMoneyText: role === 'case_holder' ? amountText : null,
        ...(role === 'player' && playerFields ? {
          caseAmount: playerFields.caseAmount,
          quickCash: playerFields.quickCash,
          bankOfferTaken: playerFields.bankOfferTaken,
          spinTheWheel: playerFields.spinTheWheel,
          prize: playerFields.prize,
        } : {
          caseAmount: null,
          quickCash: null,
          bankOfferTaken: null,
          spinTheWheel: null,
          prize: null,
        }),
      });
      // Invalidate only the queries needed for winning money
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments/with-winning-money'] });
      setWinningMoneyModalOpen(false);
      setSelectedAssignmentId("");
      const displayAmount = amount !== null ? `$${amount}` : amountText;
      toast({
        title: "Winning money updated",
        description: `Amount saved: ${displayAmount}`,
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

  const handleRemoveWinningMoney = async () => {
    if (!selectedAssignmentId) return;
    
    setWinningMoneyLoading(true);
    try {
      await apiRequest('PATCH', `/api/seat-assignments/${selectedAssignmentId}/winning-money`, {
        rxNumber: "",
        rxEpNumber: "",
        caseNumber: "",
        winningMoneyRole: "",
        winningMoneyAmount: 0,
        caseAmount: null,
        quickCash: null,
        bankOfferTaken: null,
        spinTheWheel: null,
        prize: null,
      });
      // Invalidate only the queries needed for winning money
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments/with-winning-money'] });
      setWinningMoneyModalOpen(false);
      setSelectedAssignmentId("");
      toast({
        title: "Winning money removed",
        description: "Winning money data has been cleared.",
      });
    } catch (error: any) {
      toast({
        title: "Error removing winning money",
        description: error?.message || "Could not remove winning money.",
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
      // Invalidate essential queries - cancel affects seat assignments, contestants, standbys, and canceled list
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'] });
      broadcastSeatingChange(recordDayId);
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
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <h1 className="text-2xl font-semibold">Seating Chart</h1>
            {currentRecordDay && (
              <Badge variant="secondary">
                {currentRecordDay.rxNumber && `${currentRecordDay.rxNumber} - `}
                {format(new Date(currentRecordDay.date), "EEE, MMMM d, yyyy")}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Drag and drop contestants to arrange seating blocks
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          {currentRecordDay && (
            <div className="flex items-center gap-2">
              <Label htmlFor="producer-select" className="font-medium">Producer:</Label>
              <Select value={selectedProducer || "none"} onValueChange={handleProducerChange} disabled={producerUpdating || isLocked}>
                <SelectTrigger id="producer-select" className="w-56" data-testid="select-producer">
                  <SelectValue placeholder="Select producer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="Peter Adamidis">Peter Adamidis</SelectItem>
                  <SelectItem value="Kathleen Reynolds">Kathleen Reynolds</SelectItem>
                  <SelectItem value="Maggie Carty">Maggie Carty</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setSwapBlocksDialogOpen(true)} 
              title="Swap all contestants between two blocks"
              data-testid="button-swap-blocks"
              className="text-muted-foreground"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <Button 
              variant={isPodiumVisualizerMode ? "default" : "ghost"}
              size="icon"
              onClick={() => setIsPodiumVisualizerMode(!isPodiumVisualizerMode)} 
              title={isPodiumVisualizerMode ? "Exit Podium Visualiser" : "Podium Visualiser - Show photos only"}
              data-testid="button-podium-visualizer"
              className={isPodiumVisualizerMode ? "bg-violet-600 hover:bg-violet-700 text-white" : "text-muted-foreground"}
            >
              <Camera className="h-4 w-4" />
            </Button>
            <Button 
              variant={isReadinessMode ? "default" : "ghost"}
              size="icon"
              onClick={() => setIsReadinessMode(!isReadinessMode)} 
              title={isReadinessMode ? "Exit Readiness View" : "Readiness - Show block status overview"}
              data-testid="button-readiness-view"
              className={isReadinessMode ? "bg-teal-600 hover:bg-teal-700 text-white" : "text-muted-foreground"}
            >
              <ClipboardCheck className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {isReadinessMode ? (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Filled</p>
                    <p className="text-2xl font-semibold">
                      {blockReadiness.reduce((sum, b) => sum + b.filledSeats, 0)}/
                      {blockReadiness.reduce((sum, b) => sum + b.totalSeats, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Confirmed</p>
                    <p className="text-2xl font-semibold">
                      {blockReadiness.reduce((sum, b) => sum + b.confirmedSeats, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Awaiting Confirmation</p>
                    <p className="text-2xl font-semibold">
                      {blockReadiness.reduce((sum, b) => sum + b.missingConfirmation, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-muted rounded-lg">
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Empty Seats</p>
                    <p className="text-2xl font-semibold">
                      {blockReadiness.reduce((sum, b) => sum + b.emptySeats, 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Per-Block Readiness */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {blockReadiness.map((block) => (
              <Card 
                key={block.blockNumber} 
                className={`cursor-pointer hover-elevate ${
                  block.status === 'ready' ? 'border-green-500/50' : 
                  block.status === 'warning' ? 'border-amber-500/50' : 
                  'border-muted'
                }`}
                onClick={() => setIsReadinessMode(false)}
                data-testid={`readiness-block-${block.blockNumber}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between">
                    <span>Block {block.blockNumber}</span>
                    {block.status === 'ready' && block.filledSeats > 0 ? (
                      <Badge className="bg-green-500 text-white">Ready</Badge>
                    ) : block.status === 'warning' ? (
                      <Badge className="bg-amber-500 text-white">Pending</Badge>
                    ) : (
                      <Badge variant="secondary">Incomplete</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Filled</span>
                      <span className="font-medium">{block.filledSeats}/{block.totalSeats}</span>
                    </div>
                    <Progress value={block.fillPercent} className="h-2" />
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Confirmed</span>
                      <span className="font-medium">{block.confirmedSeats}/{block.filledSeats}</span>
                    </div>
                    <Progress 
                      value={block.confirmPercent} 
                      className={`h-2 ${block.confirmPercent === 100 ? '[&>div]:bg-green-500' : '[&>div]:bg-amber-500'}`} 
                    />
                  </div>

                  {block.missingConfirmation > 0 && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-4 w-4" />
                      <span>{block.missingConfirmation} awaiting confirmation</span>
                    </div>
                  )}

                  {block.hasIssues > 0 && (
                    <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{block.hasIssues} with mobility notes</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        isLoading ? (
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
            onRemoveWinningMoney={isLocked ? handleRemoveWinningMoney : undefined}
            onReturnToStandby={handleReturnToStandby}
            onNoShow={isLocked ? handleNoShow : undefined}
            onEarlyLeaver={isLocked ? handleEarlyLeaver : undefined}
            onEditTempContestant={handleEditTempContestant}
            isLocked={isLocked}
            standbys={standbys}
            onStandbySeated={() => {
              refetch();
              refetchStandbys();
            }}
            isPodiumVisualizerMode={isPodiumVisualizerMode}
          />
        )
      )}

      {/* Assign Contestant to Empty Seat Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[95vh] flex flex-col gap-4 overflow-hidden" data-testid="dialog-assign-contestant-to-seat">
          <DialogHeader className="pb-2">
            <DialogTitle className="flex items-center gap-2">
              Assign to Block {selectedBlock}, Seat {selectedSeat}
            </DialogTitle>
            <DialogDescription>
              Choose a contestant from the list below
            </DialogDescription>
          </DialogHeader>
          
          {availableContestants.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="font-medium">No available contestants</p>
              <p className="text-sm">All contestants are already seated.</p>
            </div>
          ) : (
            <>
              {/* Search and Filters */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name..."
                    value={contestantSearch}
                    onChange={(e) => setContestantSearch(e.target.value)}
                    className="pl-9"
                    data-testid="input-contestant-search"
                  />
                </div>
                
                <div className="flex flex-wrap items-end gap-2 text-xs">
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[10px] font-medium">Rating</span>
                    <Select value={filterRating} onValueChange={setFilterRating}>
                      <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-rating">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="A+">A+</SelectItem>
                        <SelectItem value="A">A</SelectItem>
                        <SelectItem value="B+">B+</SelectItem>
                        <SelectItem value="B">B</SelectItem>
                        <SelectItem value="C">C</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[10px] font-medium">Gender</span>
                    <Select value={filterGender} onValueChange={setFilterGender}>
                      <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-gender">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Male">Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[10px] font-medium">Group Size</span>
                    <Select value={filterGroupSize} onValueChange={setFilterGroupSize}>
                      <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-group-size">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="1">Solo</SelectItem>
                        <SelectItem value="2">Pair</SelectItem>
                        <SelectItem value="3+">3+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[10px] font-medium">Age</span>
                    <Select value={filterAge} onValueChange={setFilterAge}>
                      <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-age">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="18-29">18-29</SelectItem>
                        <SelectItem value="30-39">30-39</SelectItem>
                        <SelectItem value="40-49">40-49</SelectItem>
                        <SelectItem value="50-59">50-59</SelectItem>
                        <SelectItem value="60+">60+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[10px] font-medium">Status</span>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="h-7 w-[90px] text-xs" data-testid="select-filter-status">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="invited">Invited</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-[10px] font-medium">Standby</span>
                    <Select value={filterStandby} onValueChange={setFilterStandby}>
                      <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-standby">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="available">Yes</SelectItem>
                        <SelectItem value="not_available">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <span className="ml-auto text-muted-foreground self-end pb-1">
                    {filteredContestants.length} found
                  </span>
                </div>
              </div>
              
              {/* Contestant List */}
              <ScrollArea className="h-[220px] border rounded-md bg-muted/20">
                <div className="p-2 space-y-1">
                  {filteredContestants.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No contestants match your filters.
                    </p>
                  ) : (
                    filteredContestants.map((contestant: any) => {
                      const isSelected = selectedContestant === contestant.id;
                      const ratingColors: Record<string, string> = {
                        'A+': 'bg-emerald-500 text-white',
                        'A': 'bg-green-500 text-white',
                        'B+': 'bg-amber-500 text-white',
                        'B': 'bg-orange-500 text-white',
                        'C': 'bg-red-500 text-white',
                      };
                      const statusColors: Record<string, string> = {
                        'available': 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
                        'invited': 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
                        'confirmed': 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
                        'assigned': 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
                      };
                      const statusLabels: Record<string, string> = {
                        'available': 'Avail',
                        'invited': 'Invited',
                        'confirmed': 'Conf',
                        'assigned': 'Asgnd',
                      };
                      const hasGroup = !!contestant.attendingWith;
                      const isAvailableForStandby = !!contestant.availableForStandby;
                      const hasPodiumStory = !!contestant.podiumStory;
                      
                      return (
                        <div
                          key={contestant.id}
                          onClick={() => setSelectedContestant(contestant.id)}
                          className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 p-2 rounded-md cursor-pointer transition-all ${
                            isSelected 
                              ? 'bg-primary text-primary-foreground shadow-sm' 
                              : 'hover:bg-muted'
                          }`}
                          data-testid={`contestant-card-${contestant.id}`}
                        >
                          {/* Photo */}
                          <Avatar className="h-9 w-9 border border-border">
                            {contestant.photoUrl ? (
                              <AvatarImage src={contestant.photoUrl} alt={contestant.name} className="object-cover" />
                            ) : null}
                            <AvatarFallback className="text-xs bg-muted">
                              <User className="h-4 w-4 text-muted-foreground" />
                            </AvatarFallback>
                          </Avatar>
                          
                          {/* Info section - constrained to available space */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">
                                {contestant.name}
                              </span>
                              {isAvailableForStandby && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${
                                  isSelected 
                                    ? 'bg-primary-foreground/20 text-primary-foreground' 
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                                }`}>
                                  S
                                </span>
                              )}
                              {hasPodiumStory && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${
                                  isSelected 
                                    ? 'bg-primary-foreground/20 text-primary-foreground' 
                                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                                }`}>
                                  PS
                                </span>
                              )}
                              {hasGroup && (
                                <Users className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? 'text-primary-foreground/70' : 'text-blue-500'}`} />
                              )}
                              {isSelected && (
                                <Check className="h-4 w-4 flex-shrink-0" />
                              )}
                            </div>
                            <div className={`text-xs truncate ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                              {contestant.gender === "Female" ? "F" : "M"}
                              {contestant.age && ` | ${contestant.age}yo`}
                              {hasGroup && ` | ${contestant.attendingWith}`}
                            </div>
                          </div>
                          
                          {/* Status badge */}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isSelected 
                              ? 'bg-primary-foreground/20 text-primary-foreground' 
                              : statusColors[contestant.availabilityStatus] || 'bg-gray-100 text-gray-600'
                          }`}>
                            {statusLabels[contestant.availabilityStatus] || contestant.availabilityStatus || '?'}
                          </span>
                          
                          {/* Rating indicator - moved to right */}
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            contestant.auditionRating 
                              ? ratingColors[contestant.auditionRating] || 'bg-gray-500 text-white'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {contestant.auditionRating || '?'}
                          </div>
                          
                          {/* View button - always visible */}
                          <Button
                            size="icon"
                            variant={isSelected ? "secondary" : "outline"}
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewContestantId(contestant.id);
                            }}
                            data-testid={`button-view-contestant-${contestant.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
              
              {/* Selection Preview & Group Option */}
              {selectedContestant && selectedContestantData && (
                <div className="border rounded-md p-3 bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Selected:</span>
                    <span className="text-sm">{selectedContestantData.name}</span>
                  </div>
                  
                  {hasGroupToSeat && (
                    <div className={`p-2.5 rounded-md ${canSeatGroupTogether ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800' : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'}`}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="seat-group-together"
                          checked={seatGroupTogether}
                          onCheckedChange={(checked) => setSeatGroupTogether(checked === true)}
                          disabled={!canSeatGroupTogether}
                          className="mt-0.5"
                          data-testid="checkbox-seat-group-together"
                        />
                        <div className="flex-1 text-sm">
                          <label 
                            htmlFor="seat-group-together" 
                            className={`font-medium cursor-pointer ${!canSeatGroupTogether ? 'text-muted-foreground' : ''}`}
                          >
                            Seat entire group together
                          </label>
                          {canSeatGroupTogether ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                <span>{groupMembersToSeat.map((m: any) => m.name).join(' + ')}</span>
                              </div>
                              <div className="mt-0.5">
                                Seats: {adjacentSeats.slice(0, groupMembersToSeat.length).join(', ')}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                              Need {groupMembersToSeat.length} adjacent seats, only {adjacentSeats.length} available in this row
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter className="flex flex-row justify-between w-full gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => {
                setTempContestantDialogOpen(true);
                setTempContestantName("");
                setTempContestantGender("");
                setTempContestantAge("");
                setTempContestantPhone("");
                setTempContestantEmail("");
                setTempContestantNotes("");
              }}
              className="mr-auto border-dashed border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
              data-testid="button-new-temp-contestant"
            >
              <User className="h-4 w-4 mr-1" />
              New Contestant
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAssignContestant} 
                disabled={!selectedContestant || availableContestants.length === 0}
                data-testid="button-confirm-seat-assign"
              >
                {seatGroupTogether && canSeatGroupTogether 
                  ? `Assign ${groupMembersToSeat.length} People` 
                  : 'Assign to Seat'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Temporary Contestant Dialog */}
      <Dialog open={tempContestantDialogOpen} onOpenChange={setTempContestantDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-new-temp-contestant">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-amber-500" />
              Add Temporary Contestant
            </DialogTitle>
            <DialogDescription>
              Create a placeholder contestant who hasn't been imported from Cast It Reach yet. They can be updated later after proper audition.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="temp-name">Name *</Label>
                <Input
                  id="temp-name"
                  value={tempContestantName}
                  onChange={(e) => setTempContestantName(e.target.value)}
                  placeholder="Full name"
                  data-testid="input-temp-name"
                />
              </div>
              
              <div>
                <Label htmlFor="temp-gender">Gender *</Label>
                <Select value={tempContestantGender} onValueChange={setTempContestantGender}>
                  <SelectTrigger data-testid="select-temp-gender">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="temp-age">Age</Label>
                <Input
                  id="temp-age"
                  type="number"
                  value={tempContestantAge}
                  onChange={(e) => setTempContestantAge(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-temp-age"
                />
              </div>
              
              <div>
                <Label htmlFor="temp-phone">Phone</Label>
                <Input
                  id="temp-phone"
                  value={tempContestantPhone}
                  onChange={(e) => setTempContestantPhone(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-temp-phone"
                />
              </div>
              
              <div>
                <Label htmlFor="temp-email">Email</Label>
                <Input
                  id="temp-email"
                  type="email"
                  value={tempContestantEmail}
                  onChange={(e) => setTempContestantEmail(e.target.value)}
                  placeholder="Optional"
                  data-testid="input-temp-email"
                />
              </div>
            </div>
            
            <div>
              <Label htmlFor="temp-notes">Notes</Label>
              <Textarea
                id="temp-notes"
                value={tempContestantNotes}
                onChange={(e) => setTempContestantNotes(e.target.value)}
                placeholder="Any notes about this contestant..."
                className="h-20 resize-none"
                data-testid="input-temp-notes"
              />
            </div>
            
            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This contestant is marked as <strong>temporary</strong> until they complete their audition and are properly imported via Cast It Reach.
                </p>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setTempContestantDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={async () => {
                if (!tempContestantName.trim() || !tempContestantGender) {
                  toast({
                    variant: "destructive",
                    title: "Missing required fields",
                    description: "Name and gender are required.",
                  });
                  return;
                }
                
                setIsCreatingTempContestant(true);
                try {
                  // Create temporary contestant
                  const res = await apiRequest("POST", "/api/contestants/temporary", {
                    name: tempContestantName.trim(),
                    gender: tempContestantGender,
                    age: tempContestantAge || undefined,
                    phone: tempContestantPhone || undefined,
                    email: tempContestantEmail || undefined,
                    notes: tempContestantNotes || undefined,
                  });
                  
                  const newContestant = await res.json();
                  
                  // Close temp dialog
                  setTempContestantDialogOpen(false);
                  
                  // Assign to seat
                  await apiRequest("POST", "/api/seat-assignments", {
                    recordDayId,
                    contestantId: newContestant.id,
                    blockNumber: selectedBlock,
                    seatLabel: selectedSeat,
                  });
                  
                  toast({
                    title: "Temporary contestant added",
                    description: `${newContestant.name} has been created and assigned to Block ${selectedBlock}, Seat ${selectedSeat}.`,
                  });
                  
                  // Refresh data
                  queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
                  queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
                  broadcastSeatingChange();
                  
                  // Close assign dialog
                  setAssignDialogOpen(false);
                } catch (error: any) {
                  toast({
                    variant: "destructive",
                    title: "Failed to create contestant",
                    description: error.message,
                  });
                } finally {
                  setIsCreatingTempContestant(false);
                }
              }}
              disabled={isCreatingTempContestant || !tempContestantName.trim() || !tempContestantGender}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-create-temp-contestant"
            >
              {isCreatingTempContestant ? "Creating..." : "Create & Assign to Seat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Temporary Contestant Dialog */}
      <Dialog open={editTempContestantDialogOpen} onOpenChange={setEditTempContestantDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-edit-temp-contestant">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-amber-600" />
              Edit Temporary Contestant
            </DialogTitle>
            <DialogDescription>
              Update the temporary contestant's information. They will remain marked as temporary until properly imported via Cast It Reach.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input
                value={editTempName}
                onChange={(e) => setEditTempName(e.target.value)}
                placeholder="Full name"
                data-testid="input-edit-temp-name"
              />
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Gender <span className="text-destructive">*</span></label>
              <Select value={editTempGender} onValueChange={setEditTempGender}>
                <SelectTrigger data-testid="select-edit-temp-gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Age</label>
                <Input
                  value={editTempAge}
                  onChange={(e) => setEditTempAge(e.target.value)}
                  placeholder="Age"
                  type="number"
                  data-testid="input-edit-temp-age"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={editTempPhone}
                  onChange={(e) => setEditTempPhone(e.target.value)}
                  placeholder="Phone number"
                  data-testid="input-edit-temp-phone"
                />
              </div>
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                value={editTempEmail}
                onChange={(e) => setEditTempEmail(e.target.value)}
                placeholder="Email address"
                type="email"
                data-testid="input-edit-temp-email"
              />
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={editTempNotes}
                onChange={(e) => setEditTempNotes(e.target.value)}
                placeholder="Any additional notes..."
                className="min-h-[60px]"
                data-testid="textarea-edit-temp-notes"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTempContestantDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={async () => {
                if (!editTempName.trim() || !editTempGender || !editingContestantId) {
                  toast({
                    variant: "destructive",
                    title: "Missing required fields",
                    description: "Name and gender are required.",
                  });
                  return;
                }
                
                setIsUpdatingTempContestant(true);
                try {
                  await apiRequest("PUT", `/api/contestants/${editingContestantId}`, {
                    name: editTempName.trim(),
                    gender: editTempGender,
                    age: editTempAge ? parseInt(editTempAge) : null,
                    phone: editTempPhone || null,
                    email: editTempEmail || null,
                    notes: editTempNotes || null,
                  });
                  
                  toast({
                    title: "Contestant updated",
                    description: `${editTempName.trim()} has been updated.`,
                  });
                  
                  // Refresh data
                  queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
                  queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
                  broadcastSeatingChange();
                  
                  // Close dialog
                  setEditTempContestantDialogOpen(false);
                  setEditingContestantId(null);
                } catch (error: any) {
                  toast({
                    variant: "destructive",
                    title: "Failed to update contestant",
                    description: error.message,
                  });
                } finally {
                  setIsUpdatingTempContestant(false);
                }
              }}
              disabled={isUpdatingTempContestant || !editTempName.trim() || !editTempGender}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-save-temp-contestant"
            >
              {isUpdatingTempContestant ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Contestant Details Dialog */}
      <Dialog open={!!viewContestantId} onOpenChange={(open) => !open && setViewContestantId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-view-contestant">
          {(() => {
            const contestant = availableContestants.find((c: any) => c.id === viewContestantId);
            if (!contestant) return <div className="py-8 text-center text-muted-foreground">Contestant not found</div>;
            
            const ratingColors: Record<string, string> = {
              'A+': 'text-emerald-600 dark:text-emerald-400',
              'A': 'text-green-600 dark:text-green-400',
              'B+': 'text-amber-600 dark:text-amber-400',
              'B': 'text-orange-600 dark:text-orange-400',
              'C': 'text-red-500 dark:text-red-400',
            };
            
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Contestant Details</DialogTitle>
                </DialogHeader>
                
                <div className="space-y-4">
                  {/* Header with photo and basic info */}
                  <div className="flex items-start gap-4">
                    <Avatar className="h-20 w-20 border-2 border-border">
                      {contestant.photoUrl ? (
                        <AvatarImage src={contestant.photoUrl} alt={contestant.name} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-xl bg-muted">
                        <User className="h-8 w-8 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    
                    {/* Basic Information Grid */}
                    <div className="flex-1 grid grid-cols-4 gap-x-4 gap-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Name</label>
                        <p className="text-sm font-medium">{contestant.name}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Age</label>
                        <p className="text-sm">{contestant.age || '-'}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Gender</label>
                        <p className="text-sm">{contestant.gender || '-'}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <Badge variant="outline" className="text-xs">
                          {contestant.availabilityStatus || 'Unknown'}
                        </Badge>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Rating</label>
                        <p className={`text-sm font-semibold ${ratingColors[contestant.auditionRating] || 'text-muted-foreground'}`}>
                          {contestant.auditionRating || '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Player Type</label>
                        {contestant.playerType ? (
                          <Badge className={`text-xs py-0 ${
                            contestant.playerType === 'player' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                            contestant.playerType === 'backup' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' :
                            'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800'
                          }`}>
                            {contestant.playerType === 'player' ? 'Player' : contestant.playerType === 'backup' ? 'Backup' : 'Partner'}
                          </Badge>
                        ) : <span className="text-sm text-muted-foreground">-</span>}
                      </div>
                      {contestant.attendingWith && (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Attending With</label>
                          <p className="text-sm">{contestant.attendingWith}</p>
                        </div>
                      )}
                      {contestant.groupId && (
                        <div className="overflow-hidden">
                          <label className="text-xs font-medium text-muted-foreground">Group ID</label>
                          <Badge variant="outline" className="font-mono text-xs max-w-full truncate inline-block py-0" title={contestant.groupId}>
                            {contestant.groupId}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Contact & Medical in 2 columns */}
                  <div className="grid grid-cols-2 gap-4 border-t pt-3">
                    {/* Contact Information */}
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact</h3>
                      <div className="space-y-1 text-sm">
                        {contestant.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{contestant.email}</span>
                          </div>
                        )}
                        {contestant.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span>{contestant.phone}</span>
                          </div>
                        )}
                        {contestant.location && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span>{contestant.location}</span>
                          </div>
                        )}
                        {contestant.postcode && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Postcode:</span>
                            <span>{contestant.postcode}</span>
                            {contestant.state && <span className="text-xs text-muted-foreground">{contestant.state}</span>}
                          </div>
                        )}
                        {!contestant.email && !contestant.phone && !contestant.location && !contestant.postcode && (
                          <p className="text-muted-foreground italic text-xs">No contact info</p>
                        )}
                      </div>
                    </div>

                    {/* Medical Information */}
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Medical</h3>
                      <div className="space-y-1 text-sm">
                        <div>
                          <span className="text-xs text-muted-foreground">App: </span>
                          <span className={contestant.medicalInfo ? '' : 'text-muted-foreground italic'}>
                            {contestant.medicalInfo || 'None'}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Aud: </span>
                          <span className={contestant.mobilityNotes ? '' : 'text-muted-foreground italic'}>
                            {contestant.mobilityNotes || 'None'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Criminal Record */}
                  <div className="border-t pt-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Criminal Record</h3>
                    <p className={`text-sm ${contestant.criminalRecord ? '' : 'text-muted-foreground italic'}`}>
                      {contestant.criminalRecord || 'No criminal record information provided'}
                    </p>
                  </div>
                </div>
                
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={() => setViewContestantId(null)}>
                    Close
                  </Button>
                  <Button onClick={() => {
                    setSelectedContestant(contestant.id);
                    setViewContestantId(null);
                  }}>
                    Select for Assignment
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
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
          
          <div className="py-4 space-y-4">
            <div className="space-y-2">
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
            <div className="space-y-2">
              <Label htmlFor="cancel-initials">Your Initials <span className="text-red-500">*</span></Label>
              <Input
                id="cancel-initials"
                placeholder="e.g., JD"
                value={cancelInitials}
                onChange={(e) => setCancelInitials(e.target.value.toUpperCase())}
                maxLength={5}
                className="w-24"
                data-testid="input-cancel-initials"
              />
              <p className="text-xs text-muted-foreground">Required for tracking who processed this cancellation</p>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setCancelDialogOpen(false);
                setCancelAssignmentId("");
                setCancelReason("");
                setCancelInitials("");
              }}
              data-testid="button-cancel-dialog-close"
            >
              Go Back
            </Button>
            <Button 
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={!cancelInitials.trim()}
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
        onRemove={handleRemoveWinningMoney}
        isLoading={winningMoneyLoading}
        currentRxNumber={currentWinningMoneyData.rxNumber}
        currentRxEpNumber={currentWinningMoneyData.rxEpNumber}
        currentCaseNumber={currentWinningMoneyData.caseNumber}
        currentRole={currentWinningMoneyData.role}
        currentAmount={currentWinningMoneyData.amount}
        currentAmountText={currentWinningMoneyData.amountText}
        currentCaseAmount={currentWinningMoneyData.caseAmount}
        currentQuickCash={currentWinningMoneyData.quickCash}
        currentBankOfferTaken={currentWinningMoneyData.bankOfferTaken}
        currentSpinTheWheel={currentWinningMoneyData.spinTheWheel}
        currentPrize={currentWinningMoneyData.prize}
        contestantName={currentAssignment?.contestantName}
        blockNumber={currentAssignment?.blockNumber}
        assignments={assignments}
      />

      {/* Swap Blocks Dialog */}
      <Dialog open={swapBlocksDialogOpen} onOpenChange={(open) => {
        if (!isSwappingBlocks) {
          setSwapBlocksDialogOpen(open);
          if (!open) {
            setSwapSourceBlock("");
            setSwapTargetBlock("");
          }
        }
      }}>
        <DialogContent data-testid="dialog-swap-blocks">
          <DialogHeader>
            <div className="flex items-center justify-center mb-4">
              <ArrowLeftRight className="h-10 w-10 text-blue-600 dark:text-blue-400" />
            </div>
            <DialogTitle>Swap Blocks</DialogTitle>
            <DialogDescription>
              Swap all contestants between two blocks. Everyone in Block A will move to Block B (same seats), and vice versa.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source-block">From Block</Label>
                <Select value={swapSourceBlock} onValueChange={setSwapSourceBlock}>
                  <SelectTrigger id="source-block" data-testid="select-source-block">
                    <SelectValue placeholder="Select block" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map(blockNum => (
                      <SelectItem key={blockNum} value={String(blockNum)} disabled={swapTargetBlock === String(blockNum)}>
                        Block {blockNum} ({getBlockOccupancy(blockNum)}/22)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-block">To Block</Label>
                <Select value={swapTargetBlock} onValueChange={setSwapTargetBlock}>
                  <SelectTrigger id="target-block" data-testid="select-target-block">
                    <SelectValue placeholder="Select block" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map(blockNum => (
                      <SelectItem key={blockNum} value={String(blockNum)} disabled={swapSourceBlock === String(blockNum)}>
                        Block {blockNum} ({getBlockOccupancy(blockNum)}/22)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {swapSourceBlock && swapTargetBlock && (
              <div className="p-3 bg-muted rounded-md text-sm">
                <p className="font-medium mb-1">Preview:</p>
                <p>
                  Block {swapSourceBlock} ({getBlockOccupancy(parseInt(swapSourceBlock))} contestants) 
                  {" "}will swap with{" "}
                  Block {swapTargetBlock} ({getBlockOccupancy(parseInt(swapTargetBlock))} contestants)
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSwapBlocksDialogOpen(false);
                setSwapSourceBlock("");
                setSwapTargetBlock("");
              }}
              disabled={isSwappingBlocks}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSwapBlocks}
              disabled={!swapSourceBlock || !swapTargetBlock || swapSourceBlock === swapTargetBlock || isSwappingBlocks}
              data-testid="button-confirm-swap-blocks"
            >
              {isSwappingBlocks ? "Swapping..." : "Swap Blocks"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={handleResetDialogClose}>
        <DialogContent data-testid="dialog-reset-confirmation">
          <DialogHeader>
            <div className="flex items-center justify-center mb-4">
              <AlertTriangle className="h-12 w-12 text-red-600 dark:text-red-500" />
            </div>
            <DialogTitle>
              {resetConfirmationStep === 0 ? "Reset Seating Chart" : "Confirm Reset Again"}
            </DialogTitle>
            <DialogDescription>
              {resetConfirmationStep === 0 
                ? "Select which blocks to reset. Contestants in selected blocks will be removed from their seats."
                : "This action cannot be undone. Are you absolutely certain you want to reset the selected blocks?"}
            </DialogDescription>
          </DialogHeader>

          {resetConfirmationStep === 0 && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b">
                <Checkbox 
                  id="select-all-reset-blocks"
                  checked={selectedResetBlocks.length === 7}
                  onCheckedChange={handleSelectAllResetBlocks}
                  data-testid="checkbox-select-all-reset-blocks"
                />
                <Label htmlFor="select-all-reset-blocks" className="font-medium cursor-pointer">
                  Select All Blocks
                </Label>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4, 5, 6, 7].map(blockNum => (
                  <div key={blockNum} className="flex items-center gap-2">
                    <Checkbox 
                      id={`reset-block-${blockNum}`}
                      checked={selectedResetBlocks.includes(blockNum)}
                      onCheckedChange={() => handleResetBlockToggle(blockNum)}
                      data-testid={`checkbox-reset-block-${blockNum}`}
                    />
                    <Label htmlFor={`reset-block-${blockNum}`} className="cursor-pointer">
                      Block {blockNum}
                    </Label>
                  </div>
                ))}
              </div>
              
              {selectedResetBlocks.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedResetBlocks.length === 7 
                    ? "All 7 blocks selected" 
                    : `${selectedResetBlocks.length} block${selectedResetBlocks.length > 1 ? 's' : ''} selected: ${selectedResetBlocks.join(', ')}`}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={handleResetDialogClose}
              data-testid="button-reset-cancel"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleConfirmReset}
              disabled={selectedResetBlocks.length === 0}
              data-testid="button-reset-confirm"
            >
              {resetConfirmationStep === 0 ? "Yes, Reset Selected" : "Yes, Confirm Reset"}
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
