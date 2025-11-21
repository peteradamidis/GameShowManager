import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Calendar, Mail } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

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
  medicalInfo?: string;
  attendingWith?: string;
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

  const updateWorkflowMutation = useMutation({
    mutationFn: async ({ assignmentId, fields }: { assignmentId: string; fields: Partial<SeatAssignment> }) => {
      return await apiRequest("PATCH", `/api/seat-assignments/${assignmentId}/workflow`, fields);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
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
    sendBookingEmailsMutation.mutate(Array.from(selectedAssignments));
  };

  const exportToExcel = () => {
    if (!selectedRecordDay || bookingRows.length === 0) {
      return;
    }

    const selectedDay = recordDays.find(d => d.id === selectedRecordDay);
    const dayName = selectedDay ? format(new Date(selectedDay.date), "MMMM-d-yyyy") : "booking-master";
    const dayDate = selectedDay ? format(new Date(selectedDay.date), "MMMM d, yyyy") : "";

    const exportData = bookingRows.map(row => ({
      "SEAT": row.seatId,
      "FIRST NATIONS": row.assignment?.firstNations || "",
      "RATING": row.assignment?.rating || "",
      "AGE": row.contestant?.age?.toString() || "",
      "NAME": row.contestant?.name || "",
      "MOBILE": row.contestant?.phone || "",
      "EMAIL": row.contestant?.email || "",
      "ATTENDING WITH": row.contestant?.attendingWith || "",
      "LOCATION": row.assignment?.location || "",
      "MEDICAL Q (Y/N)": row.assignment?.medicalQuestion || "",
      "MOBILITY / MEDICAL NOTES": row.contestant?.medicalInfo || "",
      "CRIMINAL/BANKRUPTCY": row.assignment?.criminalBankruptcy || "",
      "CASTING CATEGORY": row.assignment?.castingCategory || "",
      "NOTES": row.assignment?.notes || "",
      "BOOKING EMAIL SENT": row.assignment?.bookingEmailSent ? "✓" : "",
      "CONFIRMED RSVP": row.assignment?.confirmedRsvp ? "✓" : "",
      "PAPERWORK SENT": row.assignment?.paperworkSent ? "✓" : "",
      "PAPERWORK RECEIVED": row.assignment?.paperworkReceived ? "✓" : "",
      "SIGNED-IN": row.assignment?.signedIn ? "✓" : "",
      "OTD NOTES": row.assignment?.otdNotes || "",
      "STANDBY REPLACEMENT / SWAPS": row.assignment?.standbyReplacementSwaps || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    
    XLSX.utils.sheet_add_aoa(ws, [[`Booking Master - ${dayDate}`]], { origin: "A1" });
    XLSX.utils.sheet_add_json(ws, exportData, { origin: "A2", skipHeader: false });
    
    XLSX.utils.book_append_sheet(wb, ws, "Booking Master");

    ws['!cols'] = [
      { wch: 10 },
      { wch: 12 },
      { wch: 8 },
      { wch: 6 },
      { wch: 20 },
      { wch: 15 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 25 },
      { wch: 15 },
      { wch: 15 },
      { wch: 25 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
    ];

    XLSX.writeFile(wb, `Booking-Master-${dayName}.xlsx`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
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
        </div>
      </div>

      <div className="flex items-center gap-4">
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
        <div className="border rounded-md overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
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
                  <TableHead className="sticky top-0 bg-background z-10">Seat</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Name</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Age</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Mobile</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Email</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Location</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Medical</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Rating</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Category</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Email Sent</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">RSVP</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Paperwork Sent</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Paperwork ✓</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Signed In</TableHead>
                  <TableHead className="sticky top-0 bg-background z-10">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookingRows.map((row) => (
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
                    <TableCell>{row.contestant?.age || ""}</TableCell>
                    <TableCell className="text-sm">{row.contestant?.phone || ""}</TableCell>
                    <TableCell className="text-sm">{row.contestant?.email || ""}</TableCell>
                    <TableCell>
                      {row.assignment && (
                        <Input
                          value={row.assignment.location || ""}
                          onChange={(e) => handleFieldUpdate(row.assignment!.id, "location", e.target.value)}
                          placeholder="Location"
                          className="h-8 text-sm"
                          data-testid={`input-location-${row.seatId}`}
                        />
                      )}
                    </TableCell>
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
                    <TableCell>
                      {row.assignment && (
                        <Input
                          value={row.assignment.rating || ""}
                          onChange={(e) => handleFieldUpdate(row.assignment!.id, "rating", e.target.value)}
                          placeholder="Rating"
                          className="h-8 text-sm w-20"
                          data-testid={`input-rating-${row.seatId}`}
                        />
                      )}
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
                          value={row.assignment.notes || ""}
                          onChange={(e) => handleFieldUpdate(row.assignment!.id, "notes", e.target.value)}
                          placeholder="Notes"
                          className="h-8 min-h-0 text-sm resize-none"
                          data-testid={`textarea-notes-${row.seatId}`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
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
