import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
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
import { Download, Calendar, Mail, Maximize2, Minimize2, Settings, RefreshCw, CheckCircle, XCircle, Columns } from "lucide-react";
import { format } from "date-fns";
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

interface GoogleSheetsConfig {
  spreadsheetId: string | null;
  lastSyncTime: string | null;
  autoSync: boolean;
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

const BLOCKS = 7;
const ROWS = [
  { label: "A", count: 5 },
  { label: "B", count: 5 },
  { label: "C", count: 4 },
  { label: "D", count: 4 },
  { label: "E", count: 4 },
];

export default function BookingMaster() {
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sheetsDialogOpen, setSheetsDialogOpen] = useState(false);
  const [spreadsheetIdInput, setSpreadsheetIdInput] = useState("");
  const [pendingTextUpdates, setPendingTextUpdates] = useState<Record<string, string>>({});
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

  const { data: sheetsConfig } = useQuery<GoogleSheetsConfig>({
    queryKey: ["/api/google-sheets/config"],
  });

  const configuresheetsMutation = useMutation({
    mutationFn: async (spreadsheetId: string) => {
      return await apiRequest("POST", "/api/google-sheets/config", { spreadsheetId, autoSync: false });
    },
    onSuccess: () => {
      toast({
        title: "Google Sheets Connected",
        description: "Your spreadsheet is now linked. You can sync booking data anytime.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/google-sheets/config"] });
      setSheetsDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error.message || "Could not connect to Google Sheets. Check the spreadsheet ID.",
        variant: "destructive",
      });
    },
  });

  const toggleAutoSyncMutation = useMutation({
    mutationFn: async ({ autoSync, spreadsheetId }: { autoSync: boolean; spreadsheetId: string }) => {
      return await apiRequest("POST", "/api/google-sheets/config", { 
        spreadsheetId, 
        autoSync 
      });
    },
    onSuccess: (_, { autoSync }) => {
      toast({
        title: autoSync ? "Auto-Sync Enabled" : "Auto-Sync Disabled",
        description: autoSync 
          ? "Booking data will sync to Google Sheets every 5 minutes." 
          : "Automatic syncing has been turned off.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/google-sheets/config"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update",
        description: error.message || "Could not update auto-sync setting.",
        variant: "destructive",
      });
    },
  });

  const syncSheetsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/google-sheets/sync", {});
    },
    onSuccess: (data: any) => {
      toast({
        title: "Sync Complete",
        description: data.message || "Booking data has been synced to Google Sheets.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/google-sheets/config"] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Could not sync to Google Sheets.",
        variant: "destructive",
      });
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
      // Refetch after mutation settles to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', selectedRecordDay] });
    },
  });

  const sendBookingEmailsMutation = useMutation({
    mutationFn: async (seatAssignmentIds: string[]) => {
      return await apiRequest("POST", "/api/booking-confirmations/send", { 
        seatAssignmentIds 
      });
    },
    onSuccess: (data: any) => {
      const successCount = data.results.filter((r: any) => r.success).length;
      const failCount = data.results.filter((r: any) => !r.success).length;
      
      toast({
        title: "Booking Emails Sent",
        description: `${successCount} email(s) sent successfully${failCount > 0 ? `, ${failCount} failed` : ''}. ${data.emailsStubbed ? '(Emails are currently stubbed - check console for details)' : ''}`,
      });
      
      setSelectedAssignments(new Set());
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send booking emails",
        variant: "destructive",
      });
    },
  });

  // Auto-sync to Google Sheets every 5 minutes when enabled
  useEffect(() => {
    if (!sheetsConfig?.isConfigured || !sheetsConfig?.autoSync) {
      return;
    }

    const doSync = async () => {
      try {
        console.log('[Auto-Sync] Syncing booking data to Google Sheets...');
        await apiRequest("POST", "/api/google-sheets/sync", {});
        queryClient.invalidateQueries({ queryKey: ["/api/google-sheets/config"] });
      } catch (error) {
        console.error('[Auto-Sync] Failed to sync:', error);
      }
    };

    // Sync immediately when auto-sync is first enabled
    doSync();

    // Set up 5-minute interval
    const intervalId = setInterval(doSync, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(intervalId);
  }, [sheetsConfig?.isConfigured, sheetsConfig?.autoSync]);

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

  const bookingRows = selectedRecordDay ? generateAllSeats() : [];

  const handleFieldUpdate = (assignmentId: string, field: string, value: any) => {
    updateWorkflowMutation.mutate({
      assignmentId,
      fields: { [field]: value },
    });
  };

  // Debounced handler for text fields - waits 500ms after user stops typing before saving
  const handleDebouncedTextUpdate = (assignmentId: string, field: string, value: string) => {
    const key = `${assignmentId}-${field}`;
    
    // Update local state immediately for responsive UI
    setPendingTextUpdates(prev => ({ ...prev, [key]: value }));
    
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
      // Clear the pending update after saving
      setPendingTextUpdates(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
      delete debounceTimersRef.current[key];
    }, 500);
  };

  // Helper to get current text value (pending update takes priority)
  const getTextValue = (assignmentId: string, field: string, originalValue: string | undefined) => {
    const key = `${assignmentId}-${field}`;
    return key in pendingTextUpdates ? pendingTextUpdates[key] : (originalValue || "");
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
    sendBookingEmailsMutation.mutate(Array.from(selectedAssignments));
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
          <Button 
            onClick={handleSendBookingEmails} 
            disabled={selectedAssignments.size === 0 || sendBookingEmailsMutation.isPending}
            data-testid="button-send-booking-emails"
          >
            <Mail className="h-4 w-4 mr-2" />
            Send Booking Emails {selectedAssignments.size > 0 && `(${selectedAssignments.size})`}
          </Button>
          <Button onClick={exportToExcel} variant="outline" data-testid="button-export-excel">
            <Download className="h-4 w-4 mr-2" />
            Export to Excel
          </Button>
          
          {sheetsConfig?.isConfigured ? (
            <Button 
              onClick={() => syncSheetsMutation.mutate()} 
              variant="outline"
              disabled={syncSheetsMutation.isPending}
              data-testid="button-sync-sheets"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncSheetsMutation.isPending ? 'animate-spin' : ''}`} />
              Sync to Sheets
            </Button>
          ) : null}
          
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
          
          <Dialog open={sheetsDialogOpen} onOpenChange={setSheetsDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="icon"
                title="Google Sheets Settings"
                data-testid="button-sheets-settings"
              >
                {sheetsConfig?.isConfigured ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Settings className="h-4 w-4" />
                )}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Google Sheets Sync</DialogTitle>
                <DialogDescription>
                  Connect a Google Sheet to automatically sync booking data. This makes it easy to share with your team.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                {sheetsConfig?.isConfigured ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Connected to Google Sheets</span>
                    </div>
                    {sheetsConfig.lastSyncTime && (
                      <p className="text-sm text-muted-foreground">
                        Last synced: {format(new Date(sheetsConfig.lastSyncTime), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    )}
                    
                    <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                      <div className="space-y-0.5">
                        <Label htmlFor="auto-sync" className="text-sm font-medium">
                          Auto-sync every 5 minutes
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Automatically keep your spreadsheet up to date
                        </p>
                      </div>
                      <Switch
                        id="auto-sync"
                        checked={sheetsConfig.autoSync}
                        onCheckedChange={(checked) => {
                          if (sheetsConfig.spreadsheetId) {
                            toggleAutoSyncMutation.mutate({ 
                              autoSync: checked, 
                              spreadsheetId: sheetsConfig.spreadsheetId 
                            });
                          }
                        }}
                        disabled={toggleAutoSyncMutation.isPending || !sheetsConfig.spreadsheetId}
                        data-testid="switch-auto-sync"
                      />
                    </div>
                    
                    <p className="text-sm text-muted-foreground">
                      {sheetsConfig.autoSync 
                        ? "Your spreadsheet will update automatically. You can also sync manually anytime."
                        : "Click \"Sync Now\" to update your spreadsheet with the latest booking data."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm">
                      To connect:
                    </p>
                    <ol className="text-sm list-decimal list-inside space-y-2 text-muted-foreground">
                      <li>Create a new Google Sheet (or use an existing one)</li>
                      <li>Copy the spreadsheet ID from the URL</li>
                      <li>Paste it below</li>
                    </ol>
                    <div className="bg-muted p-3 rounded-md text-xs">
                      <p className="font-medium mb-1">Where to find the ID:</p>
                      <p className="text-muted-foreground break-all">
                        https://docs.google.com/spreadsheets/d/<span className="text-primary font-medium">THIS-IS-YOUR-ID</span>/edit
                      </p>
                    </div>
                    <Input
                      placeholder="Paste your spreadsheet ID here"
                      value={spreadsheetIdInput}
                      onChange={(e) => setSpreadsheetIdInput(e.target.value)}
                      data-testid="input-spreadsheet-id"
                    />
                  </div>
                )}
              </div>
              
              <DialogFooter>
                {sheetsConfig?.isConfigured ? (
                  <div className="flex gap-2 w-full justify-between">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setSpreadsheetIdInput("");
                        setSheetsDialogOpen(false);
                      }}
                    >
                      Close
                    </Button>
                    <Button 
                      onClick={() => syncSheetsMutation.mutate()}
                      disabled={syncSheetsMutation.isPending}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${syncSheetsMutation.isPending ? 'animate-spin' : ''}`} />
                      Sync Now
                    </Button>
                  </div>
                ) : (
                  <Button 
                    onClick={() => configuresheetsMutation.mutate(spreadsheetIdInput)}
                    disabled={!spreadsheetIdInput.trim() || configuresheetsMutation.isPending}
                    data-testid="button-connect-sheets"
                  >
                    {configuresheetsMutation.isPending ? "Connecting..." : "Connect Sheet"}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
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

      <div className={`flex items-center flex-shrink-0 ${isFullscreen ? 'gap-1' : 'gap-4'}`}>
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
                <TableRow>
                  <TableHead className="sticky top-0 bg-background z-10 w-12">
                    <Checkbox
                      checked={selectedAssignments.size > 0 && selectedAssignments.size === bookingRows.filter(r => r.assignment).length}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  {isColumnVisible("seat") && <TableHead className="sticky top-0 bg-background z-10 text-xs w-12">SEAT</TableHead>}
                  {isColumnVisible("name") && <TableHead className="sticky top-0 bg-background z-10 text-xs min-w-[150px]">NAME</TableHead>}
                  {isColumnVisible("mobile") && <TableHead className="sticky top-0 bg-background z-10 text-xs min-w-[120px]">MOBILE</TableHead>}
                  {isColumnVisible("email") && <TableHead className="sticky top-0 bg-background z-10 text-xs w-32 max-w-[130px]">EMAIL</TableHead>}
                  {isColumnVisible("attendingWith") && <TableHead className="sticky top-0 bg-background z-10 text-xs">ATTENDING WITH</TableHead>}
                  {isColumnVisible("location") && <TableHead className="sticky top-0 bg-background z-10 text-xs">LOCATION</TableHead>}
                  {isColumnVisible("medicalQ") && <TableHead className="sticky top-0 bg-background z-10 text-xs w-14 text-center">MED<br/>Q</TableHead>}
                  {isColumnVisible("mobilityNotes") && <TableHead className="sticky top-0 bg-background z-10 text-xs">MOBILITY / MEDICAL NOTES</TableHead>}
                  {isColumnVisible("criminal") && <TableHead className="sticky top-0 bg-background z-10 text-xs w-20 text-center">CRIM/<br/>BANK</TableHead>}
                  {isColumnVisible("castingCategory") && <TableHead className="sticky top-0 bg-background z-10 text-xs">CASTING CATEGORY</TableHead>}
                  {isColumnVisible("notes") && <TableHead className={`sticky top-0 bg-background z-10 border-r-4 border-r-primary/30 ${isFullscreen ? 'min-w-[200px]' : 'min-w-[300px]'}`}>NOTES</TableHead>}
                  {isColumnVisible("emailSent") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-3 text-center w-16">EMAIL<br/>SENT</TableHead>}
                  {isColumnVisible("rsvp") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-3 text-center w-16">RSVP</TableHead>}
                  {isColumnVisible("paperSent") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-3 text-center w-16">PAPER<br/>SENT</TableHead>}
                  {isColumnVisible("paperReceived") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-3 text-center w-16">PAPER<br/>✓</TableHead>}
                  {isColumnVisible("signedIn") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-3 text-center w-16">SIGNED<br/>IN</TableHead>}
                  {isColumnVisible("otdNotes") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-2 text-center">OTD NOTES</TableHead>}
                  {isColumnVisible("standby") && <TableHead className="sticky top-0 bg-background z-10 text-xs px-2 text-center">STANDBY / SWAPS</TableHead>}
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
                    <>
                      {isFirstRowOfBlock && (
                        <TableRow key={`block-header-${row.blockNumber}`} className="bg-primary/10 hover:bg-primary/10">
                          <TableCell colSpan={20} className="py-3">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-lg" data-testid={`block-header-${row.blockNumber}`}>
                                Block {row.blockNumber}
                              </span>
                              {blockTotal > 0 && (
                                <span className="text-sm text-muted-foreground">
                                  {blockTotal} assigned | {blockFemaleCount}F / {blockMaleCount}M ({femalePercent}% female)
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow key={row.seatId} className={`${!row.assignment ? "bg-muted/20" : ""} h-12`}>
                        <TableCell className="py-1">
                          {row.assignment && (
                            <Checkbox
                              checked={selectedAssignments.has(row.assignment.id)}
                              onCheckedChange={(checked) => handleSelectAssignment(row.assignment!.id, checked as boolean)}
                              data-testid={`checkbox-select-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        {isColumnVisible("seat") && <TableCell className="font-mono text-xs py-1 w-12">{row.seatLabel}</TableCell>}
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
                                value={getTextValue(row.assignment.id, "medicalQuestion", row.assignment.medicalQuestion)}
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
                                value={getTextValue(row.assignment.id, "castingCategory", row.assignment.castingCategory)}
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
                                value={getTextValue(row.assignment.id, "notes", row.assignment.notes)}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "notes", e.target.value)}
                                placeholder="Notes"
                                className="min-h-[50px] text-sm resize-y"
                                data-testid={`textarea-notes-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("emailSent") && (
                          <TableCell className="text-center px-3 w-16 py-1">
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
                          <TableCell className="text-center px-3 w-16 py-1">
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
                          <TableCell className="text-center px-3 w-16 py-1">
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
                          <TableCell className="text-center px-3 w-16 py-1">
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
                          <TableCell className="text-center px-3 w-16 py-1">
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
                          <TableCell className="px-2 py-1">
                            {row.assignment && (
                              <Textarea
                                value={getTextValue(row.assignment.id, "otdNotes", row.assignment.otdNotes)}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "otdNotes", e.target.value)}
                                placeholder=""
                                className="h-7 min-h-0 text-xs resize-none w-24"
                                data-testid={`textarea-otd-notes-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                        {isColumnVisible("standby") && (
                          <TableCell className="px-2 py-1">
                            {row.assignment && (
                              <Textarea
                                value={getTextValue(row.assignment.id, "standbyReplacementSwaps", row.assignment.standbyReplacementSwaps)}
                                onChange={(e) => handleDebouncedTextUpdate(row.assignment!.id, "standbyReplacementSwaps", e.target.value)}
                                placeholder=""
                                className="h-7 min-h-0 text-xs resize-none w-24"
                                data-testid={`textarea-standby-${row.seatId}`}
                              />
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    </>
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
    </div>
  );
}
