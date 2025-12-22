import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Clock
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

export default function Paperwork() {
  const { toast } = useToast();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("all");
  const [searchName, setSearchName] = useState("");
  const [activeTab, setActiveTab] = useState("paperwork");

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const paperworkUrl = selectedRecordDay === "all" 
    ? "/api/paperwork" 
    : `/api/paperwork?recordDayId=${selectedRecordDay}`;
    
  const { data: paperworkData = [], isLoading: loadingPaperwork, refetch: refetchPaperwork } = useQuery<PaperworkAssignment[]>({
    queryKey: [paperworkUrl],
  });

  const { data: adobeConfig } = useQuery<AdobeSignConfig>({
    queryKey: ["/api/adobe-sign-smtp/config"],
  });

  const invalidatePaperworkQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/paperwork');
      },
    });
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

  const filteredData = paperworkData.filter((item) => {
    if (!searchName) return true;
    return item.contestant?.name?.toLowerCase().includes(searchName.toLowerCase());
  });

  const pendingSent = filteredData.filter(item => !item.paperworkSent);
  const pendingReceived = filteredData.filter(item => item.paperworkSent && !item.paperworkReceived);
  const completed = filteredData.filter(item => item.paperworkSent && item.paperworkReceived);

  const sortedRecordDays = [...recordDays].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="h-8 w-8 text-orange-600" />
            Paperwork Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Track and manage paperwork for confirmed contestants
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
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

        <TabsContent value="paperwork" className="space-y-4">
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-orange-400" />
                  Pending Send
                </CardTitle>
                <CardDescription>Awaiting paperwork to be sent</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-500" data-testid="text-pending-send-count">
                  {pendingSent.length}
                </p>
              </CardContent>
            </Card>

            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  Pending Return
                </CardTitle>
                <CardDescription>Awaiting paperwork return</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-600" data-testid="text-pending-return-count">
                  {pendingReceived.length}
                </p>
              </CardContent>
            </Card>

            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-orange-700 dark:text-orange-400" />
                  Completed
                </CardTitle>
                <CardDescription>Paperwork received and logged</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-700 dark:text-orange-400" data-testid="text-completed-count">
                  {completed.length}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Confirmed Contestants ({filteredData.length})
              </CardTitle>
              <CardDescription>
                Contestants who have confirmed their attendance and need paperwork
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPaperwork ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No confirmed contestants found</p>
                  <p className="text-sm">Contestants appear here after they confirm their booking</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-orange-100 dark:bg-orange-900/20">
                      <TableHead className="font-semibold">Name</TableHead>
                      <TableHead className="font-semibold">Record Day</TableHead>
                      <TableHead className="font-semibold">Seat</TableHead>
                      <TableHead className="font-semibold">Email</TableHead>
                      <TableHead className="font-semibold">Confirmed At</TableHead>
                      <TableHead className="font-semibold text-center">Paperwork Sent</TableHead>
                      <TableHead className="font-semibold text-center">Paperwork Received</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.map((item) => (
                      <TableRow 
                        key={item.id} 
                        className={`
                          ${item.paperworkReceived ? 'bg-orange-100/50 dark:bg-orange-900/20' : 
                            item.paperworkSent ? 'bg-orange-50 dark:bg-orange-900/10' : ''}
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
                        <TableCell className="text-sm">
                          {item.contestant?.email || "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.confirmedRsvp ? format(new Date(item.confirmedRsvp), "MMM d, h:mm a") : "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!item.paperworkSent}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                markSentMutation.mutate(item.id);
                              } else {
                                clearSentMutation.mutate(item.id);
                              }
                            }}
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
                            onCheckedChange={(checked) => {
                              if (checked) {
                                markReceivedMutation.mutate(item.id);
                              } else {
                                clearReceivedMutation.mutate(item.id);
                              }
                            }}
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
                            <Badge className="bg-orange-700 text-white dark:bg-orange-600 dark:text-white">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Complete
                            </Badge>
                          ) : item.paperworkSent ? (
                            <Badge className="bg-orange-500 text-white dark:bg-orange-500 dark:text-white">
                              <Clock className="h-3 w-3 mr-1" />
                              Awaiting Return
                            </Badge>
                          ) : (
                            <Badge className="bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                              <Send className="h-3 w-3 mr-1" />
                              Ready to Send
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
