import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Mail, Users, CheckCircle, Clock, XCircle, Send, Eye, RefreshCw, Search, Calendar, BarChart3, Edit, RotateCcw } from "lucide-react";
import type { Contestant, RecordDay } from "@shared/schema";
import { format } from "date-fns";

type AvailabilityStats = {
  total: number;
  sent: number;
  responded: number;
  pending: number;
};

type TokenWithContestant = {
  id: string;
  contestantId: string;
  token: string;
  status: 'active' | 'used' | 'expired';
  expiresAt: string;
  lastSentAt: string | null;
  createdAt: string;
  contestant: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
};

type StatsByDay = {
  recordDayId: string;
  date: string;
  rxNumber: string | null;
  yes: number;
  maybe: number;
  no: number;
  pending: number;
  total: number;
};

const DEFAULT_EMAIL_SUBJECT = "Deal or No Deal - Availability Confirmation Request";
const DEFAULT_EMAIL_HEADLINE = "Confirm Your Availability";
const DEFAULT_EMAIL_INTRO = "Thank you for registering to be part of the Deal or No Deal audience! We're excited to potentially have you join us for an upcoming recording session.";
const DEFAULT_EMAIL_INSTRUCTIONS = "Please click the button below to let us know which recording dates work for you. This helps us plan our audience seating and ensures we can accommodate you on your preferred day.";
const DEFAULT_EMAIL_BUTTON_TEXT = "Select My Available Dates";
const DEFAULT_EMAIL_FOOTER = "This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.";

