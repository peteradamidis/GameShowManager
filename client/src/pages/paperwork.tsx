import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Send, 
  CheckCircle, 
  XCircle, 
  Clock, 
  FileCheck, 
  Calendar,
  Mail,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  RecordDay, 
  SeatAssignment, 
  Contestant,
  StandbyAssignment,
  CanceledAssignment,
  AdobeSignConfig
} from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AssignmentWithContestant = SeatAssignment & {
  contestant?: Contestant;
  recordDay?: RecordDay;
};

type StandbyWithContestant = StandbyAssignment & {
  contestant?: Contestant;
  recordDay?: RecordDay;
};

type CanceledWithContestant = CanceledAssignment & {
  contestant?: Contestant;
  recordDay?: RecordDay;
};

export default function PaperworkTracker() {
  const { toast } = useToast();
  const [searchName, setSearchName] = useState("");
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("all");
  const [paperworkStatusFilter, setPaperworkStatusFilter] = useState<string>("all");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<number>>(new Set());
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "declined" | "standby">("all");

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  const { data: assignments = [] } = useQuery<AssignmentWithContestant[]>({
    queryKey: ["/api/paperwork/assignments", selectedRecordDay],
  });

  const { data: standbyData = [] } = useQuery<StandbyWithContestant[]>({
    queryKey: ["/api/paperwork/standbys", selectedRecordDay],
  });

  const { data: canceledAssignments = [] } = useQuery<CanceledWithContestant[]>({
    queryKey: ["/api/paperwork/canceled", selectedRecordDay],
  });

  const { data: returningHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/contestants/returning-history"],
  });

  const returningContestantsMap = useMemo(() => {
    const map: Record<number, any[]> = {};
    returningHistory.forEach(h => {
      if (!map[h.contestantId]) map[h.contestantId] = [];
      map[h.contestantId].push(h);
    });
    return map;
  }, [returningHistory]);

  const markSentMutation = useMutation({
    mutationFn: async (assignmentIds: number[]) => {
      return apiRequest("POST", "/api/paperwork/mark-sent", { assignmentIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paperwork"] });
      toast({ title: "Paperwork marked as sent" });
    }
  });

  const markReceivedMutation = useMutation({
    mutationFn: async (assignmentId: number) => {
      return apiRequest("POST", `/api/paperwork/mark-received/${assignmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paperwork"] });
      toast({ title: "Paperwork marked as received" });
    }
  });

  const clearReceivedMutation = useMutation({
    mutationFn: async (assignmentId: number) => {
      return apiRequest("POST", `/api/paperwork/clear-received/${assignmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paperwork"] });
      toast({ title: "Paperwork receipt cleared" });
    }
  });

  const standbyPaperworkMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number, field: string, value: boolean }) => {
      return apiRequest("PATCH", `/api/standby/${id}/paperwork`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paperwork"] });
      toast({ title: "Standby paperwork updated" });
    }
  });

  const updateCanceledPaperworkMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number, field: string, value: boolean }) => {
      return apiRequest("PATCH", `/api/paperwork/canceled/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/paperwork"] });
      toast({ title: "Canceled assignment paperwork updated" });
    }
  });

  const filteredAssignments = useMemo(() => {
    return assignments.filter(a => {
      if (searchName) {
        const searchLower = searchName.toLowerCase();
        if (!a.contestant?.name?.toLowerCase().includes(searchLower) && 
            !a.contestant?.email?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      if (paperworkStatusFilter !== "all") {
        if (paperworkStatusFilter === "ready_to_send" && a.paperworkSent) return false;
        if (paperworkStatusFilter === "awaiting_return" && (!a.paperworkSent || a.paperworkReceived)) return false;
        if (paperworkStatusFilter === "complete" && (!a.paperworkSent || !a.paperworkReceived)) return false;
        if (paperworkStatusFilter === "new_only" && (a.paperworkSent)) return false;
      }
      return true;
    });
  }, [assignments, searchName, paperworkStatusFilter]);

  const filteredStandbys = useMemo(() => {
    return standbyData.filter(s => {
      if (searchName) {
        const searchLower = searchName.toLowerCase();
        if (!s.contestant?.name?.toLowerCase().includes(searchLower) && 
            !s.contestant?.email?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      if (paperworkStatusFilter !== "all") {
        if (paperworkStatusFilter === "ready_to_send" && s.paperworkSent) return false;
        if (paperworkStatusFilter === "awaiting_return" && (!s.paperworkSent || s.paperworkReceived)) return false;
        if (paperworkStatusFilter === "complete" && (!s.paperworkSent || !s.paperworkReceived)) return false;
        if (paperworkStatusFilter === "new_only" && (s.paperworkSent)) return false;
      }
      return true;
    });
  }, [standbyData, searchName, paperworkStatusFilter]);

  const filteredCanceledAssignments = useMemo(() => {
    return canceledAssignments.filter(a => {
      if (searchName) {
        const searchLower = searchName.toLowerCase();
        if (!a.contestant?.name?.toLowerCase().includes(searchLower) && 
            !a.contestant?.email?.toLowerCase().includes(searchLower)) {
          return false;
        }
      }
      return true;
    });
  }, [canceledAssignments, searchName]);

  const toggleSelectAll = () => {
    if (selectedAssignments.size > 0) {
      setSelectedAssignments(new Set());
    } else {
      const allIds = new Set<number>();
      if (viewMode === "all" || viewMode === "declined") {
        filteredAssignments.forEach(a => allIds.add(a.id));
        filteredCanceledAssignments.forEach(a => allIds.add(a.id));
      }
      if (viewMode === "all" || viewMode === "standby") {
        filteredStandbys.forEach(s => allIds.add(s.id));
      }
      setSelectedAssignments(allIds);
    }
  };

  const selectedWithEmail = useMemo(() => {
    const list: any[] = [];
    selectedAssignments.forEach(id => {
      const a = assignments.find(item => item.id === id);
      if (a?.contestant?.email) list.push(a);
      const s = standbyData.find(item => item.id === id);
      if (s?.contestant?.email) list.push(s);
      const c = canceledAssignments.find(item => item.id === id);
      if (c?.contestant?.email) list.push(c);
    });
    return list;
  }, [selectedAssignments, assignments, standbyData, canceledAssignments]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Paperwork Tracker</h1>
          <p className="text-muted-foreground">Manage contestant paperwork and Adobe Sign status</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/paperwork"] })}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button 
            onClick={() => setSendEmailDialogOpen(true)}
            disabled={selectedAssignments.size === 0}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            <Send className="h-4 w-4 mr-2" />
            Send Paperwork ({selectedAssignments.size})
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-end bg-card p-4 rounded-lg border">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">Search Contestants</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              className="pl-8"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
            />
          </div>
        </div>
        
        <div className="w-full md:w-48 space-y-2">
          <label className="text-sm font-medium">Record Day</label>
          <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
            <SelectTrigger>
              <SelectValue placeholder="All Record Days" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Record Days</SelectItem>
              {sortedRecordDays.map((day) => (
                <SelectItem key={day.id} value={day.id.toString()}>
                  {format(new Date(day.date), "d MMM yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full md:w-48 space-y-2">
          <label className="text-sm font-medium">Paperwork Status</label>
          <Select value={paperworkStatusFilter} onValueChange={setPaperworkStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="ready_to_send">Ready to Send</SelectItem>
              <SelectItem value="awaiting_return">Awaiting Return</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="new_only">New (Not Sent)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All Active</TabsTrigger>
          <TabsTrigger value="declined">Declined / Canceled</TabsTrigger>
          <TabsTrigger value="standby">Standbys</TabsTrigger>
        </TabsList>

        <TabsContent value={viewMode} className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>
                  {viewMode === "all" ? "Active Assignments" : viewMode === "declined" ? "Declined Assignments" : "Standby List"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 px-2 text-center">
                      <Checkbox onCheckedChange={toggleSelectAll} />
                    </TableHead>
                    <TableHead>Contestant</TableHead>
                    <TableHead>Record Day</TableHead>
                    <TableHead>Seat/Type</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-center">Sent</TableHead>
                    <TableHead className="text-center">Received</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(viewMode === "all" || viewMode === "declined") && filteredAssignments.map((assignment) => (
                    <TableRow key={`assignment-${assignment.id}`} className={assignment.paperworkReceived ? 'bg-teal-50 dark:bg-teal-900/20' : ''}>
                      <TableCell className="px-2 text-center">
                        <Checkbox 
                          checked={selectedAssignments.has(assignment.id)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedAssignments);
                            if (checked) newSelected.add(assignment.id);
                            else newSelected.delete(assignment.id);
                            setSelectedAssignments(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{assignment.contestant?.name}</span>
                          {returningContestantsMap[assignment.contestantId] && (
                            <Badge variant="outline" className="h-4 px-1 bg-amber-100 text-amber-700 text-[9px] font-bold">RTN</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {assignment.recordDay ? format(new Date(assignment.recordDay.date), "d MMM") : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {assignment.blockNumber === 0 ? "OS" : `B${assignment.blockNumber}`} - {assignment.seatLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[150px]">{assignment.contestant?.email}</TableCell>
                      <TableCell className="text-center">
                        <Checkbox checked={!!assignment.paperworkSent} onCheckedChange={() => markSentMutation.mutate([assignment.id])} />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox 
                          checked={!!assignment.paperworkReceived} 
                          onCheckedChange={(v) => v ? markReceivedMutation.mutate(assignment.id) : clearReceivedMutation.mutate(assignment.id)}
                          disabled={!assignment.paperworkSent}
                        />
                      </TableCell>
                      <TableCell>
                        {assignment.paperworkReceived ? <Badge className="bg-teal-600">Complete</Badge> : assignment.paperworkSent ? <Badge className="bg-amber-500">Awaiting</Badge> : <Badge variant="outline">Ready</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}

                  {(viewMode === "all" || viewMode === "standby") && filteredStandbys.map((standby) => (
                    <TableRow key={`standby-${standby.id}`} className="bg-purple-50/20">
                      <TableCell className="px-2 text-center">
                        <Checkbox 
                          checked={selectedAssignments.has(standby.id)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedAssignments);
                            if (checked) newSelected.add(standby.id);
                            else newSelected.delete(standby.id);
                            setSelectedAssignments(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{standby.contestant?.name}</span>
                          <Badge variant="outline" className="w-fit text-[9px] mt-1">STANDBY #{standby.priority}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {standby.recordDay ? format(new Date(standby.recordDay.date), "d MMM") : "-"}
                      </TableCell>
                      <TableCell><Badge>Standby</Badge></TableCell>
                      <TableCell className="text-xs">{standby.contestant?.email}</TableCell>
                      <TableCell className="text-center">
                        <Checkbox 
                          checked={!!standby.paperworkSent} 
                          onCheckedChange={(v) => standbyPaperworkMutation.mutate({ id: standby.id, field: "paperworkSent", value: v === true })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox 
                          checked={!!standby.paperworkReceived}
                          onCheckedChange={(v) => standbyPaperworkMutation.mutate({ id: standby.id, field: "paperworkReceived", value: v === true })}
                          disabled={!standby.paperworkSent}
                        />
                      </TableCell>
                      <TableCell>
                        {standby.paperworkReceived ? <Badge className="bg-teal-600">Complete</Badge> : standby.paperworkSent ? <Badge className="bg-amber-500">Awaiting</Badge> : <Badge variant="outline">Ready</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={sendEmailDialogOpen} onOpenChange={setSendEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Paperwork</DialogTitle>
            <DialogDescription>Mark {selectedWithEmail.length} contestants as having paperwork sent.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendEmailDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              markSentMutation.mutate(selectedWithEmail.map(i => i.id));
              setSendEmailDialogOpen(false);
              setSelectedAssignments(new Set());
            }}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
