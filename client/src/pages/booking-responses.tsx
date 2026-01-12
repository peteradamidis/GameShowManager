import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { 
  Mail, 
  Send, 
  CheckCircle, 
  XCircle, 
  RefreshCw,
  Search,
  Users,
  Calendar,
  Clock,
  MailCheck,
  ArrowRightLeft,
  UserCheck,
  MailPlus,
  LayoutGrid,
  Loader2,
  Undo2,
  Ticket,
  History,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import type { RecordDay, Contestant, SeatAssignment, RebookingHistory } from "@shared/schema";

interface BookingAssignment extends SeatAssignment {
  contestant: Contestant | null;
  recordDay: RecordDay | null;
}

interface RebookingHistoryEntry extends RebookingHistory {
  contestant?: Contestant;
  fromRecordDay: RecordDay;
  toRecordDay: RecordDay;
}

interface BookingTrackerResponse {
  assignments: BookingAssignment[];
  stats: {
    total: number;
    notSent: number;
    awaiting: number;
    confirmed: number;
    declined: number;
  };
}

type StatusFilter = "all" | "not_sent" | "awaiting" | "confirmed" | "declined";

export default function BookingResponses() {
  const { toast } = useToast();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("");
  const [selectedBlock, setSelectedBlock] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchName, setSearchName] = useState("");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  
  // Send email dialog state
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  
  // Clear selection when filters change to prevent hidden selections
  const handleRecordDayChange = (value: string) => {
    setSelectedRecordDay(value);
    setSelectedAssignments(new Set());
  };
  
  const handleBlockChange = (value: string) => {
    setSelectedBlock(value);
    setSelectedAssignments(new Set());
  };
  
  const handleStatusFilterChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setSelectedAssignments(new Set());
  };
  
  const handleSearchChange = (value: string) => {
    setSearchName(value);
    // Only clear selection if search becomes more restrictive
    if (value.length > searchName.length) {
      setSelectedAssignments(new Set());
    }
  };
  
  // Dialog states
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineAssignment, setDeclineAssignment] = useState<BookingAssignment | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineAction, setDeclineAction] = useState<"reschedule" | "rebook">("reschedule");
  const [rebookRecordDayId, setRebookRecordDayId] = useState<string>("");
  const [rebookBlock, setRebookBlock] = useState<string>("");
  const [rebookSeat, setRebookSeat] = useState<string>("");
  const [rebookReason, setRebookReason] = useState<string>("");
  
  const [changeDateDialogOpen, setChangeDateDialogOpen] = useState(false);
  const [changeDateAssignment, setChangeDateAssignment] = useState<BookingAssignment | null>(null);
  const [newRecordDayId, setNewRecordDayId] = useState<string>("");
  
  // Resend email dialog state
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [resendAssignment, setResendAssignment] = useState<BookingAssignment | null>(null);
  
  // Rebooking history section state
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  // Sort record days by date
  const sortedRecordDays = [...recordDays].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Set default to first record day when data loads
  useEffect(() => {
    if (sortedRecordDays.length > 0 && !selectedRecordDay) {
      setSelectedRecordDay(sortedRecordDays[0].id);
    }
  }, [sortedRecordDays, selectedRecordDay]);

  // Build query URL with filters
  const buildTrackerUrl = () => {
    const params = new URLSearchParams();
    if (selectedRecordDay) {
      params.append("recordDayId", selectedRecordDay);
    }
    if (statusFilter !== "all") {
      params.append("status", statusFilter);
    }
    const queryString = params.toString();
    return queryString ? `/api/booking-tracker?${queryString}` : "/api/booking-tracker";
  };

  const trackerUrl = buildTrackerUrl();
    
  const { data: trackerResponse, isLoading: loadingTracker, refetch: refetchTracker } = useQuery<BookingTrackerResponse>({
    queryKey: ["/api/booking-tracker", selectedRecordDay, statusFilter],
    queryFn: async () => {
      const response = await fetch(trackerUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch booking tracker data');
      return response.json();
    },
  });
  
  const trackerData = trackerResponse?.assignments || [];
  const stats = trackerResponse?.stats || { total: 0, notSent: 0, awaiting: 0, confirmed: 0, declined: 0 };

  // Query for rebooking history for the selected record day
  const { data: rebookingHistory = [] } = useQuery<RebookingHistoryEntry[]>({
    queryKey: ["/api/rebooking-history/record-day", selectedRecordDay],
    queryFn: async () => {
      const res = await fetch(`/api/rebooking-history/record-day/${selectedRecordDay}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch rebooking history');
      return res.json();
    },
    enabled: !!selectedRecordDay,
  });

  // Query for seat assignments on the rebook record day (to show available seats)
  const { data: rebookDayAssignments = [] } = useQuery<SeatAssignment[]>({
    queryKey: ["/api/seat-assignments", { recordDayId: rebookRecordDayId }],
    queryFn: async () => {
      const res = await fetch(`/api/seat-assignments?recordDayId=${rebookRecordDayId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch seat assignments');
      return res.json();
    },
    enabled: !!rebookRecordDayId,
  });

  // Seat structure for the seating chart
  const SEAT_ROWS = [
    { label: 'A', count: 5 },
    { label: 'B', count: 5 },
    { label: 'C', count: 4 },
    { label: 'D', count: 4 },
    { label: 'E', count: 4 },
  ];

  // Calculate available seats for the selected rebook block
  const rebookAvailableSeats = rebookBlock ? (() => {
    const blockNum = parseInt(rebookBlock);
    const occupied = new Set(
      rebookDayAssignments
        .filter((a: SeatAssignment) => a.blockNumber === blockNum)
        .map((a: SeatAssignment) => a.seatLabel)
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

  const invalidateBookingQueries = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (
          key.startsWith('/api/booking-tracker') || 
          key.startsWith('/api/seat-assignments') ||
          key.startsWith('/api/paperwork') ||
          key.startsWith('/api/contestants') ||
          key.startsWith('/api/booking-master') ||
          key.startsWith('/api/rebooking-history')
        );
      },
    });
  };

  // Mutation for confirming a booking
  const confirmMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("PATCH", `/api/seat-assignments/${assignmentId}`, {
        confirmedRsvp: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      toast({ title: "Booking confirmed" });
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to confirm booking", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for undoing confirmation (clearing confirmedRsvp)
  const undoConfirmMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("DELETE", `/api/seat-assignments/${assignmentId}/confirmed-rsvp`, {});
    },
    onSuccess: () => {
      toast({ title: "Confirmation cleared", description: "Contestant is now awaiting reply" });
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to clear confirmation", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for undoing decline (restoring from reschedule)
  const undoDeclineMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("POST", `/api/seat-assignments/${assignmentId}/undo-decline`, {});
    },
    onSuccess: () => {
      toast({ title: "Decline undone", description: "Contestant is now awaiting reply" });
      invalidateBookingQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/canceled-assignments"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to undo decline", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for sending ticket email with PDF
  const sendTicketMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("POST", `/api/seat-assignments/${assignmentId}/send-ticket`, {});
    },
    onSuccess: (_, assignmentId) => {
      toast({ title: "Ticket sent", description: "Ticket email with PDF has been sent to the contestant" });
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to send ticket", 
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
      invalidateBookingQueries();
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
      invalidateBookingQueries();
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
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to confirm bookings", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Bulk send booking email mutation
  const bulkSendBookingEmailMutation = useMutation({
    mutationFn: async (assignmentIds: string[]) => {
      const response = await apiRequest("POST", "/api/booking-confirmations/send", {
        seatAssignmentIds: assignmentIds,
      });
      // apiRequest returns a Response object, need to parse JSON
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to send emails");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const results = data.results || [];
      const successCount = results.filter((r: any) => r.success).length;
      const failCount = results.filter((r: any) => !r.success).length;
      
      if (failCount > 0) {
        toast({ 
          title: `Emails sent: ${successCount} success, ${failCount} failed`,
          description: "Some emails could not be sent",
          variant: "destructive"
        });
      } else {
        toast({ title: `Booking emails sent to ${successCount} contestant(s)` });
      }
      setSelectedAssignments(new Set());
      setSendEmailDialogOpen(false);
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to send emails", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Resend booking email mutation (reuses the same endpoint)
  const resendBookingEmailMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest("POST", "/api/booking-confirmations/send", {
        seatAssignmentIds: [assignmentId],
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to resend email");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const results = data.results || [];
      const successCount = results.filter((r: any) => r.success).length;
      
      if (successCount > 0) {
        toast({ title: "Booking email resent successfully" });
      } else {
        toast({ 
          title: "Failed to resend email",
          description: results[0]?.error || "Unknown error",
          variant: "destructive"
        });
      }
      setResendDialogOpen(false);
      setResendAssignment(null);
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to resend email", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Use stats from API (computed from record-day-filtered but not status-filtered data)
  const totalCount = stats.total;
  const notSentCount = stats.notSent;
  const awaitingCount = stats.awaiting;
  const confirmedCount = stats.confirmed;
  const declinedCount = stats.declined;
  
  // Helper to check if assignment is declined
  const isDeclined = (a: BookingAssignment) => a.notes?.startsWith('[DECLINED]');

  // Filter by block and search
  const filteredData = trackerData.filter((item) => {
    // Filter by block
    if (selectedBlock !== "all" && item.blockNumber !== parseInt(selectedBlock)) {
      return false;
    }
    // Filter by search
    if (!searchName) return true;
    const search = searchName.toLowerCase();
    return (
      item.contestant?.name?.toLowerCase().includes(search) ||
      item.contestant?.email?.toLowerCase().includes(search)
    );
  });

  // Selection helpers
  const selectedItems = filteredData.filter(item => selectedAssignments.has(item.id));
  const selectedPendingConfirmation = selectedItems.filter(item => 
    !item.confirmedRsvp && !isDeclined(item)
  );
  // For sending emails: those not yet sent, have email, and not declined
  const selectedNotSentWithEmail = selectedItems.filter(item => 
    !item.bookingEmailSent && item.contestant?.email && !isDeclined(item)
  );
  const selectedNotSentWithoutEmail = selectedItems.filter(item => 
    !item.bookingEmailSent && !item.contestant?.email && !isDeclined(item)
  );

  const handleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedAssignments(new Set(filteredData.map(item => item.id)));
    } else {
      setSelectedAssignments(new Set());
    }
  };

  const handleSelectItem = (id: string, checked: boolean | 'indeterminate') => {
    const newSelected = new Set(selectedAssignments);
    if (checked === true) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedAssignments(newSelected);
  };

  const handleConfirm = (assignment: BookingAssignment) => {
    confirmMutation.mutate(assignment.id);
  };

  const handleDeclineClick = (assignment: BookingAssignment) => {
    setDeclineAssignment(assignment);
    setDeclineReason("");
    setDeclineAction("reschedule");
    setRebookRecordDayId("");
    setRebookBlock("");
    setRebookSeat("");
    setRebookReason("");
    setDeclineDialogOpen(true);
  };

  // Rebook mutation: uses atomic rebook endpoint that logs history
  const rebookMutation = useMutation({
    mutationFn: async ({ 
      oldAssignmentId, 
      contestantId, 
      newRecordDayId, 
      blockNumber, 
      seatLabel,
      reason 
    }: { 
      oldAssignmentId: string; 
      contestantId: string;
      newRecordDayId: string; 
      blockNumber: number;
      seatLabel: string;
      reason?: string;
    }) => {
      // Use the atomic rebook endpoint that logs rebooking history
      await apiRequest("POST", "/api/rebook", {
        oldAssignmentId,
        contestantId,
        newRecordDayId,
        blockNumber,
        seatLabel,
        reason,
      });
    },
    onSuccess: () => {
      toast({ title: "Contestant rebooked", description: `Moved to Block ${rebookBlock}, Seat ${rebookSeat}` });
      setDeclineDialogOpen(false);
      setDeclineAssignment(null);
      setDeclineReason("");
      setRebookRecordDayId("");
      setRebookBlock("");
      setRebookSeat("");
      setRebookReason("");
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to rebook contestant", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleDeclineSubmit = () => {
    if (!declineAssignment) return;
    
    if (declineAction === "rebook") {
      // Require record day, block, and seat for rebook
      if (!rebookRecordDayId || !rebookBlock || !rebookSeat) return;
      rebookMutation.mutate({
        oldAssignmentId: declineAssignment.id,
        contestantId: declineAssignment.contestantId,
        newRecordDayId: rebookRecordDayId,
        blockNumber: parseInt(rebookBlock),
        seatLabel: rebookSeat,
        reason: rebookReason || undefined,
      });
    } else {
      // Use the decline mutation for reschedule
      declineMutation.mutate({
        assignmentId: declineAssignment.id,
        reason: declineReason,
      });
    }
  };

  const handleChangeDateClick = (assignment: BookingAssignment) => {
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
    const ids = selectedPendingConfirmation.map(item => item.id);
    if (ids.length === 0) {
      toast({ title: "No pending confirmations selected", description: "Select contestants who haven't been confirmed yet", variant: "destructive" });
      return;
    }
    bulkConfirmMutation.mutate(ids);
  };

  const handleSendBookingEmails = () => {
    const ids = selectedNotSentWithEmail.map(item => item.id);
    if (ids.length === 0) {
      toast({ 
        title: "No valid recipients", 
        description: "Select contestants who haven't been sent a booking email and have an email address", 
        variant: "destructive" 
      });
      return;
    }
    bulkSendBookingEmailMutation.mutate(ids);
  };

  // Resend email handlers
  const handleResendClick = (assignment: BookingAssignment) => {
    setResendAssignment(assignment);
    setResendDialogOpen(true);
  };

  const handleResendConfirm = () => {
    if (!resendAssignment) return;
    resendBookingEmailMutation.mutate(resendAssignment.id);
  };

  const getStatusBadge = (assignment: BookingAssignment) => {
    // Check for declined first (takes priority)
    if (isDeclined(assignment)) {
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">
          <XCircle className="h-3 w-3 mr-1" />
          Declined
        </Badge>
      );
    }
    if (assignment.confirmedRsvp) {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">
          <CheckCircle className="h-3 w-3 mr-1" />
          Confirmed
        </Badge>
      );
    }
    if (assignment.bookingEmailSent) {
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">
          <Clock className="h-3 w-3 mr-1" />
          Awaiting Reply
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Mail className="h-3 w-3 mr-1" />
        Not Sent
      </Badge>
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Mail className="h-8 w-8 text-blue-600" />
            Booking Responses
          </h1>
          <p className="text-muted-foreground mt-1">
            Track and manage contestant booking confirmations
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => refetchTracker()}
          data-testid="button-refresh-tracker"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Label htmlFor="record-day-filter">Record Day:</Label>
          <Select value={selectedRecordDay} onValueChange={handleRecordDayChange}>
            <SelectTrigger className="w-[200px]" data-testid="select-record-day">
              <SelectValue placeholder="Select Record Day" />
            </SelectTrigger>
            <SelectContent>
              {sortedRecordDays.map((rd) => (
                <SelectItem key={rd.id} value={rd.id}>
                  {format(new Date(rd.date), "MMM d, yyyy")} {rd.rxNumber ? `- ${rd.rxNumber}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="block-filter">Block:</Label>
          <Select value={selectedBlock} onValueChange={handleBlockChange}>
            <SelectTrigger className="w-[120px]" data-testid="select-block">
              <SelectValue placeholder="All Blocks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Blocks</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7].map((block) => (
                <SelectItem key={block} value={String(block)}>
                  Block {block}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="status-filter">Status:</Label>
          <Select value={statusFilter} onValueChange={(v) => handleStatusFilterChange(v as StatusFilter)}>
            <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assigned</SelectItem>
              <SelectItem value="not_sent">Not Sent</SelectItem>
              <SelectItem value="awaiting">Awaiting Reply</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={searchName}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-[200px]"
            data-testid="input-search-name"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              Total Assigned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600" data-testid="text-total-count">
              {totalCount}
            </p>
          </CardContent>
        </Card>

        <Card className="border-gray-200 dark:border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MailPlus className="h-4 w-4 text-gray-500" />
              Not Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-600" data-testid="text-not-sent-count">
              {notSentCount}
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Awaiting Reply
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600" data-testid="text-awaiting-count">
              {awaitingCount}
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 dark:border-green-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-green-500" />
              Confirmed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600" data-testid="text-confirmed-count">
              {confirmedCount}
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Declined
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600" data-testid="text-declined-count">
              {declinedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rebooking History Section */}
      {rebookingHistory.length > 0 && (
        <Card className="border-purple-200 dark:border-purple-800">
          <CardHeader 
            className="pb-2 cursor-pointer hover-elevate"
            onClick={() => setHistoryExpanded(!historyExpanded)}
          >
            <CardTitle className="text-sm flex items-center gap-2">
              {historyExpanded ? (
                <ChevronDown className="h-4 w-4 text-purple-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-purple-500" />
              )}
              <History className="h-4 w-4 text-purple-500" />
              Rebooking History ({rebookingHistory.length})
            </CardTitle>
          </CardHeader>
          {historyExpanded && (
            <CardContent>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {rebookingHistory.map((entry) => {
                  const isIncoming = entry.toRecordDayId === selectedRecordDay;
                  const isOutgoing = entry.fromRecordDayId === selectedRecordDay;
                  
                  return (
                    <div 
                      key={entry.id} 
                      className={`p-2 rounded-md text-sm border ${
                        isIncoming 
                          ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' 
                          : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{entry.contestant?.name || 'Unknown'}</span>
                        <Badge variant="outline" className={isIncoming ? 'border-green-500 text-green-700' : 'border-red-500 text-red-700'}>
                          {isIncoming ? 'Rebooked IN' : 'Rebooked OUT'}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {isIncoming ? (
                          <>
                            From: {entry.fromRecordDay?.rxNumber || format(new Date(entry.fromRecordDay?.date), 'MMM d')} 
                            {' '}Block {entry.fromBlockNumber}, Seat {entry.fromSeatLabel}
                            {' → '}Block {entry.toBlockNumber}, Seat {entry.toSeatLabel}
                          </>
                        ) : (
                          <>
                            To: {entry.toRecordDay?.rxNumber || format(new Date(entry.toRecordDay?.date), 'MMM d')}
                            {' '}Block {entry.toBlockNumber}, Seat {entry.toSeatLabel}
                            {' (was Block '}{entry.fromBlockNumber}, Seat {entry.fromSeatLabel}{')'}
                          </>
                        )}
                      </div>
                      {entry.reason && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Reason: {entry.reason}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(entry.rebookedAt), 'MMM d, yyyy h:mm a')} by {entry.rebookedBy}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Bulk Actions */}
      {selectedAssignments.size > 0 && (
        <Card className="border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950">
          <CardContent className="py-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Users className="h-5 w-5 text-blue-600" />
              <span className="font-medium">{selectedAssignments.size} contestants selected</span>
              {selectedNotSentWithEmail.length > 0 && (
                <Badge variant="outline" className="border-gray-500 text-gray-700 dark:text-gray-300">
                  <Mail className="h-3 w-3 mr-1" />
                  {selectedNotSentWithEmail.length} ready to send
                </Badge>
              )}
              {selectedNotSentWithoutEmail.length > 0 && (
                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                  <XCircle className="h-3 w-3 mr-1" />
                  {selectedNotSentWithoutEmail.length} without email
                </Badge>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => setSendEmailDialogOpen(true)}
                disabled={selectedNotSentWithEmail.length === 0}
                data-testid="button-send-booking-email"
              >
                <Send className="h-4 w-4 mr-2" />
                Send Booking Email ({selectedNotSentWithEmail.length})
              </Button>
              <Button
                variant="secondary"
                onClick={handleBulkConfirm}
                disabled={bulkConfirmMutation.isPending || selectedPendingConfirmation.length === 0}
                data-testid="button-bulk-confirm"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Confirm Selected ({selectedPendingConfirmation.length})
              </Button>
              <Button
                variant="outline"
                onClick={() => setSelectedAssignments(new Set())}
                data-testid="button-clear-selection"
              >
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Assigned Contestants ({filteredData.length})
          </CardTitle>
          <CardDescription>
            All contestants assigned to record days with booking status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTracker ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No assigned contestants found</p>
              <p className="text-sm">Assign contestants from the Seating Chart</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-blue-100 dark:bg-blue-900/20">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedAssignments.size === filteredData.length && filteredData.length > 0}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead className="font-semibold">Name</TableHead>
                  <TableHead className="font-semibold">Record Day</TableHead>
                  <TableHead className="font-semibold">Seat</TableHead>
                  <TableHead className="font-semibold">Email</TableHead>
                  <TableHead className="font-semibold text-center">Email Sent</TableHead>
                  <TableHead className="font-semibold text-center">Status</TableHead>
                  <TableHead className="font-semibold text-center">Ticket</TableHead>
                  <TableHead className="font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((item) => {
                  const isSelected = selectedAssignments.has(item.id);
                  const isConfirmed = !!item.confirmedRsvp;
                  
                  return (
                    <TableRow 
                      key={item.id}
                      className={isSelected ? "bg-blue-50 dark:bg-blue-900/10" : ""}
                      data-testid={`row-assignment-${item.id}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectItem(item.id, checked)}
                          data-testid={`checkbox-${item.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {item.contestant?.photoUrl && (
                              <AvatarImage src={item.contestant.photoUrl} alt={item.contestant?.name || ''} />
                            )}
                            <AvatarFallback className="text-xs">
                              {(item.contestant?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{item.contestant?.name || 'Unknown'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span>
                            {item.recordDay?.date 
                              ? format(new Date(item.recordDay.date), "MMM d, yyyy") 
                              : "Unknown"}
                          </span>
                          {item.recordDay?.rxNumber && (
                            <Badge variant="outline" className="ml-1 text-xs">
                              {item.recordDay.rxNumber}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          Block {item.blockNumber} - {item.seatLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {item.contestant?.email || "No email"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {item.bookingEmailSent ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                              <MailCheck className="h-4 w-4" />
                              <span className="text-xs">
                                {format(new Date(item.bookingEmailSent), "MMM d")}
                              </span>
                            </div>
                            {item.contestant?.email && !isDeclined(item) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs"
                                onClick={() => handleResendClick(item)}
                                disabled={resendBookingEmailMutation.isPending}
                                data-testid={`button-resend-${item.id}`}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Resend
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(item)}
                      </TableCell>
                      <TableCell className="text-center">
                        {isConfirmed ? (
                          item.ticketEmailSent ? (
                            <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                              <Ticket className="h-4 w-4" />
                              <span className="text-xs">
                                {format(new Date(item.ticketEmailSent), "MMM d")}
                              </span>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => sendTicketMutation.mutate(item.id)}
                              disabled={sendTicketMutation.isPending || !item.contestant?.email}
                              data-testid={`button-send-ticket-${item.id}`}
                            >
                              <Ticket className="h-3 w-3 mr-1" />
                              Send Ticket
                            </Button>
                          )
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isDeclined(item) ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-red-600 dark:text-red-400">Declined</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => undoDeclineMutation.mutate(item.id)}
                              disabled={undoDeclineMutation.isPending}
                              data-testid={`button-undo-decline-${item.id}`}
                            >
                              <Undo2 className="h-3 w-3 mr-1" />
                              Undo
                            </Button>
                          </div>
                        ) : isConfirmed ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-green-600 dark:text-green-400">Confirmed</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => undoConfirmMutation.mutate(item.id)}
                              disabled={undoConfirmMutation.isPending}
                              data-testid={`button-undo-confirm-${item.id}`}
                            >
                              <Undo2 className="h-3 w-3 mr-1" />
                              Undo
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleConfirm(item)}
                              disabled={confirmMutation.isPending}
                              data-testid={`button-confirm-${item.id}`}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeclineClick(item)}
                              data-testid={`button-decline-${item.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Decline
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Send Booking Email Dialog */}
      <Dialog open={sendEmailDialogOpen} onOpenChange={setSendEmailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-600" />
              Send Booking Confirmation Emails
            </DialogTitle>
            <DialogDescription>
              Send booking confirmation emails to {selectedNotSentWithEmail.length} contestant(s)
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {selectedNotSentWithoutEmail.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                <h4 className="font-medium text-sm mb-2 text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {selectedNotSentWithoutEmail.length} contestant(s) will be skipped (no email)
                </h4>
                <div className="max-h-20 overflow-y-auto text-sm space-y-1 text-amber-700 dark:text-amber-300">
                  {selectedNotSentWithoutEmail.map(item => (
                    <div key={item.id}>{item.contestant?.name || "Unknown"}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted p-3 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Recipients ({selectedNotSentWithEmail.length})</h4>
              {selectedNotSentWithEmail.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contestants with email addresses selected</p>
              ) : (
                <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                  {selectedNotSentWithEmail.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.contestant?.name}</span>
                      <span className="text-muted-foreground">{item.contestant?.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Emails will be sent using the booking email template configured in Settings.
              Each recipient will receive a unique confirmation link.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSendBookingEmails}
              disabled={bulkSendBookingEmailMutation.isPending || selectedNotSentWithEmail.length === 0}
              data-testid="button-confirm-send-email"
            >
              {bulkSendBookingEmailMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send to {selectedNotSentWithEmail.length} Contestant(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Dialog */}
      <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Booking</DialogTitle>
            <DialogDescription>
              {declineAssignment && (
                <>
                  <strong>{declineAssignment.contestant?.name}</strong> cannot attend on this date.
                  Choose what to do next.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <RadioGroup 
              value={declineAction} 
              onValueChange={(v) => setDeclineAction(v as "reschedule" | "rebook")}
              className="space-y-3"
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="rebook" id="action-rebook" data-testid="radio-rebook" />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="action-rebook" className="font-medium cursor-pointer">
                    Rebook to another day
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Move contestant to a different record day
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="reschedule" id="action-reschedule" data-testid="radio-reschedule" />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="action-reschedule" className="font-medium cursor-pointer">
                    Move to Reschedule list
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Remove from seating and add to reschedule tab for later
                  </p>
                </div>
              </div>
            </RadioGroup>

            {/* Rebook: Show record day, block, and seat selectors */}
            {declineAction === "rebook" && (
              <div className="space-y-4 pt-2 border-t">
                <div className="space-y-2">
                  <Label htmlFor="rebook-day">Select new record day</Label>
                  <Select
                    value={rebookRecordDayId}
                    onValueChange={(val) => {
                      setRebookRecordDayId(val);
                      setRebookBlock("");
                      setRebookSeat("");
                    }}
                  >
                    <SelectTrigger data-testid="select-rebook-record-day">
                      <SelectValue placeholder="Select record day..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedRecordDays
                        .filter(rd => rd.id !== declineAssignment?.recordDayId)
                        .map((rd) => (
                          <SelectItem key={rd.id} value={rd.id}>
                            {rd.rxNumber ? `${rd.rxNumber} - ` : ""}{format(new Date(rd.date), "EEE, MMM d, yyyy")}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Block and Seat Selection */}
                {rebookRecordDayId && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Block</Label>
                      <Select 
                        value={rebookBlock} 
                        onValueChange={(val) => { 
                          setRebookBlock(val); 
                          setRebookSeat(""); 
                        }}
                      >
                        <SelectTrigger data-testid="select-rebook-block">
                          <SelectValue placeholder="Select block" />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6, 7].map((block) => (
                            <SelectItem key={block} value={String(block)}>
                              Block {block}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Seat</Label>
                      <Select 
                        value={rebookSeat} 
                        onValueChange={setRebookSeat}
                        disabled={!rebookBlock}
                      >
                        <SelectTrigger data-testid="select-rebook-seat">
                          <SelectValue placeholder={rebookBlock ? "Select seat" : "Select block first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {rebookAvailableSeats.length === 0 ? (
                            <SelectItem value="none" disabled>No available seats</SelectItem>
                          ) : (
                            rebookAvailableSeats.map((seat) => (
                              <SelectItem key={seat} value={seat}>
                                {seat}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                
                {/* Optional reason for rebooking */}
                <div className="space-y-2 mt-4">
                  <Label htmlFor="rebook-reason">Reason for rebooking (optional)</Label>
                  <Textarea
                    id="rebook-reason"
                    placeholder="e.g., Contestant requested date change, scheduling conflict, etc."
                    value={rebookReason}
                    onChange={(e) => setRebookReason(e.target.value)}
                    data-testid="input-rebook-reason"
                  />
                </div>
              </div>
            )}

            {/* Reschedule: Show reason textarea */}
            {declineAction === "reschedule" && (
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="decline-reason">Reason for decline</Label>
                <Textarea
                  id="decline-reason"
                  placeholder="e.g., No longer available, scheduling conflict, etc."
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  data-testid="input-decline-reason"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineDialogOpen(false)}>
              Cancel
            </Button>
            {declineAction === "rebook" ? (
              <Button
                onClick={handleDeclineSubmit}
                disabled={!rebookRecordDayId || !rebookBlock || !rebookSeat || rebookMutation.isPending}
                data-testid="button-submit-rebook"
              >
                {rebookMutation.isPending ? "Moving..." : "Rebook to New Day"}
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleDeclineSubmit}
                disabled={declineMutation.isPending}
                data-testid="button-submit-decline"
              >
                {declineMutation.isPending ? "Processing..." : "Move to Reschedule"}
              </Button>
            )}
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
                  Move <strong>{changeDateAssignment.contestant?.name}</strong> to a different record day.
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
                  {sortedRecordDays
                    .filter(rd => rd.id !== changeDateAssignment?.recordDayId)
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

      {/* Resend Booking Email Confirmation Dialog */}
      <Dialog open={resendDialogOpen} onOpenChange={setResendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-blue-600" />
              Resend Booking Email
            </DialogTitle>
            <DialogDescription>
              {resendAssignment && (
                <>
                  Are you sure you want to resend the booking confirmation email to{" "}
                  <strong>{resendAssignment.contestant?.name}</strong>?
                  <br /><br />
                  This will generate a new confirmation link and send it to{" "}
                  <strong>{resendAssignment.contestant?.email}</strong>.
                  The previous confirmation link will be revoked.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setResendDialogOpen(false);
                setResendAssignment(null);
              }}
              data-testid="button-cancel-resend"
            >
              Cancel
            </Button>
            <Button
              onClick={handleResendConfirm}
              disabled={resendBookingEmailMutation.isPending}
              data-testid="button-confirm-resend"
            >
              {resendBookingEmailMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Resend Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
