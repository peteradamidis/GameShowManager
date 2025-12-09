import { useState, useRef, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import { Download, Calendar, Mail, Maximize2, Minimize2, CheckCircle, XCircle, Columns, ChevronDown, MessageCircle, FileText, Sparkles } from "lucide-react";
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
  { id: "medicalQ", label: "MED Q", alwaysVisible: false },
  { id: "mobilityNotes", label: "MOBILITY / MEDICAL NOTES", alwaysVisible: false },
  { id: "criminal", label: "CRIM / BANK", alwaysVisible: false },
  { id: "castingCategory", label: "CASTING CATEGORY", alwaysVisible: false },
  { id: "notes", label: "NOTES", alwaysVisible: false },
  { id: "emailSent", label: "EMAIL SENT", alwaysVisible: true },
  { id: "rsvp", label: "RSVP", alwaysVisible: true },
  { id: "paperSent", label: "PAPER SENT", alwaysVisible: true },
  { id: "paperReceived", label: "PAPER ✓", alwaysVisible: true },
  { id: "signedIn", label: "SIGNED IN", alwaysVisible: true },
  { id: "otdNotes", label: "OTD NOTES", alwaysVisible: true },
  { id: "standby", label: "STANDBY / SWAPS", alwaysVisible: true },
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
  signedIn: true,
  otdNotes: true,
  standby: true,
};

const STORAGE_KEY = "booking-master-visible-columns";

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
  signedIn?: string;
  otdNotes?: string;
  standbyReplacementSwaps?: string;
  contestantName?: string;
  age?: number;
  gender?: string;
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
  standbyEmailSent: string | null;
  confirmedAt: string | null;
  notes: string | null;
  contestant: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    gender: string;
    age: number;
    photoUrl: string | null;
    auditionRating: string | null;
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

