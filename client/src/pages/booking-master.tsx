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
import { Download, Calendar, Mail, Maximize2, Minimize2, Settings, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

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
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

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
    <div className={isFullscreen ? "fixed inset-0 flex flex-col p-6 bg-background" : "p-6 space-y-6"}>
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold">Booking Master</h1>
          <p className="text-muted-foreground mt-1">
            Complete booking workflow tracking for each record day
          </p>
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

      <div className="flex items-center gap-4 flex-shrink-0">
        <Calendar className="h-5 w-5 text-muted-foreground" />
        <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
          <SelectTrigger className="w-80" data-testid="select-record-day">
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
          style={isFullscreen ? {} : { maxHeight: "calc(100vh - 300px)" }}
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
                  <TableHead className="sticky top-0 bg-background z-10">SEAT</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">NAME</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">MOBILE</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">EMAIL</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">ATTENDING WITH</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">LOCATION</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">MEDICAL Q (Y/N)</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">MOBILITY / MEDICAL NOTES</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">CRIMINAL / BANKRUPTCY</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">CASTING CATEGORY</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10 min-w-[300px]">NOTES</TableHead>
                  <TableHead className="sticky top-0 bg-primary/20 z-10 w-2 p-0"></TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">BOOKING EMAIL SENT</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">CONFIRMED RSVP</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">PAPERWORK SENT</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">PAPERWORK ✓</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">SIGNED-IN</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">OTD NOTES</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">STANDBY REPLACEMENT / SWAPS</TableHead>
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
                          <TableCell colSpan={21} className="py-3">
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
                      <TableRow key={row.seatId} className={!row.assignment ? "bg-muted/20" : ""}>
                        <TableCell>
                          {row.assignment && (
                            <Checkbox
                              checked={selectedAssignments.has(row.assignment.id)}
                              onCheckedChange={(checked) => handleSelectAssignment(row.assignment!.id, checked as boolean)}
                              data-testid={`checkbox-select-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{row.seatId}</TableCell>
                        <TableCell className="font-medium">
                          {row.contestant?.name || <span className="text-muted-foreground italic">Empty</span>}
                        </TableCell>
                        <TableCell className="text-sm">{row.contestant?.phone || ""}</TableCell>
                        <TableCell className="text-sm">{row.contestant?.email || ""}</TableCell>
                        <TableCell className="text-sm">{row.contestant?.attendingWith || ""}</TableCell>
                        <TableCell className="text-sm">{row.contestant?.location || ""}</TableCell>
                        <TableCell>
                          {row.assignment && (
                            <Input
                              value={row.assignment.medicalQuestion || ""}
                              onChange={(e) => handleFieldUpdate(row.assignment!.id, "medicalQuestion", e.target.value)}
                              placeholder="Y/N"
                              className="h-8 text-sm w-16"
                              data-testid={`input-medical-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.contestant?.mobilityNotes || ""}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.contestant?.criminalRecord || ""}
                        </TableCell>
                        <TableCell>
                          {row.assignment && (
                            <Input
                              value={row.assignment.castingCategory || ""}
                              onChange={(e) => handleFieldUpdate(row.assignment!.id, "castingCategory", e.target.value)}
                              placeholder="Category"
                              className="h-8 text-sm"
                              data-testid={`input-category-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {row.assignment && (
                            <Textarea
                              value={row.assignment.notes || ""}
                              onChange={(e) => handleFieldUpdate(row.assignment!.id, "notes", e.target.value)}
                              placeholder="Notes"
                              className="min-h-[60px] text-sm resize-y"
                              data-testid={`textarea-notes-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="bg-primary/20 p-0 w-2"></TableCell>
                        <TableCell className="text-center">
                          {row.assignment && (
                            <Checkbox
                              checked={!!row.assignment.bookingEmailSent}
                              onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "bookingEmailSent", row.assignment!.bookingEmailSent)}
                              data-testid={`checkbox-email-sent-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.assignment && (
                            <Checkbox
                              checked={!!row.assignment.confirmedRsvp}
                              onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "confirmedRsvp", row.assignment!.confirmedRsvp)}
                              data-testid={`checkbox-rsvp-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.assignment && (
                            <Checkbox
                              checked={!!row.assignment.paperworkSent}
                              onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "paperworkSent", row.assignment!.paperworkSent)}
                              data-testid={`checkbox-paperwork-sent-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.assignment && (
                            <Checkbox
                              checked={!!row.assignment.paperworkReceived}
                              onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "paperworkReceived", row.assignment!.paperworkReceived)}
                              data-testid={`checkbox-paperwork-received-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.assignment && (
                            <Checkbox
                              checked={!!row.assignment.signedIn}
                              onCheckedChange={() => handleCheckboxToggle(row.assignment!.id, "signedIn", row.assignment!.signedIn)}
                              data-testid={`checkbox-signed-in-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {row.assignment && (
                            <Textarea
                              value={row.assignment.otdNotes || ""}
                              onChange={(e) => handleFieldUpdate(row.assignment!.id, "otdNotes", e.target.value)}
                              placeholder=""
                              className="h-8 min-h-0 text-sm resize-none"
                              data-testid={`textarea-otd-notes-${row.seatId}`}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {row.assignment && (
                            <Textarea
                              value={row.assignment.standbyReplacementSwaps || ""}
                              onChange={(e) => handleFieldUpdate(row.assignment!.id, "standbyReplacementSwaps", e.target.value)}
                              placeholder=""
                              className="h-8 min-h-0 text-sm resize-none"
                              data-testid={`textarea-standby-${row.seatId}`}
                            />
                          )}
                        </TableCell>
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
