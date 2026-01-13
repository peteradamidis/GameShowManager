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
import { Mail, Users, CheckCircle, Clock, XCircle, Send, RefreshCw, Search, Calendar, BarChart3, Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRef } from "react";
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
  available: number;
  notAvailable: number;
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
  const [sendDialogSearch, setSendDialogSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailHeadline, setEmailHeadline] = useState(DEFAULT_EMAIL_HEADLINE);
  const [emailIntro, setEmailIntro] = useState(DEFAULT_EMAIL_INTRO);
  const [emailInstructions, setEmailInstructions] = useState(DEFAULT_EMAIL_INSTRUCTIONS);
  const [emailButtonText, setEmailButtonText] = useState(DEFAULT_EMAIL_BUTTON_TEXT);
  const [emailFooter, setEmailFooter] = useState(DEFAULT_EMAIL_FOOTER);
  
  // Import functionality
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResults, setImportResults] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Filter contestants with emails for the send dialog (with search)
  const contestantsWithEmail = contestants.filter(c => c.email);
  const filteredContestantsForSend = contestantsWithEmail.filter(c =>
    sendDialogSearch === "" ||
    c.name.toLowerCase().includes(sendDialogSearch.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(sendDialogSearch.toLowerCase()))
  );

  // Auto-select all record days when dialog opens
  useEffect(() => {
    if (sendDialogOpen && recordDays.length > 0 && selectedRecordDays.size === 0) {
      setSelectedRecordDays(new Set(recordDays.map(rd => rd.id)));
    }
  }, [sendDialogOpen, recordDays]);

  // Handle Excel file import
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportResults(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/availability/import', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setImportResults(data);
      
      // Refresh availability data
      queryClient.invalidateQueries({ queryKey: ["/api/availability/stats-by-day"] });
      queryClient.invalidateQueries({ queryKey: ["/api/availability/tokens"] });
      queryClient.invalidateQueries({ queryKey: ["/api/availability/status"] });

      toast({
        title: "Import Complete",
        description: data.message,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Availability Communications</h1>
          <p className="text-muted-foreground mt-1">
            Send availability checks and track contestant responses
          </p>
        </div>
        <div className="flex gap-2">
          {/* Import from Excel button */}
          <Dialog open={importDialogOpen} onOpenChange={(open) => {
            setImportDialogOpen(open);
            if (!open) setImportResults(null);
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-responses">
                <Upload className="w-4 h-4 mr-2" />
                Import Responses
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import Availability Responses</DialogTitle>
                <DialogDescription>
                  Upload an Excel file exported from Microsoft Forms to import availability responses.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {!importResults ? (
                  <>
                    <div className="border-2 border-dashed rounded-lg p-8 text-center">
                      <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-4">
                        Select your Microsoft Forms Excel export file
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileImport}
                        className="hidden"
                        data-testid="input-import-file"
                      />
                      <Button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                        data-testid="button-select-file"
                      >
                        {isImporting ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Select File
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4">
                      <h4 className="font-medium mb-2">Expected Format</h4>
                      <p className="text-sm text-muted-foreground mb-2">
                        The Excel file should contain columns for:
                      </p>
                      <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                        <li><strong>Email</strong> or <strong>Name</strong> - to identify the contestant</li>
                        <li><strong>Record Day columns</strong> - with values like "Yes", "No", or "Maybe"</li>
                      </ul>
                      <p className="text-sm text-muted-foreground mt-2">
                        Columns with dates (e.g., "Jan 15" or "RX001") will be matched to record days.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold">{importResults.results?.totalRows || 0}</div>
                          <div className="text-sm text-muted-foreground">Total Rows</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-green-600">{importResults.results?.matched || 0}</div>
                          <div className="text-sm text-muted-foreground">Matched</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-blue-600">{importResults.results?.updated || 0}</div>
                          <div className="text-sm text-muted-foreground">Updated</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <div className="text-2xl font-bold text-orange-600">{importResults.results?.unmatched || 0}</div>
                          <div className="text-sm text-muted-foreground">Unmatched</div>
                        </CardContent>
                      </Card>
                    </div>

                    {importResults.results?.columnMappings && (
                      <div className="bg-muted/50 rounded-lg p-4">
                        <h4 className="font-medium mb-2">Column Mappings Detected</h4>
                        <div className="text-sm space-y-1">
                          <p><strong>Email Column:</strong> {importResults.results.columnMappings.email || 'Not found'}</p>
                          <p><strong>Name Column:</strong> {importResults.results.columnMappings.name || 'Not found'}</p>
                          <p><strong>Phone Column:</strong> {importResults.results.columnMappings.phone || 'Not found'}</p>
                          <p><strong>Record Days Matched:</strong> {importResults.results.columnMappings.recordDays?.length || 0}</p>
                        </div>
                      </div>
                    )}

                    {importResults.results?.errors?.length > 0 && (
                      <div className="border rounded-lg">
                        <div className="p-3 bg-orange-50 dark:bg-orange-950/20 border-b flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-orange-600" />
                          <span className="font-medium text-sm">Issues ({importResults.results.errors.length})</span>
                        </div>
                        <ScrollArea className="h-40">
                          <div className="p-2 space-y-1">
                            {importResults.results.errors.map((err: any, idx: number) => (
                              <div key={idx} className="text-sm p-2 bg-muted/50 rounded">
                                <span className="font-medium">Row {err.row}:</span> {err.reason}
                                {err.data?.email && <span className="text-muted-foreground ml-2">({err.data.email})</span>}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}

                    <DialogFooter>
                      <Button variant="outline" onClick={() => {
                        setImportResults(null);
                      }} data-testid="button-import-another">
                        Import Another File
                      </Button>
                      <Button onClick={() => setImportDialogOpen(false)} data-testid="button-close-import">
                        Done
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={sendDialogOpen} onOpenChange={(open) => {
            setSendDialogOpen(open);
            if (!open) {
              setSendDialogSearch("");
            }
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-send-checks">
                <Send className="w-4 h-4 mr-2" />
                Send Availability Checks
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Send Availability Checks</DialogTitle>
              <DialogDescription>
                Select contestants to send availability check emails
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Search and quick actions */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email..."
                    value={sendDialogSearch}
                    onChange={(e) => setSendDialogSearch(e.target.value)}
                    className="pl-8"
                    data-testid="input-search-contestants"
                  />
                </div>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => setSelectedContestants(new Set(filteredContestantsForSend.map(c => c.id)))}
                  data-testid="button-select-all-contestants"
                >
                  All
                </Button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={clearContestantSelection}
                  data-testid="button-clear-contestants"
                >
                  None
                </Button>
              </div>

              {/* Info badge */}
              {contestantsWithEmail.length < contestants.length && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>Showing {contestantsWithEmail.length} of {contestants.length} contestants (only those with email addresses)</span>
                </div>
              )}

              {/* Contestant list */}
              <ScrollArea className="h-[280px] border rounded-md">
                <div className="p-2 space-y-1">
                  {filteredContestantsForSend.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      {sendDialogSearch ? "No contestants match your search" : "No contestants with email addresses"}
                    </div>
                  ) : (
                    filteredContestantsForSend.map((contestant) => (
                      <div 
                        key={contestant.id} 
                        className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                          selectedContestants.has(contestant.id) 
                            ? 'bg-primary/10' 
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => toggleContestant(contestant.id)}
                      >
                        <Checkbox
                          id={`contestant-${contestant.id}`}
                          checked={selectedContestants.has(contestant.id)}
                          onCheckedChange={() => toggleContestant(contestant.id)}
                          data-testid={`checkbox-contestant-${contestant.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{contestant.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{contestant.email}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              {/* Selection count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {selectedContestants.size} selected
                </span>
                {selectedContestants.size > 0 && (
                  <Badge variant="secondary">{selectedContestants.size} email{selectedContestants.size !== 1 ? 's' : ''} will be sent</Badge>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setSendDialogOpen(false)} data-testid="button-cancel-send">
                Cancel
              </Button>
              <Button
                onClick={() => setConfirmSendOpen(true)}
                disabled={selectedContestants.size === 0}
                data-testid="button-confirm-send"
              >
                <Mail className="h-4 w-4 mr-2" />
                Send to {selectedContestants.size} Contestant{selectedContestants.size !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </DialogContent>
          </Dialog>
        </div>

        {/* Confirmation Preview Dialog */}
        <Dialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Confirm Send
              </DialogTitle>
              <DialogDescription>
                You're about to send availability check emails
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="bg-muted p-4 rounded-md">
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary">{selectedContestants?.size || 0}</div>
                  <div className="text-sm text-muted-foreground">contestant{(selectedContestants?.size || 0) !== 1 ? 's' : ''} will receive an email</div>
                </div>
              </div>

              {/* Recipient preview */}
              <div>
                <h4 className="text-sm font-medium mb-2">Recipients</h4>
                <ScrollArea className="h-[120px] border rounded-md">
                  <div className="p-2 space-y-1">
                    {contestants && Array.from(selectedContestants).map(contestantId => {
                      const contestant = contestants.find((c: any) => c.id === contestantId);
                      return (
                        <div key={contestantId} className="text-xs flex justify-between items-center py-1">
                          <span className="font-medium">{contestant?.name}</span>
                          <span className="text-muted-foreground truncate ml-2">{contestant?.email}</span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setConfirmSendOpen(false)} data-testid="button-cancel-confirm">
                Cancel
              </Button>
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending}
                data-testid="button-final-send"
              >
                {sendMutation.isPending ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Emails
                  </>
                )}
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
                          <span className="text-green-600">Available</span>
                        </TableHead>
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
                              {day.available}
                            </Badge>
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

      </Tabs>
    </div>
  );
}
