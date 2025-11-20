import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
import { Download, Calendar } from "lucide-react";
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

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery<SeatAssignment[]>({
    queryKey: [`/api/seat-assignments/${selectedRecordDay}`],
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
      queryClient.invalidateQueries({ queryKey: [`/api/seat-assignments/${selectedRecordDay}`] });
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
    const newValue = currentValue ? null : new Date().toISOString();
    handleFieldUpdate(assignmentId, field, newValue);
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
        <Button onClick={exportToExcel} variant="outline" data-testid="button-export-excel">
          <Download className="h-4 w-4 mr-2" />
          Export to Excel
        </Button>
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
