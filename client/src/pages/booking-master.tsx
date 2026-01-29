import { useState, useRef, useEffect, Fragment, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBookingMasterWebSocket } from "@/hooks/use-websocket";
import { broadcastBookingChange, broadcastSeatingChange } from "@/lib/crossTabSync";

// Helper function to check if a medical field has meaningful content (not NA/N/A/empty)
const hasMeaningfulMedicalNote = (value: string | undefined | null): boolean => {
  if (!value) return false;
  const trimmed = value.trim().toUpperCase();
  return trimmed !== '' && trimmed !== 'NA' && trimmed !== 'N/A' && trimmed !== 'N / A';
};
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Calendar, Mail, Maximize2, Minimize2, CheckCircle, XCircle, Columns, ChevronDown, MessageCircle, FileText, Sparkles, Users, AlertTriangle, Copy, Pencil, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { useLocation } from "wouter";
import * as XLSX from "xlsx";

// Column configuration for the booking master table
// Columns to the right of the bar (after NOTES) are always visible and cannot be hidden
const COLUMN_CONFIG = [
  { id: "seat", label: "SEAT", alwaysVisible: true },
  { id: "name", label: "NAME", alwaysVisible: true },
  { id: "mobile", label: "MOBILE", alwaysVisible: false },
  { id: "email", label: "EMAIL", alwaysVisible: false },
  { id: "attendingWith", label: "ATTENDING WITH", alwaysVisible: false },
  { id: "location", label: "LOCATION", alwaysVisible: false },
  { id: "medicalQ", label: "MEDICAL - APP", alwaysVisible: false },
  { id: "mobilityNotes", label: "MEDICAL - AUD", alwaysVisible: false },
  { id: "criminal", label: "CRIM / BANK", alwaysVisible: false },
  { id: "castingCategory", label: "CASTING CATEGORY", alwaysVisible: false },
  { id: "notes", label: "NOTES", alwaysVisible: false },
  { id: "emailSent", label: "EMAIL SENT", alwaysVisible: false },
  { id: "rsvp", label: "RSVP", alwaysVisible: false },
  { id: "paperSent", label: "PAPER SENT", alwaysVisible: false },
  { id: "paperReceived", label: "PAPER ✓", alwaysVisible: false },
  { id: "otdHardCopy", label: "OTD PAPER WORK", alwaysVisible: false },
  { id: "signedIn", label: "SIGNED IN", alwaysVisible: false },
  { id: "otdNotes", label: "OTD NOTES", alwaysVisible: false },
  { id: "standby", label: "STANDBY / SWAPS", alwaysVisible: false },
] as const;

type ColumnId = typeof COLUMN_CONFIG[number]["id"];

// Default visible columns
const DEFAULT_VISIBLE_COLUMNS: Record<ColumnId, boolean> = {
  seat: true,
  name: true,
  mobile: true,
  email: true,
  attendingWith: true,
  location: true,
  medicalQ: true,
  mobilityNotes: true,
  criminal: true,
  castingCategory: true,
  notes: true,
  emailSent: true,
  rsvp: true,
  paperSent: true,
  paperReceived: true,
  otdHardCopy: true,
  signedIn: true,
  otdNotes: true,
  standby: true,
};

const STORAGE_KEY = "booking-master-visible-columns";

// Check In mode columns - only these columns are visible in Check In mode
const CHECK_IN_COLUMNS: ColumnId[] = [
  "seat",
  "name", 
  "email",
  "attendingWith",
  "medicalQ",
  "mobilityNotes",
  "notes",
  "paperSent",
  "paperReceived",
  "otdHardCopy",
  "signedIn",
  "otdNotes",
];

interface SharePointConfig {
  sharePointUrl: string | null;
  isConfigured: boolean;
}

interface RecordDay {
  id: string;
  date: string;
  totalSeats: number;
  status: string;
}

interface Contestant {
  id: string;
  name: string;
  age: number;
  gender: string;
  email?: string;
  phone?: string;
  address?: string;
  location?: string;
  medicalInfo?: string;
  mobilityNotes?: string;
  criminalRecord?: string;
  attendingWith?: string;
  groupId?: string;
  photoUrl?: string;
  playerType?: 'player' | 'backup' | 'player_partner' | null;
}

interface BlockType {
  id: string;
  recordDayId: string;
  blockNumber: number;
  blockType: 'PB' | 'NPB';
}

interface SeatAssignment {
  id: string;
  recordDayId: string;
  contestantId: string;
  blockNumber: number;
  seatLabel: string;
  firstNations?: string;
  rating?: string;
  location?: string;
  medicalQuestion?: string;
  criminalBankruptcy?: string;
  castingCategory?: string;
  notes?: string;
  bookingEmailSent?: string;
  confirmedRsvp?: string;
  paperworkSent?: string;
  paperworkReceived?: string;
  paperworkOnDay?: string;
  signedIn?: string;
  otdNotes?: string;
  standbyReplacementSwaps?: string;
  contestantName?: string;
  age?: number;
  gender?: string;
  // RX Day Mode swap tracking
  originalBlockNumber?: number;
  originalSeatLabel?: string;
  swappedAt?: string;
  // Standby tracking
  wasStandby?: boolean;
  // Reschedule tracking
  isFromReschedule?: boolean;
  // Override fields (for changes after invitations sent)
  attendingWithOverride?: string;
  mobilityNotesOverride?: string;
}

interface BookingRow {
  seatId: string;
  blockNumber: number;
  seatLabel: string;
  assignment?: SeatAssignment;
  contestant?: Contestant;
}

interface StandbyAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  status: string;
  priority: number | null;
  standbyEmailSent: string | null;
  confirmedAt: string | null;
  notes: string | null;
  assignedToSeat: string | null;
  // Workflow tracking fields
  bookingEmailSent: string | null;
  confirmedRsvp: string | null;
  paperworkSent: string | null;
  paperworkReceived: string | null;
  paperworkOnDay: string | null;
  signedIn: string | null;
  otdNotes: string | null;
  standbyMovementNotes: string | null;
  contestant: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    gender: string;
    age: number;
    photoUrl: string | null;
    auditionRating: string | null;
    attendingWith: string | null;
    location: string | null;
    medicalInfo: string | null;
    mobilityNotes: string | null;
    criminalRecord: string | null;
    isTemporary: boolean | null;
    isTestSubject: boolean | null;
  };
}

const BLOCKS = 7;
const ROWS = [
  { label: "A", count: 5 },
  { label: "B", count: 5 },
  { label: "C", count: 4 },
  { label: "D", count: 4 },
  { label: "E", count: 4 },
];

const RECORD_DAY_STORAGE_KEY = 'booking-master-selected-day';