export default function BookingMaster() {
  const [, setLocation] = useLocation();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("");
  const [searchName, setSearchName] = useState<string>("");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sharePointDialogOpen, setSharePointDialogOpen] = useState(false);
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("Deal or No Deal - Booking Confirmation");
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
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

  // Save column visibility to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch (e) {
      console.error("Failed to save column visibility settings:", e);
    }
  }, [visibleColumns]);

  const toggleColumnVisibility = (columnId: ColumnId) => {
    const column = COLUMN_CONFIG.find(c => c.id === columnId);
    if (column?.alwaysVisible) return; // Can't hide always-visible columns
    
    setVisibleColumns(prev => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  };

  const isColumnVisible = (columnId: ColumnId) => visibleColumns[columnId];

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery<SeatAssignment[]>({
    queryKey: ['/api/seat-assignments', selectedRecordDay],
    enabled: !!selectedRecordDay,
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ["/api/contestants"],
  });

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

  // Mutation to update standby assignment when a standby is assigned to a seat
  const assignStandbyMutation = useMutation({
    mutationFn: async ({ recordDayId, contestantName, seatLabel }: { recordDayId: string; contestantName: string; seatLabel: string | null }) => {
      return await apiRequest("POST", "/api/standbys/assign-seat", { recordDayId, contestantName, seatLabel });
    },
    onSuccess: () => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
    },
  });

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
    },
  });

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
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send booking emails",
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
  const bookingRows = searchName.trim() 
    ? allBookingRows.filter(row => 
        row.contestant?.name.toLowerCase().includes(searchName.toLowerCase())
      )
    : allBookingRows;

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

  const handleCheckboxToggle = (assignmentId: string, field: string, currentValue: any) => {
    const newValue = !currentValue;
    handleFieldUpdate(assignmentId, field, newValue);
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
    const dayName = selectedDay ? format(new Date(selectedDay.date), "MMMM-d-yyyy") : "booking-master";
    const dayDate = selectedDay ? format(new Date(selectedDay.date), "MMMM d, yyyy") : "";

    const headers = [
      "SEAT", "NAME", "MOBILE", "EMAIL", "ATTENDING WITH", "LOCATION", 
      "MEDICAL Q (Y/N)", "MOBILITY / MEDICAL NOTES", "CRIMINAL / BANKRUPTCY", 
      "CASTING CATEGORY", "NOTES", "BOOKING EMAIL SENT", "CONFIRMED RSVP", 
      "PAPERWORK SENT", "PAPERWORK ✓", "SIGNED-IN", "OTD NOTES", 
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
      
      exportRows.push([
        row.seatId,
        row.contestant?.name || "",
        row.contestant?.phone || "",
        row.contestant?.email || "",
        row.contestant?.attendingWith || "",
        row.contestant?.location || "",
        row.assignment?.medicalQuestion || "",
        row.contestant?.mobilityNotes || "",
        row.contestant?.criminalRecord || "",
        row.assignment?.castingCategory || "",
        row.assignment?.notes || "",
        row.assignment?.bookingEmailSent ? "✓" : "",
        row.assignment?.confirmedRsvp ? "✓" : "",
        row.assignment?.paperworkSent ? "✓" : "",
        row.assignment?.paperworkReceived ? "✓" : "",
        row.assignment?.signedIn ? "✓" : "",
        row.assignment?.otdNotes || "",
        row.assignment?.standbyReplacementSwaps || "",
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    
    XLSX.utils.book_append_sheet(wb, ws, "Booking Master");

    ws['!cols'] = [
      { wch: 10 },  // SEAT
      { wch: 20 },  // NAME
      { wch: 15 },  // MOBILE
      { wch: 25 },  // EMAIL
      { wch: 15 },  // ATTENDING WITH
      { wch: 15 },  // LOCATION
      { wch: 12 },  // MEDICAL Q (Y/N)
      { wch: 30 },  // MOBILITY / MEDICAL NOTES
      { wch: 18 },  // CRIMINAL / BANKRUPTCY
      { wch: 15 },  // CASTING CATEGORY
      { wch: 25 },  // NOTES
      { wch: 15 },  // BOOKING EMAIL SENT
      { wch: 12 },  // CONFIRMED RSVP
      { wch: 14 },  // PAPERWORK SENT
      { wch: 12 },  // PAPERWORK ✓
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
          
          <Dialog open={sharePointDialogOpen} onOpenChange={setSharePointDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="icon"
                title="SharePoint Excel Settings"
                data-testid="button-sharepoint-settings"
              >
                {sharePointConfig.isConfigured ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>SharePoint Excel Integration</DialogTitle>
                <DialogDescription>
                  Link booking data with an Excel spreadsheet on SharePoint for team access.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                {sharePointConfig.isConfigured ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Connected to SharePoint Excel</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your booking data is linked to the SharePoint spreadsheet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-4 rounded-md">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                        Configuration Required
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        SharePoint Excel integration will be configured offline by your IT administrator. 
                        Once connected, booking data can sync with your team's shared spreadsheet.
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <p className="text-sm font-medium">What this enables:</p>
                      <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                        <li>Two-way sync with Excel on SharePoint</li>
                        <li>Real-time updates for your team</li>
                        <li>Works with your existing workflows</li>
                      </ul>
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      For now, use the "Export to Excel" button to download booking data manually.
                    </p>
                  </div>
                )}
              </div>
              
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setSharePointDialogOpen(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <Button 
            onClick={() => setLocation('/booking-responses')}
            variant="outline" 
            size="icon"
            title="View booking responses"
            data-testid="button-booking-responses"
          >
            <MessageCircle className="h-4 w-4" />
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
                {format(new Date(day.date), "MMMM d, yyyy")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRecordDay && (
          <Input
            placeholder="Search by name..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className={isFullscreen ? "w-32" : "w-48"}
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
              Loading assignments...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-[#004d4d] dark:bg-[#003333]">
                  <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 w-12 text-white">
                    <Checkbox
                      checked={selectedAssignments.size > 0 && selectedAssignments.size === bookingRows.filter(r => r.assignment).length}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                      className="border-white data-[state=checked]:bg-white data-[state=checked]:text-[#004d4d]"
                    />
                  </TableHead>
                  {isColumnVisible("seat") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs w-12 text-white font-semibold">SEAT</TableHead>}
                  {isColumnVisible("name") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs min-w-[150px] text-white font-semibold">NAME</TableHead>}
                  {isColumnVisible("mobile") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs min-w-[120px] text-white font-semibold">MOBILE</TableHead>}
                  {isColumnVisible("email") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs w-32 max-w-[130px] text-white font-semibold">EMAIL</TableHead>}
                  {isColumnVisible("attendingWith") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs text-white font-semibold">ATTENDING WITH</TableHead>}
                  {isColumnVisible("location") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs text-white font-semibold">LOCATION</TableHead>}
                  {isColumnVisible("medicalQ") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs w-14 text-center text-white font-semibold">MED<br/>Q</TableHead>}
                  {isColumnVisible("mobilityNotes") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs text-white font-semibold">MOBILITY / MEDICAL NOTES</TableHead>}
                  {isColumnVisible("criminal") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs w-20 text-center text-white font-semibold">CRIM/<br/>BANK</TableHead>}
                  {isColumnVisible("castingCategory") && <TableHead className="sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 text-xs text-white font-semibold">CASTING CATEGORY</TableHead>}
                  {isColumnVisible("notes") && <TableHead className={`sticky top-0 bg-[#004d4d] dark:bg-[#003333] z-10 border-r-4 border-r-[#1a6b6b] text-white font-semibold ${isFullscreen ? 'min-w-[200px]' : 'min-w-[300px]'}`}>NOTES</TableHead>}
                  {isColumnVisible("emailSent") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-3 text-center w-16 text-[#004d4d] dark:text-white font-semibold">EMAIL<br/>SENT</TableHead>}
                  {isColumnVisible("rsvp") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-3 text-center w-16 text-[#004d4d] dark:text-white font-semibold">RSVP</TableHead>}
                  {isColumnVisible("paperSent") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-3 text-center w-16 text-[#004d4d] dark:text-white font-semibold">PAPER<br/>SENT</TableHead>}
                  {isColumnVisible("paperReceived") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-3 text-center w-16 text-[#004d4d] dark:text-white font-semibold">PAPER<br/>✓</TableHead>}
                  {isColumnVisible("signedIn") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-3 text-center w-16 text-[#004d4d] dark:text-white font-semibold">SIGNED<br/>IN</TableHead>}
                  {isColumnVisible("otdNotes") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-2 text-center text-[#004d4d] dark:text-white font-semibold">OTD NOTES</TableHead>}
                  {isColumnVisible("standby") && <TableHead className="sticky top-0 bg-[#b8d4d4] dark:bg-[#2a5a5a] z-10 text-xs px-2 text-center text-[#004d4d] dark:text-white font-semibold">STANDBY / SWAPS</TableHead>}
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
                        <TableRow key={`block-header-${row.blockNumber}`} className="bg-[#004d4d] dark:bg-[#003333] hover:bg-[#004d4d] dark:hover:bg-[#003333]">
                          <TableCell colSpan={20} className="py-3">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-lg text-white" data-testid={`block-header-${row.blockNumber}`}>
                                BLOCK {row.blockNumber}
                              </span>
                              {blockTotal > 0 && (
                                <span className="text-sm text-white/80">
                                  {blockTotal} assigned | {blockFemaleCount}F / {blockMaleCount}M ({femalePercent}% female)
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow key={row.seatId} className={`${!row.assignment ? "bg-muted/20" : "bg-white dark:bg-background"} h-12 border-b border-gray-200 dark:border-gray-700`}>
                        <TableCell className="py-1">
                          {row.assignment && (
                            <Checkbox
                              checked={selectedAssignments.has(row.assignment.id)}
                              onCheckedChange={(checked) => handleSelectAssignment(row.assignment!.id, checked as boolean)}
                              data-testid={`checkbox-select-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        {isColumnVisible("seat") && <TableCell className="font-mono text-xs py-1 w-12 text-[#2e7d32] dark:text-[#66bb6a] font-semibold">{row.seatLabel}</TableCell>}
                        {isColumnVisible("name") && (
                          <TableCell className="font-medium text-xs min-w-[150px] py-1">
                            {row.contestant?.name || <span className="text-muted-foreground italic">Empty</span>}
                          </TableCell>
                        )}
                        {isColumnVisible("mobile") && <TableCell className="text-xs min-w-[120px] py-1">{row.contestant?.phone || ""}</TableCell>}
                        {isColumnVisible("email") && <TableCell className="text-xs py-1 w-32 max-w-[130px] truncate">{row.contestant?.email || ""}</TableCell>}
                        {isColumnVisible("attendingWith") && <TableCell className="text-xs py-1">{row.contestant?.attendingWith || ""}</TableCell>}
                        {isColumnVisible("location") && <TableCell className="text-xs py-1">{row.contestant?.location || ""}</TableCell>}
                        {isColumnVisible("medicalQ") && (
                          <TableCell className="py-1 w-14">
                            {row.assignment && (
                              <Input
                                key={`med-${row.assignment.id}`}
                                defaultValue={row.assignment.medicalQuestion || ""}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "medicalQuestion", e.target.value)}
                                placeholder="Y/N"
                                className="h-7 text-xs w-10"
                                data-testid={`input-medical-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("mobilityNotes") && (
                          <TableCell className="text-xs py-1">
                            {row.contestant?.mobilityNotes || ""}
                          </TableCell>
                        )}
                        {isColumnVisible("criminal") && (
                          <TableCell className="text-xs py-1 w-20 text-center">
                            {row.contestant?.criminalRecord || ""}
                          </TableCell>
                        )}
                        {isColumnVisible("castingCategory") && (
                          <TableCell className="py-1">
                            {row.assignment && (
                              <Input
                                key={`cat-${row.assignment.id}`}
                                defaultValue={row.assignment.castingCategory || ""}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "castingCategory", e.target.value)}
                                placeholder="Category"
                                className="h-7 text-xs"
                                data-testid={`input-category-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("notes") && (
                          <TableCell className="border-r-4 border-r-primary/30 py-1">
                            {row.assignment && (
                              <Textarea
                                key={`notes-${row.assignment.id}`}
                                defaultValue={row.assignment.notes || ""}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "notes", e.target.value)}
                                placeholder="Notes"
                                className="min-h-[50px] text-sm resize-y"
                                data-testid={`textarea-notes-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("emailSent") && (
                          <TableCell className="text-center px-3 w-16 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.bookingEmailSent}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "bookingEmailSent", row.assignment!.bookingEmailSent)}
                                data-testid={`checkbox-email-sent-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("rsvp") && (
                          <TableCell className="text-center px-3 w-16 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
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
                          <TableCell className="text-center px-3 w-16 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
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
                          <TableCell className="text-center px-3 w-16 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.paperworkReceived}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "paperworkReceived", row.assignment!.paperworkReceived)}
                                data-testid={`checkbox-paperwork-received-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("signedIn") && (
                          <TableCell className="text-center px-3 w-16 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
                            {row.assignment && (
                              <Checkbox
                                checked={!!row.assignment.signedIn}
                                onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "signedIn", row.assignment!.signedIn)}
                                data-testid={`checkbox-signed-in-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("otdNotes") && (
                          <TableCell className="px-2 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
                            {row.assignment && (
                              <Textarea
                                key={`otd-${row.assignment.id}`}
                                defaultValue={row.assignment.otdNotes || ""}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "otdNotes", e.target.value)}
                                placeholder=""
                                className="h-14 min-h-0 text-xs resize-none w-36"
                                data-testid={`textarea-otd-notes-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("standby") && (
                          <TableCell className="px-2 py-1 bg-[#e8f4f4] dark:bg-[#1a3a3a]">
                            {row.assignment && (
                              <Select
                                key={`standby-${row.assignment.id}`}
                                defaultValue={row.assignment.standbyReplacementSwaps || "none"}
                                onValueChange={(value) => {
                                  const newValue = value === "none" ? "" : value;
                                  const previousValue = row.assignment!.standbyReplacementSwaps;
                                  
                                  handleDebouncedTextUpdate(row.assignment!.id, "standbyReplacementSwaps", newValue);
                                  
                                  // Clear the previous standby's seat assignment if there was one
                                  if (previousValue && previousValue !== newValue) {
                                    assignStandbyMutation.mutate({
                                      recordDayId: selectedRecordDay,
                                      contestantName: previousValue,
                                      seatLabel: null, // Clear the assignment
                                    });
                                  }
                                  
                                  // Set the new standby's seat assignment if one was selected
                                  if (newValue) {
                                    assignStandbyMutation.mutate({
                                      recordDayId: selectedRecordDay,
                                      contestantName: newValue,
                                      seatLabel: row.seatLabel,
                                    });
                                  }
                                }}
                              >
                                <SelectTrigger 
                                  className="h-7 text-xs w-32"
                                  data-testid={`select-standby-${row.seatId}`}
                                >
                                  <SelectValue placeholder="Select standby" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">
                                    <span className="text-muted-foreground">None</span>
                                  </SelectItem>
                                  {standbysForRecordDay.map((standby) => (
                                    <SelectItem key={standby.id} value={standby.contestant.name}>
                                      <span className="flex items-center gap-2">
                                        <span>{standby.contestant.name}</span>
                                        <span className="text-muted-foreground text-xs">
                                          ({standby.contestant.auditionRating || "?"} / {standby.contestant.gender === "female" ? "F" : "M"})
                                        </span>
                                      </span>
                                    </SelectItem>
                                  ))}
                                  {standbysForRecordDay.length === 0 && (
                                    <SelectItem value="no-standbys" disabled>
                                      <span className="text-muted-foreground italic">No standbys for this day</span>
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
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
            
            <div className="border rounded-lg p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-amber-600" />
                <span className="font-medium text-amber-800 dark:text-amber-200">Professional Template</span>
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Emails will include the Deal or No Deal banner, burgundy background, gold accents, 
                and automatically show contestant name, recording date, and seat details.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                To edit the email wording, go to Settings &gt; Booking Email Template
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

    </div>
  );
}
