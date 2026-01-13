import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePaperworkWebSocket } from "@/hooks/use-websocket";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  FileText, 
  Send, 
  CheckCircle, 
  XCircle, 
  Settings, 
  RefreshCw,
  Search,
  Users,
  Calendar,
  Mail,
  Clock,
  FileCheck,
  UserCheck,
  MailPlus,
  AlertTriangle,
  Copy
} from "lucide-react";
import type { RecordDay, Contestant, SeatAssignment } from "@shared/schema";

interface PaperworkAssignment extends SeatAssignment {
  contestant: Contestant | null;
  recordDay: RecordDay | null;
}

interface AdobeSignConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromEmail: string;
  fromName: string;
  hasPassword: boolean;
}

type StatusFilter = "all" | "invited" | "confirmed";
type PaperworkStatusFilter = "all" | "ready_to_send" | "awaiting_return" | "complete";

export default function Paperwork() {
  const { toast } = useToast();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paperworkStatusFilter, setPaperworkStatusFilter] = useState<PaperworkStatusFilter>("all");
  const [searchName, setSearchName] = useState("");
  const [activeTab, setActiveTab] = useState("paperwork");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [adobeSignLink, setAdobeSignLink] = useState("");
  
  // Untick confirmation dialog state
  const [untickConfirmOpen, setUntickConfirmOpen] = useState(false);
  const [untickPending, setUntickPending] = useState<{
    itemId: string;
    field: "paperworkSent" | "paperworkReceived";
    fieldLabel: string;
    contestantName: string;
  } | null>(null);
  const [emailSubject, setEmailSubject] = useState("Deal or No Deal - Required Paperwork");
  const [emailBody, setEmailBody] = useState(`Dear {name},

Thank you for confirming your attendance for Deal or No Deal!

Please complete the required paperwork by clicking the Adobe Sign link below:

{adobe_sign_link}

If you have any questions, please don't hesitate to contact us.

Best regards,
Deal or No Deal Production Team`);

  // Connect to WebSocket for real-time updates from Booking Master
  usePaperworkWebSocket();

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  // Build query URL with filters
  const buildPaperworkUrl = () => {
    const params = new URLSearchParams();
    if (selectedRecordDay !== "all") {
      params.append("recordDayId", selectedRecordDay);
    }
    if (statusFilter !== "all") {
      params.append("status", statusFilter);
    }
    const queryString = params.toString();
    return queryString ? `/api/paperwork?${queryString}` : "/api/paperwork";
  };

  const paperworkUrl = buildPaperworkUrl();
    
  const { data: paperworkData = [], isLoading: loadingPaperwork, refetch: refetchPaperwork } = useQuery<PaperworkAssignment[]>({
    queryKey: ["/api/paperwork", selectedRecordDay, statusFilter],
    queryFn: async () => {
      const response = await fetch(paperworkUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch paperwork data');
      return response.json();
    },
  });

  const { data: adobeConfig } = useQuery<AdobeSignConfig>({
    queryKey: ["/api/adobe-sign-smtp/config"],
  });

  const invalidatePaperworkQueries = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/paperwork');
      },
    });
    // Also invalidate seat assignments for sync with Booking Master
    await queryClient.invalidateQueries({ queryKey: ["/api/seat-assignments"] });
  };

  const markSentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest("POST", `/api/paperwork/${assignmentId}/sent`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Paperwork marked as sent" });
      invalidatePaperworkQueries();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const markReceivedMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest("POST", `/api/paperwork/${assignmentId}/received`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Paperwork marked as received and logged" });
      invalidatePaperworkQueries();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearSentMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest("DELETE", `/api/paperwork/${assignmentId}/sent`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Paperwork sent status cleared" });
      invalidatePaperworkQueries();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const clearReceivedMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest("DELETE", `/api/paperwork/${assignmentId}/received`, {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Paperwork received status cleared" });
      invalidatePaperworkQueries();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Get contestant name for an assignment
  const getContestantName = (itemId: string): string => {
    const item = paperworkData.find(p => p.id === itemId);
    return item?.contestant?.name || "Unknown Contestant";
  };

  // Handler for checkbox changes that require confirmation when unticking
  const handlePaperworkCheckbox = (
    item: PaperworkAssignment, 
    field: "paperworkSent" | "paperworkReceived", 
    checked: boolean
  ) => {
    if (checked) {
      // Ticking on - proceed directly
      if (field === "paperworkSent") {
        markSentMutation.mutate(item.id);
      } else {
        markReceivedMutation.mutate(item.id);
      }
    } else {
      // Unticking - show confirmation
      setUntickPending({
        itemId: item.id,
        field,
        fieldLabel: field === "paperworkSent" ? "Paperwork Sent" : "Paperwork Received",
        contestantName: item.contestant?.name || "Unknown Contestant",
      });
      setUntickConfirmOpen(true);
    }
  };

  const handleConfirmUntick = () => {
    if (untickPending) {
      if (untickPending.field === "paperworkSent") {
        clearSentMutation.mutate(untickPending.itemId);
      } else {
        clearReceivedMutation.mutate(untickPending.itemId);
      }
    }
    setUntickConfirmOpen(false);
    setUntickPending(null);
  };

  const handleCancelUntick = () => {
    setUntickConfirmOpen(false);
    setUntickPending(null);
  };

  const bulkSendPaperworkMutation = useMutation({
    mutationFn: async (data: { assignmentIds: string[]; adobeSignLink: string; subject: string; body: string }) => {
      const response = await apiRequest("POST", "/api/paperwork/bulk-send", data);
      return response.json();
    },
    onSuccess: async (data) => {
      // Handle different outcomes based on actual results
      if (data.sent === 0) {
        // No emails were sent - this is a failure, not success
        toast({ 
          title: "Failed to send emails", 
          description: data.errors?.length > 0 
            ? `All ${data.failed} emails failed: ${data.errors[0]}` 
            : "No emails were sent",
          variant: "destructive" 
        });
        // Don't close dialog or clear selection - let user retry
        return;
      }
      
      // At least some emails were sent successfully
      if (data.failed > 0) {
        // Partial success
        toast({ 
          title: "Paperwork emails partially sent", 
          description: `Sent to ${data.sent} contestants, ${data.failed} failed`,
          variant: "default" 
        });
      } else {
        // Full success
        toast({ 
          title: "Paperwork emails sent", 
          description: `Successfully sent to ${data.sent} contestants` 
        });
      }
      
      // Invalidate and wait for refetch to complete before clearing UI
      await invalidatePaperworkQueries();
      setSendEmailDialogOpen(false);
      setSelectedAssignments(new Set());
    },
    onError: (error: Error) => {
      toast({ title: "Error sending emails", description: error.message, variant: "destructive" });
    },
  });

  // Filter by search and paperwork status
  const filteredData = paperworkData.filter((item) => {
    // Filter by name search
    if (searchName && !item.contestant?.name?.toLowerCase().includes(searchName.toLowerCase())) {
      return false;
    }
    // Filter by paperwork status
    if (paperworkStatusFilter !== "all") {
      if (paperworkStatusFilter === "ready_to_send" && item.paperworkSent) {
        return false;
      }
      if (paperworkStatusFilter === "awaiting_return" && (!item.paperworkSent || item.paperworkReceived)) {
        return false;
      }
      if (paperworkStatusFilter === "complete" && (!item.paperworkSent || !item.paperworkReceived)) {
        return false;
      }
    }
    return true;
  });

  // Stats
  const invitedCount = filteredData.filter(item => !item.confirmedRsvp).length;
  const confirmedCount = filteredData.filter(item => item.confirmedRsvp).length;
  const pendingSent = filteredData.filter(item => !item.paperworkSent);
  const pendingReceived = filteredData.filter(item => item.paperworkSent && !item.paperworkReceived);
  const completed = filteredData.filter(item => item.paperworkSent && item.paperworkReceived);

  const sortedRecordDays = [...recordDays].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Get all emails from filtered data for copy functionality
  const allEmails = filteredData
    .map(item => item.contestant?.email)
    .filter((email): email is string => !!email);

  const handleCopyAllEmails = async () => {
    if (allEmails.length === 0) {
      toast({ title: "No emails to copy", variant: "destructive" });
      return;
    }
    
    try {
      await navigator.clipboard.writeText(allEmails.join(", "));
      toast({ 
        title: "Emails copied!", 
        description: `${allEmails.length} email addresses copied to clipboard (comma-separated)` 
      });
    } catch {
      toast({ title: "Failed to copy", description: "Please try selecting manually", variant: "destructive" });
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedAssignments(new Set(filteredData.map(item => item.id)));
    } else {
      setSelectedAssignments(new Set());
    }
  };

  const handleSelectAssignment = (assignmentId: string, checked: boolean) => {
    const newSelected = new Set(selectedAssignments);
    if (checked) {
      newSelected.add(assignmentId);
    } else {
      newSelected.delete(assignmentId);
    }
    setSelectedAssignments(newSelected);
  };

  const selectedItems = filteredData.filter(item => selectedAssignments.has(item.id));
  const selectedWithEmail = selectedItems.filter(item => item.contestant?.email);
  const selectedWithoutEmail = selectedItems.filter(item => !item.contestant?.email);

  const handleSendPaperwork = () => {
    if (!adobeSignLink) {
      toast({ title: "Adobe Sign link required", description: "Please enter an Adobe Sign link", variant: "destructive" });
      return;
    }
    
    if (selectedWithEmail.length === 0) {
      toast({ 
        title: "No valid recipients", 
        description: "None of the selected contestants have email addresses", 
        variant: "destructive" 
      });
      return;
    }
    
    const assignmentIds = selectedWithEmail.map(item => item.id);
    bulkSendPaperworkMutation.mutate({
      assignmentIds,
      adobeSignLink,
      subject: emailSubject,
      body: emailBody,
    });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="h-8 w-8 text-orange-600" />
            Paperwork Tracker
          </h1>
          <p className="text-muted-foreground mt-1">
            Track paperwork status for invited contestants
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => refetchPaperwork()}
          data-testid="button-refresh-paperwork"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tabs structure preserved but hidden - emailing now done via Adobe Sign website */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="hidden-tabs">
        {/* TabsList hidden since only one tab remains
        <TabsList>
          <TabsTrigger value="paperwork" data-testid="tab-paperwork">
            <FileText className="h-4 w-4 mr-2" />
            Paperwork Tracker
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="h-4 w-4 mr-2" />
            Email Settings
          </TabsTrigger>
        </TabsList>
        */}

        <TabsContent value="paperwork" className="space-y-4 mt-0">
          {/* Filters Row */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Label htmlFor="record-day-filter">Record Day:</Label>
              <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
                <SelectTrigger className="w-[200px]" data-testid="select-record-day">
                  <SelectValue placeholder="All Record Days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Record Days</SelectItem>
                  {sortedRecordDays.map((rd) => (
                    <SelectItem key={rd.id} value={rd.id}>
                      {format(new Date(rd.date), "MMM d, yyyy")} {rd.rxNumber ? `- ${rd.rxNumber}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="w-[200px]"
                data-testid="input-search-name"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="paperwork-status-filter">Paperwork Status:</Label>
              <Select value={paperworkStatusFilter} onValueChange={(v) => setPaperworkStatusFilter(v as PaperworkStatusFilter)}>
                <SelectTrigger className="w-[180px]" data-testid="select-paperwork-status-filter">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ready_to_send">Ready To Send</SelectItem>
                  <SelectItem value="awaiting_return">Awaiting Return</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="status-filter">Booking Status:</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Invited</SelectItem>
                  <SelectItem value="invited">Invited Only</SelectItem>
                  <SelectItem value="confirmed">Confirmed Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-500" />
                  Invited
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-blue-600" data-testid="text-invited-count">
                  {invitedCount}
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

            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Send className="h-4 w-4 text-orange-500" />
                  Ready To Send
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-orange-600" data-testid="text-ready-to-send-count">
                  {pendingSent.length}
                </p>
              </CardContent>
            </Card>

            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Awaiting Return
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-600" data-testid="text-awaiting-return-count">
                  {pendingReceived.length}
                </p>
              </CardContent>
            </Card>

            <Card className="border-teal-200 dark:border-teal-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-teal-600" />
                  Complete
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-teal-700" data-testid="text-complete-count">
                  {completed.length}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Bulk Actions - commented out as emailing is done via Adobe Sign website
          {selectedAssignments.size > 0 && (
            <Card className="border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950">
              <CardContent className="py-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Users className="h-5 w-5 text-orange-600" />
                  <span className="font-medium">{selectedAssignments.size} contestants selected</span>
                  <span className="text-muted-foreground">
                    ({selectedWithEmail.length} with email)
                  </span>
                  {selectedWithoutEmail.length > 0 && (
                    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                      <XCircle className="h-3 w-3 mr-1" />
                      {selectedWithoutEmail.length} without email
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setSendEmailDialogOpen(true)}
                    disabled={selectedWithEmail.length === 0}
                    data-testid="button-send-paperwork-email"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Paperwork Email
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
          */}

          {/* Main Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Invited Contestants ({filteredData.length})
                  </CardTitle>
                  <CardDescription>
                    Contestants who have been sent a booking invitation
                  </CardDescription>
                </div>
                <Button 
                  onClick={handleCopyAllEmails}
                  disabled={allEmails.length === 0}
                  variant="outline"
                  className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/20"
                  data-testid="button-copy-all-emails"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy All Emails ({allEmails.length})
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingPaperwork ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No invited contestants found</p>
                  <p className="text-sm">Contestants appear here after they are sent a booking email</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-orange-100 dark:bg-orange-900/20">
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Record Day</TableHead>
                      <TableHead className="font-semibold">Seat</TableHead>
                      <TableHead className="font-semibold">Email</TableHead>
                      <TableHead className="font-semibold text-center">Booking Status</TableHead>
                      <TableHead className="font-semibold text-center">Paperwork Sent</TableHead>
                      <TableHead className="font-semibold text-center">Paperwork Received</TableHead>
                      <TableHead className="font-semibold">Paperwork Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.map((item) => (
                      <TableRow 
                        key={item.id} 
                        className={`
                          ${item.paperworkReceived ? 'bg-teal-50 dark:bg-teal-900/20' : 
                            item.paperworkSent ? 'bg-amber-50 dark:bg-amber-900/10' : ''}
                        `}
                        data-testid={`row-paperwork-${item.id}`}
                      >
                        <TableCell className="font-medium">
                          {item.contestant?.name || "Unknown"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {item.recordDay ? format(new Date(item.recordDay.date), "MMM d, yyyy") : "N/A"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700">
                            Block {item.blockNumber} - {item.seatLabel}
                          </Badge>
                        </TableCell>
                        <TableCell 
                          className="text-sm select-all cursor-text"
                          title="Click to select, then Ctrl+C to copy"
                          data-testid={`email-${item.id}`}
                        >
                          {item.contestant?.email || "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.confirmedRsvp ? (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Confirmed
                            </Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                              <Mail className="h-3 w-3 mr-1" />
                              Invited
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!item.paperworkSent}
                            onCheckedChange={(checked) => handlePaperworkCheckbox(item, "paperworkSent", checked === true)}
                            disabled={markSentMutation.isPending || clearSentMutation.isPending}
                            data-testid={`checkbox-sent-${item.id}`}
                          />
                          {item.paperworkSent && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paperworkSent), "MMM d")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!item.paperworkReceived}
                            onCheckedChange={(checked) => handlePaperworkCheckbox(item, "paperworkReceived", checked === true)}
                            disabled={!item.paperworkSent || markReceivedMutation.isPending || clearReceivedMutation.isPending}
                            data-testid={`checkbox-received-${item.id}`}
                          />
                          {item.paperworkReceived && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paperworkReceived), "MMM d")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.paperworkReceived ? (
                            <Badge className="bg-teal-600 text-white dark:bg-teal-600">
                              <FileCheck className="h-3 w-3 mr-1" />
                              Complete
                            </Badge>
                          ) : item.paperworkSent ? (
                            <Badge className="bg-amber-500 text-white dark:bg-amber-500">
                              <Clock className="h-3 w-3 mr-1" />
                              Awaiting Return
                            </Badge>
                          ) : (
                            <Badge className="bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                              <Send className="h-3 w-3 mr-1" />
                              Ready To Send
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <AdobeSignSettings config={adobeConfig} />
        </TabsContent>
      </Tabs>

      {/* Send Paperwork Email Dialog */}
      <Dialog open={sendEmailDialogOpen} onOpenChange={setSendEmailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-orange-600" />
              Send Paperwork Email
            </DialogTitle>
            <DialogDescription>
              Send paperwork email with Adobe Sign link to {selectedWithEmail.length} contestants
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adobe-sign-link">Adobe Sign Link *</Label>
              <Input
                id="adobe-sign-link"
                placeholder="https://secure.adobesign.com/..."
                value={adobeSignLink}
                onChange={(e) => setAdobeSignLink(e.target.value)}
                data-testid="input-adobe-sign-link"
              />
              <p className="text-xs text-muted-foreground">
                This link will be included in the email sent to contestants
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-subject">Email Subject</Label>
              <Input
                id="email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                data-testid="input-email-subject"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-body">Email Body</Label>
              <Textarea
                id="email-body"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="min-h-[200px]"
                data-testid="textarea-email-body"
              />
              <p className="text-xs text-muted-foreground">
                Use {"{name}"} for contestant name, {"{adobe_sign_link}"} for the Adobe Sign link
              </p>
            </div>

            {selectedWithoutEmail.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                <h4 className="font-medium text-sm mb-2 text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {selectedWithoutEmail.length} contestant(s) will be skipped (no email)
                </h4>
                <div className="max-h-20 overflow-y-auto text-sm space-y-1 text-amber-700 dark:text-amber-300">
                  {selectedWithoutEmail.map(item => (
                    <div key={item.id}>{item.contestant?.name || "Unknown"}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted p-3 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Recipients ({selectedWithEmail.length})</h4>
              {selectedWithEmail.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contestants with email addresses selected</p>
              ) : (
                <div className="max-h-32 overflow-y-auto text-sm space-y-1">
                  {selectedWithEmail.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.contestant?.name}</span>
                      <span className="text-muted-foreground">{item.contestant?.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSendPaperwork}
              disabled={bulkSendPaperworkMutation.isPending || !adobeSignLink || selectedWithEmail.length === 0}
              data-testid="button-confirm-send-email"
            >
              {bulkSendPaperworkMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send to {selectedWithEmail.length} Contestants
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
    </div>
  );
}

function AdobeSignSettings({ config }: { config?: AdobeSignConfig }) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    host: config?.host || "",
    port: config?.port || 587,
    secure: config?.secure || false,
    username: config?.username || "",
    password: "",
    fromEmail: config?.fromEmail || "",
    fromName: config?.fromName || "Deal or No Deal Paperwork",
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/adobe-sign-smtp/config", data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Adobe Sign email settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/adobe-sign-smtp/config"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/adobe-sign-smtp/test", {});
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Connection successful", description: "Adobe Sign SMTP connection verified" });
    },
    onError: (error: Error) => {
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-orange-600" />
          Adobe Sign Email Configuration
        </CardTitle>
        <CardDescription>
          Configure a separate email account for sending paperwork via Adobe Sign.
          This is different from the main booking email configuration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="smtp-host">SMTP Host</Label>
            <Input
              id="smtp-host"
              placeholder="smtp.office365.com"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              data-testid="input-smtp-host"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-port">SMTP Port</Label>
            <Input
              id="smtp-port"
              type="number"
              placeholder="587"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 587 })}
              data-testid="input-smtp-port"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-username">Username / Email</Label>
            <Input
              id="smtp-username"
              placeholder="paperwork@company.com"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              data-testid="input-smtp-username"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-password">Password</Label>
            <Input
              id="smtp-password"
              type="password"
              placeholder={config?.hasPassword ? "••••••••" : "Enter password"}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              data-testid="input-smtp-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from-email">From Email</Label>
            <Input
              id="from-email"
              placeholder="paperwork@company.com"
              value={formData.fromEmail}
              onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
              data-testid="input-from-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from-name">From Name</Label>
            <Input
              id="from-name"
              placeholder="Deal or No Deal Paperwork"
              value={formData.fromName}
              onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
              data-testid="input-from-name"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="smtp-secure"
            checked={formData.secure}
            onCheckedChange={(checked) => setFormData({ ...formData, secure: checked === true })}
            data-testid="checkbox-smtp-secure"
          />
          <Label htmlFor="smtp-secure">Use SSL/TLS (port 465)</Label>
        </div>

        <div className="flex gap-2">
          <Button 
            onClick={() => saveConfigMutation.mutate(formData)}
            disabled={saveConfigMutation.isPending}
            data-testid="button-save-config"
          >
            {saveConfigMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Save Configuration
          </Button>
          <Button 
            variant="outline"
            onClick={() => testConnectionMutation.mutate()}
            disabled={testConnectionMutation.isPending || !config?.host}
            data-testid="button-test-connection"
          >
            {testConnectionMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Test Connection
          </Button>
        </div>

        {config?.host && (
          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Current Configuration</h4>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Host:</span> {config.host}</p>
              <p><span className="text-muted-foreground">Port:</span> {config.port}</p>
              <p><span className="text-muted-foreground">From:</span> {config.fromName} &lt;{config.fromEmail}&gt;</p>
              <p><span className="text-muted-foreground">Secure:</span> {config.secure ? "Yes (SSL/TLS)" : "No (STARTTLS)"}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