export default function AvailabilityManagement() {
  const { toast } = useToast();
  const [selectedContestants, setSelectedContestants] = useState<Set<string>>(new Set());
  const [selectedRecordDays, setSelectedRecordDays] = useState<Set<string>>(new Set());
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailHeadline, setEmailHeadline] = useState(DEFAULT_EMAIL_HEADLINE);
  const [emailIntro, setEmailIntro] = useState(DEFAULT_EMAIL_INTRO);
  const [emailInstructions, setEmailInstructions] = useState(DEFAULT_EMAIL_INSTRUCTIONS);
  const [emailButtonText, setEmailButtonText] = useState(DEFAULT_EMAIL_BUTTON_TEXT);
  const [emailFooter, setEmailFooter] = useState(DEFAULT_EMAIL_FOOTER);

  const { data: stats } = useQuery<AvailabilityStats>({
    queryKey: ["/api/availability/status"],
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ["/api/contestants"],
  });

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: tokens = [], refetch: refetchTokens } = useQuery<TokenWithContestant[]>({
    queryKey: ["/api/availability/tokens"],
  });

  const { data: statsByDay = [] } = useQuery<StatsByDay[]>({
    queryKey: ["/api/availability/stats-by-day"],
  });

  const resetEmailToDefaults = () => {
    setEmailSubject(DEFAULT_EMAIL_SUBJECT);
    setEmailHeadline(DEFAULT_EMAIL_HEADLINE);
    setEmailIntro(DEFAULT_EMAIL_INTRO);
    setEmailInstructions(DEFAULT_EMAIL_INSTRUCTIONS);
    setEmailButtonText(DEFAULT_EMAIL_BUTTON_TEXT);
    setEmailFooter(DEFAULT_EMAIL_FOOTER);
    toast({
      title: "Email Reset",
      description: "Email content has been reset to defaults.",
    });
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/availability/send", {
        contestantIds: Array.from(selectedContestants),
        recordDayIds: Array.from(selectedRecordDays),
        emailSubject,
        emailHeadline,
        emailIntro,
        emailInstructions,
        emailButtonText,
        emailFooter,
      });
    },
    onSuccess: (data: any) => {
      const tokensCreated = data.tokensCreated?.length || 0;
      const emailsSent = data.emailsSent?.length || 0;
      const emailsFailed = data.emailsFailed?.length || 0;
      
      toast({
        title: "Availability checks sent!",
        description: `Generated ${tokensCreated} availability check tokens. ${emailsSent} email(s) sent${emailsFailed > 0 ? `, ${emailsFailed} failed` : ''}.`,
      });
      setSendDialogOpen(false);
      setConfirmSendOpen(false);
      setSelectedContestants(new Set());
      setSelectedRecordDays(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/availability/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/availability/tokens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/availability/stats-by-day"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send availability checks",
        variant: "destructive",
      });
    },
  });

  const toggleContestant = (id: string) => {
    const newSet = new Set(selectedContestants);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedContestants(newSet);
  };

  const toggleRecordDay = (id: string) => {
    const newSet = new Set(selectedRecordDays);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRecordDays(newSet);
  };

  const selectAllContestants = () => {
    if (contestants) {
      setSelectedContestants(new Set(contestants.map(c => c.id)));
    }
  };

  const clearContestantSelection = () => {
    setSelectedContestants(new Set());
  };

  const selectAllRecordDays = () => {
    if (recordDays) {
      setSelectedRecordDays(new Set(recordDays.map(rd => rd.id)));
    }
  };

  const clearRecordDaySelection = () => {
    setSelectedRecordDays(new Set());
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'used':
        return <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">Responded</Badge>;
      case 'active':
        return <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">Pending</Badge>;
      case 'expired':
        return <Badge variant="secondary">Expired</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Filter tokens based on search and status
  const filteredTokens = tokens.filter(token => {
    const matchesSearch = searchQuery === "" || 
      token.contestant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (token.contestant.email && token.contestant.email.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = filterStatus === "all" || token.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  // Get contestants who haven't been sent an availability check
  const contestantsNotSent = contestants.filter(c => 
    !tokens.some(t => t.contestantId === c.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Availability Communications</h1>
          <p className="text-muted-foreground mt-1">
            Send availability checks and track contestant responses
          </p>
        </div>
        <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-send-checks">
              <Send className="w-4 h-4 mr-2" />
              Send Availability Checks
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Send Availability Checks</DialogTitle>
              <DialogDescription>
                Select contestants and record days to send availability check emails.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Select Record Days</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={selectAllRecordDays} data-testid="button-select-all-days">
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearRecordDaySelection} data-testid="button-clear-days">
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md p-4 space-y-2 max-h-40 overflow-auto">
                  {recordDays?.map((day) => (
                    <div key={day.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`day-${day.id}`}
                        checked={selectedRecordDays.has(day.id)}
                        onCheckedChange={() => toggleRecordDay(day.id)}
                        data-testid={`checkbox-day-${day.id}`}
                      />
                      <label
                        htmlFor={`day-${day.id}`}
                        className="text-sm font-medium leading-none cursor-pointer flex-1"
                      >
                        {format(new Date(day.date), 'EEE, MMM d, yyyy')}
                        {day.rxNumber && <span className="text-muted-foreground ml-2">({day.rxNumber})</span>}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedRecordDays.size} day{selectedRecordDays.size !== 1 ? 's' : ''} selected
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Select Contestants</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={selectAllContestants} data-testid="button-select-all-contestants">
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearContestantSelection} data-testid="button-clear-contestants">
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md p-4 space-y-2 max-h-60 overflow-auto">
                  {contestants?.map((contestant) => (
                    <div key={contestant.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`contestant-${contestant.id}`}
                        checked={selectedContestants.has(contestant.id)}
                        onCheckedChange={() => toggleContestant(contestant.id)}
                        data-testid={`checkbox-contestant-${contestant.id}`}
                      />
                      <label
                        htmlFor={`contestant-${contestant.id}`}
                        className="text-sm font-medium leading-none cursor-pointer flex-1"
                      >
                        {contestant.name} 
                        <span className="text-muted-foreground ml-1">
                          ({contestant.age}, {contestant.gender})
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedContestants.size} contestant{selectedContestants.size !== 1 ? 's' : ''} selected
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSendDialogOpen(false)} data-testid="button-cancel-send">
                Cancel
              </Button>
              <Button
                onClick={() => setConfirmSendOpen(true)}
                disabled={selectedContestants.size === 0 || selectedRecordDays.size === 0}
                data-testid="button-confirm-send"
              >
                {`Review & Send to ${selectedContestants.size} Contestant${selectedContestants.size !== 1 ? 's' : ''}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirmation Preview Dialog */}
        <Dialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Confirm Sending Availability Checks</DialogTitle>
              <DialogDescription>
                Please review the details below before sending
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Record Days</h3>
                <div className="bg-muted p-3 rounded-md space-y-1">
                  {recordDays && Array.from(selectedRecordDays).map(dayId => {
                    const day = recordDays.find((d: any) => d.id === dayId);
                    return (
                      <div key={dayId} className="text-sm">
                        {day && format(new Date(day.date), 'EEE, MMM d, yyyy')}
                        {day?.rxNumber && <span className="text-muted-foreground ml-2">({day.rxNumber})</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Recipients ({selectedContestants?.size || 0})</h3>
                <div className="bg-muted p-3 rounded-md max-h-48 overflow-auto space-y-1">
                  {contestants && Array.from(selectedContestants).map(contestantId => {
                    const contestant = contestants.find((c: any) => c.id === contestantId);
                    return (
                      <div key={contestantId} className="text-sm">
                        <div className="font-medium">{contestant?.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {contestant?.email || 'No email'} • {contestant?.age}, {contestant?.gender}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-md">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  {selectedContestants?.size || 0} availability checks will be sent via Gmail to the recipients listed above.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmSendOpen(false)} data-testid="button-cancel-confirm">
                Cancel
              </Button>
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
                data-testid="button-final-send"
              >
                {sendMutation.isPending ? "Sending..." : "Yes, Send Availability Checks"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Contestants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total">{stats?.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {contestantsNotSent.length} not yet contacted
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-sent">{stats?.sent || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Availability checks distributed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Responded</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-responded">{stats?.responded || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.sent ? Math.round((stats.responded / stats.sent) * 100) : 0}% response rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Awaiting Response</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600" data-testid="stat-pending">{stats?.pending || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Still waiting to hear back
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="responses" className="space-y-4">
        <TabsList>
          <TabsTrigger value="responses" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Responses by Day
          </TabsTrigger>
          <TabsTrigger value="tracking" className="gap-2">
            <Mail className="h-4 w-4" />
            Tracking
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-2">
            <Eye className="h-4 w-4" />
            Email Preview
          </TabsTrigger>
        </TabsList>

        {/* Tracking Tab */}
        <TabsContent value="tracking" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>Email Tracking</CardTitle>
                  <CardDescription>
                    Monitor who has been sent availability checks and their response status
                  </CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetchTokens()}
                  data-testid="button-refresh-tracking"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px] max-w-sm">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-tracking"
                    />
                  </div>
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[180px]" data-testid="select-filter-status">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Pending</SelectItem>
                    <SelectItem value="used">Responded</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Tracking Table */}
              {filteredTokens.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {tokens.length === 0 
                    ? "No availability checks have been sent yet. Click 'Send Availability Checks' to get started."
                    : "No results match your search criteria."
                  }
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contestant</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTokens.map((token) => (
                        <TableRow key={token.id} data-testid={`row-token-${token.id}`}>
                          <TableCell className="font-medium">{token.contestant.name}</TableCell>
                          <TableCell className="text-sm">{token.contestant.email || "-"}</TableCell>
                          <TableCell className="text-sm">{token.contestant.phone || "-"}</TableCell>
                          <TableCell className="text-sm">
                            {token.lastSentAt 
                              ? format(new Date(token.lastSentAt), 'MMM d, yyyy')
                              : format(new Date(token.createdAt), 'MMM d, yyyy')
                            }
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(token.expiresAt), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>{getStatusBadge(token.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              
              <div className="text-sm text-muted-foreground">
                Showing {filteredTokens.length} of {tokens.length} tracked contestants
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Responses by Day Tab */}
        <TabsContent value="responses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Response Breakdown by Record Day</CardTitle>
              <CardDescription>
                See how many contestants are available for each recording date
              </CardDescription>
            </CardHeader>
            <CardContent>
              {statsByDay.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No availability data yet. Send availability checks to start collecting responses.
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Record Day</TableHead>
                        <TableHead>Episode</TableHead>
                        <TableHead className="text-center">
                          <span className="text-green-600">Yes</span>
                        </TableHead>
                        <TableHead className="text-center">
                          <span className="text-yellow-600">Maybe</span>
                        </TableHead>
                        <TableHead className="text-center">
                          <span className="text-red-600">No</span>
                        </TableHead>
                        <TableHead className="text-center">Pending</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statsByDay.map((day) => (
                        <TableRow key={day.recordDayId} data-testid={`row-stats-${day.recordDayId}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(day.date), 'EEE, MMM d, yyyy')}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {day.rxNumber || "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 min-w-[40px]">
                              {day.yes}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 min-w-[40px]">
                              {day.maybe}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 min-w-[40px]">
                              {day.no}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="min-w-[40px]">
                              {day.pending}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-medium">
                            {day.total}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Preview Tab */}
        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle>Email Preview</CardTitle>
                  <CardDescription>
                    {isEditingEmail ? "Edit the availability email content" : "Preview how the availability check email will appear to contestants"}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingEmail(!isEditingEmail)}
                    data-testid="button-toggle-edit-email"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    {isEditingEmail ? "Preview" : "Edit Email"}
                  </Button>
                  {isEditingEmail && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetEmailToDefaults}
                      data-testid="button-reset-email"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset to Defaults
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isEditingEmail ? (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="email-subject">Email Subject</Label>
                    <Input
                      id="email-subject"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="mt-1"
                      data-testid="input-email-subject"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email-headline">Headline (Gold Banner Text)</Label>
                    <Input
                      id="email-headline"
                      value={emailHeadline}
                      onChange={(e) => setEmailHeadline(e.target.value)}
                      className="mt-1"
                      data-testid="input-email-headline"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email-intro">Introduction Paragraph</Label>
                    <Textarea
                      id="email-intro"
                      value={emailIntro}
                      onChange={(e) => setEmailIntro(e.target.value)}
                      className="mt-1"
                      rows={3}
                      data-testid="textarea-email-intro"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email-instructions">Instructions (after dates list)</Label>
                    <Textarea
                      id="email-instructions"
                      value={emailInstructions}
                      onChange={(e) => setEmailInstructions(e.target.value)}
                      className="mt-1"
                      rows={3}
                      data-testid="textarea-email-instructions"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email-button">Button Text</Label>
                    <Input
                      id="email-button"
                      value={emailButtonText}
                      onChange={(e) => setEmailButtonText(e.target.value)}
                      className="mt-1"
                      data-testid="input-email-button"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email-footer">Footer Text</Label>
                    <Textarea
                      id="email-footer"
                      value={emailFooter}
                      onChange={(e) => setEmailFooter(e.target.value)}
                      className="mt-1"
                      rows={2}
                      data-testid="textarea-email-footer"
                    />
                  </div>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: '#2a0a0a' }}>
                  <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                    <div style={{ background: 'linear-gradient(180deg, #8B0000 0%, #5a0000 100%)', padding: '20px', textAlign: 'center' as const }}>
                      <h2 style={{ color: '#D4AF37', fontSize: '24px', fontWeight: 'bold', margin: 0, letterSpacing: '2px' }}>
                        DEAL OR NO DEAL
                      </h2>
                    </div>
                    
                    <div style={{ background: 'linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%)', padding: '25px 30px', textAlign: 'center' as const }}>
                      <h1 style={{ color: '#D4AF37', fontSize: '26px', fontWeight: 'bold', margin: 0, letterSpacing: '3px', textTransform: 'uppercase' as const }}>
                        {emailHeadline}
                      </h1>
                    </div>
                    
                    <div style={{ backgroundColor: '#2a0a0a', padding: '0 20px 25px 20px' }}>
                      <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', padding: '35px 30px' }}>
                        <p style={{ color: '#333333', fontSize: '16px', lineHeight: 1.6, margin: '0 0 18px 0' }}>
                          Hi <span style={{ color: '#8B0000', fontWeight: 'bold' }}>[Contestant Name]</span>,
                        </p>
                        
                        <p style={{ color: '#333333', fontSize: '16px', lineHeight: 1.6, margin: '0 0 25px 0' }}>
                          {emailIntro}
                        </p>
                        
                        <div style={{ background: 'linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%)', borderRadius: '8px', borderLeft: '5px solid #D4AF37', padding: '20px', margin: '0 0 25px 0' }}>
                          <h2 style={{ color: '#8B0000', fontSize: '14px', fontWeight: 'bold', margin: '0 0 12px 0', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                            Available Recording Dates
                          </h2>
                          <ul style={{ color: '#444444', fontSize: '15px', lineHeight: 1.7, margin: 0, paddingLeft: '20px' }}>
                            {recordDays.slice(0, 5).map((day) => (
                              <li key={day.id}>
                                {format(new Date(day.date), 'EEEE, MMMM d, yyyy')}
                                {day.rxNumber && <span style={{ color: '#888888' }}> ({day.rxNumber})</span>}
                              </li>
                            ))}
                            {recordDays.length > 5 && (
                              <li style={{ color: '#888888' }}>...and {recordDays.length - 5} more dates</li>
                            )}
                          </ul>
                        </div>
                        
                        <p style={{ color: '#555555', fontSize: '15px', lineHeight: 1.6, margin: '0 0 25px 0' }}>
                          {emailInstructions}
                        </p>
                        
                        <div style={{ textAlign: 'center' as const, margin: '0 0 25px 0' }}>
                          <span style={{ 
                            display: 'inline-block', 
                            background: 'linear-gradient(135deg, #D4AF37 0%, #B8860B 100%)', 
                            borderRadius: '8px', 
                            padding: '16px 40px', 
                            color: '#2a0a0a', 
                            fontWeight: 'bold', 
                            textTransform: 'uppercase' as const, 
                            letterSpacing: '1.5px',
                            fontSize: '15px'
                          }}>
                            {emailButtonText}
                          </span>
                          <p style={{ color: '#888888', fontSize: '12px', marginTop: '10px' }}>
                            This link will expire in 14 days
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ backgroundColor: '#2a0a0a', padding: '15px 30px 30px 30px', textAlign: 'center' as const }}>
                      <p style={{ color: '#aa8888', fontSize: '11px', lineHeight: 1.6, margin: 0 }}>
                        {emailFooter}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                <span className="font-medium">Subject:</span>
                <span>{emailSubject}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
