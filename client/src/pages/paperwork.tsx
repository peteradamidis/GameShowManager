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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { 
  Search, 
  Mail, 
  CheckCircle, 
  Clock, 
  FileCheck, 
  XCircle, 
  Send,
  Calendar,
  History,
  ClipboardCheck,
  AlertCircle,
  FileText
} from "lucide-react";
import { format } from "date-fns";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue,
  SelectGroup 
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Filter } from "lucide-react";

export default function PaperworkTracker() {
  const [searchName, setSearchName] = useState("");
  const [paperworkStatusFilter, setPaperworkStatusFilter] = useState<"all" | "ready_to_send" | "awaiting_return" | "complete" | "new_only">("all");
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("all");
  const [selectedAssignments, setSelectedAssignments] = useState<Set<number>>(new Set());
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [emailTemplate, setEmailTemplate] = useState("Standard paperwork request");
  const [viewMode, setViewMode] = useState<"all" | "declined">("all");
  const { toast } = useToast();

  // Queries
  const { data: assignments = [], isLoading: isLoadingAssignments } = useQuery<any[]>({
    queryKey: ["/api/assignments"],
  });

  const { data: recordDays = [], isLoading: isLoadingRecordDays } = useQuery<any[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: canceledAssignments = [], isLoading: isLoadingCanceled } = useQuery<any[]>({
    queryKey: ["/api/assignments/canceled"],
  });

  const { data: standbyData = [], isLoading: isLoadingStandbys } = useQuery<any[]>({
    queryKey: ["/api/standbys"],
  });

  const { data: adobeConfig } = useQuery<any>({
    queryKey: ["/api/adobe-sign/config"],
  });

  // Query for returning contestants history
  const { data: returningContestantsHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/contestants/returning-history"],
  });

  // Map returning history by contestant ID for easy lookup
  const returningContestantsMap = useMemo(() => {
    const map: Record<number, any[]> = {};
    returningContestantsHistory.forEach(item => {
      if (!map[item.contestantId]) {
        map[item.contestantId] = [];
      }
      map[item.contestantId].push({
        date: format(new Date(item.recordDayDate), "d MMM yyyy"),
        label: item.seatLabel || "Standby",
        type: item.type
      });
    });
    return map;
  }, [returningContestantsHistory]);

  // Mutations
  const updatePaperworkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/assignments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
    },
  });

  const updateCanceledPaperworkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/assignments/canceled/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments/canceled"] });
    },
  });

  const standbyPaperworkMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/standbys/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/standbys"] });
    },
  });

  const bulkUpdatePaperworkMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/paperwork/bulk-update", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/standbys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments/canceled"] });
      toast({
        title: "Bulk update complete",
        description: `Successfully updated paperwork for ${data.count} items.`,
      });
      setSelectedAssignments(new Set());
    },
  });

  // Sorting record days
  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  // Filtering assignments
  const filteredAssignments = useMemo(() => {
    return assignments.filter((item) => {
      const matchesSearch = !searchName || 
        item.contestant?.name?.toLowerCase().includes(searchName.toLowerCase()) ||
        item.contestant?.email?.toLowerCase().includes(searchName.toLowerCase());
      
      const matchesDay = selectedRecordDay === "all" || item.recordDayId === parseInt(selectedRecordDay);
      
      let matchesPaperworkStatus = true;
      if (paperworkStatusFilter === "ready_to_send") {
        matchesPaperworkStatus = !item.paperworkSent;
      } else if (paperworkStatusFilter === "awaiting_return") {
        matchesPaperworkStatus = !!item.paperworkSent && !item.paperworkReceived;
      } else if (paperworkStatusFilter === "complete") {
        matchesPaperworkStatus = !!item.paperworkReceived;
      } else if (paperworkStatusFilter === "new_only") {
        matchesPaperworkStatus = !item.paperworkSent && !item.paperworkReceived;
      }

      return matchesSearch && matchesDay && matchesPaperworkStatus;
    });
  }, [assignments, searchName, selectedRecordDay, paperworkStatusFilter]);

  const filteredCanceledAssignments = useMemo(() => {
    return canceledAssignments.filter((item) => {
      const matchesSearch = !searchName || 
        item.contestant?.name?.toLowerCase().includes(searchName.toLowerCase()) ||
        item.contestant?.email?.toLowerCase().includes(searchName.toLowerCase());
      
      const matchesDay = selectedRecordDay === "all" || item.recordDayId === parseInt(selectedRecordDay);
      
      return matchesSearch && matchesDay;
    });
  }, [canceledAssignments, searchName, selectedRecordDay]);

  const handleCheckboxChange = (item: any, field: string, value: boolean) => {
    const timestamp = value ? new Date().toISOString() : null;
    updatePaperworkMutation.mutate({
      id: item.id,
      data: { [field]: timestamp }
    });
  };

  const handleCanceledPaperworkCheckbox = (item: any, field: string, value: boolean) => {
    const timestamp = value ? new Date().toISOString() : null;
    updateCanceledPaperworkMutation.mutate({
      id: item.id,
      data: { [field]: timestamp }
    });
  };

  const handleStandbyPaperworkCheckbox = (standby: any, field: string, value: boolean) => {
    const timestamp = value ? new Date().toISOString() : null;
    standbyPaperworkMutation.mutate({
      id: standby.id,
      data: { [field]: timestamp }
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set([
        ...filteredAssignments.map(a => a.id),
        ...standbyData.map(s => s.id)
      ]);
      setSelectedAssignments(allIds);
    } else {
      setSelectedAssignments(new Set());
    }
  };

  const selectedWithEmail = useMemo(() => {
    const selectedItems = [];
    
    filteredAssignments.forEach(a => {
      if (selectedAssignments.has(a.id) && a.contestant?.email) {
        selectedItems.push({
          id: a.id,
          type: 'assignment',
          name: a.contestant.name,
          email: a.contestant.email
        });
      }
    });

    standbyData.forEach(s => {
      if (selectedAssignments.has(s.id) && s.contestant?.email) {
        selectedItems.push({
          id: s.id,
          type: 'standby',
          name: s.contestant.name,
          email: s.contestant.email
        });
      }
    });

    return selectedItems;
  }, [selectedAssignments, filteredAssignments, standbyData]);

  const handleSendEmails = () => {
    if (selectedWithEmail.length === 0) return;
    
    bulkUpdatePaperworkMutation.mutate({
      assignmentIds: selectedWithEmail.filter(i => i.type === 'assignment').map(i => i.id),
      standbyIds: selectedWithEmail.filter(i => i.type === 'standby').map(i => i.id),
      field: 'paperworkSent',
      value: new Date().toISOString()
    });
    
    setSendEmailDialogOpen(false);
  };

  const handleMarkReceived = () => {
    if (selectedAssignments.size === 0) return;
    
    bulkUpdatePaperworkMutation.mutate({
      assignmentIds: Array.from(selectedAssignments).filter(id => filteredAssignments.some(a => a.id === id)),
      standbyIds: Array.from(selectedAssignments).filter(id => standbyData.some(s => s.id === id)),
      field: 'paperworkReceived',
      value: new Date().toISOString()
    });
  };

  const isLoading = isLoadingAssignments || isLoadingRecordDays || isLoadingCanceled || isLoadingStandbys;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3-xl font-bold tracking-tight">Paperwork Tracker</h1>
          <p className="text-muted-foreground">
            Manage contestant paperwork status and track returns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={() => queryClient.invalidateQueries()}
            className="flex items-center gap-2"
          >
            <History className="h-4 w-4" />
            Refresh
          </Button>
          <Button 
            disabled={selectedAssignments.size === 0}
            onClick={() => setSendEmailDialogOpen(true)}
            className="bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            Send Paperwork ({selectedAssignments.size})
          </Button>
          <Button 
            variant="outline"
            disabled={selectedAssignments.size === 0}
            onClick={handleMarkReceived}
            className="flex items-center gap-2 border-teal-600 text-teal-600 hover:bg-teal-50"
          >
            <ClipboardCheck className="h-4 w-4" />
            Mark Received
          </Button>
        </div>
      </div>

      <Tabs defaultValue="tracker" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tracker" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Tracking Sheet
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Integration Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tracker" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name or email..."
                className="pl-8"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
              />
            </div>
            
            <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
              <SelectTrigger>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All Record Days" />
                </div>
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

            <Select 
              value={paperworkStatusFilter} 
              onValueChange={(v: any) => setPaperworkStatusFilter(v)}
            >
              <SelectTrigger>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Paperwork Status" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new_only">New (Not Sent)</SelectItem>
                <SelectItem value="ready_to_send">Ready to Send</SelectItem>
                <SelectItem value="awaiting_return">Awaiting Return</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 p-1 bg-muted rounded-md h-10">
              <Button 
                variant={viewMode === "all" ? "secondary" : "ghost"} 
                className="flex-1 h-8 text-xs"
                onClick={() => setViewMode("all")}
              >
                All Active
              </Button>
              <Button 
                variant={viewMode === "declined" ? "secondary" : "ghost"} 
                className="flex-1 h-8 text-xs"
                onClick={() => setViewMode("declined")}
              >
                Declined
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Contestant Tracking</CardTitle>
                  <CardDescription>
                    {filteredAssignments.length + standbyData.length} total contestants matching filters
                  </CardDescription>
                </div>
                {selectedAssignments.size > 0 && (
                  <Badge variant="secondary" className="px-3 py-1">
                    {selectedAssignments.size} items selected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px] px-2">
                        <Checkbox 
                          checked={
                            (filteredAssignments.length + standbyData.length) > 0 && 
                            selectedAssignments.size === (filteredAssignments.length + standbyData.length)
                          }
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Contestant</TableHead>
                      <TableHead>Record Day</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Sent</TableHead>
                      <TableHead className="text-center">Received</TableHead>
                      <TableHead>Paperwork Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewMode === "all" && filteredAssignments.map((item) => (
                      <TableRow 
                        key={item.id}
                        className={`
                          ${item.paperworkReceived ? 'bg-teal-50/30 dark:bg-teal-900/10' : 
                            item.paperworkSent ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''}
                        `}
                        data-testid={`row-paperwork-assignment-${item.id}`}
                      >
                        <TableCell className="px-2">
                          <Checkbox
                            checked={selectedAssignments.has(item.id)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedAssignments);
                              if (checked === true) {
                                newSelected.add(item.id);
                              } else {
                                newSelected.delete(item.id);
                              }
                              setSelectedAssignments(newSelected);
                            }}
                            data-testid={`checkbox-paperwork-${item.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1">
                              <span className="font-medium">{item.contestant?.name || "Unknown"}</span>
                              {returningContestantsMap[item.contestantId] && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge 
                                      variant="outline" 
                                      className="h-4 px-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 text-[9px] font-bold cursor-help"
                                    >
                                      RTN
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    <p className="font-bold mb-1">Returning Contestant</p>
                                    <ul className="space-y-1">
                                      {returningContestantsMap[item.contestantId].map((h: any, i: number) => (
                                        <li key={i} className="flex gap-2 justify-between">
                                          <span>{h.date}:</span>
                                          <span className="font-medium">{h.label} ({h.type === 'standby' ? 'Standby' : 'Seated'})</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">{item.contestant?.id ? `#${item.contestant.id}` : ""}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {item.recordDay ? format(new Date(item.recordDay.date), "d MMM yyyy") : "N/A"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.blockNumber != null && item.blockNumber > 0 ? (
                            <Badge variant="outline" className="bg-muted/50 border-muted-foreground/20">
                              Block {item.blockNumber} - {item.seatLabel}
                            </Badge>
                          ) : item.blockNumber === 0 ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                              To Seat - {item.seatLabel}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell 
                          className="text-sm select-all cursor-text"
                          title="Click to select, then Ctrl+C to copy"
                        >
                          {item.contestant?.email || "-"}
                        </TableCell>
                        <TableCell 
                          className="text-sm select-all cursor-text"
                          title="Click to select, then Ctrl+C to copy"
                        >
                          {item.contestant?.phone || "-"}
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
                            onCheckedChange={(checked) => handleCheckboxChange(item, "paperworkSent", checked === true)}
                            disabled={updatePaperworkMutation.isPending}
                            data-testid={`checkbox-sent-${item.id}`}
                          />
                          {item.paperworkSent && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paperworkSent), "d MMM")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!item.paperworkReceived}
                            onCheckedChange={(checked) => handleCheckboxChange(item, "paperworkReceived", checked === true)}
                            disabled={!item.paperworkSent || updatePaperworkMutation.isPending}
                            data-testid={`checkbox-received-${item.id}`}
                          />
                          {item.paperworkReceived && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paperworkReceived), "d MMM")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
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
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* Standbys - only show in "all" view mode */}
                    {viewMode === "all" && standbyData
                      .filter(s => {
                        if (searchName) {
                          const searchLower = searchName.toLowerCase();
                          if (!s.contestant?.name?.toLowerCase().includes(searchLower) && 
                              !s.contestant?.email?.toLowerCase().includes(searchLower)) {
                            return false;
                          }
                        }
                        return true;
                      })
                      .map((standby) => (
                        <TableRow 
                          key={`standby-${standby.id}`}
                          className={`
                            ${standby.paperworkReceived ? 'bg-teal-50 dark:bg-teal-900/20' : 
                              standby.paperworkSent ? 'bg-amber-50 dark:bg-amber-900/10' : 
                              'bg-amber-50/50 dark:bg-amber-900/5'}
                          `}
                          data-testid={`row-paperwork-standby-${standby.id}`}
                        >
                          <TableCell className="px-2">
                            <Checkbox
                              checked={selectedAssignments.has(standby.id)}
                              onCheckedChange={(checked) => {
                                const newSelected = new Set(selectedAssignments);
                                if (checked === true) {
                                  newSelected.add(standby.id);
                                } else {
                                  newSelected.delete(standby.id);
                                }
                                setSelectedAssignments(newSelected);
                              }}
                              data-testid={`checkbox-paperwork-standby-${standby.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1">
                                <span className="font-medium">{standby.contestant?.name || "Unknown"}</span>
                                {returningContestantsMap[standby.contestantId] && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge 
                                        variant="outline" 
                                        className="h-4 px-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 text-[9px] font-bold cursor-help"
                                      >
                                        RTN
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs max-w-[200px]">
                                      <p className="font-bold mb-1">Returning Contestant</p>
                                      <ul className="space-y-1">
                                        {returningContestantsMap[standby.contestantId].map((h: any, i: number) => (
                                          <li key={i} className="flex gap-2 justify-between">
                                            <span>{h.date}:</span>
                                            <span className="font-medium">{h.label} ({h.type === 'standby' ? 'Standby' : 'Seated'})</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <Badge className="w-fit text-[10px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 mt-1">
                                Standby #{standby.priority || '-'}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              {standby.recordDay ? format(new Date(standby.recordDay.date), "d MMM yyyy") : "N/A"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700">
                              Standby
                            </Badge>
                          </TableCell>
                          <TableCell 
                            className="text-sm select-all cursor-text"
                            title="Click to select, then Ctrl+C to copy"
                          >
                            {standby.contestant?.email || "-"}
                          </TableCell>
                          <TableCell 
                            className="text-sm select-all cursor-text"
                            title="Click to select, then Ctrl+C to copy"
                          >
                            {standby.contestant?.phone || "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            {standby.confirmedRsvp ? (
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
                              checked={!!standby.paperworkSent}
                              onCheckedChange={(checked) => handleStandbyPaperworkCheckbox(standby, "paperworkSent", checked === true)}
                              data-testid={`checkbox-sent-standby-${standby.id}`}
                            />
                            {standby.paperworkSent && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(standby.paperworkSent), "d MMM")}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={!!standby.paperworkReceived}
                              onCheckedChange={(checked) => handleStandbyPaperworkCheckbox(standby, "paperworkReceived", checked === true)}
                              disabled={!standby.paperworkSent}
                              data-testid={`checkbox-received-standby-${standby.id}`}
                            />
                            {standby.paperworkReceived && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {format(new Date(standby.paperworkReceived), "d MMM")}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1 items-start">
                              {standby.paperworkReceived ? (
                                <Badge className="bg-teal-600 text-white dark:bg-teal-600">
                                  <FileCheck className="h-3 w-3 mr-1" />
                                  Complete
                                </Badge>
                              ) : standby.paperworkSent ? (
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
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}

                    {/* Rescheduled/Declined contestants from canceled assignments */}
                    {(viewMode === "declined") && filteredCanceledAssignments.map((item) => (
                      <TableRow 
                        key={`canceled-${item.id}`}
                        className="bg-red-50 dark:bg-red-950/20"
                        data-testid={`row-canceled-paperwork-${item.id}`}
                      >
                        <TableCell className="px-2">
                          <Checkbox
                            checked={selectedAssignments.has(item.id)}
                            onCheckedChange={(checked) => {
                              const newSelected = new Set(selectedAssignments);
                              if (checked === true) {
                                newSelected.add(item.id);
                              } else {
                                newSelected.delete(item.id);
                              }
                              setSelectedAssignments(newSelected);
                            }}
                            data-testid={`checkbox-paperwork-canceled-${item.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1">
                              <span className="font-medium">{item.contestant?.name || "Unknown"}</span>
                              {returningContestantsMap[item.contestantId] && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge 
                                      variant="outline" 
                                      className="h-4 px-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 text-[9px] font-bold cursor-help"
                                    >
                                      RTN
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    <p className="font-bold mb-1">Returning Contestant</p>
                                    <ul className="space-y-1">
                                      {returningContestantsMap[item.contestantId].map((h: any, i: number) => (
                                        <li key={i} className="flex gap-2 justify-between">
                                          <span>{h.date}:</span>
                                          <span className="font-medium">{h.label} ({h.type === 'standby' ? 'Standby' : 'Seated'})</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <Badge variant="outline" className="w-fit text-[10px] px-1 py-0 border-amber-500 text-amber-600 mt-1">
                              Reschedule
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
                            {item.recordDay ? format(new Date(item.recordDay.date), "d MMM yyyy") : "N/A"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.blockNumber != null && item.blockNumber > 0 ? (
                            <Badge className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700">
                              Block {item.blockNumber} - {item.seatLabel}
                            </Badge>
                          ) : item.blockNumber === 0 ? (
                            <Badge className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-red-700">
                              To Seat - {item.seatLabel}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell 
                          className="text-sm select-all cursor-text"
                          title="Click to select, then Ctrl+C to copy"
                        >
                          {item.contestant?.email || "-"}
                        </TableCell>
                        <TableCell 
                          className="text-sm select-all cursor-text"
                          title="Click to select, then Ctrl+C to copy"
                        >
                          {item.contestant?.phone || "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            Declined
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!item.paperworkSent}
                            onCheckedChange={(checked) => handleCanceledPaperworkCheckbox(item, "paperworkSent", checked === true)}
                            disabled={updateCanceledPaperworkMutation.isPending}
                            data-testid={`checkbox-canceled-sent-${item.id}`}
                          />
                          {item.paperworkSent && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paperworkSent), "d MMM")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={!!item.paperworkReceived}
                            onCheckedChange={(checked) => handleCanceledPaperworkCheckbox(item, "paperworkReceived", checked === true)}
                            disabled={!item.paperworkSent || updateCanceledPaperworkMutation.isPending}
                            data-testid={`checkbox-canceled-received-${item.id}`}
                          />
                          {item.paperworkReceived && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paperworkReceived), "d MMM")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
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
                              <Badge variant="outline" className="text-muted-foreground">
                                <Send className="h-3 w-3 mr-1" />
                                Not Sent
                              </Badge>
                            )}
                          </div>
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
          <div className="p-8 text-center border-2 border-dashed rounded-lg">
            <Send className="h-8 w-8 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Adobe Sign Integration</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Adobe Sign integration settings are available for administrators.
            </p>
          </div>
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
              Send paperwork email to {selectedWithEmail.length} contestants
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email Template</Label>
              <Select value={emailTemplate} onValueChange={setEmailTemplate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Standard paperwork request">Standard paperwork request</SelectItem>
                  <SelectItem value="Urgent reminder">Urgent reminder</SelectItem>
                  <SelectItem value="Returning contestant update">Returning contestant update</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Selected Recipients</Label>
              <ScrollArea className="h-[200px] border rounded-md p-2">
                <div className="space-y-2">
                  {selectedWithEmail.map((item) => (
                    <div key={`${item.type}-${item.id}`} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded-md">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        <Badge variant="outline" className="text-[10px] h-4">
                          {item.type}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground">{item.email}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {!adobeConfig?.clientId && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-md text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>
                  Adobe Sign is not configured. Emails will be marked as sent but no actual paperwork link will be generated.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendEmailDialogOpen(false)}>Cancel</Button>
            <Button 
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={handleSendEmails}
              disabled={bulkUpdatePaperworkMutation.isPending}
            >
              {bulkUpdatePaperworkMutation.isPending ? "Sending..." : "Send Paperwork Emails"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
