import { useState, useEffect, useCallback } from "react";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
import { Switch } from "@/components/ui/switch";
import { 
  FileCheck2, 
  Plus, 
  Search,
  Calendar,
  Users,
  Trash2,
  Edit,
  Save,
  X,
  RefreshCw,
  Tv
} from "lucide-react";
import type { RecordDay, Contestant, PostRecordTracking } from "@shared/schema";

interface PostRecordWithDetails extends PostRecordTracking {
  contestant: Contestant | null;
  recordDay: RecordDay | null;
}

const POST_RECORD_STORAGE_KEY = 'post-record-state';

interface PostRecordState {
  selectedRecordDay: string;
  searchQuery: string;
  showTxSection: boolean;
}

export default function PostRecordPage() {
  const { toast } = useToast();
  
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(POST_RECORD_STORAGE_KEY);
      if (saved) {
        const state: PostRecordState = JSON.parse(saved);
        return state.selectedRecordDay || "all";
      }
    } catch {}
    return "all";
  });
  
  const [showTxSection, setShowTxSection] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(POST_RECORD_STORAGE_KEY);
      if (saved) {
        const state: PostRecordState = JSON.parse(saved);
        return state.showTxSection !== false; // Default to true
      }
    } catch {}
    return true;
  });
  
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedContestantId, setSelectedContestantId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<PostRecordTracking>>({});

  useEffect(() => {
    try {
      const state: PostRecordState = {
        selectedRecordDay,
        searchQuery,
        showTxSection,
      };
      localStorage.setItem(POST_RECORD_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save post-record state:", e);
    }
  }, [selectedRecordDay, searchQuery, showTxSection]);

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const buildPostRecordUrl = () => {
    const params = new URLSearchParams();
    if (selectedRecordDay !== "all") {
      params.append("recordDayId", selectedRecordDay);
    }
    const queryString = params.toString();
    return queryString ? `/api/post-record?${queryString}` : "/api/post-record";
  };

  const { data: postRecordData = [], isLoading, refetch } = useQuery<PostRecordWithDetails[]>({
    queryKey: ["/api/post-record", selectedRecordDay],
    queryFn: async () => {
      const response = await fetch(buildPostRecordUrl());
      if (!response.ok) throw new Error("Failed to fetch post-record data");
      return response.json();
    },
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ["/api/contestants"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { contestantId: string; recordDayId?: string }) => {
      const response = await apiRequest("POST", "/api/post-record", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-record"] });
      setAddDialogOpen(false);
      setSelectedContestantId("");
      toast({ title: "Added contestant to post-record tracking" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to add", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PostRecordTracking> }) => {
      const response = await apiRequest("PATCH", `/api/post-record/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-record"] });
      setEditingId(null);
      setEditData({});
      toast({ title: "Updated successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Update failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/post-record/${id}`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-record"] });
      toast({ title: "Entry removed" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Delete failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleCheckboxChange = useCallback((id: string, field: string, value: boolean) => {
    updateMutation.mutate({ id, data: { [field]: value } });
  }, [updateMutation]);

  const handleFieldChange = useCallback((id: string, field: string, value: string | number | boolean | null) => {
    updateMutation.mutate({ id, data: { [field]: value } });
  }, [updateMutation]);

  const startEditing = (item: PostRecordWithDetails) => {
    setEditingId(item.id);
    setEditData({
      caseNumber: item.caseNumber,
      caseAmount: item.caseAmount,
      prizeWon: item.prizeWon,
      amountWon: item.amountWon,
      notes: item.notes,
    });
  };

  const saveEditing = () => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: editData });
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData({});
  };

  const filteredData = postRecordData.filter((item) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.contestant?.name?.toLowerCase().includes(query) ||
      item.contestant?.email?.toLowerCase().includes(query) ||
      item.contestant?.phone?.toLowerCase().includes(query)
    );
  });

  const contestantsNotInTracking = contestants.filter(
    (c) => !postRecordData.some((p) => p.contestantId === c.id)
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-6 w-6 text-primary" />
              <div>
                <CardTitle>Post Record Tracking</CardTitle>
                <CardDescription>Track post-production paperwork and legal requirements</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                data-testid="button-refresh-post-record"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Refresh
              </Button>
              <Button
                onClick={() => setAddDialogOpen(true)}
                data-testid="button-add-post-record"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Entry
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="record-day-filter">Record Day</Label>
              <Select
                value={selectedRecordDay}
                onValueChange={setSelectedRecordDay}
              >
                <SelectTrigger className="w-48" data-testid="select-record-day">
                  <SelectValue placeholder="All Record Days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Record Days</SelectItem>
                  {recordDays.map((rd) => (
                    <SelectItem key={rd.id} value={rd.id}>
                      {format(new Date(rd.date), "MMM d, yyyy")}
                      {rd.rxNumber ? ` - ${rd.rxNumber}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64"
                data-testid="input-search-post-record"
              />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Tv className="h-4 w-4 text-yellow-600" />
              <Label htmlFor="tx-toggle" className="text-sm font-medium">TX</Label>
              <Switch
                id="tx-toggle"
                checked={showTxSection}
                onCheckedChange={setShowTxSection}
                data-testid="switch-tx-visibility"
              />
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center p-4">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          
          <ScrollArea className="w-full">
              <div className={showTxSection ? "min-w-[2600px]" : "min-w-[2200px]"}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead colSpan={3} className="text-center font-bold text-rose-800 dark:text-rose-200 bg-rose-100 dark:bg-rose-900/20 border-r-2">
                        RECORD
                      </TableHead>
                      {showTxSection && (
                        <TableHead colSpan={4} className="text-center font-bold text-yellow-800 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-900/20 border-r-2">
                          TX
                        </TableHead>
                      )}
                      <TableHead colSpan={11} className="text-center font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/20 border-r-2">
                        CONTESTANTS
                      </TableHead>
                      <TableHead colSpan={14} className="text-center font-bold text-blue-800 dark:text-blue-200 bg-blue-100 dark:bg-blue-900/20">
                        LEGALS
                      </TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                    <TableRow>
                      <TableHead className="font-semibold text-center bg-rose-50 dark:bg-rose-900/10 min-w-[90px]">RX DATE</TableHead>
                      <TableHead className="font-semibold text-center bg-rose-50 dark:bg-rose-900/10 min-w-[70px]">RX DAY</TableHead>
                      <TableHead className="font-semibold text-center bg-rose-50 dark:bg-rose-900/10 border-r-2 min-w-[80px]">RX EP NO.</TableHead>
                      {showTxSection && (
                        <>
                          <TableHead className="font-semibold text-center bg-yellow-50 dark:bg-yellow-900/10 min-w-[100px]">TX EP NUMBER</TableHead>
                          <TableHead className="font-semibold text-center bg-yellow-50 dark:bg-yellow-900/10 min-w-[90px]">TX EP DATE</TableHead>
                          <TableHead className="font-semibold text-center bg-yellow-50 dark:bg-yellow-900/10 min-w-[100px]">NOTIFIED OF TX?</TableHead>
                          <TableHead className="font-semibold text-center bg-yellow-50 dark:bg-yellow-900/10 border-r-2 min-w-[90px]">PHOTO SENT</TableHead>
                        </>
                      )}
                      <TableHead className="font-semibold min-w-[150px] sticky left-0 bg-background z-10">Name</TableHead>
                      <TableHead className="font-semibold text-center">Player</TableHead>
                      <TableHead className="font-semibold min-w-[120px]">Phone</TableHead>
                      <TableHead className="font-semibold min-w-[180px]">Email</TableHead>
                      <TableHead className="font-semibold text-center">Case No.</TableHead>
                      <TableHead className="font-semibold text-center">Case Amount</TableHead>
                      <TableHead className="font-semibold min-w-[100px] text-center bg-green-100 dark:bg-green-900/20">Prize Won</TableHead>
                      <TableHead className="font-semibold text-center bg-red-100 dark:bg-red-900/20">Bank Offer Taken?</TableHead>
                      <TableHead className="font-semibold text-center">Amount Won</TableHead>
                      <TableHead className="font-semibold min-w-[150px]">Notes</TableHead>
                      <TableHead className="font-semibold border-r-2">Record Day</TableHead>
                      <TableHead className="font-semibold text-center">Appearance Release</TableHead>
                      <TableHead className="font-semibold text-center">NED Signed</TableHead>
                      <TableHead className="font-semibold text-center">Disclosure Received</TableHead>
                      <TableHead className="font-semibold text-center">Returned Entry (Supplier)</TableHead>
                      <TableHead className="font-semibold text-center">Entry Sent (Contestant)</TableHead>
                      <TableHead className="font-semibold text-center">ESA Entry</TableHead>
                      <TableHead className="font-semibold text-center">AFP Confirm</TableHead>
                      <TableHead className="font-semibold text-center">AFP FYI Check</TableHead>
                      <TableHead className="font-semibold text-center">AFP Check Returned</TableHead>
                      <TableHead className="font-semibold text-center">AFP No.</TableHead>
                      <TableHead className="font-semibold text-center">AFP Batch No.</TableHead>
                      <TableHead className="font-semibold text-center">Idiwriter Check</TableHead>
                      <TableHead className="font-semibold text-center">Social Media Brief</TableHead>
                      <TableHead className="font-semibold text-center">Bankruptcy Check</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={showTxSection ? 33 : 29} className="h-24 text-center text-muted-foreground">
                          No entries found. Click "Add Entry" to add contestants to track.
                        </TableCell>
                      </TableRow>
                    ) : filteredData.map((item) => {
                      const isEditing = editingId === item.id;
                      return (
                        <TableRow 
                          key={item.id}
                          className={isEditing ? "bg-blue-50 dark:bg-blue-900/10" : ""}
                          data-testid={`row-post-record-${item.id}`}
                        >
                          {/* RECORD columns */}
                          <TableCell className="text-center text-xs bg-rose-50/50 dark:bg-rose-900/5">
                            {item.recordDay ? format(new Date(item.recordDay.date), "d-MMM-yy") : "-"}
                          </TableCell>
                          <TableCell className="text-center text-xs bg-rose-50/50 dark:bg-rose-900/5">
                            {item.recordDay?.rxNumber || "-"}
                          </TableCell>
                          <TableCell className="text-center bg-rose-50/50 dark:bg-rose-900/5 border-r-2">
                            <Input
                              value={item.rxEpNo || ""}
                              onChange={(e) => handleFieldChange(item.id, "rxEpNo", e.target.value)}
                              className="w-16 h-7 text-xs text-center"
                              placeholder="-"
                              data-testid={`input-rx-ep-no-${item.id}`}
                            />
                          </TableCell>
                          {/* TX columns */}
                          {showTxSection && (
                            <>
                              <TableCell className="text-center bg-yellow-50/50 dark:bg-yellow-900/5">
                                <Input
                                  value={item.txEpNumber || ""}
                                  onChange={(e) => handleFieldChange(item.id, "txEpNumber", e.target.value)}
                                  className="w-16 h-7 text-xs text-center"
                                  placeholder="-"
                                  data-testid={`input-tx-ep-number-${item.id}`}
                                />
                              </TableCell>
                              <TableCell className="text-center bg-yellow-50/50 dark:bg-yellow-900/5">
                                <Input
                                  type="date"
                                  value={item.txEpDate ? format(new Date(item.txEpDate), "yyyy-MM-dd") : ""}
                                  onChange={(e) => handleFieldChange(item.id, "txEpDate", e.target.value ? new Date(e.target.value).toISOString() : null)}
                                  className="w-28 h-7 text-xs"
                                  data-testid={`input-tx-ep-date-${item.id}`}
                                />
                              </TableCell>
                              <TableCell className="text-center bg-yellow-50/50 dark:bg-yellow-900/5">
                                <Checkbox
                                  checked={item.notifiedOfTx || false}
                                  onCheckedChange={(checked) => handleCheckboxChange(item.id, "notifiedOfTx", checked === true)}
                                  data-testid={`checkbox-notified-tx-${item.id}`}
                                />
                              </TableCell>
                              <TableCell className="text-center bg-yellow-50/50 dark:bg-yellow-900/5 border-r-2">
                                <Checkbox
                                  checked={item.photoSent || false}
                                  onCheckedChange={(checked) => handleCheckboxChange(item.id, "photoSent", checked === true)}
                                  data-testid={`checkbox-photo-sent-${item.id}`}
                                />
                              </TableCell>
                            </>
                          )}
                          {/* CONTESTANTS columns */}
                          <TableCell className="font-medium sticky left-0 bg-background z-10">
                            {item.contestant?.name || "Unknown"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.isPlayer || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "isPlayer", checked === true)}
                              data-testid={`checkbox-is-player-${item.id}`}
                            />
                          </TableCell>
                          <TableCell>{item.contestant?.phone || "-"}</TableCell>
                          <TableCell className="text-xs">{item.contestant?.email || "-"}</TableCell>
                          <TableCell className="text-center">
                            {isEditing ? (
                              <Input
                                value={editData.caseNumber || ""}
                                onChange={(e) => setEditData({ ...editData, caseNumber: e.target.value })}
                                className="w-16 h-7 text-xs"
                              />
                            ) : (
                              item.caseNumber || "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editData.caseAmount || ""}
                                onChange={(e) => setEditData({ ...editData, caseAmount: e.target.value ? parseInt(e.target.value) : undefined })}
                                className="w-20 h-7 text-xs"
                              />
                            ) : (
                              item.caseAmount ? `$${item.caseAmount.toLocaleString()}` : "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center bg-green-50 dark:bg-green-900/10">
                            {isEditing ? (
                              <Input
                                value={editData.prizeWon || ""}
                                onChange={(e) => setEditData({ ...editData, prizeWon: e.target.value })}
                                className="w-24 h-7 text-xs"
                              />
                            ) : (
                              item.prizeWon ? (
                                <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                  {item.prizeWon}
                                </Badge>
                              ) : "-"
                            )}
                          </TableCell>
                          <TableCell className="text-center bg-red-50 dark:bg-red-900/10">
                            <Select
                              value={item.bankOfferTaken === null ? "n/a" : item.bankOfferTaken ? "yes" : "no"}
                              onValueChange={(value) => handleFieldChange(item.id, "bankOfferTaken", value === "n/a" ? null : value === "yes")}
                            >
                              <SelectTrigger className="w-16 h-7 text-xs" data-testid={`select-bank-offer-${item.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="n/a">N/A</SelectItem>
                                <SelectItem value="yes">Yes</SelectItem>
                                <SelectItem value="no">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-center">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editData.amountWon || ""}
                                onChange={(e) => setEditData({ ...editData, amountWon: e.target.value ? parseInt(e.target.value) : undefined })}
                                className="w-24 h-7 text-xs"
                              />
                            ) : (
                              item.amountWon ? `$${item.amountWon.toLocaleString()}` : "-"
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                value={editData.notes || ""}
                                onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                                className="w-32 h-7 text-xs"
                              />
                            ) : (
                              <span className="text-xs">{item.notes || "-"}</span>
                            )}
                          </TableCell>
                          <TableCell className="border-r-2">
                            {item.recordDay ? (
                              <div className="flex items-center gap-1 text-xs">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                {format(new Date(item.recordDay.date), "MMM d")}
                              </div>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.appearanceReleaseSigned || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "appearanceReleaseSigned", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.nedSigned || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "nedSigned", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.disclosureDocumentReceived || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "disclosureDocumentReceived", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.returnedEntryBySupplier || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "returnedEntryBySupplier", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.entrySentByContestant || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "entrySentByContestant", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.paramountEntryContestant || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "paramountEntryContestant", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.afpConfirmation || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "afpConfirmation", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.afpFyiCheck || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "afpFyiCheck", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.afpCheckReturned || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "afpCheckReturned", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.afpNo || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "afpNo", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.afpBatchNo || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "afpBatchNo", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.idiwriterCheck || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "idiwriterCheck", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.socialMediaBrief || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "socialMediaBrief", checked === true)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={item.bankruptcyCheck || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "bankruptcyCheck", checked === true)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {isEditing ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={saveEditing}
                                    data-testid={`button-save-${item.id}`}
                                  >
                                    <Save className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={cancelEditing}
                                    data-testid={`button-cancel-${item.id}`}
                                  >
                                    <X className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => startEditing(item)}
                                    data-testid={`button-edit-${item.id}`}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => deleteMutation.mutate(item.id)}
                                    data-testid={`button-delete-${item.id}`}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{filteredData.length} entries</span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Post-Record Entry</DialogTitle>
            <DialogDescription>
              Select a contestant to add to post-record tracking
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Contestant</Label>
              <Select
                value={selectedContestantId}
                onValueChange={setSelectedContestantId}
              >
                <SelectTrigger data-testid="select-add-contestant">
                  <SelectValue placeholder="Select a contestant" />
                </SelectTrigger>
                <SelectContent>
                  {contestantsNotInTracking.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.email ? `(${c.email})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedRecordDay !== "all" && (
              <p className="text-sm text-muted-foreground">
                Will be added to record day: {recordDays.find(r => r.id === selectedRecordDay)?.date ? format(new Date(recordDays.find(r => r.id === selectedRecordDay)!.date), "MMM d, yyyy") : ""}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({
                contestantId: selectedContestantId,
                recordDayId: selectedRecordDay !== "all" ? selectedRecordDay : undefined,
              })}
              disabled={!selectedContestantId || createMutation.isPending}
              data-testid="button-confirm-add"
            >
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
