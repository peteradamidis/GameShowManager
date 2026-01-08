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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Mail,
  MailCheck,
  RefreshCw,
  ArrowRightLeft,
  Search,
  Filter,
  Users,
  ExternalLink
} from "lucide-react";
import { format } from "date-fns";

interface RecordDay {
  id: string;
  date: string;
  rxNumber?: string;
  totalSeats: number;
  status: string;
}

interface SeatAssignment {
  id: string;
  recordDayId: string;
  contestantId: string;
  blockNumber: number;
  seatLabel: string;
  bookingEmailSent: string | null;
  confirmedRsvp: string | null;
  notes: string | null;
  contestant: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    location?: string;
    photoUrl?: string;
  };
}

type StatusFilter = "all" | "not_sent" | "awaiting" | "confirmed" | "declined";

export default function BookingResponses() {
  const { toast } = useToast();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  
  // Dialog states
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineAssignment, setDeclineAssignment] = useState<SeatAssignment | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  
  const [changeDateDialogOpen, setChangeDateDialogOpen] = useState(false);
  const [changeDateAssignment, setChangeDateAssignment] = useState<SeatAssignment | null>(null);
  const [newRecordDayId, setNewRecordDayId] = useState<string>("");

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: assignments = [], isLoading } = useQuery<SeatAssignment[]>({
    queryKey: ["/api/seat-assignments/record-day", selectedRecordDay],
    enabled: !!selectedRecordDay,
  });

  // Mutation for confirming a booking
  const confirmMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("PATCH", `/api/seat-assignments/${assignmentId}`, {
        confirmedRsvp: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast({ title: "Booking confirmed" });
      queryClient.invalidateQueries({ queryKey: ["/api/seat-assignments"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to confirm booking", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for declining a booking (moves to reschedule)
  const declineMutation = useMutation({
    mutationFn: async ({ assignmentId, reason }: { assignmentId: string; reason: string }) => {
      return apiRequest("POST", `/api/seat-assignments/${assignmentId}/decline`, {
        reason,
      });
    },
    onSuccess: () => {
      toast({ title: "Booking declined", description: "Contestant moved to reschedule list" });
      setDeclineDialogOpen(false);
      setDeclineAssignment(null);
      setDeclineReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/seat-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/canceled-assignments"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to decline booking", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for changing record date
  const changeRecordDateMutation = useMutation({
    mutationFn: async ({ assignmentId, newRecordDayId }: { assignmentId: string; newRecordDayId: string }) => {
      return apiRequest("POST", `/api/seat-assignments/${assignmentId}/change-date`, {
        newRecordDayId,
      });
    },
    onSuccess: () => {
      toast({ title: "Record date changed", description: "Contestant moved to new date" });
      setChangeDateDialogOpen(false);
      setChangeDateAssignment(null);
      setNewRecordDayId("");
      queryClient.invalidateQueries({ queryKey: ["/api/seat-assignments"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to change record date", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Bulk confirm mutation
  const bulkConfirmMutation = useMutation({
    mutationFn: async (assignmentIds: string[]) => {
      const promises = assignmentIds.map(id => 
        apiRequest("PATCH", `/api/seat-assignments/${id}`, {
          confirmedRsvp: new Date().toISOString(),
        })
      );
      return Promise.all(promises);
    },
    onSuccess: (_, variables) => {
      toast({ title: `${variables.length} bookings confirmed` });
      setSelectedAssignments(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/seat-assignments"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to confirm bookings", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const getStatus = (assignment: SeatAssignment): "not_sent" | "awaiting" | "confirmed" | "declined" => {
    if (assignment.confirmedRsvp) {
      // Check if it was a decline (stored in notes with specific pattern)
      if (assignment.notes?.startsWith("[DECLINED]")) {
        return "declined";
      }
      return "confirmed";
    }
    if (assignment.bookingEmailSent) {
      return "awaiting";
    }
    return "not_sent";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0"><CheckCircle className="h-3 w-3 mr-1" />Confirmed</Badge>;
      case "declined":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0"><XCircle className="h-3 w-3 mr-1" />Declined</Badge>;
      case "awaiting":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0"><Clock className="h-3 w-3 mr-1" />Awaiting Reply</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground"><Mail className="h-3 w-3 mr-1" />Not Sent</Badge>;
    }
  };

  const counts = {
    all: assignments.length,
    not_sent: assignments.filter(a => !a.bookingEmailSent).length,
    awaiting: assignments.filter(a => a.bookingEmailSent && !a.confirmedRsvp).length,
    confirmed: assignments.filter(a => a.confirmedRsvp && !a.notes?.startsWith("[DECLINED]")).length,
    declined: assignments.filter(a => a.notes?.startsWith("[DECLINED]")).length,
  };

  const filteredAssignments = assignments
    .filter(a => {
      if (statusFilter === "all") return true;
      return getStatus(a) === statusFilter;
    })
    .filter(a => {
      if (!searchQuery) return true;
      const search = searchQuery.toLowerCase();
      return (
        a.contestant.name.toLowerCase().includes(search) ||
        a.contestant.email?.toLowerCase().includes(search) ||
        a.seatLabel.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => a.blockNumber - b.blockNumber || a.seatLabel.localeCompare(b.seatLabel));

  const toggleSelectAll = () => {
    if (selectedAssignments.size === filteredAssignments.length) {
      setSelectedAssignments(new Set());
    } else {
      setSelectedAssignments(new Set(filteredAssignments.map(a => a.id)));
    }
  };

  const toggleSelectAssignment = (id: string) => {
    const newSelected = new Set(selectedAssignments);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedAssignments(newSelected);
  };

  const handleConfirm = (assignment: SeatAssignment) => {
    confirmMutation.mutate(assignment.id);
  };

  const handleDeclineClick = (assignment: SeatAssignment) => {
    setDeclineAssignment(assignment);
    setDeclineReason("");
    setDeclineDialogOpen(true);
  };

  const handleDeclineSubmit = () => {
    if (!declineAssignment) return;
    declineMutation.mutate({
      assignmentId: declineAssignment.id,
      reason: declineReason,
    });
  };

  const handleChangeDateClick = (assignment: SeatAssignment) => {
    setChangeDateAssignment(assignment);
    setNewRecordDayId("");
    setChangeDateDialogOpen(true);
  };

  const handleChangeDateSubmit = () => {
    if (!changeDateAssignment || !newRecordDayId) return;
    changeRecordDateMutation.mutate({
      assignmentId: changeDateAssignment.id,
      newRecordDayId,
    });
  };

  const handleBulkConfirm = () => {
    const ids = Array.from(selectedAssignments);
    if (ids.length === 0) return;
    bulkConfirmMutation.mutate(ids);
  };

  const selectedRecordDayData = recordDays.find(rd => rd.id === selectedRecordDay);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold" data-testid="page-title">Booking Responses</h1>
          <p className="text-sm text-muted-foreground">
            Track and manage contestant booking confirmations
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <Select
            value={selectedRecordDay || ""}
            onValueChange={(value) => {
              setSelectedRecordDay(value || null);
              setSelectedAssignments(new Set());
            }}
          >
            <SelectTrigger className="w-[280px]" data-testid="select-record-day">
              <SelectValue placeholder="Select record day..." />
            </SelectTrigger>
            <SelectContent>
              {recordDays.map((rd) => (
                <SelectItem key={rd.id} value={rd.id}>
                  {rd.rxNumber ? `${rd.rxNumber} - ` : ""}{format(new Date(rd.date), "EEE, MMM d, yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedRecordDay && (
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/seat-assignments/record-day", selectedRecordDay] });
              }}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {!selectedRecordDay ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Mail className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Select a record day to view bookings</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No contestants assigned to this day</p>
            <p className="text-sm">Assign contestants from the Seating Chart</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden mt-4">
          {/* Filters and Actions Bar */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge 
                variant={statusFilter === "all" ? "default" : "outline"} 
                className="cursor-pointer"
                onClick={() => setStatusFilter("all")}
                data-testid="filter-all"
              >
                All ({counts.all})
              </Badge>
              <Badge 
                variant={statusFilter === "not_sent" ? "default" : "outline"} 
                className="cursor-pointer"
                onClick={() => setStatusFilter("not_sent")}
                data-testid="filter-not-sent"
              >
                <Mail className="h-3 w-3 mr-1" />
                Not Sent ({counts.not_sent})
              </Badge>
              <Badge 
                variant={statusFilter === "awaiting" ? "default" : "outline"} 
                className="cursor-pointer"
                onClick={() => setStatusFilter("awaiting")}
                data-testid="filter-awaiting"
              >
                <Clock className="h-3 w-3 mr-1" />
                Awaiting ({counts.awaiting})
              </Badge>
              <Badge 
                variant={statusFilter === "confirmed" ? "default" : "outline"} 
                className="cursor-pointer"
                onClick={() => setStatusFilter("confirmed")}
                data-testid="filter-confirmed"
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Confirmed ({counts.confirmed})
              </Badge>
              <Badge 
                variant={statusFilter === "declined" ? "default" : "outline"} 
                className="cursor-pointer"
                onClick={() => setStatusFilter("declined")}
                data-testid="filter-declined"
              >
                <XCircle className="h-3 w-3 mr-1" />
                Declined ({counts.declined})
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search contestants..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px]"
                  data-testid="input-search"
                />
              </div>
              {selectedAssignments.size > 0 && (
                <Button
                  onClick={handleBulkConfirm}
                  disabled={bulkConfirmMutation.isPending}
                  data-testid="button-bulk-confirm"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Confirm Selected ({selectedAssignments.size})
                </Button>
              )}
            </div>
          </div>

          {/* Table */}
          <ScrollArea className="flex-1 border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedAssignments.size === filteredAssignments.length && filteredAssignments.length > 0}
                      onCheckedChange={toggleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Contestant</TableHead>
                  <TableHead className="w-24">Block</TableHead>
                  <TableHead className="w-24">Seat</TableHead>
                  <TableHead className="w-36">Email Status</TableHead>
                  <TableHead className="w-40">Response Status</TableHead>
                  <TableHead className="w-64">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssignments.map((assignment) => {
                  const status = getStatus(assignment);
                  const isSelected = selectedAssignments.has(assignment.id);

                  return (
                    <TableRow 
                      key={assignment.id}
                      className={isSelected ? "bg-accent/50" : ""}
                      data-testid={`row-assignment-${assignment.id}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectAssignment(assignment.id)}
                          data-testid={`checkbox-${assignment.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {assignment.contestant.photoUrl && (
                              <AvatarImage src={assignment.contestant.photoUrl} alt={assignment.contestant.name} />
                            )}
                            <AvatarFallback className="text-xs">
                              {assignment.contestant.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{assignment.contestant.name}</div>
                            {assignment.contestant.email && (
                              <div className="text-xs text-muted-foreground">{assignment.contestant.email}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{assignment.blockNumber}</TableCell>
                      <TableCell className="text-center font-medium">{assignment.seatLabel}</TableCell>
                      <TableCell>
                        {assignment.bookingEmailSent ? (
                          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <MailCheck className="h-4 w-4" />
                            <span className="text-xs">
                              {format(new Date(assignment.bookingEmailSent), "MMM d")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not sent</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(status)}
                      </TableCell>
                      <TableCell>
                        {status === "confirmed" || status === "declined" ? (
                          <span className="text-sm text-muted-foreground">
                            {status === "confirmed" ? "Confirmed" : "Moved to reschedule"}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleConfirm(assignment)}
                              disabled={confirmMutation.isPending}
                              data-testid={`button-confirm-${assignment.id}`}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeclineClick(assignment)}
                              data-testid={`button-decline-${assignment.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Decline
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleChangeDateClick(assignment)}
                              data-testid={`button-change-date-${assignment.id}`}
                            >
                              <ArrowRightLeft className="h-3 w-3 mr-1" />
                              Change Date
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Summary Bar */}
          <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span><strong>{counts.confirmed}</strong> confirmed</span>
              <span><strong>{counts.awaiting}</strong> awaiting reply</span>
              <span><strong>{counts.not_sent}</strong> not sent</span>
              <span><strong>{counts.declined}</strong> declined</span>
            </div>
            {selectedRecordDayData && (
              <div className="text-sm">
                <strong>{selectedRecordDayData.rxNumber || format(new Date(selectedRecordDayData.date), "MMM d, yyyy")}</strong>
                {" - "}
                <span className="text-muted-foreground">{assignments.length} contestants assigned</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Decline Dialog */}
      <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Booking</DialogTitle>
            <DialogDescription>
              {declineAssignment && (
                <>
                  Mark <strong>{declineAssignment.contestant.name}</strong>'s booking as declined.
                  They will be moved to the reschedule list.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="decline-reason">Reason for decline</Label>
              <Textarea
                id="decline-reason"
                placeholder="e.g., No longer available, scheduling conflict, etc."
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                data-testid="input-decline-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeclineSubmit}
              disabled={declineMutation.isPending}
              data-testid="button-submit-decline"
            >
              {declineMutation.isPending ? "Processing..." : "Decline & Move to Reschedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Date Dialog */}
      <Dialog open={changeDateDialogOpen} onOpenChange={setChangeDateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Record Date</DialogTitle>
            <DialogDescription>
              {changeDateAssignment && (
                <>
                  Move <strong>{changeDateAssignment.contestant.name}</strong> to a different record day.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-date">Select new record day</Label>
              <Select
                value={newRecordDayId}
                onValueChange={setNewRecordDayId}
              >
                <SelectTrigger data-testid="select-new-record-day">
                  <SelectValue placeholder="Select record day..." />
                </SelectTrigger>
                <SelectContent>
                  {recordDays
                    .filter(rd => rd.id !== selectedRecordDay)
                    .map((rd) => (
                      <SelectItem key={rd.id} value={rd.id}>
                        {rd.rxNumber ? `${rd.rxNumber} - ` : ""}{format(new Date(rd.date), "EEE, MMM d, yyyy")}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeDateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleChangeDateSubmit}
              disabled={!newRecordDayId || changeRecordDateMutation.isPending}
              data-testid="button-submit-change-date"
            >
              {changeRecordDateMutation.isPending ? "Moving..." : "Move to New Date"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
