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
  Ticket,
  History,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet
} from "lucide-react";
import type { RecordDay, Contestant, SeatAssignment, RebookingHistory, StandbyAssignment, CanceledAssignment } from "@shared/schema";

interface BookingAssignment extends SeatAssignment {
  contestant: Contestant | null;
  recordDay: RecordDay | null;
}

interface StandbyWithContestant extends StandbyAssignment {
  contestant: Contestant;
  recordDay?: RecordDay;
}

interface RebookingHistoryEntry extends RebookingHistory {
  contestant?: Contestant;
  fromRecordDay: RecordDay;
  toRecordDay: RecordDay;
}

interface CanceledAssignmentWithDetails extends CanceledAssignment {
  contestant: Contestant;
  recordDay: RecordDay;
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

type StatusFilter = "all" | "not_sent" | "awaiting" | "confirmed" | "declined" | "failed_send";
type EmailTypeFilter = "all" | "bigpond_only" | "exclude_bigpond";
type ViewMode = "seats" | "standbys";

const BOOKING_TRACKER_STORAGE_KEY = 'booking-tracker-state';

interface BookingTrackerState {
  selectedRecordDay: string;
  selectedBlock: string;
  statusFilter: StatusFilter;
  emailTypeFilter: EmailTypeFilter;
  viewMode: ViewMode;
}

export default function BookingResponses() {
  const { toast } = useToast();
  
  // Initialize state from localStorage
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(BOOKING_TRACKER_STORAGE_KEY);
      if (saved) {
        const state: BookingTrackerState = JSON.parse(saved);
        return state.selectedRecordDay || "";
      }
    } catch {}
    return "";
  });
  
  const [selectedBlock, setSelectedBlock] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(BOOKING_TRACKER_STORAGE_KEY);
      if (saved) {
        const state: BookingTrackerState = JSON.parse(saved);
        return state.selectedBlock || "all";
      }
    } catch {}
    return "all";
  });
  
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    try {
      const saved = localStorage.getItem(BOOKING_TRACKER_STORAGE_KEY);
      if (saved) {
        const state: BookingTrackerState = JSON.parse(saved);
        return state.statusFilter || "all";
      }
    } catch {}
    return "all";
  });
  
  const [emailTypeFilter, setEmailTypeFilter] = useState<EmailTypeFilter>(() => {
    try {
      const saved = localStorage.getItem(BOOKING_TRACKER_STORAGE_KEY);
      if (saved) {
        const state: BookingTrackerState = JSON.parse(saved);
        return state.emailTypeFilter || "all";
      }
    } catch {}
    return "all";
  });
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(BOOKING_TRACKER_STORAGE_KEY);
      if (saved) {
        const state: BookingTrackerState = JSON.parse(saved);
        return state.viewMode || "seats";
      }
    } catch {}
    return "seats";
  });
  
  const [searchName, setSearchName] = useState("");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  const [selectedStandbys, setSelectedStandbys] = useState<Set<string>>(new Set());
  const [isExportingStandbys, setIsExportingStandbys] = useState(false);
  
  // Save state to localStorage when filters change
  useEffect(() => {
    try {
      const state: BookingTrackerState = {
        selectedRecordDay,
        selectedBlock,
        statusFilter,
        emailTypeFilter,
        viewMode,
      };
      localStorage.setItem(BOOKING_TRACKER_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save booking tracker state:", e);
    }
  }, [selectedRecordDay, selectedBlock, statusFilter, emailTypeFilter, viewMode]);
  
  // Send email dialog state
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  
  // Send ticket email dialog state
  const [sendTicketDialogOpen, setSendTicketDialogOpen] = useState(false);
  
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
  
  const handleEmailTypeFilterChange = (value: EmailTypeFilter) => {
    setEmailTypeFilter(value);
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
  const [declineAction, setDeclineAction] = useState<"reschedule" | "return_pool" | "attendance_issue">("reschedule");
  const [declineMovedBy, setDeclineMovedBy] = useState("");
  const [rebookRecordDayId, setRebookRecordDayId] = useState<string>("");
  const [rebookBlock, setRebookBlock] = useState<string>("");
  const [rebookSeat, setRebookSeat] = useState<string>("");
  const [rebookReason, setRebookReason] = useState<string>("");
  
  const [changeDateDialogOpen, setChangeDateDialogOpen] = useState(false);
  const [changeDateAssignment, setChangeDateAssignment] = useState<BookingAssignment | null>(null);
  const [newRecordDayId, setNewRecordDayId] = useState<string>("");
  
  // Resend booking email dialog state
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [resendAssignment, setResendAssignment] = useState<BookingAssignment | null>(null);
  
  // Resend ticket email dialog state
  const [resendTicketDialogOpen, setResendTicketDialogOpen] = useState(false);
  const [resendTicketAssignment, setResendTicketAssignment] = useState<BookingAssignment | null>(null);
  
  // Rebooking history section state
  const [historyExpanded, setHistoryExpanded] = useState(false);
  
  // Cancel confirmation dialog state
  const [cancelConfirmDialogOpen, setCancelConfirmDialogOpen] = useState(false);
  const [cancelConfirmAssignment, setCancelConfirmAssignment] = useState<BookingAssignment | null>(null);
  const [cancelConfirmType, setCancelConfirmType] = useState<"confirm" | "decline">("confirm");
  
  // No email warning dialog state (for confirm/decline without email sent)
  const [noEmailWarningOpen, setNoEmailWarningOpen] = useState(false);
  const [noEmailWarningAssignment, setNoEmailWarningAssignment] = useState<BookingAssignment | null>(null);
  const [noEmailWarningAction, setNoEmailWarningAction] = useState<"confirm" | "decline">("confirm");

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  // Sort record days by date
  const sortedRecordDays = [...recordDays].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Note: No auto-selection - "All Record Days" is the default when no selection is stored

  // Build query URL with filters - computed inside queryFn to avoid stale closure issues
  const buildTrackerUrl = (recordDay: string, status: StatusFilter) => {
    const params = new URLSearchParams();
    if (recordDay) {
      params.append("recordDayId", recordDay);
    }
    if (status !== "all") {
      params.append("status", status);
    }
    const queryString = params.toString();
    return queryString ? `/api/booking-tracker?${queryString}` : "/api/booking-tracker";
  };
    
  const { data: trackerResponse, isLoading: loadingTracker, refetch: refetchTracker, error: trackerError } = useQuery<BookingTrackerResponse>({
    queryKey: ["/api/booking-tracker", selectedRecordDay, statusFilter],
    retry: 1,
    queryFn: async ({ queryKey }) => {
      // Use query key values to build URL, ensuring fresh values
      const [, recordDay, status] = queryKey as [string, string, StatusFilter];
      const url = buildTrackerUrl(recordDay === "all" ? "" : (recordDay || ""), status || "all");
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch booking tracker data');
      }
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

  // Query for standbys when in standby view mode
  const { data: standbyData = [], isLoading: loadingStandbys } = useQuery<StandbyWithContestant[]>({
    queryKey: ["/api/standbys/record-day", selectedRecordDay],
    queryFn: async () => {
      if (!selectedRecordDay) {
        const response = await fetch("/api/standbys", { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch standbys');
        return response.json();
      }
      const response = await fetch(`/api/standbys/record-day/${selectedRecordDay}?all=true`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch standbys');
      return response.json();
    },
    enabled: viewMode === "standbys",
  });

  // Query for canceled assignments (declined contestants now on reschedule list)
  // Always fetch so declined count includes fixed legacy records with wasDeclined flag
  const { data: canceledAssignments = [] } = useQuery<CanceledAssignmentWithDetails[]>({
    queryKey: ["/api/canceled-assignments"],
    queryFn: async () => {
      const response = await fetch("/api/canceled-assignments", { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch canceled assignments');
      return response.json();
    },
  });

  // Filter canceled assignments by record day, search, and other filters
  const filteredCanceledAssignments = canceledAssignments.filter(ca => {
    // Only show declined contestants
    if (!ca.wasDeclined) return false;
    // Filter by record day if selected
    if (selectedRecordDay && ca.recordDayId !== selectedRecordDay) return false;
    // Filter by search name
    if (searchName) {
      const searchLower = searchName.toLowerCase();
      const nameMatch = ca.contestant?.name?.toLowerCase().includes(searchLower);
      const attendingWithMatch = ca.contestant?.attendingWith?.toLowerCase().includes(searchLower);
      const emailMatch = ca.contestant?.email?.toLowerCase().includes(searchLower);
      if (!nameMatch && !attendingWithMatch && !emailMatch) return false;
    }
    return true;
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
          key.startsWith('/api/rebooking-history') ||
          key.startsWith('/api/canceled-assignments')
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

  // Mutation for resending ticket email (with force flag to bypass already-sent check)
  const resendTicketMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("POST", `/api/seat-assignments/${assignmentId}/send-ticket`, { resend: true });
    },
    onSuccess: () => {
      toast({ title: "Ticket resent", description: "Ticket email with PDF has been resent to the contestant" });
      setResendTicketDialogOpen(false);
      setResendTicketAssignment(null);
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to resend ticket", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for declining a booking (moves to reschedule)
  const declineMutation = useMutation({
    mutationFn: async ({ assignmentId, reason, movedBy, moveToAttendanceIssues }: { assignmentId: string; reason: string; movedBy?: string; moveToAttendanceIssues?: boolean }) => {
      const res = await apiRequest("POST", `/api/seat-assignments/${assignmentId}/decline`, {
        reason,
        movedBy,
        moveToAttendanceIssues
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      if (data.attendanceIssue) {
        toast({ title: "Booking declined", description: "Contestant moved to attendance issues" });
      } else {
        toast({ title: "Booking declined", description: "Contestant moved to reschedule list" });
      }
      setDeclineDialogOpen(false);
      setDeclineAssignment(null);
      setDeclineReason("");
      setDeclineMovedBy("");
      setDeclineAction("reschedule");
      invalidateBookingQueries();
      queryClient.invalidateQueries({ queryKey: ["/api/canceled-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attendance-issues"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to decline booking", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Mutation for returning to pool (deleting assignment)
  const returnToPoolMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return apiRequest("DELETE", `/api/seat-assignments/${assignmentId}`);
    },
    onSuccess: () => {
      toast({ title: "Returned to pool", description: "Assignment removed and contestant is available again" });
      setDeclineDialogOpen(false);
      setDeclineAssignment(null);
      setDeclineReason("");
      setDeclineMovedBy("");
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to return to pool", 
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

  // Export to Excel state
  const [isExporting, setIsExporting] = useState(false);
  
  // Export filtered data to Excel
  const handleExportExcel = async () => {
    if (filteredData.length === 0) {
      toast({
        title: "No data to export",
        description: "Apply filters to select data to export",
        variant: "destructive"
      });
      return;
    }
    
    setIsExporting(true);
    try {
      const response = await fetch('/api/booking-tracker/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ assignmentIds: filteredData.map(item => item.id) }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }
      
      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `booking-tracker-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Export successful",
        description: `Exported ${filteredData.length} records to Excel`
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message || "Could not export data",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Export selected standbys to Excel
  const handleExportStandbys = async () => {
    if (selectedStandbys.size === 0) {
      toast({
        title: "No standbys selected",
        description: "Select standbys to export",
        variant: "destructive"
      });
      return;
    }
    
    setIsExportingStandbys(true);
    try {
      const response = await fetch('/api/standbys/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ standbyIds: Array.from(selectedStandbys) }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }
      
      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `standbys-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Export successful",
        description: `Exported ${selectedStandbys.size} standbys to Excel`
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error.message || "Could not export data",
        variant: "destructive"
      });
    } finally {
      setIsExportingStandbys(false);
    }
  };

  // Bulk send booking email mutation
  const bulkSendBookingEmailMutation = useMutation({
    mutationFn: async (assignmentIds: string[]) => {
      try {
        const response = await apiRequest("POST", "/api/booking-confirmations/send", {
          seatAssignmentIds: assignmentIds,
        });
        // apiRequest returns a Response object, need to parse JSON
        if (!response.ok) {
          // Check for 504 Gateway Timeout - emails are still being sent in background
          if (response.status === 504) {
            return { backgroundSending: true, count: assignmentIds.length };
          }
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to send emails");
        }
        return response.json();
      } catch (error: any) {
        // Network errors or timeouts may still result in emails being sent
        if (error.message?.includes('504') || error.message?.includes('timeout') || error.message?.includes('Gateway')) {
          return { backgroundSending: true, count: assignmentIds.length };
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      // Handle background sending case (504 timeout but emails still processing)
      if (data.backgroundSending) {
        toast({ 
          title: "Emails are being sent",
          description: `${data.count} email(s) are being sent in the background. This may take a few minutes.`
        });
        setSelectedAssignments(new Set());
        setSendEmailDialogOpen(false);
        // Delay invalidation to give time for emails to be sent
        setTimeout(() => invalidateBookingQueries(), 5000);
        return;
      }
      
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
      // Check if error message suggests a timeout (emails may still be sending)
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('504') || errorMsg.includes('timeout') || errorMsg.includes('gateway')) {
        toast({ 
          title: "Emails are being sent",
          description: "The request timed out but emails are being sent in the background. This may take a few minutes."
        });
        setSelectedAssignments(new Set());
        setSendEmailDialogOpen(false);
        setTimeout(() => invalidateBookingQueries(), 5000);
        return;
      }
      
      toast({ 
        title: "Failed to send emails", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Bulk send ticket email mutation
  const bulkSendTicketEmailMutation = useMutation({
    mutationFn: async (assignmentIds: string[]) => {
      try {
        const response = await apiRequest("POST", "/api/seat-assignments/bulk-send-ticket", {
          seatAssignmentIds: assignmentIds,
        });
        if (!response.ok) {
          // Check for 504 Gateway Timeout - emails are still being sent in background
          if (response.status === 504) {
            return { backgroundSending: true, count: assignmentIds.length };
          }
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to send ticket emails");
        }
        return response.json();
      } catch (error: any) {
        // Network errors or timeouts may still result in emails being sent
        if (error.message?.includes('504') || error.message?.includes('timeout') || error.message?.includes('Gateway')) {
          return { backgroundSending: true, count: assignmentIds.length };
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      // Handle background sending case (504 timeout but emails still processing)
      if (data.backgroundSending) {
        toast({ 
          title: "Ticket emails are being sent",
          description: `${data.count} ticket email(s) are being sent in the background. This may take a few minutes.`
        });
        setSelectedAssignments(new Set());
        setSendTicketDialogOpen(false);
        setTimeout(() => invalidateBookingQueries(), 5000);
        return;
      }
      
      const successCount = data.successCount || 0;
      const failCount = data.failCount || 0;
      
      if (failCount > 0) {
        toast({ 
          title: `Ticket emails sent: ${successCount} success, ${failCount} failed`,
          description: "Some emails could not be sent",
          variant: "destructive"
        });
      } else {
        toast({ title: `Ticket emails sent to ${successCount} contestant(s)` });
      }
      setSelectedAssignments(new Set());
      setSendTicketDialogOpen(false);
      invalidateBookingQueries();
    },
    onError: (error: any) => {
      // Check if error message suggests a timeout (emails may still be sending)
      const errorMsg = error.message?.toLowerCase() || '';
      if (errorMsg.includes('504') || errorMsg.includes('timeout') || errorMsg.includes('gateway')) {
        toast({ 
          title: "Ticket emails are being sent",
          description: "The request timed out but ticket emails are being sent in the background. This may take a few minutes."
        });
        setSelectedAssignments(new Set());
        setSendTicketDialogOpen(false);
        setTimeout(() => invalidateBookingQueries(), 5000);
        return;
      }
      
      toast({ 
        title: "Failed to send ticket emails", 
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
  // Note: stats.declined already includes both active declined assignments AND canceled assignments with wasDeclined
  const totalCount = stats.total;
  const notSentCount = stats.notSent;
  const awaitingCount = stats.awaiting;
  const confirmedCount = stats.confirmed;
  // stats.declined already includes canceled assignments - no need to add them again
  const declinedCount = stats.declined;
  
  // Helper to check if assignment is declined
  const isDeclined = (a: BookingAssignment) => a.notes?.startsWith('[DECLINED]');
  
  // Helper to check if email is a Bigpond address
  const isBigpondEmail = (email: string | undefined | null) => {
    if (!email) return false;
    const lower = email.toLowerCase();
    return lower.includes('bigpond');
  };

  // Filter by block, email type, failed sends, and search
  const filteredData = trackerData.filter((item) => {
    // Filter by block
    if (selectedBlock !== "all" && item.blockNumber !== parseInt(selectedBlock)) {
      return false;
    }
    
    // Filter by email type (Bigpond)
    if (emailTypeFilter === "bigpond_only") {
      if (!isBigpondEmail(item.contestant?.email)) return false;
    } else if (emailTypeFilter === "exclude_bigpond") {
      if (isBigpondEmail(item.contestant?.email)) return false;
    }
    
    // Filter by failed send status
    if (statusFilter === "failed_send") {
      if (!item.bookingEmailError) return false;
    }
    
    // Filter by search (name, attending with, AND email)
    if (!searchName) return true;
    const search = searchName.toLowerCase();
    return (
      item.contestant?.name?.toLowerCase().includes(search) ||
      item.contestant?.attendingWith?.toLowerCase().includes(search) ||
      item.contestant?.email?.toLowerCase().includes(search)
    );
  });
  
  // Count failed sends for stats
  const failedSendCount = trackerData.filter(a => a.bookingEmailError).length;

  // Selection helpers
  const selectedItems = filteredData.filter(item => selectedAssignments.has(item.id));
  const selectedPendingConfirmation = selectedItems.filter(item => 
    !item.confirmedRsvp && !isDeclined(item) && item.bookingEmailSent
  );
  // For sending emails: those not yet sent, have email, and not declined
  const selectedNotSentWithEmail = selectedItems.filter(item => 
    !item.bookingEmailSent && item.contestant?.email && !isDeclined(item)
  );
  const selectedNotSentWithoutEmail = selectedItems.filter(item => 
    !item.bookingEmailSent && !item.contestant?.email && !isDeclined(item)
  );
  
  // For ticket emails: confirmed but ticket not yet sent, with email
  const selectedConfirmedWithoutTicket = selectedItems.filter(item => 
    item.confirmedRsvp && !item.ticketEmailSent && item.contestant?.email && !isDeclined(item)
  );
  const selectedConfirmedWithoutTicketNoEmail = selectedItems.filter(item => 
    item.confirmedRsvp && !item.ticketEmailSent && !item.contestant?.email && !isDeclined(item)
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
    // If no booking email was sent, show warning dialog first
    if (!assignment.bookingEmailSent) {
      setNoEmailWarningAssignment(assignment);
      setNoEmailWarningAction("confirm");
      setNoEmailWarningOpen(true);
      return;
    }
    confirmMutation.mutate(assignment.id);
  };
  
  const handleConfirmWithoutEmail = () => {
    if (noEmailWarningAssignment) {
      if (noEmailWarningAction === "confirm") {
        confirmMutation.mutate(noEmailWarningAssignment.id);
      } else {
        // Open decline dialog
        setDeclineAssignment(noEmailWarningAssignment);
        setDeclineReason("");
        setDeclineAction("reschedule");
        setDeclineMovedBy("");
        setRebookRecordDayId("");
        setRebookBlock("");
        setRebookSeat("");
        setRebookReason("");
        setDeclineDialogOpen(true);
      }
    }
    setNoEmailWarningOpen(false);
    setNoEmailWarningAssignment(null);
  };

  const handleDeclineClick = (assignment: BookingAssignment) => {
    // If no booking email was sent, show warning dialog first
    if (!assignment.bookingEmailSent) {
      setNoEmailWarningAssignment(assignment);
      setNoEmailWarningAction("decline");
      setNoEmailWarningOpen(true);
      return;
    }
    setDeclineAssignment(assignment);
    setDeclineReason("");
    setDeclineAction("reschedule");
    setDeclineMovedBy("");
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
      setDeclineMovedBy("");
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
    
    if (declineAction === "return_pool") {
      returnToPoolMutation.mutate(declineAssignment.id);
    } else {
      // Use the decline mutation for reschedule
      if (!declineMovedBy.trim()) {
        toast({ title: "Please enter your initials", variant: "destructive" });
        return;
      }
      declineMutation.mutate({
        assignmentId: declineAssignment.id,
        reason: declineReason,
        movedBy: declineMovedBy,
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

  const handleSendTicketEmails = () => {
    const ids = selectedConfirmedWithoutTicket.map(item => item.id);
    if (ids.length === 0) {
      toast({ 
        title: "No valid recipients", 
        description: "Select confirmed contestants who haven't been sent a ticket email and have an email address", 
        variant: "destructive" 
      });
      return;
    }
    bulkSendTicketEmailMutation.mutate(ids);
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

  // Resend ticket email handlers
  const handleResendTicketClick = (assignment: BookingAssignment) => {
    setResendTicketAssignment(assignment);
    setResendTicketDialogOpen(true);
  };

  const handleResendTicketConfirm = () => {
    if (!resendTicketAssignment) return;
    resendTicketMutation.mutate(resendTicketAssignment.id);
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
            Booking Tracker
          </h1>
          <p className="text-muted-foreground mt-1">
            Track and manage contestant booking confirmations
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={handleExportExcel}
            disabled={isExporting || filteredData.length === 0 || viewMode === 'standbys'}
            data-testid="button-export-excel"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export Excel ({filteredData.length})
          </Button>
          <Button 
            variant="outline" 
            onClick={() => refetchTracker()}
            data-testid="button-refresh-tracker"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Label htmlFor="view-mode-filter">View:</Label>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="w-[140px]" data-testid="select-view-mode">
              <SelectValue placeholder="Seats" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seats">Seat Bookings</SelectItem>
              <SelectItem value="standbys">Standbys</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="record-day-filter">Record Day:</Label>
          <Select value={selectedRecordDay || "all"} onValueChange={(v) => handleRecordDayChange(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[280px]" data-testid="select-record-day">
              <SelectValue placeholder="Select Record Day" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Record Days</SelectItem>
              {sortedRecordDays.map((rd) => (
                <SelectItem key={rd.id} value={rd.id}>
                  {format(new Date(rd.date), "EEE, d MMM yyyy")} {rd.rxNumber ? `- ${rd.rxNumber}` : ""}
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
              <SelectItem value="failed_send">
                <span className="flex items-center gap-1 text-red-600">
                  Failed Sends {failedSendCount > 0 && `(${failedSendCount})`}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="email-type-filter">Email:</Label>
          <Select value={emailTypeFilter} onValueChange={(v) => handleEmailTypeFilterChange(v as EmailTypeFilter)}>
            <SelectTrigger className="w-[160px]" data-testid="select-email-type-filter">
              <SelectValue placeholder="All Emails" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Emails</SelectItem>
              <SelectItem value="bigpond_only">Bigpond Only</SelectItem>
              <SelectItem value="exclude_bigpond">Exclude Bigpond</SelectItem>
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

      {viewMode === "standbys" ? (
        /* Standbys View */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-amber-600" />
                  Standbys ({standbyData.filter(s => {
                    if (searchName && !s.contestant?.name?.toLowerCase().includes(searchName.toLowerCase())) return false;
                    if (statusFilter === "confirmed" && !s.confirmedAt) return false;
                    if (statusFilter === "awaiting" && s.confirmedAt) return false;
                    return true;
                  }).length})
                </CardTitle>
                <CardDescription>
                  Backup contestants for the selected record day
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {selectedStandbys.size > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {selectedStandbys.size} selected
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportStandbys}
                  disabled={isExportingStandbys || selectedStandbys.size === 0}
                  data-testid="button-export-standbys"
                >
                  {isExportingStandbys ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                  )}
                  Export to Excel
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingStandbys ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : standbyData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No standbys found</p>
                <p className="text-sm">Add standbys from the Seating Chart page</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-amber-100 dark:bg-amber-900/20">
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={
                          standbyData.filter(s => {
                            if (searchName && !s.contestant?.name?.toLowerCase().includes(searchName.toLowerCase())) return false;
                            if (statusFilter === "confirmed" && !s.confirmedAt) return false;
                            if (statusFilter === "awaiting" && s.confirmedAt) return false;
                            return true;
                          }).length > 0 &&
                          standbyData.filter(s => {
                            if (searchName && !s.contestant?.name?.toLowerCase().includes(searchName.toLowerCase())) return false;
                            if (statusFilter === "confirmed" && !s.confirmedAt) return false;
                            if (statusFilter === "awaiting" && s.confirmedAt) return false;
                            return true;
                          }).every(s => selectedStandbys.has(s.id))
                        }
                        onCheckedChange={(checked) => {
                          const filteredStandbys = standbyData.filter(s => {
                            if (searchName && !s.contestant?.name?.toLowerCase().includes(searchName.toLowerCase())) return false;
                            if (statusFilter === "confirmed" && !s.confirmedAt) return false;
                            if (statusFilter === "awaiting" && s.confirmedAt) return false;
                            return true;
                          });
                          if (checked) {
                            setSelectedStandbys(new Set(filteredStandbys.map(s => s.id)));
                          } else {
                            setSelectedStandbys(new Set());
                          }
                        }}
                        data-testid="checkbox-select-all-standbys"
                      />
                    </TableHead>
                    <TableHead className="font-semibold">Priority</TableHead>
                    <TableHead className="font-semibold">Name</TableHead>
                    <TableHead className="font-semibold">Record Day</TableHead>
                    <TableHead className="font-semibold min-w-[200px]">Email</TableHead>
                    <TableHead className="font-semibold">Phone</TableHead>
                    <TableHead className="font-semibold text-center">Standby Status</TableHead>
                    <TableHead className="font-semibold text-center">Email Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standbyData
                    .filter(s => {
                      // Filter by name
                      if (searchName && !s.contestant?.name?.toLowerCase().includes(searchName.toLowerCase())) {
                        return false;
                      }
                      // Filter by status
                      if (statusFilter === "confirmed" && !s.confirmedAt) {
                        return false;
                      }
                      if (statusFilter === "awaiting" && s.confirmedAt) {
                        return false;
                      }
                      // For "all", "declined", "failed_send" etc, show all standbys
                      return true;
                    })
                    .sort((a, b) => (a.priority || 999) - (b.priority || 999))
                    .map((standby) => (
                      <TableRow 
                        key={standby.id}
                        className={`${standby.confirmedAt ? 'bg-green-50 dark:bg-green-900/20' : ''} ${selectedStandbys.has(standby.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        data-testid={`row-standby-${standby.id}`}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedStandbys.has(standby.id)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedStandbys);
                              if (checked) {
                                newSelected.add(standby.id);
                              } else {
                                newSelected.delete(standby.id);
                              }
                              setSelectedStandbys(newSelected);
                            }}
                            data-testid={`checkbox-standby-${standby.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                            #{standby.priority || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {standby.contestant?.name || "Unknown"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {standby.recordDay ? format(new Date(standby.recordDay.date), "d MMM yyyy") : 
                              (selectedRecordDay ? 
                                sortedRecordDays.find(rd => rd.id === selectedRecordDay)?.date ? 
                                  format(new Date(sortedRecordDays.find(rd => rd.id === selectedRecordDay)!.date), "d MMM yyyy") : "N/A"
                                : "N/A")}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {standby.contestant?.email || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {standby.contestant?.phone || "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          {standby.confirmedAt ? (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Confirmed
                            </Badge>
                          ) : standby.status === 'pending' ? (
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              <Clock className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              {standby.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {standby.standbyEmailSent ? (
                            <div className="flex flex-col items-center">
                              <CheckCircle className="h-4 w-4 text-green-600" />
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(standby.standbyEmailSent), "d MMM")}
                              </span>
                            </div>
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
      <>
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
                            From: {entry.fromRecordDay?.rxNumber || format(new Date(entry.fromRecordDay?.date), 'd MMM')} 
                            {' '}Block {entry.fromBlockNumber}, Seat {entry.fromSeatLabel}
                            {' → '}Block {entry.toBlockNumber}, Seat {entry.toSeatLabel}
                          </>
                        ) : (
                          <>
                            To: {entry.toRecordDay?.rxNumber || format(new Date(entry.toRecordDay?.date), 'd MMM')}
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
                        {format(new Date(entry.rebookedAt), 'd MMM yyyy h:mm a')} by {entry.rebookedBy}
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
              {selectedConfirmedWithoutTicket.length > 0 && (
                <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">
                  <Ticket className="h-3 w-3 mr-1" />
                  {selectedConfirmedWithoutTicket.length} ready for ticket
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
                onClick={() => setSendTicketDialogOpen(true)}
                disabled={selectedConfirmedWithoutTicket.length === 0}
                className="bg-green-600 hover:bg-green-700 text-white"
                data-testid="button-send-ticket-email"
              >
                <Ticket className="h-4 w-4 mr-2" />
                Send Ticket Email ({selectedConfirmedWithoutTicket.length})
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
          ) : filteredData.length === 0 && filteredCanceledAssignments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No assigned contestants found</p>
              <p className="text-sm">Assign contestants from the Seating Chart</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-blue-100 dark:bg-blue-900/20">
                  <TableHead className="w-8 px-2">
                    <Checkbox
                      checked={selectedAssignments.size === filteredData.length && filteredData.length > 0}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead className="font-semibold text-xs">Name</TableHead>
                  <TableHead className="font-semibold text-xs">Rating</TableHead>
                  <TableHead className="font-semibold text-xs">Attending<br/>With</TableHead>
                  <TableHead className="font-semibold text-xs whitespace-nowrap">Date /<br/>RX</TableHead>
                  <TableHead className="font-semibold text-xs">Seat</TableHead>
                  <TableHead className="font-semibold text-xs min-w-[200px]">Email</TableHead>
                  <TableHead className="font-semibold text-xs text-center">Sent</TableHead>
                  <TableHead className="font-semibold text-xs text-center">Status</TableHead>
                  <TableHead className="font-semibold text-xs text-center">Ticket</TableHead>
                  <TableHead className="font-semibold text-xs">Actions</TableHead>
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
                      <TableCell className="py-1">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            {item.contestant?.photoUrl && (
                              <AvatarImage src={item.contestant.photoUrl} alt={item.contestant?.name || ''} />
                            )}
                            <AvatarFallback className="text-[10px]">
                              {(item.contestant?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-xs">{item.contestant?.name || 'Unknown'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-1">
                        {item.contestant?.auditionRating ? (
                          <Badge 
                            variant="outline" 
                            className={`text-[10px] px-1.5 py-0 ${
                              item.contestant.auditionRating === 'A+' ? 'border-green-500 text-green-600 dark:text-green-400' :
                              item.contestant.auditionRating === 'A' ? 'border-green-400 text-green-500 dark:text-green-300' :
                              item.contestant.auditionRating === 'B+' ? 'border-blue-400 text-blue-500 dark:text-blue-300' :
                              item.contestant.auditionRating === 'B' ? 'border-blue-300 text-blue-400 dark:text-blue-200' :
                              item.contestant.auditionRating === 'C' ? 'border-orange-400 text-orange-500 dark:text-orange-300' :
                              item.contestant.auditionRating === 'P' ? 'border-purple-400 text-purple-500 dark:text-purple-300' :
                              ''
                            }`}
                          >
                            {item.contestant.auditionRating}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1 max-w-[160px]">
                        {item.contestant?.attendingWith ? (
                          <div className="flex flex-col text-xs text-muted-foreground">
                            {item.contestant.attendingWith.split(/[,&]/).map((name, idx) => (
                              <span key={idx} className="truncate" title={name.trim()}>{name.trim()}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1">
                        <div className="flex flex-col text-xs">
                          <span>
                            {item.recordDay?.date 
                              ? format(new Date(item.recordDay.date), "d MMM") 
                              : "-"}
                          </span>
                          {item.recordDay?.rxNumber && (
                            <span className="text-muted-foreground text-[10px]">
                              {item.recordDay.rxNumber}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1">
                        <span className="text-xs font-mono">
                          {item.blockNumber}-{item.seatLabel}
                        </span>
                      </TableCell>
                      <TableCell className="py-1">
                        <span className="text-xs text-muted-foreground">
                          {item.contestant?.email || "-"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center py-1 px-2">
                        {item.bookingEmailError ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge variant="destructive" className="text-[9px] px-1 py-0">
                              <XCircle className="h-2.5 w-2.5 mr-0.5" />
                              FAILED
                            </Badge>
                            <span className="text-[9px] text-red-500 max-w-[80px] truncate" title={item.bookingEmailError}>
                              {item.bookingEmailError.substring(0, 20)}...
                            </span>
                            {item.contestant?.email && !isDeclined(item) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 px-1.5 text-[10px] border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => handleResendClick(item)}
                                disabled={resendBookingEmailMutation.isPending}
                                data-testid={`button-retry-${item.id}`}
                              >
                                <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                                Retry
                              </Button>
                            )}
                          </div>
                        ) : item.bookingEmailSent ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                              <MailCheck className="h-3 w-3" />
                              <span className="text-[10px]">
                                {format(new Date(item.bookingEmailSent), "d/M")}
                              </span>
                            </div>
                            {item.contestant?.email && !isDeclined(item) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => handleResendClick(item)}
                                disabled={resendBookingEmailMutation.isPending}
                                data-testid={`button-resend-${item.id}`}
                              >
                                <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                                Resend
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-1 px-2">
                        {getStatusBadge(item)}
                      </TableCell>
                      <TableCell className="text-center py-1 px-2">
                        {isConfirmed ? (
                          item.ticketEmailSent ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                <Ticket className="h-3 w-3" />
                                <span className="text-[10px]">
                                  {format(new Date(item.ticketEmailSent), "d/M")}
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => handleResendTicketClick(item)}
                                disabled={resendTicketMutation.isPending}
                                data-testid={`button-resend-ticket-${item.id}`}
                              >
                                <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                                Resend
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[10px]"
                              onClick={() => sendTicketMutation.mutate(item.id)}
                              disabled={sendTicketMutation.isPending || !item.contestant?.email}
                              data-testid={`button-send-ticket-${item.id}`}
                            >
                              <Ticket className="h-2.5 w-2.5 mr-0.5" />
                              Send
                            </Button>
                          )
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1 px-2">
                        {isDeclined(item) ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[10px]"
                              onClick={() => {
                                setCancelConfirmAssignment(item);
                                setCancelConfirmType("decline");
                                setCancelConfirmDialogOpen(true);
                              }}
                              disabled={undoDeclineMutation.isPending}
                              data-testid={`button-cancel-decline-${item.id}`}
                            >
                              <XCircle className="h-2.5 w-2.5 mr-0.5" />
                              Cancel
                            </Button>
                          </div>
                        ) : isConfirmed ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[10px]"
                              onClick={() => {
                                setCancelConfirmAssignment(item);
                                setCancelConfirmType("confirm");
                                setCancelConfirmDialogOpen(true);
                              }}
                              disabled={undoConfirmMutation.isPending}
                              data-testid={`button-cancel-confirm-${item.id}`}
                            >
                              <XCircle className="h-2.5 w-2.5 mr-0.5" />
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-5 px-1.5 text-[10px]"
                              onClick={() => handleConfirm(item)}
                              disabled={confirmMutation.isPending}
                              title="Confirm booking"
                              data-testid={`button-confirm-${item.id}`}
                            >
                              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[10px]"
                              onClick={() => handleDeclineClick(item)}
                              title="Decline booking"
                              data-testid={`button-decline-${item.id}`}
                            >
                              <XCircle className="h-2.5 w-2.5 mr-0.5" />
                              Decline
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                
                {/* Rescheduled/Declined contestants from canceled assignments - show in both "all" and "declined" views */}
                {(statusFilter === "declined" || statusFilter === "all") && filteredCanceledAssignments.map((item) => (
                  <TableRow 
                    key={`canceled-${item.id}`}
                    className="bg-red-50 dark:bg-red-950/20"
                    data-testid={`row-canceled-${item.id}`}
                  >
                    <TableCell>
                      <span className="text-xs text-muted-foreground">-</span>
                    </TableCell>
                    <TableCell className="py-1">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          {item.contestant?.photoUrl && (
                            <AvatarImage src={item.contestant.photoUrl} alt={item.contestant?.name || ''} />
                          )}
                          <AvatarFallback className="text-[10px]">
                            {(item.contestant?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium text-xs">{item.contestant?.name || 'Unknown'}</span>
                          <Badge variant="outline" className="w-fit text-[9px] px-1 py-0 border-amber-500 text-amber-600">
                            Reschedule
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-1">
                      {item.contestant?.auditionRating ? (
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1.5 py-0 ${
                            item.contestant.auditionRating === 'A+' ? 'border-green-500 text-green-600 dark:text-green-400' :
                            item.contestant.auditionRating === 'A' ? 'border-green-400 text-green-500 dark:text-green-300' :
                            item.contestant.auditionRating === 'B+' ? 'border-blue-400 text-blue-500 dark:text-blue-300' :
                            item.contestant.auditionRating === 'B' ? 'border-blue-300 text-blue-400 dark:text-blue-200' :
                            item.contestant.auditionRating === 'C' ? 'border-orange-400 text-orange-500 dark:text-orange-300' :
                            item.contestant.auditionRating === 'P' ? 'border-purple-400 text-purple-500 dark:text-purple-300' :
                            ''
                          }`}
                        >
                          {item.contestant.auditionRating}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 max-w-[160px]">
                      {item.contestant?.attendingWith ? (
                        <div className="flex flex-col text-xs text-muted-foreground">
                          {item.contestant.attendingWith.split(/[,&]/).map((name, idx) => (
                            <span key={idx} className="truncate" title={name.trim()}>{name.trim()}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="py-1">
                      <div className="flex flex-col text-xs">
                        <span>
                          {item.recordDay?.date 
                            ? format(new Date(item.recordDay.date), "d MMM") 
                            : "-"}
                        </span>
                        {item.recordDay?.rxNumber && (
                          <span className="text-muted-foreground text-[10px]">
                            {item.recordDay.rxNumber}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        {item.blockNumber ? `${item.blockNumber}-${item.seatLabel}` : '-'}
                      </span>
                    </TableCell>
                    <TableCell className="py-1">
                      <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                        {item.contestant?.email || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center py-1 px-2">
                      {item.bookingEmailSent ? (
                        <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                          <MailCheck className="h-3 w-3" />
                          <span className="text-[10px]">
                            {format(new Date(item.bookingEmailSent), "d/M")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center py-1 px-2">
                      <Badge variant="destructive" className="text-[10px] px-1.5">
                        <XCircle className="h-2.5 w-2.5 mr-0.5" />
                        Declined
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center py-1 px-2">
                      <span className="text-xs text-muted-foreground">-</span>
                    </TableCell>
                    <TableCell className="py-1 px-2">
                      <div className="text-xs text-muted-foreground">
                        {item.declinedAt && (
                          <div className="text-[10px]">
                            {format(new Date(item.declinedAt), "d/M h:mma")}
                          </div>
                        )}
                        {item.reason && (
                          <div className="text-[10px] truncate max-w-[100px]" title={item.reason}>
                            {item.reason.replace('[DECLINED] ', '')}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
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
            
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted px-3 py-2 border-b flex items-center justify-between">
                <span className="text-sm font-medium">Email Preview</span>
                {!selectedRecordDay && selectedNotSentWithEmail.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Preview showing: {sortedRecordDays.find(rd => rd.id === selectedNotSentWithEmail[0]?.recordDayId)?.rxNumber || 'Sample'}
                  </span>
                )}
              </div>
              <iframe
                src={`/api/email-preview/booking?recordDayId=${selectedRecordDay || selectedNotSentWithEmail[0]?.recordDayId || ''}&t=${Date.now()}`}
                className="w-full h-[300px] bg-white"
                title="Booking Email Preview"
              />
            </div>
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

      {/* Send Ticket Email Dialog */}
      <Dialog open={sendTicketDialogOpen} onOpenChange={setSendTicketDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-green-600" />
              Send Ticket Emails
            </DialogTitle>
            <DialogDescription>
              Send ticket emails with PDF attachment to {selectedConfirmedWithoutTicket.length} confirmed contestant(s)
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {selectedConfirmedWithoutTicketNoEmail.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                <h4 className="font-medium text-sm mb-2 text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {selectedConfirmedWithoutTicketNoEmail.length} contestant(s) will be skipped (no email)
                </h4>
                <div className="max-h-20 overflow-y-auto text-sm space-y-1 text-amber-700 dark:text-amber-300">
                  {selectedConfirmedWithoutTicketNoEmail.map(item => (
                    <div key={item.id}>{item.contestant?.name || "Unknown"}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted p-3 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Recipients ({selectedConfirmedWithoutTicket.length})</h4>
              {selectedConfirmedWithoutTicket.length === 0 ? (
                <p className="text-sm text-muted-foreground">No confirmed contestants with email addresses selected</p>
              ) : (
                <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                  {selectedConfirmedWithoutTicket.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.contestant?.name}</span>
                      <span className="text-muted-foreground">{item.contestant?.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Each recipient will receive a ticket email with the Record Day Information PDF attached.
            </p>
            
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted px-3 py-2 border-b flex items-center justify-between">
                <span className="text-sm font-medium">Email Preview</span>
                {!selectedRecordDay && selectedConfirmedWithoutTicket.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Preview showing: {sortedRecordDays.find(rd => rd.id === selectedConfirmedWithoutTicket[0]?.recordDayId)?.rxNumber || 'Sample'}
                  </span>
                )}
              </div>
              <iframe
                key={`ticket-preview-${selectedRecordDay || selectedConfirmedWithoutTicket[0]?.recordDayId}`}
                src={`/api/email-preview/ticket?recordDayId=${selectedRecordDay || selectedConfirmedWithoutTicket[0]?.recordDayId || ''}&t=${Date.now()}`}
                className="w-full h-[300px] bg-white"
                title="Ticket Email Preview"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTicketDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSendTicketEmails}
              disabled={bulkSendTicketEmailMutation.isPending || selectedConfirmedWithoutTicket.length === 0}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-confirm-send-ticket-email"
            >
              {bulkSendTicketEmailMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Ticket className="h-4 w-4 mr-2" />
                  Send to {selectedConfirmedWithoutTicket.length} Contestant(s)
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
              onValueChange={(v) => setDeclineAction(v as "reschedule" | "return_pool" | "attendance_issue")}
              className="space-y-3"
            >
              <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50">
                <RadioGroupItem value="reschedule" id="action-reschedule" data-testid="radio-reschedule" />
                <div className="flex flex-col">
                  <Label htmlFor="action-reschedule" className="font-medium cursor-pointer">
                    Move to Reschedule list
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    Remove from seating and add to reschedule tab for later
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50">
                <RadioGroupItem value="return_pool" id="action-return-pool" data-testid="radio-return-pool" />
                <div className="flex flex-col">
                  <Label htmlFor="action-return-pool" className="font-medium cursor-pointer">
                    Return to Contestant Pool
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    Remove assignment and make contestant available again
                  </span>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50 border-red-200 bg-red-50/10 dark:bg-red-900/10">
                <RadioGroupItem value="attendance_issue" id="action-attendance-issue" data-testid="radio-attendance-issue" />
                <div className="flex flex-col">
                  <Label htmlFor="action-attendance-issue" className="font-medium cursor-pointer text-red-600 dark:text-red-400">
                    No Longer Want to Attend
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    Move to Attendance Issues tab (permanent record)
                  </span>
                </div>
              </div>
            </RadioGroup>

            {/* Reschedule or Attendance Issue: Show reason textarea and producer initials */}
            {(declineAction === "reschedule" || declineAction === "attendance_issue") && (
              <div className="space-y-4 pt-2 border-t">
                <div className="space-y-2">
                  <Label htmlFor="decline-reason">
                    {declineAction === "attendance_issue" ? "Reason for not attending" : "Reason for decline"}
                  </Label>
                  <Textarea
                    id="decline-reason"
                    placeholder={declineAction === "attendance_issue" ? "e.g., Decided not to participate, health reasons, etc." : "e.g., No longer available, scheduling conflict, etc."}
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    data-testid="input-decline-reason"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="decline-moved-by">Your Initials <span className="text-red-500">*</span></Label>
                  <Input
                    id="decline-moved-by"
                    placeholder="e.g., JD"
                    value={declineMovedBy}
                    onChange={(e) => setDeclineMovedBy(e.target.value.toUpperCase())}
                    maxLength={5}
                    className="w-24"
                    data-testid="input-decline-moved-by"
                  />
                  <p className="text-xs text-muted-foreground">Required for tracking who processed this decline</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={declineAction === "return_pool" ? "default" : "destructive"}
              onClick={() => {
                if (declineAction === "return_pool") {
                  returnToPoolMutation.mutate(declineAssignment!.id);
                } else {
                  declineMutation.mutate({ 
                    assignmentId: declineAssignment!.id, 
                    reason: declineReason,
                    movedBy: declineMovedBy,
                    moveToAttendanceIssues: declineAction === "attendance_issue"
                  });
                }
              }}
              disabled={
                ((declineAction === "reschedule" || declineAction === "attendance_issue") && !declineMovedBy.trim()) || 
                declineMutation.isPending || 
                returnToPoolMutation.isPending
              }
              data-testid="button-submit-decline"
            >
              {declineMutation.isPending || returnToPoolMutation.isPending ? "Processing..." : 
               declineAction === "reschedule" ? "Move to Reschedule" : 
               declineAction === "attendance_issue" ? "Move to Attendance Issues" :
               "Return to Pool"}
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
                        {rd.rxNumber ? `${rd.rxNumber} - ` : ""}{format(new Date(rd.date), "EEE, d MMM yyyy")}
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

      {/* Resend Ticket Email Confirmation Dialog */}
      <Dialog open={resendTicketDialogOpen} onOpenChange={setResendTicketDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-amber-600" />
              Resend Ticket Email
            </DialogTitle>
            <DialogDescription>
              {resendTicketAssignment && (
                <>
                  Are you sure you want to resend the ticket email to{" "}
                  <strong>{resendTicketAssignment.contestant?.name}</strong>?
                  <br /><br />
                  This will send another copy of the ticket email with PDF attachment to{" "}
                  <strong>{resendTicketAssignment.contestant?.email}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setResendTicketDialogOpen(false);
                setResendTicketAssignment(null);
              }}
              data-testid="button-cancel-resend-ticket"
            >
              Cancel
            </Button>
            <Button
              onClick={handleResendTicketConfirm}
              disabled={resendTicketMutation.isPending}
              data-testid="button-confirm-resend-ticket"
            >
              {resendTicketMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Ticket className="h-4 w-4 mr-2" />
                  Resend Ticket
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      {/* No Email Warning Dialog */}
      <Dialog open={noEmailWarningOpen} onOpenChange={setNoEmailWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-amber-600" />
              No Booking Email Sent
            </DialogTitle>
            <DialogDescription>
              {noEmailWarningAssignment && (
                <>
                  <strong>{noEmailWarningAssignment.contestant?.name}</strong> has not been sent a booking email yet.
                  <br /><br />
                  Are you sure you want to {noEmailWarningAction === "confirm" ? "confirm" : "decline"} their booking?
                  <br /><br />
                  <span className="text-muted-foreground text-xs">
                    This is useful when someone in a group confirms on behalf of another group member.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setNoEmailWarningOpen(false);
                setNoEmailWarningAssignment(null);
              }}
              data-testid="button-cancel-no-email-warning"
            >
              Cancel
            </Button>
            <Button
              variant={noEmailWarningAction === "confirm" ? "default" : "outline"}
              onClick={handleConfirmWithoutEmail}
              disabled={confirmMutation.isPending}
              data-testid="button-proceed-no-email-warning"
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                `Yes, ${noEmailWarningAction === "confirm" ? "Confirm" : "Decline"} Anyway`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelConfirmDialogOpen} onOpenChange={setCancelConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-amber-600" />
              {cancelConfirmType === "confirm" ? "Cancel Confirmation" : "Cancel Decline"}
            </DialogTitle>
            <DialogDescription>
              {cancelConfirmAssignment && (
                <>
                  Are you sure you want to {cancelConfirmType === "confirm" ? "cancel the confirmation" : "cancel the decline"} for{" "}
                  <strong>{cancelConfirmAssignment.contestant?.name}</strong>?
                  <br /><br />
                  {cancelConfirmType === "confirm" 
                    ? "This will reset their status back to awaiting reply."
                    : "This will restore them from the reschedule list and set their status back to awaiting reply."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setCancelConfirmDialogOpen(false);
                setCancelConfirmAssignment(null);
              }}
              data-testid="button-close-cancel-confirm"
            >
              Go Back
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (cancelConfirmAssignment) {
                  if (cancelConfirmType === "confirm") {
                    undoConfirmMutation.mutate(cancelConfirmAssignment.id);
                  } else {
                    undoDeclineMutation.mutate(cancelConfirmAssignment.id);
                  }
                  setCancelConfirmDialogOpen(false);
                  setCancelConfirmAssignment(null);
                }
              }}
              disabled={undoConfirmMutation.isPending || undoDeclineMutation.isPending}
              data-testid="button-confirm-cancel-action"
            >
              {(undoConfirmMutation.isPending || undoDeclineMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Yes, Cancel"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}
