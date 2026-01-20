import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Trash2, UserPlus, Clock, CheckCircle2, XCircle, Send, Calendar, ArrowRightLeft, Users, RefreshCw, CheckCircle, Loader2, Ticket, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";

interface RecordDay {
  id: string;
  date: string;
  rxNumber: string | null;
  status: string;
}

interface Contestant {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  gender: string;
  age: number;
  photoUrl: string | null;
  auditionRating: string | null;
  availabilityStatus: string;
  groupId: string | null;
  attendingWith: string | null;
}

interface StandbyAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  status: string;
  standbyEmailSent: string | null;
  standbyTicketSent: string | null;
  confirmedAt: string | null;
  notes: string | null;
  assignedToSeat: string | null;
  assignedAt: string | null;
  movedToReschedule: boolean;
  movedToRescheduleAt: string | null;
  contestant: Contestant;
  recordDay?: RecordDay;
}

const StatusBadge = ({ status }: { status: string }) => {
  const config: Record<string, { label: string; className: string }> = {
    pending: { 
      label: "Assigned", 
      className: "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-800 dark:text-blue-400" 
    },
    email_sent: { 
      label: "Invited", 
      className: "border-purple-200 bg-purple-500/10 text-purple-700 dark:border-purple-800 dark:text-purple-400" 
    },
    confirmed: { 
      label: "Booked", 
      className: "border-green-200 bg-green-500/10 text-green-700 dark:border-green-800 dark:text-green-400" 
    },
    declined: { 
      label: "Declined", 
      className: "border-red-200 bg-red-500/10 text-red-700 dark:border-red-800 dark:text-red-400" 
    },
    seated: { 
      label: "Seated", 
      className: "border-teal-200 bg-teal-500/10 text-teal-700 dark:border-teal-800 dark:text-teal-400" 
    },
  };

  const { label, className } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
};

type StandbyStatusFilter = "all" | "not_sent" | "awaiting" | "confirmed" | "declined";