export default function BookingMaster() {
  const [, setLocation] = useLocation();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>(() => {
    // Load from localStorage on initial render
    try {
      return localStorage.getItem(RECORD_DAY_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [searchName, setSearchName] = useState<string>("");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sharePointDialogOpen, setSharePointDialogOpen] = useState(false);
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  
  // Untick confirmation dialog state
  const [untickConfirmOpen, setUntickConfirmOpen] = useState(false);
  const [untickPending, setUntickPending] = useState<{
    assignmentId: string;
    field: string;
    fieldLabel: string;
    contestantName: string;
    isStandby?: boolean;
  } | null>(null);
  const [emailSubject, setEmailSubject] = useState("Deal or No Deal - Booking Confirmation");
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [expandedOtdNotes, setExpandedOtdNotes] = useState<Set<string>>(new Set());
  const [filterMedicalNotes, setFilterMedicalNotes] = useState(false);
  const [filterConfirmedOnly, setFilterConfirmedOnly] = useState(false);
  const [filterPaperworkNotSent, setFilterPaperworkNotSent] = useState(false);
  const [isStandbyMode, setIsStandbyMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isCheckInMode, setIsCheckInMode] = useState(false);
  const [filterNotSignedIn, setFilterNotSignedIn] = useState(false);
  const [showNoShowConfirm, setShowNoShowConfirm] = useState(false);
  const [savedColumnsBeforeCheckIn, setSavedColumnsBeforeCheckIn] = useState<Record<ColumnId, boolean> | null>(null);
  // Use refs instead of state for pending text updates to avoid re-renders
  const pendingTextUpdatesRef = useRef<Record<string, string>>({});
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnId, boolean>>(() => {
    // Load from localStorage or use defaults
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_VISIBLE_COLUMNS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error("Failed to load column visibility settings:", e);
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const debounceTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const { toast } = useToast();
  
  // Connect to WebSocket for real-time updates
  useBookingMasterWebSocket(selectedRecordDay || null);

  // Save column visibility to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch (e) {
      console.error("Failed to save column visibility settings:", e);
    }
  }, [visibleColumns]);

  // Save selected record day to localStorage when it changes
  useEffect(() => {
    if (selectedRecordDay) {
      try {
        localStorage.setItem(RECORD_DAY_STORAGE_KEY, selectedRecordDay);
      } catch (e) {
        console.error("Failed to save selected record day:", e);
      }
    }
  }, [selectedRecordDay]);

  const toggleColumnVisibility = (columnId: ColumnId) => {
    const column = COLUMN_CONFIG.find(c => c.id === columnId);
    if (column?.alwaysVisible) return; // Can't hide always-visible columns
    
    setVisibleColumns(prev => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  };

  const toggleCheckInMode = () => {
    if (!isCheckInMode) {
      // Entering Check In mode - save current columns and apply check-in columns
      setSavedColumnsBeforeCheckIn(visibleColumns);
      const checkInVisibility: Record<ColumnId, boolean> = {} as Record<ColumnId, boolean>;
      COLUMN_CONFIG.forEach(col => {
        checkInVisibility[col.id] = CHECK_IN_COLUMNS.includes(col.id);
      });
      setVisibleColumns(checkInVisibility);
    } else {
      // Exiting Check In mode - restore saved columns
      if (savedColumnsBeforeCheckIn) {
        setVisibleColumns(savedColumnsBeforeCheckIn);
      }
      setSavedColumnsBeforeCheckIn(null);
      setFilterNotSignedIn(false); // Reset not signed in filter when exiting
    }
    setIsCheckInMode(!isCheckInMode);
  };

  const isColumnVisible = (columnId: ColumnId) => visibleColumns[columnId];

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  // Validate stored record day exists in available record days
  useEffect(() => {
    if (recordDays.length > 0 && selectedRecordDay) {
      const exists = recordDays.some(rd => rd.id === selectedRecordDay);
      if (!exists) {
        // Stored record day no longer exists, clear it
        setSelectedRecordDay("");
        try {
          localStorage.removeItem(RECORD_DAY_STORAGE_KEY);
        } catch (e) {
          console.error("Failed to clear invalid record day:", e);
        }
      }
    }
  }, [recordDays, selectedRecordDay]);

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery<SeatAssignment[]>({
    queryKey: ['/api/seat-assignments', selectedRecordDay],
    enabled: !!selectedRecordDay,
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ["/api/contestants"],
  });

  // Fetch block types for the selected record day
  const { data: blockTypes = [] } = useQuery<BlockType[]>({
    queryKey: ['/api/record-days', selectedRecordDay, 'block-types'],
    enabled: !!selectedRecordDay,
  });

  // Create a map of block number to block type for quick lookup
  const blockTypeMap = useMemo(() => {
    const map: Record<number, 'PB' | 'NPB'> = {};
    blockTypes.forEach(bt => {
      map[bt.blockNumber] = bt.blockType;
    });
    return map;
  }, [blockTypes]);

  // Helper function to get auto-populated casting category
  const getAutoCastingCategory = (contestant: Contestant | undefined, blockNumber: number): string => {
    // If contestant has a player type set, show that
    if (contestant?.playerType) {
      switch (contestant.playerType) {
        case 'player': return 'PLAYER';
        case 'player_partner': return 'PLAYER PARTNER';
        case 'backup': return 'BACKUP';
      }
    }
    // Otherwise, auto-populate based on block type
    const blockType = blockTypeMap[blockNumber];
    if (blockType === 'PB') return 'PODIUM';
    if (blockType === 'NPB') return 'NPB';
    return ''; // If block type not set
  };

  // SharePoint Excel integration - configuration will be done offline
  // This is a placeholder for future SharePoint integration
  const sharePointConfig: SharePointConfig = {
    sharePointUrl: null,
    isConfigured: false,
  };

  // Fetch standbys for the selected record day (for the dropdown)
  const { data: standbys = [] } = useQuery<StandbyAssignment[]>({
    queryKey: ['/api/standbys'],
  });

  // Filter standbys to get ones for the current record day
  const standbysForRecordDay = standbys.filter(s => s.recordDayId === selectedRecordDay);

  // Fetch email assets (images and PDFs) for attachments
  interface EmailAsset {
    path: string;
    name: string;
    contentType: string;
    size: number;
    url: string;
  }
  const { data: emailAssets = [] } = useQuery<EmailAsset[]>({
    queryKey: ["/api/email-assets"],
  });
  
  // Filter to only PDF assets for attachments
  const pdfAssets = emailAssets.filter(a => a.contentType === 'application/pdf');

  const updateWorkflowMutation = useMutation({
    mutationFn: async ({ assignmentId, fields }: { assignmentId: string; fields: Partial<SeatAssignment> }) => {
      return await apiRequest("PATCH", `/api/seat-assignments/${assignmentId}/workflow`, fields);
    },
    onMutate: async ({ assignmentId, fields }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/seat-assignments', selectedRecordDay] });
      
      // Snapshot the previous value
      const previousAssignments = queryClient.getQueryData<SeatAssignment[]>(['/api/seat-assignments', selectedRecordDay]);
      
      // Optimistically update the cache
      if (previousAssignments) {
        queryClient.setQueryData<SeatAssignment[]>(
          ['/api/seat-assignments', selectedRecordDay],
          previousAssignments.map(assignment => 
            assignment.id === assignmentId 
              ? { ...assignment, ...fields }
              : assignment
          )
        );
      }
      
      // Return context with the previous value for rollback
      return { previousAssignments };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousAssignments) {
        queryClient.setQueryData(
          ['/api/seat-assignments', selectedRecordDay],
          context.previousAssignments
        );
      }
      toast({
        title: "Update failed",
        description: "Could not save changes. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/paperwork'], exact: false });
      broadcastBookingChange(selectedRecordDay);
    },
  });

  // Mutation for updating standby workflow fields
  const updateStandbyWorkflowMutation = useMutation({
    mutationFn: async ({ standbyId, fields }: { standbyId: string; fields: Record<string, any> }) => {
      return await apiRequest("PATCH", `/api/standbys/${standbyId}/workflow`, fields);
    },
    onMutate: async ({ standbyId, fields }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/standbys'] });
      const previousStandbys = queryClient.getQueryData<StandbyAssignment[]>(['/api/standbys']);
      if (previousStandbys) {
        queryClient.setQueryData<StandbyAssignment[]>(
          ['/api/standbys'],
          previousStandbys.map(s => s.id === standbyId ? { ...s, ...fields } : s)
        );
      }
      return { previousStandbys };
    },
    onError: (err, variables, context) => {
      if (context?.previousStandbys) {
        queryClient.setQueryData(['/api/standbys'], context.previousStandbys);
      }
      toast({
        title: "Update failed",
        description: "Could not save standby changes. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Invalidate all standby-related queries to sync with Paperwork Tracker
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/standbys/record-day'], exact: false });
      broadcastBookingChange(selectedRecordDay);
    },
  });

  const handleStandbyWorkflowUpdate = (standbyId: string, field: string, value: any) => {
    updateStandbyWorkflowMutation.mutate({
      standbyId,
      fields: { [field]: value },
    });
  };

  // Handler to delete test subject contestants
  const handleDeleteTestSubject = async (contestantId: string) => {
    try {
      await apiRequest('DELETE', `/api/contestants/${contestantId}`);
      toast({
        title: "Test subject removed",
        description: "The contestant has been deleted from the system.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
    } catch (error: any) {
      toast({
        title: "Failed to delete",
        description: error?.message || "Could not delete contestant.",
        variant: "destructive",
      });
    }
  };

  const handleStandbyCheckboxToggle = (standbyId: string, field: string, currentValue: any, standbyName: string) => {
    const newValue = !currentValue;
    if (currentValue) {
      setUntickPending({
        assignmentId: standbyId,
        field,
        fieldLabel: getFieldLabel(field),
        contestantName: standbyName,
        isStandby: true,
      });
      setUntickConfirmOpen(true);
    } else {
      handleStandbyWorkflowUpdate(standbyId, field, new Date().toISOString());
    }
  };

  const handleStandbyDebouncedTextUpdate = (standbyId: string, field: string, value: string) => {
    const key = `standby-${standbyId}-${field}`;
    pendingTextUpdatesRef.current[key] = value;
    if (debounceTimersRef.current[key]) {
      clearTimeout(debounceTimersRef.current[key]);
    }
    debounceTimersRef.current[key] = setTimeout(() => {
      updateStandbyWorkflowMutation.mutate({
        standbyId,
        fields: { [field]: value },
      });
      delete pendingTextUpdatesRef.current[key];
      delete debounceTimersRef.current[key];
    }, 500);
  };

  const sendBookingEmailsMutation = useMutation({
    mutationFn: async ({ seatAssignmentIds, emailSubject, emailBody, attachmentPaths }: { seatAssignmentIds: string[]; emailSubject: string; emailBody?: string; attachmentPaths?: string[] }) => {
      return await apiRequest("POST", "/api/booking-confirmations/send", { 
        seatAssignmentIds,
        emailSubject,
        emailBody,
        attachmentPaths
      });
    },
    onSuccess: (data: any) => {
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.success).length;
      const failCount = results.filter((r: any) => !r.success).length;
      
      toast({
        title: "Booking Emails Sent",
        description: successCount > 0 
          ? `${successCount} email(s) sent successfully${failCount > 0 ? `, ${failCount} failed` : ''}.`
          : "Email processing completed.",
      });
      
      setSelectedAssignments(new Set());
      setEmailPreviewOpen(false);
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/booking-confirmations'], exact: false });
      broadcastBookingChange(selectedRecordDay);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send booking emails",
        variant: "destructive",
      });
    },
  });

  // Bulk mark no-shows mutation
  const bulkNoShowMutation = useMutation({
    mutationFn: async ({ assignmentIds, recordDayId }: { assignmentIds: string[]; recordDayId: string }) => {
      return await apiRequest("POST", "/api/attendance-issues/bulk-no-show", { 
        assignmentIds,
        recordDayId,
        markedBy: "Booking Master"
      });
    },
    onSuccess: (data: any) => {
      const count = data?.count || 0;
      toast({
        title: "No-Shows Marked",
        description: `${count} contestant(s) marked as no-show and removed from seats.`,
      });
      
      setShowNoShowConfirm(false);
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/attendance-issues'], exact: false });
      broadcastBookingChange(selectedRecordDay);
      broadcastSeatingChange(selectedRecordDay);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to mark no-shows",
        variant: "destructive",
      });
    },
  });

  const generateAllSeats = (): BookingRow[] => {
    const rows: BookingRow[] = [];
    
    for (let blockNum = 1; blockNum <= BLOCKS; blockNum++) {
      for (const row of ROWS) {
        for (let seatNum = 1; seatNum <= row.count; seatNum++) {
          const seatLabel = `${row.label}${seatNum}`;
          const seatId = `${String(blockNum).padStart(2, '0')}-${seatLabel}`;
          
          const assignment = assignments.find(
            (a) => a.blockNumber === blockNum && a.seatLabel === seatLabel
          );
          
          const contestant = assignment 
            ? contestants.find(c => c.id === assignment.contestantId)
            : undefined;

          rows.push({
            seatId,
            blockNumber: blockNum,
            seatLabel,
            assignment,
            contestant,
          });
        }
      }
    }
    
    rows.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      const rowOrder = ['A', 'B', 'C', 'D', 'E'];
      const aRow = a.seatLabel[0];
      const bRow = b.seatLabel[0];
      const aRowIdx = rowOrder.indexOf(aRow);
      const bRowIdx = rowOrder.indexOf(bRow);
      if (aRowIdx !== bRowIdx) return aRowIdx - bRowIdx;
      const aNum = parseInt(a.seatLabel.slice(1));
      const bNum = parseInt(b.seatLabel.slice(1));
      return aNum - bNum;
    });
    
    return rows;
  };

  const allBookingRows = selectedRecordDay ? generateAllSeats() : [];
  const bookingRows = allBookingRows.filter(row => {
    // Filter by name search - searches both name and attending with columns
    if (searchName.trim()) {
      const searchLower = searchName.toLowerCase();
      const nameMatch = row.contestant?.name.toLowerCase().includes(searchLower);
      const attendingWithMatch = row.contestant?.attendingWith?.toLowerCase().includes(searchLower);
      if (!nameMatch && !attendingWithMatch) {
        return false;
      }
    }
    // Filter by medical information (includes both Medical App and Medical AUD, excludes NA/N/A)
    if (filterMedicalNotes && !hasMeaningfulMedicalNote(row.contestant?.medicalInfo) && !hasMeaningfulMedicalNote(row.contestant?.mobilityNotes)) {
      return false;
    }
    // Filter to only show confirmed RSVP
    if (filterConfirmedOnly && !row.assignment?.confirmedRsvp) {
      return false;
    }
    // Filter to only show those with paperwork NOT sent (when confirmed filter is active)
    if (filterConfirmedOnly && filterPaperworkNotSent && row.assignment?.paperworkSent) {
      return false;
    }
    // Filter to only show those NOT signed in (when check-in mode is active)
    if (isCheckInMode && filterNotSignedIn && row.assignment?.signedIn) {
      return false;
    }
    return true;
  });

  const handleFieldUpdate = (assignmentId: string, field: string, value: any) => {
    updateWorkflowMutation.mutate({
      assignmentId,
      fields: { [field]: value },
    });
  };

  // Debounced handler for text fields - waits 500ms after user stops typing before saving
  // Uses refs to avoid re-rendering the entire table on each keystroke
  const handleDebouncedTextUpdate = (assignmentId: string, field: string, value: string) => {
    const key = `${assignmentId}-${field}`;
    
    // Store in ref (no re-render)
    pendingTextUpdatesRef.current[key] = value;
    
    // Clear any existing timer for this field
    if (debounceTimersRef.current[key]) {
      clearTimeout(debounceTimersRef.current[key]);
    }
    
    // Set new timer to save after 500ms of no typing
    debounceTimersRef.current[key] = setTimeout(() => {
      updateWorkflowMutation.mutate({
        assignmentId,
        fields: { [field]: value },
      });
      delete pendingTextUpdatesRef.current[key];
      delete debounceTimersRef.current[key];
    }, 500);
  };

  // Field labels for confirmation dialog
  const getFieldLabel = (field: string): string => {
    const labels: Record<string, string> = {
      confirmedRsvp: "RSVP Confirmed",
      paperworkSent: "Paperwork Sent",
      paperworkReceived: "Paperwork Received",
      paperworkOnDay: "OTD Paperwork",
      signedIn: "Signed In",
    };
    return labels[field] || field;
  };

  // Get contestant name from assignment ID
  const getContestantNameForAssignment = (assignmentId: string): string => {
    const row = bookingRows.find(r => r.assignment?.id === assignmentId);
    return row?.contestant?.name || "Unknown Contestant";
  };

  const handleCheckboxToggle = (assignmentId: string, field: string, currentValue: any) => {
    const newValue = !currentValue;
    
    // If unticking (currentValue is truthy), show confirmation dialog
    if (currentValue) {
      setUntickPending({
        assignmentId,
        field,
        fieldLabel: getFieldLabel(field),
        contestantName: getContestantNameForAssignment(assignmentId),
      });
      setUntickConfirmOpen(true);
    } else {
      // Ticking on - proceed directly
      handleFieldUpdate(assignmentId, field, newValue);
    }
  };

  const handleConfirmUntick = () => {
    if (untickPending) {
      if (untickPending.isStandby) {
        // Use standby workflow update for standbys
        handleStandbyWorkflowUpdate(untickPending.assignmentId, untickPending.field, null);
      } else {
        // Use regular assignment update
        handleFieldUpdate(untickPending.assignmentId, untickPending.field, false);
      }
      toast({ 
        title: `${untickPending.fieldLabel} unticked`,
        description: `Cleared for ${untickPending.contestantName}`
      });
    }
    setUntickConfirmOpen(false);
    setUntickPending(null);
  };

  const handleCancelUntick = () => {
    setUntickConfirmOpen(false);
    setUntickPending(null);
  };

  const handleSelectAssignment = (assignmentId: string, checked: boolean) => {
    const newSelection = new Set(selectedAssignments);
    if (checked) {
      newSelection.add(assignmentId);
    } else {
      newSelection.delete(assignmentId);
    }
    setSelectedAssignments(newSelection);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allAssignmentIds = new Set(
        bookingRows
          .filter(row => row.assignment)
          .map(row => row.assignment!.id)
      );
      setSelectedAssignments(allAssignmentIds);
    } else {
      setSelectedAssignments(new Set());
    }
  };

  const handleSendBookingEmails = () => {
    if (selectedAssignments.size === 0) {
      toast({
        title: "No contestants selected",
        description: "Please select at least one contestant to send booking emails",
        variant: "destructive",
      });
      return;
    }
    setConfirmSendOpen(true);
  };

  const handleConfirmSend = () => {
    sendBookingEmailsMutation.mutate({
      seatAssignmentIds: Array.from(selectedAssignments),
      emailSubject,
      emailBody: undefined
    });
    setConfirmSendOpen(false);
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const exportToExcel = () => {
    if (!selectedRecordDay || bookingRows.length === 0) {
      return;
    }

    const selectedDay = recordDays.find(d => d.id === selectedRecordDay);
    const dayName = selectedDay ? format(new Date(selectedDay.date), "d-MMMM-yyyy") : "booking-master";
    const dayDate = selectedDay ? format(new Date(selectedDay.date), "d MMMM yyyy") : "";

    const headers = [
      "SEAT", "NAME", "MOBILE", "EMAIL", "AGE", "ATTENDING WITH", "LOCATION", 
      "MEDICAL - APP", "MEDICAL - AUD", "CRIMINAL / BANKRUPTCY", 
      "CASTING CATEGORY", "NOTES", "BOOKING EMAIL SENT", "CONFIRMED RSVP", 
      "PAPERWORK SENT", "PAPERWORK ✓", "OTD PAPER WORK", "SIGNED-IN", "OTD NOTES", 
      "STANDBY REPLACEMENT / SWAPS"
    ];

    const exportRows: (string | number)[][] = [];
    
    exportRows.push([`Booking Master - ${dayDate}`]);
    exportRows.push([]);
    exportRows.push(headers);

    let currentBlock = 0;
    for (const row of bookingRows) {
      if (row.blockNumber !== currentBlock) {
        currentBlock = row.blockNumber;
        const blockAssignments = bookingRows.filter(r => r.blockNumber === currentBlock && r.assignment);
        const blockFemaleCount = blockAssignments.filter(r => r.contestant?.gender === 'Female').length;
        const blockMaleCount = blockAssignments.filter(r => r.contestant?.gender === 'Male').length;
        const blockTotal = blockAssignments.length;
        const femalePercent = blockTotal > 0 ? Math.round((blockFemaleCount / blockTotal) * 100) : 0;
        
        exportRows.push([]);
        const blockHeader = blockTotal > 0 
          ? `BLOCK ${currentBlock} - ${blockTotal} assigned | ${blockFemaleCount}F / ${blockMaleCount}M (${femalePercent}% female)`
          : `BLOCK ${currentBlock}`;
        exportRows.push([blockHeader]);
      }
      
      // Build standby/swaps column value - include swap info if applicable
      let standbySwapsValue = row.assignment?.standbyReplacementSwaps || "";
      if (row.assignment?.swappedAt && row.assignment?.originalBlockNumber && row.assignment?.originalSeatLabel) {
        const swapInfo = `Was: ${row.assignment.originalBlockNumber}-${row.assignment.originalSeatLabel}`;
        standbySwapsValue = standbySwapsValue ? `${swapInfo} | ${standbySwapsValue}` : swapInfo;
      }
      
      exportRows.push([
        row.seatId,
        row.contestant?.name || "",
        row.contestant?.phone || "",
        row.contestant?.email || "",
        row.contestant?.age || "",
        row.contestant?.attendingWith || "",
        row.contestant?.location || "",
        row.contestant?.medicalInfo || "",
        row.contestant?.mobilityNotes || "",
        row.contestant?.criminalRecord || "",
        row.assignment?.castingCategory || "",
        row.assignment?.notes || "",
        row.assignment?.bookingEmailSent ? "✓" : "",
        row.assignment?.confirmedRsvp ? "✓" : "",
        row.assignment?.paperworkSent ? "✓" : "",
        row.assignment?.paperworkReceived ? "✓" : "",
        row.assignment?.paperworkOnDay ? "✓" : "",
        row.assignment?.signedIn ? "✓" : "",
        row.assignment?.otdNotes || "",
        standbySwapsValue,
      ]);
    }

    // Add standbys section at the bottom
    if (standbysForRecordDay.length > 0) {
      exportRows.push([]);
      exportRows.push([]);
      const standbyCount = standbysForRecordDay.length;
      exportRows.push([`STANDBYS - ${standbyCount} total`]);
      exportRows.push(headers);

      // Sort standbys by priority (lower number = higher priority)
      const sortedStandbys = [...standbysForRecordDay].sort((a, b) => (a.priority || 999) - (b.priority || 999));

      for (const standby of sortedStandbys) {
        const contestant = standby.contestant;
        exportRows.push([
          `S${standby.priority || "-"}`, // Use priority as "seat" indicator
          contestant?.name || "",
          contestant?.phone || "",
          contestant?.email || "",
          contestant?.age || "",
          contestant?.attendingWith || "",
          contestant?.location || "",
          contestant?.medicalInfo || "",
          contestant?.mobilityNotes || "",
          contestant?.criminalRecord || "",
          "", // No casting category for standbys
          standby.notes || "",
          standby.bookingEmailSent ? "✓" : "",
          standby.confirmedRsvp ? "✓" : "",
          standby.paperworkSent ? "✓" : "",
          standby.paperworkReceived ? "✓" : "",
          standby.paperworkOnDay ? "✓" : "",
          standby.signedIn ? "✓" : "",
          standby.otdNotes || "",
          standby.standbyMovementNotes || "",
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    
    XLSX.utils.book_append_sheet(wb, ws, "Booking Master");

    ws['!cols'] = [
      { wch: 10 },  // SEAT
      { wch: 20 },  // NAME
      { wch: 15 },  // MOBILE
      { wch: 25 },  // EMAIL
      { wch: 6 },   // AGE
      { wch: 15 },  // ATTENDING WITH
      { wch: 15 },  // LOCATION
      { wch: 15 },  // MEDICAL - APP
      { wch: 15 },  // MEDICAL - AUD
      { wch: 18 },  // CRIMINAL / BANKRUPTCY
      { wch: 15 },  // CASTING CATEGORY
      { wch: 25 },  // NOTES
      { wch: 15 },  // BOOKING EMAIL SENT
      { wch: 12 },  // CONFIRMED RSVP
      { wch: 14 },  // PAPERWORK SENT
      { wch: 12 },  // PAPERWORK ✓
      { wch: 14 },  // OTD PAPER WORK
      { wch: 10 },  // SIGNED-IN
      { wch: 20 },  // OTD NOTES
      { wch: 25 },  // STANDBY REPLACEMENT / SWAPS
    ];

    XLSX.writeFile(wb, `Booking-Master-${dayName}.xlsx`);
  };

  return (
    <div className={isFullscreen ? "fixed inset-0 flex flex-col p-2 bg-background gap-1" : "p-6 space-y-6"}>
      <div className={`flex items-center justify-between flex-shrink-0 ${isFullscreen ? 'gap-2' : ''}`}>
        <div>
          <h1 className={isFullscreen ? "text-lg font-bold" : "text-3xl font-bold"}>Booking Master</h1>
          {!isFullscreen && (
            <p className="text-muted-foreground mt-1">
              Complete booking workflow tracking for each record day
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {selectedAssignments.size > 0 && (
            <Button 
              onClick={() => setEmailPreviewOpen(true)}
              disabled={sendBookingEmailsMutation.isPending}
              data-testid="button-send-booking-emails"
            >
              <Mail className={`h-4 w-4 mr-2 ${sendBookingEmailsMutation.isPending ? 'animate-pulse' : ''}`} />
              Send Booking Emails ({selectedAssignments.size})
            </Button>
          )}
          
          <Button onClick={exportToExcel} variant="outline" data-testid="button-export-excel">
            <Download className="h-4 w-4 mr-2" />
            Export to Excel
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" title="Toggle Columns" data-testid="button-toggle-columns">
                <Columns className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_CONFIG.filter(col => !col.alwaysVisible).map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={visibleColumns[column.id]}
                  onCheckedChange={() => toggleColumnVisibility(column.id)}
                  data-testid={`toggle-column-${column.id}`}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button 
            onClick={toggleCheckInMode}
            variant={isCheckInMode ? "default" : "outline"}
            className={isCheckInMode ? "bg-teal-600 hover:bg-teal-700 text-white" : "border-teal-500 text-teal-600 hover:bg-teal-50 dark:border-teal-400 dark:text-teal-400 dark:hover:bg-teal-950"}
            title={isCheckInMode ? "Exit Check In mode" : "Enter Check In mode - shows only check-in relevant columns"}
            data-testid="button-check-in-mode"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Check In
          </Button>
          
          {isCheckInMode && (
            <Button 
              onClick={() => setFilterNotSignedIn(!filterNotSignedIn)}
              variant={filterNotSignedIn ? "default" : "outline"}
              className={filterNotSignedIn ? "bg-red-600 hover:bg-red-700 text-white" : "border-red-400 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950"}
              title={filterNotSignedIn ? "Show all contestants" : "Show only those NOT signed in yet"}
              data-testid="button-filter-not-signed-in"
            >
              Not Signed In
            </Button>
          )}
          
          {isCheckInMode && filterNotSignedIn && bookingRows.filter(r => r.assignment?.id).length > 0 && (
            <Button 
              onClick={() => setShowNoShowConfirm(true)}
              variant="destructive"
              className="bg-red-700 hover:bg-red-800"
              title="Mark all visible contestants as no-shows"
              data-testid="button-mark-all-no-show"
              disabled={bulkNoShowMutation.isPending}
            >
              {bulkNoShowMutation.isPending ? "Processing..." : `Mark All as No Show (${bookingRows.filter(r => r.assignment?.id).length})`}
            </Button>
          )}
          
          <Button 
            onClick={() => {
              setFilterConfirmedOnly(!filterConfirmedOnly);
              if (filterConfirmedOnly) setFilterPaperworkNotSent(false); // Reset secondary filter when turning off
            }}
            variant={filterConfirmedOnly ? "default" : "outline"}
            title={filterConfirmedOnly ? "Show all contestants" : "Show only confirmed RSVP"}
            data-testid="button-filter-confirmed"
          >
            Confirmed Only
          </Button>

          {filterConfirmedOnly && (
            <>
              <Button 
                onClick={() => {
                  const emails = bookingRows
                    .filter(row => row.contestant?.email)
                    .map(row => row.contestant!.email!)
                    .filter((email, index, self) => self.indexOf(email) === index);
                  if (emails.length > 0) {
                    navigator.clipboard.writeText(emails.join("; "));
                    toast({ title: `Copied ${emails.length} email${emails.length !== 1 ? 's' : ''} to clipboard` });
                  } else {
                    toast({ title: "No emails to copy", variant: "destructive" });
                  }
                }}
                variant="outline"
                className="border-green-400 text-green-700 hover:bg-green-50 dark:border-green-600 dark:text-green-400"
                title="Copy emails of all currently visible contestants to clipboard"
                data-testid="button-copy-all-emails"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Visible Emails ({bookingRows.filter(r => r.contestant?.email).length})
              </Button>
              <Button 
                onClick={() => setFilterPaperworkNotSent(!filterPaperworkNotSent)}
                variant={filterPaperworkNotSent ? "default" : "outline"}
                className={filterPaperworkNotSent ? "bg-orange-600 hover:bg-orange-700" : "border-orange-400 text-orange-700 hover:bg-orange-50 dark:border-orange-600 dark:text-orange-400"}
                title={filterPaperworkNotSent ? "Show all confirmed" : "Show only those without paperwork sent"}
                data-testid="button-filter-paperwork-not-sent"
              >
                Paperwork Not Sent
              </Button>
            </>
          )}

          <Button 
            onClick={() => setFilterMedicalNotes(!filterMedicalNotes)}
            variant={filterMedicalNotes ? "default" : "outline"}
            title={filterMedicalNotes ? "Show all contestants" : "Show only contestants with medical notes (App or AUD)"}
            data-testid="button-filter-medical-notes"
          >
            Show Medical Notes
          </Button>

          <Button 
            onClick={() => setIsEditMode(!isEditMode)}
            variant={isEditMode ? "default" : "outline"}
            title={isEditMode ? "Exit edit mode" : "Edit attending with and medical notes"}
            data-testid="button-toggle-edit-mode"
          >
            <Pencil className="h-4 w-4 mr-1" />
            {isEditMode ? "Done Editing" : "Edit Fields"}
          </Button>

          <Button 
            onClick={handleToggleFullscreen} 
            variant="outline" 
            size="icon"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            data-testid="button-toggle-fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className={`flex items-center flex-shrink-0 gap-2 ${isFullscreen ? 'flex-wrap' : 'gap-4'}`}>
        <Calendar className={isFullscreen ? "h-4 w-4 text-muted-foreground" : "h-5 w-5 text-muted-foreground"} />
        <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
          <SelectTrigger className={isFullscreen ? "w-48" : "w-80"} data-testid="select-record-day">
            <SelectValue placeholder="Select a record day" />
          </SelectTrigger>
          <SelectContent>
            {recordDays.map((day) => (
              <SelectItem key={day.id} value={day.id} data-testid={`option-record-day-${day.id}`}>
                {format(new Date(day.date), "EEE, d MMMM yyyy")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRecordDay && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-md border bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800">
            <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <Label htmlFor="standby-toggle" className="text-sm font-medium text-purple-700 dark:text-purple-300 cursor-pointer">
              Standby
            </Label>
            <Switch
              id="standby-toggle"
              checked={isStandbyMode}
              onCheckedChange={setIsStandbyMode}
              data-testid="toggle-standby-mode"
            />
          </div>
        )}
        {selectedRecordDay && (
          <Input
            placeholder="Search by name..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className={isFullscreen ? "w-48" : "w-64"}
            data-testid="input-search-name"
          />
        )}
        {selectedAssignments.size > 0 && (
          <Badge variant="secondary" data-testid="badge-selected-count">
            {selectedAssignments.size} selected
          </Badge>
        )}
      </div>

      {selectedRecordDay && (
        <div 
          ref={tableContainerRef}
          className="border rounded-md overflow-auto flex-1" 
          style={isFullscreen ? { minHeight: 0 } : { maxHeight: "calc(100vh - 300px)" }}
        >
          {loadingAssignments ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading...
            </div>
          ) : isStandbyMode ? (
            /* Standby Booking Master Table */
            <Table>
              <TableHeader className="sticky top-0 z-50">
                <TableRow className="bg-purple-700 dark:bg-purple-900 h-10">
                  <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 w-10 text-white font-semibold border-r border-purple-500 dark:border-purple-700">#</TableHead>
                  <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 w-16 text-white font-semibold border-r border-purple-500 dark:border-purple-700">STATUS</TableHead>
                  {isColumnVisible("name") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 min-w-[120px] text-white font-semibold border-r border-purple-500 dark:border-purple-700">NAME</TableHead>}
                  {isColumnVisible("mobile") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 min-w-[100px] text-white font-semibold border-r border-purple-500 dark:border-purple-700">MOBILE</TableHead>}
                  {isColumnVisible("email") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 w-48 min-w-[180px] text-white font-semibold border-r border-purple-500 dark:border-purple-700">EMAIL</TableHead>}
                  {isColumnVisible("attendingWith") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 text-white font-semibold border-r border-purple-500 dark:border-purple-700">ATTENDING<br/>WITH</TableHead>}
                  {isColumnVisible("location") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 text-white font-semibold border-r border-purple-500 dark:border-purple-700">LOCATION</TableHead>}
                  {isColumnVisible("mobilityNotes") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 text-white font-semibold border-r border-purple-500 dark:border-purple-700">MEDICAL -<br/>AUD</TableHead>}
                  {isColumnVisible("criminal") && <TableHead className="sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 w-20 text-center text-white font-semibold border-r border-purple-500 dark:border-purple-700">CRIMINAL /<br/>BANKRUPTCY</TableHead>}
                  {isColumnVisible("notes") && <TableHead className={`sticky top-0 bg-purple-700 dark:bg-purple-900 z-50 text-[10px] py-1 border-r-4 border-r-purple-400 text-white font-semibold ${isFullscreen ? 'min-w-[200px]' : 'min-w-[300px]'}`}>NOTES</TableHead>}
                  {isColumnVisible("emailSent") && <TableHead className="sticky top-0 bg-purple-200 dark:bg-purple-800 z-50 text-[10px] py-1 px-2 text-center w-14 text-purple-900 dark:text-white font-semibold border-r border-purple-300 dark:border-purple-600">BOOKING<br/>EMAIL<br/>SENT</TableHead>}
                  {isColumnVisible("rsvp") && <TableHead className="sticky top-0 bg-purple-200 dark:bg-purple-800 z-50 text-[10px] py-1 px-2 text-center w-14 text-purple-900 dark:text-white font-semibold border-r border-purple-300 dark:border-purple-600">CONFIRM<br/>ED RSVP</TableHead>}
                  {isColumnVisible("paperSent") && <TableHead className="sticky top-0 bg-purple-200 dark:bg-purple-800 z-50 text-[10px] py-1 px-2 text-center w-14 text-purple-900 dark:text-white font-semibold border-r border-purple-300 dark:border-purple-600">PAPER<br/>WORK<br/>SENT</TableHead>}
                  {isColumnVisible("paperReceived") && <TableHead className="sticky top-0 bg-purple-200 dark:bg-purple-800 z-50 text-[10px] py-1 px-2 text-center w-14 text-purple-900 dark:text-white font-semibold border-r border-purple-300 dark:border-purple-600">PAPER<br/>WORK<br/>RECV<br/>& LOGGED</TableHead>}
                  {isColumnVisible("otdHardCopy") && <TableHead className="sticky top-0 bg-amber-400 dark:bg-amber-700 z-50 text-[10px] py-1 px-2 text-center w-14 text-amber-900 dark:text-white font-semibold border-r border-amber-500 dark:border-amber-600">OTD<br/>PAPER<br/>WORK</TableHead>}
                  {isColumnVisible("signedIn") && <TableHead className="sticky top-0 bg-green-200 dark:bg-green-800 z-50 text-[10px] py-1 px-2 text-center w-14 text-green-900 dark:text-white font-semibold border-r border-green-300 dark:border-green-600">SIGNED<br/>IN</TableHead>}
                  {isColumnVisible("otdNotes") && <TableHead className="sticky top-0 bg-purple-200 dark:bg-purple-800 z-50 text-[10px] py-1 px-2 text-center min-w-[120px] text-purple-900 dark:text-white font-semibold border-r border-purple-300 dark:border-purple-600">OTD NOTES</TableHead>}
                  <TableHead className="sticky top-0 bg-purple-200 dark:bg-purple-800 z-50 text-[10px] py-1 px-2 text-center w-20 text-purple-900 dark:text-white font-semibold">ASSIGNED<br/>TO SEAT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standbysForRecordDay
                  .filter(standby => {
                    if (!searchName) return true;
                    const search = searchName.toLowerCase();
                    const nameMatch = standby.contestant.name.toLowerCase().includes(search);
                    const attendingWithMatch = standby.contestant.attendingWith?.toLowerCase().includes(search) || false;
                    return nameMatch || attendingWithMatch;
                  })
                  .map((standby, index) => {
                    const contestant = contestants.find(c => c.id === standby.contestantId);
                    return (
                      <TableRow key={standby.id} className="bg-purple-50 dark:bg-purple-950/20 h-7 border-b border-purple-200 dark:border-purple-800">
                        <TableCell className="font-mono text-xs py-0.5 h-7 w-10 text-purple-700 dark:text-purple-300 font-semibold border-r border-purple-200 dark:border-purple-800">{index + 1}</TableCell>
                        <TableCell className="py-0.5 h-7 border-r border-purple-200 dark:border-purple-800">
                          <Badge 
                            variant="secondary" 
                            className={`text-[10px] ${
                              standby.status === 'confirmed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                              standby.status === 'seated' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                              standby.status === 'declined' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                              standby.status === 'email_sent' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                            }`}
                          >
                            {standby.status === 'pending' ? 'Assigned' :
                             standby.status === 'email_sent' ? 'Invited' :
                             standby.status === 'seated' ? 'Assigned' :
                             standby.status === 'confirmed' ? 'Confirmed' :
                             standby.status === 'declined' ? 'Declined' :
                             standby.status}
                          </Badge>
                        </TableCell>
                        {isColumnVisible("name") && (
                          <TableCell className="font-medium text-xs min-w-[150px] py-0.5 h-7 border-r border-purple-200 dark:border-purple-800">
                            <div className="flex items-center gap-1">
                              {standby.contestant.name}
                              {standby.contestant.isTemporary && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">
                                  TEMP
                                </Badge>
                              )}
                              {(standby.contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(standby.contestant.name)) && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                                  TEST
                                </Badge>
                              )}
                              {(standby.contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(standby.contestant.name)) && standby.contestantId && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Remove test subject ${standby.contestant.name}?`)) {
                                      handleDeleteTestSubject(standby.contestantId);
                                    }
                                  }}
                                  title="Remove test subject"
                                  data-testid={`button-delete-standby-test-subject-${standby.contestantId}`}
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {isColumnVisible("mobile") && <TableCell className="text-xs min-w-[120px] py-0.5 h-7 border-r border-purple-200 dark:border-purple-800">{standby.contestant.phone || ""}</TableCell>}
                        {isColumnVisible("email") && <TableCell className="text-xs py-0.5 h-7 w-48 min-w-[180px] truncate border-r border-purple-200 dark:border-purple-800" title={standby.contestant.email || ""}>{standby.contestant.email || ""}</TableCell>}
                        {isColumnVisible("attendingWith") && <TableCell className="text-xs py-0.5 h-7 min-w-[140px] border-r border-purple-200 dark:border-purple-800">{contestant?.attendingWith || ""}</TableCell>}
                        {isColumnVisible("location") && <TableCell className="text-xs py-0.5 h-7 border-r border-purple-200 dark:border-purple-800">{contestant?.location || ""}</TableCell>}
                        {isColumnVisible("mobilityNotes") && <TableCell className="text-xs py-0.5 h-7 border-r border-purple-200 dark:border-purple-800">{contestant?.mobilityNotes || ""}</TableCell>}
                        {isColumnVisible("criminal") && <TableCell className="text-xs py-0.5 h-7 w-20 text-center border-r border-purple-200 dark:border-purple-800">{contestant?.criminalRecord || ""}</TableCell>}
                        {isColumnVisible("notes") && (
                          <TableCell className="border-r-4 border-r-purple-400 py-0.5 text-xs">
                            {(standby as any).standbyMovementNotes || standby.notes || ""}
                          </TableCell>
                        )}
                        {isColumnVisible("emailSent") && (
                          <TableCell className="py-0.5 h-7 text-center border-r border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20">
                            <Checkbox
                              checked={!!standby.bookingEmailSent}
                              onCheckedChange={() => handleStandbyCheckboxToggle(standby.id, 'bookingEmailSent', standby.bookingEmailSent, standby.contestant.name)}
                              className="h-4 w-4"
                              data-testid={`checkbox-standby-booking-email-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {isColumnVisible("rsvp") && (
                          <TableCell className="py-0.5 h-7 text-center border-r border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20">
                            <Checkbox
                              checked={!!standby.confirmedRsvp}
                              onCheckedChange={() => handleStandbyCheckboxToggle(standby.id, 'confirmedRsvp', standby.confirmedRsvp, standby.contestant.name)}
                              className="h-4 w-4"
                              data-testid={`checkbox-standby-rsvp-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {isColumnVisible("paperSent") && (
                          <TableCell className="py-0.5 h-7 text-center border-r border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20">
                            <Checkbox
                              checked={!!standby.paperworkSent}
                              onCheckedChange={() => handleStandbyCheckboxToggle(standby.id, 'paperworkSent', standby.paperworkSent, standby.contestant.name)}
                              className="h-4 w-4"
                              data-testid={`checkbox-standby-paperwork-sent-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {isColumnVisible("paperReceived") && (
                          <TableCell className="py-0.5 h-7 text-center border-r border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20">
                            <Checkbox
                              checked={!!standby.paperworkReceived}
                              onCheckedChange={() => handleStandbyCheckboxToggle(standby.id, 'paperworkReceived', standby.paperworkReceived, standby.contestant.name)}
                              className="h-4 w-4"
                              data-testid={`checkbox-standby-paperwork-recv-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {isColumnVisible("otdHardCopy") && (
                          <TableCell className="py-0.5 h-7 text-center border-r border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
                            <Checkbox
                              checked={!!standby.paperworkOnDay}
                              onCheckedChange={() => handleStandbyCheckboxToggle(standby.id, 'paperworkOnDay', standby.paperworkOnDay, standby.contestant.name)}
                              className="h-4 w-4"
                              data-testid={`checkbox-standby-otd-paperwork-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {isColumnVisible("signedIn") && (
                          <TableCell className="py-0.5 h-7 text-center border-r border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20">
                            <Checkbox
                              checked={!!standby.signedIn}
                              onCheckedChange={() => handleStandbyCheckboxToggle(standby.id, 'signedIn', standby.signedIn, standby.contestant.name)}
                              className="h-4 w-4"
                              data-testid={`checkbox-standby-signed-in-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {isColumnVisible("otdNotes") && (
                          <TableCell className="py-0.5 h-7 border-r border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20">
                            <Input
                              defaultValue={standby.otdNotes || ""}
                              placeholder="OTD Notes"
                              onChange={(e) => handleStandbyDebouncedTextUpdate(standby.id, 'otdNotes', e.target.value)}
                              className="h-5 text-xs border-0 bg-transparent px-1"
                              data-testid={`input-standby-otd-notes-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="py-0.5 h-7 text-center">
                          {standby.assignedToSeat ? (
                            <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                              {standby.assignedToSeat}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                {standbysForRecordDay.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No standbys assigned for this record day
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-50">
                <TableRow className="bg-[#00363a] dark:bg-[#002628] h-10">
                  <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 w-8 py-1 text-white border-r border-gray-300 dark:border-gray-600">
                    <Checkbox
                      checked={selectedAssignments.size > 0 && selectedAssignments.size === bookingRows.filter(r => r.assignment).length}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                      className="border-white data-[state=checked]:bg-white data-[state=checked]:text-[#00363a]"
                    />
                  </TableHead>
                  {isColumnVisible("seat") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 w-14 text-white font-semibold whitespace-nowrap border-r border-gray-300 dark:border-gray-600">SEAT</TableHead>}
                  {isColumnVisible("name") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 min-w-[120px] text-white font-semibold border-r border-gray-300 dark:border-gray-600">NAME</TableHead>}
                  {isColumnVisible("mobile") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 min-w-[100px] text-white font-semibold border-r border-gray-300 dark:border-gray-600">MOBILE</TableHead>}
                  {isColumnVisible("email") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 w-48 min-w-[180px] text-white font-semibold border-r border-gray-300 dark:border-gray-600">EMAIL</TableHead>}
                  {isColumnVisible("attendingWith") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 text-white font-semibold border-r border-gray-300 dark:border-gray-600">ATTENDING<br/>WITH</TableHead>}
                  {isColumnVisible("location") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 text-white font-semibold border-r border-gray-300 dark:border-gray-600">LOCATION</TableHead>}
                  {isColumnVisible("medicalQ") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 text-white font-semibold border-r border-gray-300 dark:border-gray-600">MEDICAL -<br/>APP</TableHead>}
                  {isColumnVisible("mobilityNotes") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 text-white font-semibold border-r border-gray-300 dark:border-gray-600">MEDICAL -<br/>AUD</TableHead>}
                  {isColumnVisible("criminal") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 w-20 text-center text-white font-semibold border-r border-gray-300 dark:border-gray-600">CRIMINAL /<br/>BANKRUPTCY</TableHead>}
                  {isColumnVisible("castingCategory") && <TableHead className="sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 text-white font-semibold border-r border-gray-300 dark:border-gray-600">CASTING<br/>CATEGORY</TableHead>}
                  {isColumnVisible("notes") && <TableHead className={`sticky top-0 bg-[#00363a] dark:bg-[#002628] z-50 text-[10px] py-1 border-r-4 border-r-[#1a6b6b] text-white font-semibold ${isFullscreen ? 'min-w-[200px]' : 'min-w-[300px]'}`}>NOTES</TableHead>}
                  {isColumnVisible("emailSent") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-50 text-[10px] py-1 px-2 text-center w-14 text-[#00363a] dark:text-white font-semibold border-r border-gray-300 dark:border-gray-600">BOOKING<br/>EMAIL<br/>SENT</TableHead>}
                  {isColumnVisible("rsvp") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-50 text-[10px] py-1 px-2 text-center w-14 text-[#00363a] dark:text-white font-semibold border-r border-gray-300 dark:border-gray-600">CONFIRM<br/>ED RSVP</TableHead>}
                  {isColumnVisible("paperSent") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-50 text-[10px] py-1 px-2 text-center w-14 text-[#00363a] dark:text-white font-semibold border-r border-gray-300 dark:border-gray-600">PAPER<br/>WORK<br/>SENT</TableHead>}
                  {isColumnVisible("paperReceived") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-50 text-[10px] py-1 px-2 text-center w-14 text-[#00363a] dark:text-white font-semibold border-r border-gray-300 dark:border-gray-600">PAPER<br/>WORK<br/>RECEIVED<br/>& LOGGED</TableHead>}
                  {isColumnVisible("otdHardCopy") && <TableHead className="sticky top-0 bg-[#f59e0b] dark:bg-[#b45309] z-50 text-[10px] py-1 px-2 text-center w-14 text-white font-semibold border-r border-gray-300 dark:border-gray-600">OTD<br/>PAPER<br/>WORK</TableHead>}
                  {isColumnVisible("signedIn") && <TableHead className="sticky top-0 bg-[#a8d4a8] dark:bg-[#2a5a3a] z-50 text-[10px] py-1 px-2 text-center w-14 text-[#00363a] dark:text-white font-semibold border-r border-gray-300 dark:border-gray-600">SIGNED<br/>IN</TableHead>}
                  {isColumnVisible("otdNotes") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-50 text-[10px] py-1 px-2 text-center text-[#00363a] dark:text-white font-semibold border-r border-gray-300 dark:border-gray-600">OTD<br/>NOTES</TableHead>}
                  {isColumnVisible("standby") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-50 text-[10px] py-1 px-2 text-center text-[#00363a] dark:text-white font-semibold">STANDBY /<br/>SWAPS</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookingRows.map((row, index) => {
                  const isFirstRowOfBlock = index === 0 || bookingRows[index - 1].blockNumber !== row.blockNumber;
                  const blockAssignments = bookingRows.filter(r => r.blockNumber === row.blockNumber && r.assignment);
                  const blockFemaleCount = blockAssignments.filter(r => r.contestant?.gender === 'Female').length;
                  const blockMaleCount = blockAssignments.filter(r => r.contestant?.gender === 'Male').length;
                  const blockTotal = blockAssignments.length;
                  const femalePercent = blockTotal > 0 ? Math.round((blockFemaleCount / blockTotal) * 100) : 0;
                  
                  return (
                    <Fragment key={row.seatId}>
                      {isFirstRowOfBlock && (
                        <TableRow key={`block-header-${row.blockNumber}`} className="bg-[#004d4d] dark:bg-[#003838] hover:bg-[#004d4d] dark:hover:bg-[#003838]">
                          <TableCell colSpan={20} className="py-1 h-8">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-white" data-testid={`block-header-${row.blockNumber}`}>
                                BLOCK {row.blockNumber}
                              </span>
                              {blockTotal > 0 && (
                                <span className="text-xs text-white/80">
                                  {blockTotal} assigned | {blockFemaleCount}F / {blockMaleCount}M ({femalePercent}% female)
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow key={row.seatId} className={`${!row.assignment ? "bg-muted/20" : row.assignment.wasStandby ? "bg-purple-100 dark:bg-purple-900/30" : row.assignment.swappedAt ? "bg-amber-100 dark:bg-amber-900/30" : "bg-white dark:bg-background"} h-7 border-b border-gray-200 dark:border-gray-700`}>
                        <TableCell className="py-0.5 h-7 border-r border-gray-200 dark:border-gray-700">
                          {row.assignment && (
                            <Checkbox
                              checked={selectedAssignments.has(row.assignment.id)}
                              onCheckedChange={(checked) => handleSelectAssignment(row.assignment!.id, checked as boolean)}
                              data-testid={`checkbox-select-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        {isColumnVisible("seat") && <TableCell className="font-mono text-xs py-0.5 h-7 w-14 text-[#2e7d32] dark:text-[#66bb6a] font-semibold whitespace-nowrap border-r border-gray-200 dark:border-gray-700">{String(row.blockNumber).padStart(2, '0')}-{row.seatLabel}</TableCell>}
                        {isColumnVisible("name") && (
                          <TableCell className="font-medium text-xs min-w-[150px] py-0.5 h-7 border-r border-gray-200 dark:border-gray-700">
                            {row.contestant?.name ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className={row.assignment?.standbyReplacementSwaps && row.assignment.standbyReplacementSwaps !== "none" ? "text-red-600 line-through" : ""}>
                                  {row.contestant.name}
                                </span>
                                {row.contestant.isTemporary && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">
                                    TEMP
                                  </Badge>
                                )}
                                {(row.contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(row.contestant.name)) && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                                    TEST
                                  </Badge>
                                )}
                                {row.assignment?.isFromReschedule && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-red-400 bg-red-100 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300" title="Rebooked from reschedule list">
                                    RSCH
                                  </Badge>
                                )}
                                {row.assignment?.wasStandby && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-purple-400 bg-purple-100 text-purple-700 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300" title="Originally booked as standby">
                                    STBY
                                  </Badge>
                                )}
                                {row.contestant?.state === 'rescheduled' && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-orange-400 bg-orange-100 text-orange-700 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-300" title="Contestant was rescheduled">
                                    RESCHED
                                  </Badge>
                                )}
                                {row.contestant?.id && (row.contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(row.contestant.name)) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(`Remove test subject ${row.contestant!.name}?`)) {
                                        handleDeleteTestSubject(row.contestant!.id);
                                      }
                                    }}
                                    title="Remove test subject"
                                    data-testid={`button-delete-test-subject-${row.contestant.id}`}
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic">Empty</span>
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("mobile") && <TableCell className="text-xs min-w-[120px] py-0.5 h-7 border-r border-gray-200 dark:border-gray-700">{row.contestant?.phone || ""}</TableCell>}
                        {isColumnVisible("email") && <TableCell className="text-xs py-0.5 h-7 w-48 min-w-[180px] truncate border-r border-gray-200 dark:border-gray-700" title={row.contestant?.email}>{row.contestant?.email || ""}</TableCell>}
                        {isColumnVisible("attendingWith") && (
                          <TableCell className="text-xs py-0.5 h-7 min-w-[160px] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment ? (
                              isEditMode ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    key={`attending-${row.assignment.id}`}
                                    defaultValue={row.assignment.attendingWithOverride || row.contestant?.attendingWith || ""}
                                    onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "attendingWithOverride", e.target.value)}
                                    placeholder={row.contestant?.attendingWith || "Attending with..."}
                                    className="h-6 text-xs flex-1"
                                    data-testid={`input-attending-with-${row.seatId}`}
                                  />
                                  {row.assignment.attendingWithOverride && row.assignment.attendingWithOverride !== row.contestant?.attendingWith && (
                                    <span className="text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-1 rounded font-medium whitespace-nowrap">UPDATED</span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span className="truncate" title={row.assignment.attendingWithOverride || row.contestant?.attendingWith || ""}>
                                    {row.assignment.attendingWithOverride || row.contestant?.attendingWith || ""}
                                  </span>
                                  {row.assignment.attendingWithOverride && row.assignment.attendingWithOverride !== row.contestant?.attendingWith && (
                                    <span className="text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-1 rounded font-medium whitespace-nowrap flex-shrink-0">UPDATED</span>
                                  )}
                                </div>
                              )
                            ) : (
                              row.contestant?.attendingWith || ""
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("location") && <TableCell className="text-xs py-0.5 h-7 border-r border-gray-200 dark:border-gray-700">{row.contestant?.location || ""}</TableCell>}
                        {isColumnVisible("medicalQ") && (
                          <TableCell className="text-xs py-0.5 h-7 border-r border-gray-200 dark:border-gray-700">
                            {row.contestant?.medicalInfo || ""}
                          </TableCell>
                        )}
                        {isColumnVisible("mobilityNotes") && (
                          <TableCell className="text-xs py-0.5 h-7 min-w-[160px] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment ? (
                              isEditMode ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    key={`mobility-${row.assignment.id}`}
                                    defaultValue={row.assignment.mobilityNotesOverride || row.contestant?.mobilityNotes || ""}
                                    onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "mobilityNotesOverride", e.target.value)}
                                    placeholder={row.contestant?.mobilityNotes || "Medical notes..."}
                                    className="h-6 text-xs flex-1"
                                    data-testid={`input-mobility-notes-${row.seatId}`}
                                  />
                                  {row.assignment.mobilityNotesOverride && row.assignment.mobilityNotesOverride !== row.contestant?.mobilityNotes && (
                                    <span className="text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-1 rounded font-medium whitespace-nowrap">UPDATED</span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span className="truncate" title={row.assignment.mobilityNotesOverride || row.contestant?.mobilityNotes || ""}>
                                    {row.assignment.mobilityNotesOverride || row.contestant?.mobilityNotes || ""}
                                  </span>
                                  {row.assignment.mobilityNotesOverride && row.assignment.mobilityNotesOverride !== row.contestant?.mobilityNotes && (
                                    <span className="text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-1 rounded font-medium whitespace-nowrap flex-shrink-0">UPDATED</span>
                                  )}
                                </div>
                              )
                            ) : (
                              row.contestant?.mobilityNotes || ""
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("criminal") && (
                          <TableCell className="text-xs py-0.5 h-7 w-20 text-center border-r border-gray-200 dark:border-gray-700">
                            {row.contestant?.criminalRecord || ""}
                          </TableCell>
                        )}
                        {isColumnVisible("castingCategory") && (
                          <TableCell className="py-0.5 h-7 border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <span className="text-xs px-1">
                                {row.assignment.castingCategory || getAutoCastingCategory(row.contestant, row.blockNumber)}
                              </span>
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("notes") && (
                          <TableCell className="border-r-4 border-r-[#1a6b6b] py-0.5 group">
                            {row.assignment && (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setExpandedNotes(prev => {
                                        const next = new Set(prev);
                                        if (next.has(row.assignment!.id)) {
                                          next.delete(row.assignment!.id);
                                        } else {
                                          next.add(row.assignment!.id);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                                    data-testid={`button-expand-notes-${row.seatId}`}
                                  >
                                    <ChevronDown 
                                      className={`h-4 w-4 transition-transform ${expandedNotes.has(row.assignment.id) ? 'rotate-180' : ''}`}
                                    />
                                  </button>
                                  {!expandedNotes.has(row.assignment.id) && (
                                    <Input
                                      key={`notes-${row.assignment.id}`}
                                      defaultValue={row.assignment.notes || ""}
                                      onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "notes", e.target.value)}
                                      placeholder="Notes"
                                      className="h-6 text-xs flex-1"
                                      data-testid={`input-notes-${row.seatId}`}
                                    />
                                  )}
                                </div>
                                {expandedNotes.has(row.assignment.id) && (
                                  <Textarea
                                    key={`notes-expanded-${row.assignment.id}`}
                                    defaultValue={row.assignment.notes || ""}
                                    onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "notes", e.target.value)}
                                    placeholder="Notes"
                                    className="text-xs min-h-24 resize-none"
                                    data-testid={`textarea-notes-${row.seatId}`}
                                  />
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("emailSent") && (
                          <TableCell className="text-center px-3 w-16 py-0.5 h-7 bg-[#e8f4f4] dark:bg-[#1a3a3a] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.bookingEmailSent}
                                disabled={!!row.assignment.bookingEmailSent}
                                onCheckedChange={() => {
                                  if (!row.assignment!.bookingEmailSent) {
                                    handleCheckboxToggle(row.assignment!.id, "bookingEmailSent", row.assignment!.bookingEmailSent);
                                  }
                                }}
                                title={row.assignment.bookingEmailSent ? "Booking email was sent - cannot be unticked" : ""}
                                data-testid={`checkbox-email-sent-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("rsvp") && (
                          <TableCell className="text-center px-3 w-16 py-0.5 h-7 bg-[#e8f4f4] dark:bg-[#1a3a3a] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.confirmedRsvp}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "confirmedRsvp", row.assignment!.confirmedRsvp)}
                                data-testid={`checkbox-rsvp-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("paperSent") && (
                          <TableCell className="text-center px-3 w-16 py-0.5 h-7 bg-[#e8f4f4] dark:bg-[#1a3a3a] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.paperworkSent}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "paperworkSent", row.assignment!.paperworkSent)}
                                data-testid={`checkbox-paperwork-sent-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("paperReceived") && (
                          <TableCell className="text-center px-3 w-16 py-0.5 h-7 bg-[#e8f4f4] dark:bg-[#1a3a3a] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.paperworkReceived}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "paperworkReceived", row.assignment!.paperworkReceived)}
                                data-testid={`checkbox-paperwork-received-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("otdHardCopy") && (
                          <TableCell className="text-center px-3 w-16 py-0.5 h-7 bg-[#fef3c7] dark:bg-[#78350f] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.paperworkOnDay}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "paperworkOnDay", row.assignment!.paperworkOnDay)}
                                className="border-orange-600 data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600"
                                data-testid={`checkbox-otd-paperwork-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("signedIn") && (
                          <TableCell className="text-center px-3 w-16 py-0.5 h-7 bg-[#d4e8d4] dark:bg-[#1a3a2a] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.signedIn}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "signedIn", row.assignment!.signedIn)}
                                className="border-green-600 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                                data-testid={`checkbox-signed-in-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("otdNotes") && (
                          <TableCell className="px-2 py-0.5 bg-[#e8f4f4] dark:bg-[#1a3a3a] border-r border-gray-200 dark:border-gray-700">
                            {row.assignment && (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setExpandedOtdNotes(prev => {
                                        const next = new Set(prev);
                                        if (next.has(row.assignment!.id)) {
                                          next.delete(row.assignment!.id);
                                        } else {
                                          next.add(row.assignment!.id);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                                    data-testid={`button-expand-otd-notes-${row.seatId}`}
                                  >
                                    <ChevronDown 
                                      className={`h-4 w-4 transition-transform ${expandedOtdNotes.has(row.assignment.id) ? 'rotate-180' : ''}`}
                                    />
                                  </button>
                                  {!expandedOtdNotes.has(row.assignment.id) && (
                                    <Input
                                      key={`otd-${row.assignment.id}`}
                                      defaultValue={row.assignment.otdNotes || ""}
                                      onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "otdNotes", e.target.value)}
                                      placeholder="OTD Notes"
                                      className="h-6 text-xs min-w-[180px]"
                                      data-testid={`input-otd-notes-${row.seatId}`}
                                    />
                                  )}
                                </div>
                                {expandedOtdNotes.has(row.assignment.id) && (
                                  <Textarea
                                    key={`otd-expanded-${row.assignment.id}`}
                                    defaultValue={row.assignment.otdNotes || ""}
                                    onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "otdNotes", e.target.value)}
                                    placeholder="OTD Notes"
                                    className="text-xs min-h-24 resize-none min-w-[180px]"
                                    data-testid={`textarea-otd-notes-${row.seatId}`}
                                  />
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("standby") && (
                          <TableCell className="px-2 py-0.5 h-7 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
                            {row.assignment && (
                              <div className="flex flex-col gap-0.5">
                                {/* Show previous seat if this was a swap in RX Day Mode */}
                                {row.assignment.swappedAt && row.assignment.originalBlockNumber && row.assignment.originalSeatLabel && (
                                  <span 
                                    className="text-[10px] text-amber-700 dark:text-amber-400 font-medium"
                                    data-testid={`swap-info-${row.seatId}`}
                                  >
                                    Swapped from: {row.assignment.originalBlockNumber}-{row.assignment.originalSeatLabel}
                                  </span>
                                )}
                                {/* Show standby replacement info if applicable */}
                                {row.assignment.standbyReplacementSwaps && (
                                  <span 
                                    className="text-[10px] text-purple-700 dark:text-purple-400 font-medium"
                                    data-testid={`standby-info-${row.seatId}`}
                                  >
                                    Standby: {row.assignment.standbyReplacementSwaps}
                                  </span>
                                )}
                                {/* Show if no swap/standby activity */}
                                {!row.assignment.swappedAt && !row.assignment.standbyReplacementSwaps && (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {!selectedRecordDay && (
        <div className="border rounded-md p-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Record Day Selected</h3>
          <p className="text-muted-foreground">
            Select a record day above to view and manage the booking master
          </p>
        </div>
      )}

      <Dialog open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview Booking Email</DialogTitle>
            <DialogDescription>
              Review and edit the email before sending to {selectedAssignments.size} contestant{selectedAssignments.size !== 1 ? 's' : ''}. 
              Use placeholders: {"{{name}}"}, {"{{date}}"}, {"{{confirmationLink}}"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {/* RESEND Warning */}
            {(() => {
              const selectedRows = bookingRows.filter(row => row.assignment && selectedAssignments.has(row.assignment.id));
              const resendContestants = selectedRows.filter(row => row.assignment?.bookingEmailSent);
              const newContestants = selectedRows.filter(row => !row.assignment?.bookingEmailSent);
              
              if (resendContestants.length > 0) {
                return (
                  <div className="border-2 border-amber-500 rounded-lg p-4 bg-amber-50 dark:bg-amber-950/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      <Label className="text-sm font-bold text-amber-800 dark:text-amber-200">
                        RESEND WARNING
                      </Label>
                    </div>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {resendContestants.length === selectedRows.length 
                        ? `All ${resendContestants.length} selected contestant${resendContestants.length !== 1 ? 's have' : ' has'} already received a booking email. This will be a RESEND.`
                        : `${resendContestants.length} of ${selectedRows.length} selected contestants have already received a booking email and will receive a RESEND.`
                      }
                    </p>
                    <div className="text-xs text-amber-600 dark:text-amber-400">
                      <strong>Previously emailed:</strong> {resendContestants.map(r => r.contestant?.name || 'Unknown').join(', ')}
                    </div>
                    {newContestants.length > 0 && (
                      <div className="text-xs text-green-600 dark:text-green-400">
                        <strong>First-time recipients:</strong> {newContestants.map(r => r.contestant?.name || 'Unknown').join(', ')}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })()}

            {/* Recipients List */}
            <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20 space-y-2">
              <Label className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                Emails will be sent to:
              </Label>
              <div className="max-h-40 overflow-y-auto bg-white dark:bg-slate-950 rounded border border-blue-200 dark:border-blue-800 p-2 space-y-1">
                {bookingRows
                  .filter(row => row.assignment && selectedAssignments.has(row.assignment.id))
                  .map(row => (
                    <div key={row.assignment!.id} className="text-sm text-slate-700 dark:text-slate-300 flex justify-between gap-3 px-2 py-1">
                      <span className="font-medium">
                        {row.contestant?.name || 'Unknown'}
                        {row.assignment?.bookingEmailSent && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">RESEND</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.contestant?.email || 'No email'}</span>
                    </div>
                  ))}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Email subject"
                data-testid="input-email-subject"
              />
            </div>
            
            {/* Email Preview */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Email Preview</Label>
              <div className="border rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900">
                <iframe 
                  src="/api/email-preview/booking"
                  className="w-full h-[400px] border-0"
                  title="Booking Email Preview"
                  data-testid="iframe-email-preview"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This preview uses sample data. The actual email will include the contestant's name and booking details.
                To edit the email template, go to Settings &gt; Booking Email Template.
              </p>
            </div>
            
            {pdfAssets.length > 0 && (
              <div className="space-y-2">
                <Label>PDF Attachments</Label>
                <div className="border rounded-md p-3 space-y-2">
                  {pdfAssets.map((asset) => (
                    <label 
                      key={asset.path} 
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAttachments.includes(asset.path)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAttachments([...selectedAttachments, asset.path]);
                          } else {
                            setSelectedAttachments(selectedAttachments.filter(p => p !== asset.path));
                          }
                        }}
                        className="h-4 w-4"
                        data-testid={`checkbox-attachment-${asset.name}`}
                      />
                      <FileText className="h-4 w-4 text-red-500" />
                      <span className="text-sm">{asset.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({(asset.size / 1024).toFixed(1)} KB)
                      </span>
                    </label>
                  ))}
                </div>
                {selectedAttachments.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedAttachments.length} attachment{selectedAttachments.length !== 1 ? 's' : ''} will be included
                  </p>
                )}
              </div>
            )}

          </div>
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEmailPreviewOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                sendBookingEmailsMutation.mutate({
                  seatAssignmentIds: Array.from(selectedAssignments),
                  emailSubject,
                  emailBody: undefined,
                  attachmentPaths: selectedAttachments.length > 0 ? selectedAttachments : undefined
                });
              }}
              disabled={sendBookingEmailsMutation.isPending}
              data-testid="button-confirm-send-emails"
            >
              {sendBookingEmailsMutation.isPending ? (
                <>
                  <Mail className="h-4 w-4 mr-2 animate-pulse" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Send to {selectedAssignments.size} Contestant{selectedAssignments.size !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Untick Confirmation Dialog */}
      <Dialog open={untickConfirmOpen} onOpenChange={setUntickConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Untick
            </DialogTitle>
            <DialogDescription>
              You are about to untick <strong>{untickPending?.fieldLabel}</strong> for{" "}
              <strong>{untickPending?.contestantName}</strong>.
              <br /><br />
              This will clear this workflow step. Are you sure you want to continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancelUntick} data-testid="button-cancel-untick">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleConfirmUntick}
              data-testid="button-confirm-untick"
            >
              Yes, Untick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk No-Show Confirmation Dialog */}
      <AlertDialog open={showNoShowConfirm} onOpenChange={setShowNoShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark All as No-Show?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2">This will mark <strong>{bookingRows.filter(r => r.assignment?.id).length} contestant(s)</strong> as no-shows:</p>
                <ul className="list-disc pl-5 mt-2 max-h-40 overflow-y-auto text-sm">
                  {bookingRows.filter(r => r.assignment?.id).slice(0, 10).map(row => (
                    <li key={row.seatId}>{row.contestant?.name} (Block {row.blockNumber}, Seat {row.seatLabel})</li>
                  ))}
                  {bookingRows.filter(r => r.assignment?.id).length > 10 && <li>...and {bookingRows.filter(r => r.assignment?.id).length - 10} more</li>}
                </ul>
                <p className="mt-3 text-red-600 dark:text-red-400 font-medium">
                  This action will remove them from their seats, increment their no-show count, and create audit records.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkNoShowMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const assignmentIds = bookingRows
                  .filter(row => row.assignment?.id)
                  .map(row => row.assignment!.id);
                if (selectedRecordDay && assignmentIds.length > 0) {
                  bulkNoShowMutation.mutate({ assignmentIds, recordDayId: selectedRecordDay });
                }
              }}
              disabled={bulkNoShowMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-bulk-no-show"
            >
              {bulkNoShowMutation.isPending ? "Processing..." : "Mark All as No-Show"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
