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
import { Mail, Trash2, UserPlus, Clock, CheckCircle2, XCircle, Send, Calendar, ArrowRightLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
}

interface StandbyAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  status: string;
  standbyEmailSent: string | null;
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

export default function StandbysPage() {
  const { toast } = useToast();
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>("");
  const [selectedStandbys, setSelectedStandbys] = useState<string[]>([]);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  // Fetch record days
  const { data: recordDays = [], isLoading: recordDaysLoading } = useQuery<RecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  // Fetch all standbys
  const { data: allStandbys = [], isLoading: standbysLoading } = useQuery<StandbyAssignment[]>({
    queryKey: ['/api/standbys'],
  });

  // Filter standbys by selected record day
  const standbysForRecordDay = useMemo(() => {
    if (!selectedRecordDayId) return [];
    return allStandbys.filter(s => s.recordDayId === selectedRecordDayId);
  }, [allStandbys, selectedRecordDayId]);

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
      return apiRequest('POST', '/api/standbys/preview-emails', { standbyIds });
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
                    Standbys for {selectedRecordDay ? formatDate(selectedRecordDay.date) : 'Selected Day'}
                  </CardTitle>
                  <CardDescription>
                    {standbysForRecordDay.length} standby contestant{standbysForRecordDay.length !== 1 ? 's' : ''}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {selectedStandbys.length > 0 && (
                    <Button 
                      onClick={handlePreviewEmails}
                      disabled={previewEmailsMutation.isPending}
                      data-testid="button-preview-emails"
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Send Booking Emails ({selectedStandbys.length})
                    </Button>
                  )}
                </div>
              </div>
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
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedStandbys.length === standbysForRecordDay.length && standbysForRecordDay.length > 0}
                          onCheckedChange={handleSelectAll}
                          data-testid="checkbox-select-all-standbys"
                        />
                      </TableHead>
                      <TableHead className="w-16">Photo</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned Seat</TableHead>
                      <TableHead>Email Sent</TableHead>
                      <TableHead>Reschedule</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {standbysForRecordDay.map(standby => (
                      <TableRow key={standby.id} data-testid={`row-standby-${standby.id}`}>
                        <TableCell>
                          <Checkbox
                            checked={selectedStandbys.includes(standby.id)}
                            onCheckedChange={() => handleSelectStandby(standby.id)}
                            data-testid={`checkbox-standby-${standby.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Avatar className="h-10 w-10">
                            {standby.contestant.photoUrl && (
                              <AvatarImage src={standby.contestant.photoUrl} alt={standby.contestant.name} />
                            )}
                            <AvatarFallback>
                              {standby.contestant.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell className="font-medium">{standby.contestant.name}</TableCell>
                        <TableCell>
                          {standby.contestant.auditionRating ? (
                            <span className={`font-semibold ${
                              standby.contestant.auditionRating === 'A+' ? 'text-emerald-600' :
                              standby.contestant.auditionRating === 'A' ? 'text-green-600' :
                              standby.contestant.auditionRating === 'B+' ? 'text-amber-600' :
                              standby.contestant.auditionRating === 'B' ? 'text-orange-600' :
                              standby.contestant.auditionRating === 'C' ? 'text-red-500' : ''
                            }`}>
                              {standby.contestant.auditionRating}
                            </span>
                          ) : "-"}
                        </TableCell>
                        <TableCell>{standby.contestant.gender}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {standby.contestant.email || "-"}
                        </TableCell>
                        <TableCell className="space-x-2 flex items-center flex-wrap gap-2">
                          <StatusBadge status={standby.contestant.availabilityStatus} />
                          <Badge variant="outline" className="border-yellow-300 bg-yellow-500/20 text-yellow-800 dark:border-yellow-700 dark:text-yellow-400">
                            Standby
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {standby.assignedToSeat ? (
                            <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-200">
                              {standby.assignedToSeat}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {standby.standbyEmailSent 
                            ? new Date(standby.standbyEmailSent).toLocaleDateString('en-AU')
                            : "-"
                          }
                        </TableCell>
                        <TableCell>
                          {standby.movedToReschedule ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge 
                                  variant="outline" 
                                  className="bg-green-500/10 text-green-700 border-green-200 cursor-help"
                                >
                                  Moved to Reschedule
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Added to reschedule tab on {standby.movedToRescheduleAt 
                                  ? new Date(standby.movedToRescheduleAt).toLocaleDateString('en-AU')
                                  : 'N/A'}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => moveToRescheduleMutation.mutate(standby.id)}
                              disabled={moveToRescheduleMutation.isPending}
                              className="h-7 text-xs"
                              data-testid={`button-move-reschedule-${standby.id}`}
                            >
                              <ArrowRightLeft className="h-3 w-3 mr-1" />
                              Move to Reschedule
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteStandbyMutation.mutate(standby.id)}
                            disabled={deleteStandbyMutation.isPending}
                            data-testid={`button-delete-standby-${standby.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
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
        <DialogContent className="max-w-lg" data-testid="dialog-email-preview">
          <DialogHeader>
            <DialogTitle>Send Standby Booking Emails</DialogTitle>
            <DialogDescription>
              Review recipients before sending standby booking confirmation emails.
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
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

              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-1">Email will include:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Confirmation that they are a STANDBY (not guaranteed seat)</li>
                  <li>Information about fast-track if not seated</li>
                  <li>Link to confirm or decline</li>
                </ul>
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
    </div>
  );
}