export default function StandbysPage() {
  const { toast } = useToast();
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>("");
  const [selectedStandbys, setSelectedStandbys] = useState<string[]>([]);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<StandbyStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // Decline dialog state (matching booking-responses)
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineStandby, setDeclineStandby] = useState<StandbyAssignment | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineAction, setDeclineAction] = useState<"reschedule" | "rebook">("reschedule");
  const [declineMovedBy, setDeclineMovedBy] = useState("");
  const [rebookRecordDayId, setRebookRecordDayId] = useState<string>("");

  // Send ticket dialog state
  const [sendTicketDialogOpen, setSendTicketDialogOpen] = useState(false);

  // Fetch record days
  const { data: recordDays = [], isLoading: recordDaysLoading } = useQuery<RecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  // Fetch all standbys
  const { data: allStandbys = [], isLoading: standbysLoading } = useQuery<StandbyAssignment[]>({
    queryKey: ['/api/standbys'],
  });

  // Global search - searches all record days
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase().trim();
    return allStandbys.filter(s => 
      s.contestant.name.toLowerCase().includes(query) ||
      s.contestant.email?.toLowerCase().includes(query) ||
      s.contestant.phone?.toLowerCase().includes(query) ||
      s.contestant.attendingWith?.toLowerCase().includes(query)
    );
  }, [allStandbys, searchQuery]);

  // Determine if we're in search mode
  const isSearchMode = searchQuery.trim().length > 0;

  // Filter standbys by selected record day
  const standbysForRecordDay = useMemo(() => {
    if (isSearchMode) return searchResults || [];
    if (!selectedRecordDayId) return [];
    return allStandbys.filter(s => s.recordDayId === selectedRecordDayId);
  }, [allStandbys, selectedRecordDayId, isSearchMode, searchResults]);

  // Calculate stats for the selected record day
  const stats = useMemo(() => {
    const total = standbysForRecordDay.length;
    const notSent = standbysForRecordDay.filter(s => s.status === 'pending' && !s.standbyEmailSent).length;
    const awaiting = standbysForRecordDay.filter(s => s.status === 'pending' && s.standbyEmailSent || s.status === 'email_sent').length;
    const confirmed = standbysForRecordDay.filter(s => s.status === 'confirmed').length;
    const declined = standbysForRecordDay.filter(s => s.status === 'declined').length;
    return { total, notSent, awaiting, confirmed, declined };
  }, [standbysForRecordDay]);

  // Filter by status
  const filteredStandbysForRecordDay = useMemo(() => {
    if (statusFilter === "all") return standbysForRecordDay;
    return standbysForRecordDay.filter(s => {
      switch (statusFilter) {
        case "not_sent":
          return s.status === 'pending' && !s.standbyEmailSent;
        case "awaiting":
          return (s.status === 'pending' && s.standbyEmailSent) || s.status === 'email_sent';
        case "confirmed":
          return s.status === 'confirmed';
        case "declined":
          return s.status === 'declined';
        default:
          return true;
      }
    });
  }, [standbysForRecordDay, statusFilter]);

  // Group standbys together and sort so groups appear consecutively
  const groupedStandbysForRecordDay = useMemo(() => {
    if (filteredStandbysForRecordDay.length === 0) return [];
    
    // Create a map of contestant ID to their group identifier
    const contestantToGroup = new Map<string, string>();
    
    // First pass: assign groups based on groupId
    filteredStandbysForRecordDay.forEach(s => {
      if (s.contestant.groupId) {
        contestantToGroup.set(s.contestantId, `group-${s.contestant.groupId}`);
      }
    });
    
    // Second pass: try to match by attendingWith for contestants without groupId
    filteredStandbysForRecordDay.forEach(s => {
      if (!contestantToGroup.has(s.contestantId) && s.contestant.attendingWith) {
        // Look for other standbys whose name appears in this contestant's attendingWith
        filteredStandbysForRecordDay.forEach(other => {
          if (other.contestantId !== s.contestantId) {
            const attendingWithLower = (s.contestant.attendingWith || '').toLowerCase();
            const nameParts = other.contestant.name.toLowerCase().split(' ');
            const firstName = nameParts[0];
            const lastName = nameParts[nameParts.length - 1];
            
            if (attendingWithLower.includes(firstName) || attendingWithLower.includes(lastName)) {
              // Found a match - create or join a group
              const existingGroup = contestantToGroup.get(other.contestantId);
              if (existingGroup) {
                contestantToGroup.set(s.contestantId, existingGroup);
              } else {
                const newGroupId = `attendingWith-${s.contestantId}-${other.contestantId}`;
                contestantToGroup.set(s.contestantId, newGroupId);
                contestantToGroup.set(other.contestantId, newGroupId);
              }
            }
          }
        });
      }
    });
    
    // Sort standbys so groups are together
    const sorted = [...filteredStandbysForRecordDay].sort((a, b) => {
      const groupA = contestantToGroup.get(a.contestantId) || '';
      const groupB = contestantToGroup.get(b.contestantId) || '';
      if (groupA && groupB && groupA !== groupB) return groupA.localeCompare(groupB);
      if (groupA && !groupB) return -1;
      if (!groupA && groupB) return 1;
      return a.contestant.name.localeCompare(b.contestant.name);
    });
    
    // Return with group info including isLastInGroup for border styling
    return sorted.map((s, index) => {
      const currentGroup = contestantToGroup.get(s.contestantId) || null;
      const nextStandby = sorted[index + 1];
      const nextGroup = nextStandby ? contestantToGroup.get(nextStandby.contestantId) || null : null;
      
      // Check if this is the last person in a group (next person is in a different group or not in any group)
      const isLastInGroup = currentGroup !== null && currentGroup !== nextGroup;
      const isInGroup = currentGroup !== null;
      
      return {
        ...s,
        groupIdentifier: currentGroup,
        isInGroup,
        isLastInGroup,
        groupMembers: contestantToGroup.has(s.contestantId)
          ? filteredStandbysForRecordDay
              .filter(other => contestantToGroup.get(other.contestantId) === contestantToGroup.get(s.contestantId))
              .map(m => m.contestant.name)
          : null,
      };
    });
  }, [filteredStandbysForRecordDay]);

  // Group standbys by record day for the overview
  const standbysByRecordDay = useMemo(() => {
    const grouped: Record<string, StandbyAssignment[]> = {};
    allStandbys.forEach(s => {
      if (!grouped[s.recordDayId]) {
        grouped[s.recordDayId] = [];
      }
      grouped[s.recordDayId].push(s);
    });
    return grouped;
  }, [allStandbys]);

  // Auto-select first record day
  useEffect(() => {
    if (recordDays.length > 0 && !selectedRecordDayId) {
      setSelectedRecordDayId(recordDays[0].id);
    }
  }, [recordDays, selectedRecordDayId]);

  // Delete standby mutation
  const deleteStandbyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/standbys/${id}`);
    },
    onSuccess: () => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
      toast({ title: "Standby removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Preview emails mutation
  const previewEmailsMutation = useMutation({
    mutationFn: async (standbyIds: string[]) => {
      const res = await apiRequest('POST', '/api/standbys/preview-emails', { standbyIds });
      return res.json();
    },
    onSuccess: (data: any) => {
      setPreviewData(data);
      setPreviewDialogOpen(true);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Send emails mutation
  const sendEmailsMutation = useMutation({
    mutationFn: async (standbyIds: string[]) => {
      return apiRequest('POST', '/api/standbys/send-emails', { standbyIds });
    },
    onSuccess: (data: any) => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      setPreviewDialogOpen(false);
      setSelectedStandbys([]);
      toast({ 
        title: "Emails sent", 
        description: `Sent ${data.sent} standby booking emails${data.failed > 0 ? `, ${data.failed} failed` : ''}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error sending emails", description: error.message, variant: "destructive" });
    },
  });

  // Move to reschedule mutation
  const moveToRescheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/standbys/${id}/move-to-reschedule`);
    },
    onSuccess: () => {
      // Invalidate ALL related queries for consistent state across tabs
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false });
      toast({ 
        title: "Moved to Reschedule", 
        description: "Standby has been moved to the reschedule tab for future booking.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Confirm standby mutation
  const confirmStandbyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('PATCH', `/api/standbys/${id}`, {
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      toast({ title: "Standby confirmed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Decline standby mutation (with reason and move to reschedule)
  const declineStandbyMutation = useMutation({
    mutationFn: async ({ id, reason, movedBy }: { id: string; reason: string; movedBy: string }) => {
      return apiRequest('PATCH', `/api/standbys/${id}`, {
        status: 'declined',
        movedToReschedule: true,
        movedToRescheduleAt: new Date().toISOString(),
        notes: reason ? `[DECLINED by ${movedBy}] ${reason}` : `[DECLINED by ${movedBy}]`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      toast({ title: "Standby declined", description: "Moved to reschedule list" });
      setDeclineDialogOpen(false);
      setDeclineStandby(null);
      setDeclineReason("");
      setDeclineMovedBy("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Rebook standby to different day mutation
  const rebookStandbyMutation = useMutation({
    mutationFn: async ({ oldId, newRecordDayId, contestantId }: { oldId: string; newRecordDayId: string; contestantId: string }) => {
      // First decline/delete the old standby
      await apiRequest('DELETE', `/api/standbys/${oldId}`);
      // Then create new standby on the new day
      return apiRequest('POST', `/api/standbys`, {
        contestantId,
        recordDayId: newRecordDayId,
        status: 'pending',
        notes: '[REBOOKED] from previous day',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      toast({ title: "Standby rebooked", description: "Moved to new record day" });
      setDeclineDialogOpen(false);
      setDeclineStandby(null);
      setDeclineReason("");
      setDeclineMovedBy("");
      setRebookRecordDayId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error rebooking", description: error.message, variant: "destructive" });
    },
  });

  // Resend email mutation (for single standby)
  const resendEmailMutation = useMutation({
    mutationFn: async (standbyId: string) => {
      return apiRequest('POST', '/api/standbys/send-emails', { standbyIds: [standbyId] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      toast({ title: "Email resent successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error resending email", description: error.message, variant: "destructive" });
    },
  });

  const sendTicketMutation = useMutation({
    mutationFn: async (standbyId: string) => {
      return apiRequest('POST', `/api/standbys/${standbyId}/send-ticket`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      toast({ title: "Standby ticket sent successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error sending ticket", description: error.message, variant: "destructive" });
    },
  });

  // Bulk send ticket mutation
  const bulkSendTicketMutation = useMutation({
    mutationFn: async (standbyIds: string[]) => {
      return apiRequest('POST', '/api/standbys/bulk-send-ticket', { standbyIds });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false });
      toast({ 
        title: "Ticket emails sent", 
        description: `Successfully sent ${data.sent || 0} ticket(s)` 
      });
      setSendTicketDialogOpen(false);
      setSelectedStandbys([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error sending tickets", description: error.message, variant: "destructive" });
    },
  });

  // Calculate confirmed standbys eligible for ticket sending
  const selectedConfirmedWithoutTicket = useMemo(() => {
    return standbysForRecordDay.filter(s => 
      selectedStandbys.includes(s.id) && 
      s.status === 'confirmed' && 
      !s.standbyTicketSent &&
      s.contestant.email
    );
  }, [standbysForRecordDay, selectedStandbys]);

  const selectedConfirmedNoEmail = useMemo(() => {
    return standbysForRecordDay.filter(s => 
      selectedStandbys.includes(s.id) && 
      s.status === 'confirmed' && 
      !s.standbyTicketSent &&
      !s.contestant.email
    );
  }, [standbysForRecordDay, selectedStandbys]);

  const handleSelectAll = () => {
    if (selectedStandbys.length === standbysForRecordDay.length) {
      setSelectedStandbys([]);
    } else {
      setSelectedStandbys(standbysForRecordDay.map(s => s.id));
    }
  };

  const handleSelectStandby = (id: string) => {
    if (selectedStandbys.includes(id)) {
      setSelectedStandbys(selectedStandbys.filter(sid => sid !== id));
    } else {
      setSelectedStandbys([...selectedStandbys, id]);
    }
  };

  const handlePreviewEmails = () => {
    if (selectedStandbys.length === 0) {
      toast({ title: "No standbys selected", variant: "destructive" });
      return;
    }
    previewEmailsMutation.mutate(selectedStandbys);
  };

  const handleSendEmails = () => {
    if (!previewData || previewData.recipients.length === 0) return;
    const standbyIds = previewData.recipients.map((r: any) => r.standbyId);
    sendEmailsMutation.mutate(standbyIds);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  // Handle decline button click - opens dialog
  const handleDeclineClick = (standby: StandbyAssignment) => {
    setDeclineStandby(standby);
    setDeclineReason("");
    setDeclineAction("reschedule");
    setDeclineMovedBy("");
    setRebookRecordDayId("");
    setDeclineDialogOpen(true);
  };

  // Handle decline dialog submit
  const handleDeclineSubmit = () => {
    if (!declineStandby) return;

    if (declineAction === "rebook") {
      if (!rebookRecordDayId) {
        toast({ title: "Please select a record day", variant: "destructive" });
        return;
      }
      rebookStandbyMutation.mutate({
        oldId: declineStandby.id,
        newRecordDayId: rebookRecordDayId,
        contestantId: declineStandby.contestantId,
      });
    } else {
      // Reschedule action
      if (!declineMovedBy.trim()) {
        toast({ title: "Please enter your initials", variant: "destructive" });
        return;
      }
      declineStandbyMutation.mutate({
        id: declineStandby.id,
        reason: declineReason,
        movedBy: declineMovedBy,
      });
    }
  };

  const selectedRecordDay = recordDays.find(rd => rd.id === selectedRecordDayId);

  if (recordDaysLoading || standbysLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Standbys</h1>
          <p className="text-muted-foreground">
            Manage backup contestants for each record day
          </p>
        </div>
      </div>

      {recordDays.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No record days available. Create a record day first.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Record Day Selector */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Record Days</CardTitle>
              <CardDescription>Select a record day to manage standbys</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recordDays.map(rd => {
                  const standbys = standbysByRecordDay[rd.id] || [];
                  const confirmed = standbys.filter(s => s.status === 'confirmed').length;
                  const pending = standbys.filter(s => s.status === 'pending' || s.status === 'email_sent').length;
                  
                  return (
                    <button
                      key={rd.id}
                      onClick={() => {
                        setSelectedRecordDayId(rd.id);
                        setSelectedStandbys([]);
                      }}
                      className={`w-full text-left p-3 rounded-md border transition-colors hover-elevate ${
                        selectedRecordDayId === rd.id 
                          ? 'border-primary bg-primary/5' 
                          : 'border-border'
                      }`}
                      data-testid={`button-record-day-${rd.id}`}
                    >
                      <div className="font-medium">{formatDate(rd.date)}</div>
                      {rd.rxNumber && (
                        <div className="text-xs text-muted-foreground">{rd.rxNumber}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {standbys.length} standby{standbys.length !== 1 ? 's' : ''}
                        </Badge>
                        {confirmed > 0 && (
                          <Badge variant="outline" className="text-xs text-green-600">
                            {confirmed} confirmed
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Standbys List */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">
                    {isSearchMode 
                      ? `Search Results for "${searchQuery}"` 
                      : `Standbys for ${selectedRecordDay ? formatDate(selectedRecordDay.date) : 'Selected Day'}`}
                  </CardTitle>
                  <CardDescription>
                    {standbysForRecordDay.length} standby contestant{standbysForRecordDay.length !== 1 ? 's' : ''}
                    {isSearchMode && ' (across all record days)'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* Search Input */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search all standbys..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        // Clear selections when entering/exiting search mode
                        setSelectedStandbys([]);
                      }}
                      className="pl-9 w-64"
                      data-testid="input-search-standbys"
                    />
                  </div>
                  {/* Hide bulk actions in search mode */}
                  {!isSearchMode && selectedStandbys.length > 0 && (
                    <Button 
                      onClick={handlePreviewEmails}
                      disabled={previewEmailsMutation.isPending}
                      className="bg-purple-600"
                      data-testid="button-preview-emails"
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Send Standby Email ({selectedStandbys.length})
                    </Button>
                  )}
                  {/* Send Ticket button - for confirmed standbys without ticket */}
                  {selectedConfirmedWithoutTicket.length > 0 && (
                    <Button 
                      onClick={() => setSendTicketDialogOpen(true)}
                      className="bg-green-600 hover:bg-green-700"
                      data-testid="button-send-ticket-email"
                    >
                      <Ticket className="h-4 w-4 mr-2" />
                      Send Ticket ({selectedConfirmedWithoutTicket.length})
                    </Button>
                  )}
                </div>
              </div>

              {/* Status Stats Bar - Hide in search mode */}
              {!isSearchMode && standbysForRecordDay.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t">
                  <button
                    onClick={() => setStatusFilter("all")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      statusFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted hover-elevate"
                    }`}
                    data-testid="filter-all"
                  >
                    All
                    <Badge variant="secondary" className="ml-1">{stats.total}</Badge>
                  </button>
                  <button
                    onClick={() => setStatusFilter("not_sent")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      statusFilter === "not_sent" ? "bg-gray-600 text-white" : "bg-gray-100 dark:bg-gray-800 hover-elevate"
                    }`}
                    data-testid="filter-not-sent"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Not Sent
                    <Badge variant="secondary" className="ml-1">{stats.notSent}</Badge>
                  </button>
                  <button
                    onClick={() => setStatusFilter("awaiting")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      statusFilter === "awaiting" ? "bg-amber-600 text-white" : "bg-amber-100 dark:bg-amber-900/30 hover-elevate"
                    }`}
                    data-testid="filter-awaiting"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Awaiting Reply
                    <Badge variant="secondary" className="ml-1">{stats.awaiting}</Badge>
                  </button>
                  <button
                    onClick={() => setStatusFilter("confirmed")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      statusFilter === "confirmed" ? "bg-green-600 text-white" : "bg-green-100 dark:bg-green-900/30 hover-elevate"
                    }`}
                    data-testid="filter-confirmed"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Confirmed
                    <Badge variant="secondary" className="ml-1">{stats.confirmed}</Badge>
                  </button>
                  <button
                    onClick={() => setStatusFilter("declined")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      statusFilter === "declined" ? "bg-red-600 text-white" : "bg-red-100 dark:bg-red-900/30 hover-elevate"
                    }`}
                    data-testid="filter-declined"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Declined
                    <Badge variant="secondary" className="ml-1">{stats.declined}</Badge>
                  </button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {standbysForRecordDay.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No standbys for this record day yet.</p>
                  <p className="text-sm mt-2">
                    Go to the Contestants tab to add standbys for this date.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {!isSearchMode && (
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedStandbys.length === standbysForRecordDay.length && standbysForRecordDay.length > 0}
                            onCheckedChange={handleSelectAll}
                            data-testid="checkbox-select-all-standbys"
                          />
                        </TableHead>
                      )}
                      <TableHead className="font-semibold text-xs">Name</TableHead>
                      <TableHead className="font-semibold text-xs">Rating</TableHead>
                      <TableHead className="font-semibold text-xs">Attending<br/>With</TableHead>
                      {isSearchMode && <TableHead className="font-semibold text-xs whitespace-nowrap">Date /<br/>RX</TableHead>}
                      <TableHead className="font-semibold text-xs">Email</TableHead>
                      <TableHead className="font-semibold text-xs text-center">Sent</TableHead>
                      <TableHead className="font-semibold text-xs text-center">Status</TableHead>
                      <TableHead className="font-semibold text-xs text-center">Ticket</TableHead>
                      <TableHead className="font-semibold text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedStandbysForRecordDay.map(standby => (
                      <TableRow 
                        key={standby.id} 
                        data-testid={`row-standby-${standby.id}`}
                        className={`${standby.isInGroup ? 'bg-muted/30' : ''} ${
                          standby.isLastInGroup 
                            ? '!border-b-[3px] !border-b-border' 
                            : standby.isInGroup 
                              ? '!border-b-transparent' 
                              : ''
                        }`}
                      >
                        {!isSearchMode && (
                          <TableCell className="px-2">
                            <Checkbox
                              checked={selectedStandbys.includes(standby.id)}
                              onCheckedChange={() => handleSelectStandby(standby.id)}
                              data-testid={`checkbox-standby-${standby.id}`}
                            />
                          </TableCell>
                        )}
                        {/* Name with photo */}
                        <TableCell className="py-1">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              {standby.contestant.photoUrl && (
                                <AvatarImage src={standby.contestant.photoUrl} alt={standby.contestant.name} />
                              )}
                              <AvatarFallback className="text-[10px]">
                                {standby.contestant.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-xs">{standby.contestant.name}</span>
                            {standby.groupMembers && standby.groupMembers.length > 1 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 cursor-help">
                                    <Users className="h-2.5 w-2.5 mr-0.5" />
                                    {standby.groupMembers.length}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-sm">
                                    <p className="font-medium mb-1">Group members:</p>
                                    {standby.groupMembers.map((name, i) => (
                                      <p key={i}>{name}</p>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        {/* Rating */}
                        <TableCell className="py-1">
                          {standby.contestant.auditionRating ? (
                            <Badge 
                              variant="outline" 
                              className={`text-[10px] px-1.5 py-0 ${
                                standby.contestant.auditionRating === 'A+' ? 'border-green-500 text-green-600 dark:text-green-400' :
                                standby.contestant.auditionRating === 'A' ? 'border-green-400 text-green-500 dark:text-green-300' :
                                standby.contestant.auditionRating === 'B+' ? 'border-blue-400 text-blue-500 dark:text-blue-300' :
                                standby.contestant.auditionRating === 'B' ? 'border-blue-300 text-blue-400 dark:text-blue-200' :
                                standby.contestant.auditionRating === 'C' ? 'border-orange-400 text-orange-500 dark:text-orange-300' : ''
                              }`}
                            >
                              {standby.contestant.auditionRating}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        {/* Attending With */}
                        <TableCell className="py-1 max-w-[160px]">
                          {standby.contestant.attendingWith ? (
                            <div className="flex flex-col text-xs text-muted-foreground">
                              {standby.contestant.attendingWith.split(/[,&]/).map((name, idx) => (
                                <span key={idx} className="truncate" title={name.trim()}>{name.trim()}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        {/* Date/RX - only in search mode */}
                        {isSearchMode && (
                          <TableCell className="py-1">
                            <div className="flex flex-col text-xs">
                              {(() => {
                                const rd = recordDays.find(r => r.id === standby.recordDayId);
                                return rd ? (
                                  <>
                                    <span>{format(new Date(rd.date), "MMM d")}</span>
                                    {rd.rxNumber && (
                                      <span className="text-muted-foreground text-[10px]">{rd.rxNumber}</span>
                                    )}
                                  </>
                                ) : '-';
                              })()}
                            </div>
                          </TableCell>
                        )}
                        {/* Email */}
                        <TableCell className="py-1">
                          <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                            {standby.contestant.email || "-"}
                          </span>
                        </TableCell>
                        {/* Sent status */}
                        <TableCell className="text-center py-1 px-2">
                          {standby.standbyEmailSent ? (
                            <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                              <CheckCircle className="h-3 w-3" />
                              <span className="text-[10px]">
                                {format(new Date(standby.standbyEmailSent), "M/d")}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        {/* Status */}
                        <TableCell className="text-center py-1 px-2">
                          {standby.status === 'confirmed' ? (
                            <Badge className="bg-green-500/20 text-green-700 border-green-300 dark:text-green-400 text-[10px] px-1.5 py-0">
                              Confirmed
                            </Badge>
                          ) : standby.status === 'declined' ? (
                            <Badge className="bg-red-500/20 text-red-700 border-red-300 dark:text-red-400 text-[10px] px-1.5 py-0">
                              Declined
                            </Badge>
                          ) : standby.standbyEmailSent ? (
                            <Badge className="bg-amber-500/20 text-amber-700 border-amber-300 dark:text-amber-400 text-[10px] px-1.5 py-0">
                              Awaiting
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                              Not Sent
                            </Badge>
                          )}
                        </TableCell>
                        {/* Ticket */}
                        <TableCell className="text-center py-1 px-2">
                          {standby.status === 'confirmed' ? (
                            standby.standbyTicketSent ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                  <Ticket className="h-3 w-3" />
                                  <span className="text-[10px]">
                                    {format(new Date(standby.standbyTicketSent), "M/d")}
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 px-1.5 text-[10px]"
                                  onClick={() => sendTicketMutation.mutate(standby.id)}
                                  disabled={sendTicketMutation.isPending}
                                  data-testid={`button-resend-ticket-${standby.id}`}
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
                                onClick={() => sendTicketMutation.mutate(standby.id)}
                                disabled={sendTicketMutation.isPending || !standby.contestant.email}
                                data-testid={`button-send-ticket-${standby.id}`}
                              >
                                <Ticket className="h-2.5 w-2.5 mr-0.5" />
                                Send
                              </Button>
                            )
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        {/* Actions */}
                        <TableCell className="py-1 px-2">
                          {standby.status === 'declined' ? (
                            <span className="text-xs text-muted-foreground">Rescheduled</span>
                          ) : standby.status === 'confirmed' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[10px]"
                              onClick={() => handleDeclineClick(standby)}
                              data-testid={`button-cancel-confirm-${standby.id}`}
                            >
                              <XCircle className="h-2.5 w-2.5 mr-0.5" />
                              Cancel
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="default"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => confirmStandbyMutation.mutate(standby.id)}
                                disabled={confirmStandbyMutation.isPending}
                                title="Confirm booking"
                                data-testid={`button-confirm-${standby.id}`}
                              >
                                <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 px-1.5 text-[10px]"
                                onClick={() => handleDeclineClick(standby)}
                                title="Decline booking"
                                data-testid={`button-decline-${standby.id}`}
                              >
                                <XCircle className="h-2.5 w-2.5 mr-0.5" />
                                Decline
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Email Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-email-preview">
          <DialogHeader>
            <DialogTitle>Send Standby Booking Emails</DialogTitle>
            <DialogDescription>
              Review recipients before sending standby booking confirmation emails.
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between py-2 px-3 bg-muted rounded-md">
                <span className="text-sm font-medium">Recipients with email</span>
                <Badge variant="secondary">{previewData.withEmail}</Badge>
              </div>

              {previewData.withoutEmail > 0 && (
                <div className="flex items-center justify-between py-2 px-3 bg-amber-500/10 border border-amber-200 rounded-md">
                  <span className="text-sm font-medium text-amber-700">Missing email addresses</span>
                  <Badge variant="outline" className="text-amber-700">{previewData.withoutEmail}</Badge>
                </div>
              )}

              <div className="max-h-64 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.recipients.map((r: any) => (
                      <TableRow key={r.standbyId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.email}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Email Preview */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Email Preview</p>
                <div className="border rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900">
                  <iframe 
                    src={`/api/email-preview/standby${selectedRecordDayId ? `?recordDayId=${selectedRecordDayId}` : ''}`}
                    className="w-full h-[300px] border-0"
                    title="Standby Email Preview"
                    data-testid="iframe-standby-email-preview"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Preview uses sample data. Actual emails will include recipient's name and booking details.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setPreviewDialogOpen(false)}
              data-testid="button-cancel-send"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSendEmails}
              disabled={sendEmailsMutation.isPending || !previewData?.recipients?.length}
              data-testid="button-confirm-send"
            >
              {sendEmailsMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Sending...
                </span>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send {previewData?.recipients?.length || 0} Email{previewData?.recipients?.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Dialog */}
      <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <DialogContent className="sm:max-w-[500px]" data-testid="dialog-decline-standby">
          <DialogHeader>
            <DialogTitle>Decline Standby Booking</DialogTitle>
            <DialogDescription>
              {declineStandby && (
                <>
                  <strong>{declineStandby.contestant.name}</strong> cannot attend on this date.
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
              <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50">
                <RadioGroupItem value="reschedule" id="action-reschedule" data-testid="radio-reschedule" />
                <div className="flex flex-col">
                  <Label htmlFor="action-reschedule" className="font-medium cursor-pointer">
                    Move to Reschedule list
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    Remove from standbys and add to reschedule tab for later
                  </span>
                </div>
              </div>
              
              <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50">
                <RadioGroupItem value="rebook" id="action-rebook" data-testid="radio-rebook" />
                <div className="flex flex-col">
                  <Label htmlFor="action-rebook" className="font-medium cursor-pointer">
                    Rebook to Different Day
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    Move standby to a different record day
                  </span>
                </div>
              </div>
            </RadioGroup>

            {declineAction === "rebook" && (
              <div className="space-y-3 pt-2">
                <Label htmlFor="rebook-day">Select New Record Day</Label>
                <Select value={rebookRecordDayId} onValueChange={setRebookRecordDayId}>
                  <SelectTrigger id="rebook-day" data-testid="select-rebook-day">
                    <SelectValue placeholder="Select a record day" />
                  </SelectTrigger>
                  <SelectContent>
                    {recordDays
                      .filter(rd => rd.id !== declineStandby?.recordDayId)
                      .map(rd => (
                        <SelectItem key={rd.id} value={rd.id}>
                          {format(new Date(rd.date), "MMM d, yyyy")} {rd.rxNumber && `(${rd.rxNumber})`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {declineAction === "reschedule" && (
              <div className="space-y-3 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="decline-reason">Reason for decline</Label>
                  <Textarea
                    id="decline-reason"
                    placeholder="Optional: Why can't they attend?"
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    data-testid="input-decline-reason"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="decline-moved-by">Your Initials <span className="text-red-500">*</span></Label>
                  <Input
                    id="decline-moved-by"
                    placeholder="e.g. JD"
                    value={declineMovedBy}
                    onChange={(e) => setDeclineMovedBy(e.target.value.toUpperCase())}
                    maxLength={3}
                    className="w-20"
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
            {declineAction === "rebook" ? (
              <Button
                onClick={handleDeclineSubmit}
                disabled={!rebookRecordDayId || rebookStandbyMutation.isPending}
                data-testid="button-submit-rebook"
              >
                {rebookStandbyMutation.isPending ? "Rebooking..." : "Rebook Standby"}
              </Button>
            ) : (
              <Button
                onClick={handleDeclineSubmit}
                disabled={!declineMovedBy.trim() || declineStandbyMutation.isPending}
                data-testid="button-submit-decline"
              >
                {declineStandbyMutation.isPending ? "Processing..." : "Move to Reschedule"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Ticket Email Dialog */}
      <Dialog open={sendTicketDialogOpen} onOpenChange={setSendTicketDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-green-600" />
              Send Standby Ticket Emails
            </DialogTitle>
            <DialogDescription>
              Send ticket emails with PDF attachment to {selectedConfirmedWithoutTicket.length} confirmed standby(s)
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {selectedConfirmedNoEmail.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                <h4 className="font-medium text-sm mb-2 text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {selectedConfirmedNoEmail.length} standby(s) will be skipped (no email)
                </h4>
                <div className="max-h-20 overflow-y-auto text-sm space-y-1 text-amber-700 dark:text-amber-300">
                  {selectedConfirmedNoEmail.map(standby => (
                    <div key={standby.id}>{standby.contestant.name}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted p-3 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Recipients ({selectedConfirmedWithoutTicket.length})</h4>
              {selectedConfirmedWithoutTicket.length === 0 ? (
                <p className="text-sm text-muted-foreground">No confirmed standbys with email addresses selected</p>
              ) : (
                <div className="max-h-48 overflow-y-auto text-sm space-y-1">
                  {selectedConfirmedWithoutTicket.map(standby => (
                    <div key={standby.id} className="flex justify-between">
                      <span>{standby.contestant.name}</span>
                      <span className="text-muted-foreground">{standby.contestant.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Each recipient will receive a standby ticket email with the Record Day Information PDF attached.
            </p>
            
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted px-3 py-2 border-b">
                <span className="text-sm font-medium">Email Preview</span>
              </div>
              <iframe
                src={`/api/email-preview/standby-ticket${selectedRecordDay ? `?recordDayId=${selectedRecordDay}` : ''}`}
                className="w-full h-[300px] bg-white"
                title="Standby Ticket Email Preview"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTicketDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => bulkSendTicketMutation.mutate(selectedConfirmedWithoutTicket.map(s => s.id))}
              disabled={bulkSendTicketMutation.isPending || selectedConfirmedWithoutTicket.length === 0}
              className="bg-green-600 hover:bg-green-700"
              data-testid="button-confirm-send-ticket-email"
            >
              {bulkSendTicketMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Ticket className="h-4 w-4 mr-2" />
                  Send to {selectedConfirmedWithoutTicket.length} Standby(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
