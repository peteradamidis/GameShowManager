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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { 
  FileCheck2, 
  Search,
  Users,
  RefreshCw,
  Tv,
  Trophy,
  Maximize2,
  Minimize2,
  Pencil,
  Save
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { RecordDay, Contestant, PostRecordTracking, SeatAssignment } from "@shared/schema";

interface PostRecordWithDetails extends PostRecordTracking {
  contestant: Contestant | null;
  recordDay: RecordDay | null;
  seatAssignment: SeatAssignment | null;
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Edit mode state - now applies to entire document instead of per-row
  const [isEditMode, setIsEditMode] = useState(false);
  
  // Local edit state to track changes while in edit mode
  const [editedValues, setEditedValues] = useState<Record<string, Record<string, any>>>({});
  
  // Confirmation dialog for unticking checkboxes
  const [confirmUncheckDialog, setConfirmUncheckDialog] = useState<{
    open: boolean;
    itemId: string;
    field: string;
    fieldLabel: string;
  }>({ open: false, itemId: "", field: "", fieldLabel: "" });

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

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PostRecordTracking> }) => {
      const response = await apiRequest("PATCH", `/api/post-record/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-record"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Update failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const importWinnersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/post-record/import-winners", {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-record"] });
      if (data.imported > 0) {
        toast({ 
          title: "Winners imported", 
          description: `Imported ${data.imported} winners. ${data.skipped > 0 ? `${data.skipped} already existed.` : ''}`
        });
      } else if (data.skipped > 0) {
        toast({ 
          title: "All winners already imported", 
          description: `${data.skipped} winners already exist in Post Record.`
        });
      } else {
        toast({ 
          title: "No winners to import", 
          description: "No contestants with winning money found."
        });
      }
    },
    onError: (error: Error) => {
      toast({ 
        title: "Import failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Field labels for checkbox confirmation dialog
  const checkboxFieldLabels: Record<string, string> = {
    notifiedOfTx: "Notified of TX",
    photoSent: "Photo Sent",
    appearanceReleaseSigned: "Appearance Release Signed",
    nedSigned: "Deed Signed",
    disclosureDocumentReceived: "Disclosure Received",
    returnedEntryBySupplier: "Gift Card Sent & Signed Accepted",
    entrySentByContestant: "Stat Dec",
    statementBySupplier: "Statement by Supplier",
    paramountEntryContestant: "ESA Entry",
    afpConfirmation: "AFP Confirm",
    afpFyiCheck: "100 Pts ID",
    afpCheckReturned: "AFP Batch No.",
    afpNo: "AFP No",
    afpBatchNo: "AFP Batch No",
    idiwriterCheck: "Honesty Check",
    socialMediaBrief: "Social Media Sweep",
    bankruptcyCheck: "Bankruptcy Check",
  };

  const handleCheckboxChange = useCallback((id: string, field: string, value: boolean) => {
    // If unchecking, show confirmation dialog
    if (!value) {
      setConfirmUncheckDialog({
        open: true,
        itemId: id,
        field,
        fieldLabel: checkboxFieldLabels[field] || field,
      });
    } else {
      // If checking, just update directly
      updateMutation.mutate({ id, data: { [field]: value } });
    }
  }, [updateMutation]);

  const confirmUncheck = useCallback(() => {
    if (confirmUncheckDialog.itemId && confirmUncheckDialog.field) {
      updateMutation.mutate({ 
        id: confirmUncheckDialog.itemId, 
        data: { [confirmUncheckDialog.field]: false } 
      });
    }
    setConfirmUncheckDialog({ open: false, itemId: "", field: "", fieldLabel: "" });
  }, [confirmUncheckDialog, updateMutation]);

  // Get a local edit value, falling back to server data
  const getEditValue = useCallback((itemId: string, field: string, defaultValue: any) => {
    if (editedValues[itemId] && field in editedValues[itemId]) {
      return editedValues[itemId][field];
    }
    return defaultValue;
  }, [editedValues]);

  // Set a local edit value
  const setEditValue = useCallback((itemId: string, field: string, value: any) => {
    setEditedValues(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value
      }
    }));
  }, []);

  // Save all edited values when exiting edit mode
  const saveAllChanges = useCallback(async () => {
    const entries = Object.entries(editedValues);
    if (entries.length === 0) {
      setIsEditMode(false);
      return;
    }

    // Save all changes, converting string values to proper types
    for (const [itemId, fields] of entries) {
      if (Object.keys(fields).length > 0) {
        // Convert string select values back to booleans for the API
        const apiData: Record<string, any> = { ...fields };
        
        // Convert spinTheWheelOverrideStr to spinTheWheelOverride boolean
        if ("spinTheWheelOverrideStr" in apiData) {
          const strVal = apiData.spinTheWheelOverrideStr;
          apiData.spinTheWheelOverride = strVal === "none" ? null : strVal === "yes";
          delete apiData.spinTheWheelOverrideStr;
        }
        
        // Convert bankOfferTakenStr to bankOfferTaken boolean
        if ("bankOfferTakenStr" in apiData) {
          const strVal = apiData.bankOfferTakenStr;
          apiData.bankOfferTaken = strVal === "n/a" ? null : strVal === "yes";
          delete apiData.bankOfferTakenStr;
        }
        
        // Convert txEpDateStr to ISO format for the API
        if ("txEpDateStr" in apiData) {
          const dateStr = apiData.txEpDateStr;
          apiData.txEpDate = dateStr ? new Date(dateStr).toISOString() : null;
          delete apiData.txEpDateStr;
        }
        
        await updateMutation.mutateAsync({ id: itemId, data: apiData });
      }
    }
    
    // Clear edit state and exit edit mode
    setEditedValues({});
    setIsEditMode(false);
    toast({ title: "Changes saved" });
  }, [editedValues, updateMutation, toast]);

  // Helper to get display value (override ?? source)
  const getDisplayValue = (item: PostRecordWithDetails, field: 'name' | 'phone' | 'email' | 'contestantType' | 'rxNumber' | 'spinTheWheel') => {
    switch (field) {
      case 'name':
        return item.nameOverride ?? item.contestant?.name ?? "";
      case 'phone':
        return item.phoneOverride ?? item.contestant?.phone ?? "";
      case 'email':
        return item.emailOverride ?? item.contestant?.email ?? "";
      case 'contestantType':
        return item.contestantTypeOverride ?? item.seatAssignment?.winningMoneyRole ?? "";
      case 'rxNumber':
        return item.rxNumberOverride ?? item.seatAssignment?.rxNumber ?? "";
      case 'spinTheWheel':
        if (item.spinTheWheelOverride !== null && item.spinTheWheelOverride !== undefined) {
          return item.spinTheWheelOverride ? "Yes" : "No";
        }
        return item.seatAssignment?.spinTheWheel === true ? "Yes" : item.seatAssignment?.spinTheWheel === false ? "No" : "-";
      default:
        return "";
    }
  };

  const filteredData = postRecordData
    .filter((item) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        item.contestant?.name?.toLowerCase().includes(query) ||
        item.contestant?.email?.toLowerCase().includes(query) ||
        item.contestant?.phone?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      // Sort by record day date first
      const dateA = a.recordDay?.date ? new Date(a.recordDay.date).getTime() : 0;
      const dateB = b.recordDay?.date ? new Date(b.recordDay.date).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      
      // Then sort by RX number
      const rxA = a.seatAssignment?.rxNumber || a.rxNumberOverride || "";
      const rxB = b.seatAssignment?.rxNumber || b.rxNumberOverride || "";
      return rxA.localeCompare(rxB, undefined, { numeric: true });
    });

  return (
    <div className={isFullscreen ? "fixed inset-0 flex flex-col p-2 bg-background gap-1 z-50" : "space-y-6"}>
      {/* Confirmation dialog for unticking checkboxes */}
      <AlertDialog open={confirmUncheckDialog.open} onOpenChange={(open) => !open && setConfirmUncheckDialog({ open: false, itemId: "", field: "", fieldLabel: "" })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Uncheck</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to uncheck "{confirmUncheckDialog.fieldLabel}"? This will mark it as incomplete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUncheck} data-testid="button-confirm-uncheck">
              Yes, Uncheck
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className={isFullscreen ? "flex flex-col flex-1 min-h-0" : ""}>
        <CardHeader className={isFullscreen ? "flex-shrink-0 py-2" : ""}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <FileCheck2 className={isFullscreen ? "h-5 w-5 text-primary" : "h-6 w-6 text-primary"} />
              <div>
                <CardTitle className={isFullscreen ? "text-lg" : ""}>Post Record Tracking</CardTitle>
                {!isFullscreen && (
                  <CardDescription>Track post-production paperwork and legal requirements</CardDescription>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isEditMode ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={saveAllChanges}
                  disabled={updateMutation.isPending}
                  data-testid="button-done-editing"
                >
                  <Save className="h-4 w-4 mr-1" />
                  {updateMutation.isPending ? "Saving..." : "Done"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditMode(true)}
                  data-testid="button-edit-document"
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                data-testid="button-toggle-fullscreen"
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                data-testid="button-refresh-post-record"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {!isFullscreen && "Refresh"}
              </Button>
              <Button
                variant="secondary"
                size={isFullscreen ? "sm" : "default"}
                onClick={() => importWinnersMutation.mutate()}
                disabled={importWinnersMutation.isPending}
                data-testid="button-import-winners"
              >
                <Trophy className="h-4 w-4 mr-1" />
                {importWinnersMutation.isPending ? "..." : (isFullscreen ? "Import" : "Import Winners")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className={isFullscreen ? "flex-1 flex flex-col min-h-0 py-2" : ""}>
          <div className={`flex flex-wrap gap-4 mb-4 ${isFullscreen ? 'gap-2 flex-shrink-0' : ''}`}>
            <div className="flex items-center gap-2">
              {!isFullscreen && <Label htmlFor="record-day-filter">Record Day</Label>}
              <Select
                value={selectedRecordDay}
                onValueChange={setSelectedRecordDay}
              >
                <SelectTrigger className={isFullscreen ? "w-40" : "w-48"} data-testid="select-record-day">
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
                placeholder={isFullscreen ? "Search..." : "Search by name, email, or phone..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={isFullscreen ? "w-40" : "w-64"}
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
          
          <ScrollArea className={`w-full ${isFullscreen ? 'flex-1' : ''}`} style={isFullscreen ? { minHeight: 0 } : undefined}>
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
                      <TableHead colSpan={10} className="text-center font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/20 border-r-2">
                        CONTESTANTS
                      </TableHead>
                      <TableHead colSpan={15} className="text-center font-bold text-blue-800 dark:text-blue-200 bg-blue-100 dark:bg-blue-900/20">
                        LEGALS
                      </TableHead>
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
                      <TableHead className="font-semibold text-center min-w-[110px]">Contestant Type</TableHead>
                      <TableHead className="font-semibold min-w-[120px]">Phone</TableHead>
                      <TableHead className="font-semibold min-w-[180px]">Email</TableHead>
                      <TableHead className="font-semibold text-center">Case No.</TableHead>
                      <TableHead className="font-semibold text-center">Case Amount</TableHead>
                      <TableHead className="font-semibold text-center">Prize Wheel</TableHead>
                      <TableHead className="font-semibold text-center">Bank Offer Taken?</TableHead>
                      <TableHead className="font-semibold text-center">Amount Won</TableHead>
                      <TableHead className="font-semibold min-w-[200px] border-r-2">Notes</TableHead>
                      <TableHead className="font-semibold text-center">Appearance Release Signed</TableHead>
                      <TableHead className="font-semibold text-center">Deed Signed</TableHead>
                      <TableHead className="font-semibold text-center">Disclosure Received</TableHead>
                      <TableHead className="font-semibold text-center">Gift Card Sent & Signed Accepted</TableHead>
                      <TableHead className="font-semibold text-center">Stat Dec</TableHead>
                      <TableHead className="font-semibold text-center">Statement by Supplier</TableHead>
                      <TableHead className="font-semibold text-center">ESA Entry</TableHead>
                      <TableHead className="font-semibold text-center">AFP Confirm</TableHead>
                      <TableHead className="font-semibold text-center">100 Pts ID</TableHead>
                      <TableHead className="font-semibold text-center">AFP Batch No.</TableHead>
                      <TableHead className="font-semibold text-center">AFP No.</TableHead>
                      <TableHead className="font-semibold text-center">AFP Batch No.</TableHead>
                      <TableHead className="font-semibold text-center">Honesty Check</TableHead>
                      <TableHead className="font-semibold text-center">Social Media Sweep</TableHead>
                      <TableHead className="font-semibold text-center">Bankruptcy Check</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={showTxSection ? 32 : 28} className="h-24 text-center text-muted-foreground">
                          No entries found. Use "Import Winners" to automatically add contestants.
                        </TableCell>
                      </TableRow>
                    ) : filteredData.map((item) => (
                        <TableRow 
                          key={item.id}
                          data-testid={`row-post-record-${item.id}`}
                        >
                          {/* RECORD columns */}
                          <TableCell className="text-center text-xs bg-rose-50/50 dark:bg-rose-900/5">
                            {item.recordDay ? format(new Date(item.recordDay.date), "d-MMM-yy") : "-"}
                          </TableCell>
                          <TableCell className="text-center text-xs bg-rose-50/50 dark:bg-rose-900/5">
                            {isEditMode ? (
                              <Input
                                value={getEditValue(item.id, "rxNumberOverride", getDisplayValue(item, 'rxNumber'))}
                                onChange={(e) => setEditValue(item.id, "rxNumberOverride", e.target.value || null)}
                                className="w-24 h-7 text-xs text-center"
                                placeholder="RX Day"
                                data-testid={`input-edit-rxday-${item.id}`}
                              />
                            ) : (
                              <span className={item.rxNumberOverride ? "text-purple-600 dark:text-purple-400" : ""}>
                                {getDisplayValue(item, 'rxNumber') || "-"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs bg-rose-50/50 dark:bg-rose-900/5 border-r-2">
                            {isEditMode ? (
                              <Input
                                value={getEditValue(item.id, "rxEpNo", item.rxEpNo || "")}
                                onChange={(e) => setEditValue(item.id, "rxEpNo", e.target.value || null)}
                                className="w-16 h-7 text-xs text-center"
                                placeholder="-"
                                data-testid={`input-rx-ep-no-${item.id}`}
                              />
                            ) : (
                              <span>{item.rxEpNo || "-"}</span>
                            )}
                          </TableCell>
                          {/* TX columns */}
                          {showTxSection && (
                            <>
                              <TableCell className="text-center text-xs bg-yellow-50/50 dark:bg-yellow-900/5">
                                {isEditMode ? (
                                  <Input
                                    value={getEditValue(item.id, "txEpNumber", item.txEpNumber || "")}
                                    onChange={(e) => setEditValue(item.id, "txEpNumber", e.target.value || null)}
                                    className="w-16 h-7 text-xs text-center"
                                    placeholder="-"
                                    data-testid={`input-tx-ep-number-${item.id}`}
                                  />
                                ) : (
                                  <span>{item.txEpNumber || "-"}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center text-xs bg-yellow-50/50 dark:bg-yellow-900/5">
                                {isEditMode ? (
                                  <Input
                                    type="date"
                                    value={getEditValue(item.id, "txEpDateStr", item.txEpDate ? format(new Date(item.txEpDate), "yyyy-MM-dd") : "")}
                                    onChange={(e) => setEditValue(item.id, "txEpDateStr", e.target.value || null)}
                                    className="w-28 h-7 text-xs"
                                    data-testid={`input-tx-ep-date-${item.id}`}
                                  />
                                ) : (
                                  <span>{item.txEpDate ? format(new Date(item.txEpDate), "d-MMM-yy") : "-"}</span>
                                )}
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
                          <TableCell className="font-medium sticky left-0 bg-card z-10">
                            {isEditMode ? (
                              <Input
                                value={getEditValue(item.id, "nameOverride", getDisplayValue(item, 'name'))}
                                onChange={(e) => setEditValue(item.id, "nameOverride", e.target.value || null)}
                                className="w-40 h-7 text-xs"
                                placeholder="Name"
                                data-testid={`input-edit-name-${item.id}`}
                              />
                            ) : (
                              <span className={item.nameOverride ? "text-purple-600 dark:text-purple-400" : ""}>
                                {getDisplayValue(item, 'name') || "Unknown"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {isEditMode ? (
                              <Select
                                value={getEditValue(item.id, "contestantTypeOverride", getDisplayValue(item, 'contestantType')) || "none"}
                                onValueChange={(value) => setEditValue(item.id, "contestantTypeOverride", value === "none" ? null : value)}
                              >
                                <SelectTrigger className="w-28 h-7 text-xs" data-testid={`select-edit-type-${item.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">-</SelectItem>
                                  <SelectItem value="player">PLAYER</SelectItem>
                                  <SelectItem value="case_holder">CASE HOLDER</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className={item.contestantTypeOverride ? "text-purple-600 dark:text-purple-400" : ""}>
                                {getDisplayValue(item, 'contestantType') === 'player' ? 'PLAYER' : 
                                 getDisplayValue(item, 'contestantType') === 'case_holder' ? 'CASE HOLDER' : '-'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {isEditMode ? (
                              <Input
                                value={getEditValue(item.id, "phoneOverride", getDisplayValue(item, 'phone'))}
                                onChange={(e) => setEditValue(item.id, "phoneOverride", e.target.value || null)}
                                className="w-32 h-7 text-xs"
                                placeholder="Phone"
                                data-testid={`input-edit-phone-${item.id}`}
                              />
                            ) : (
                              <span className={item.phoneOverride ? "text-purple-600 dark:text-purple-400" : ""}>
                                {getDisplayValue(item, 'phone') || "-"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {isEditMode ? (
                              <Input
                                value={getEditValue(item.id, "emailOverride", getDisplayValue(item, 'email'))}
                                onChange={(e) => setEditValue(item.id, "emailOverride", e.target.value || null)}
                                className="w-48 h-7 text-xs"
                                placeholder="Email"
                                data-testid={`input-edit-email-${item.id}`}
                              />
                            ) : (
                              <span className={item.emailOverride ? "text-purple-600 dark:text-purple-400" : ""}>
                                {getDisplayValue(item, 'email') || "-"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {isEditMode ? (
                              <Input
                                value={getEditValue(item.id, "caseNumber", item.caseNumber || "")}
                                onChange={(e) => setEditValue(item.id, "caseNumber", e.target.value || null)}
                                className="w-16 h-7 text-xs text-center"
                                placeholder="-"
                                data-testid={`input-case-number-${item.id}`}
                              />
                            ) : (
                              <span>{item.caseNumber || "-"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {isEditMode ? (
                              <Input
                                type="number"
                                value={getEditValue(item.id, "caseAmount", item.caseAmount || "")}
                                onChange={(e) => setEditValue(item.id, "caseAmount", e.target.value ? parseInt(e.target.value) : null)}
                                className="w-20 h-7 text-xs text-center"
                                placeholder="-"
                                data-testid={`input-case-amount-${item.id}`}
                              />
                            ) : (
                              <span>{item.caseAmount ? `$${item.caseAmount.toLocaleString()}` : "-"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {isEditMode ? (
                              <Select
                                value={getEditValue(item.id, "spinTheWheelOverrideStr", item.spinTheWheelOverride !== null && item.spinTheWheelOverride !== undefined ? (item.spinTheWheelOverride ? "yes" : "no") : (item.seatAssignment?.spinTheWheel === true ? "yes" : item.seatAssignment?.spinTheWheel === false ? "no" : "none"))}
                                onValueChange={(value) => setEditValue(item.id, "spinTheWheelOverrideStr", value)}
                              >
                                <SelectTrigger className="w-16 h-7 text-xs" data-testid={`select-edit-prize-wheel-${item.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">-</SelectItem>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className={item.spinTheWheelOverride !== null && item.spinTheWheelOverride !== undefined ? "text-purple-600 dark:text-purple-400" : ""}>
                                {getDisplayValue(item, 'spinTheWheel')}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {item.seatAssignment?.winningMoneyRole === 'case_holder' ? (
                              <span className="text-muted-foreground">-</span>
                            ) : isEditMode ? (
                              <Select
                                value={getEditValue(item.id, "bankOfferTakenStr", item.bankOfferTaken === null ? "n/a" : item.bankOfferTaken ? "yes" : "no")}
                                onValueChange={(value) => setEditValue(item.id, "bankOfferTakenStr", value)}
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
                            ) : (
                              <span>{item.bankOfferTaken === null ? "N/A" : item.bankOfferTaken ? "Yes" : "No"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {isEditMode ? (
                              <Input
                                type="number"
                                value={getEditValue(item.id, "amountWon", item.amountWon || "")}
                                onChange={(e) => setEditValue(item.id, "amountWon", e.target.value ? parseInt(e.target.value) : null)}
                                className="w-24 h-7 text-xs text-center"
                                placeholder="-"
                                data-testid={`input-amount-won-${item.id}`}
                              />
                            ) : (
                              <span>{item.amountWon ? `$${item.amountWon.toLocaleString()}` : "-"}</span>
                            )}
                          </TableCell>
                          <TableCell className="border-r-2 text-xs">
                            {isEditMode ? (
                              <Textarea
                                value={getEditValue(item.id, "notes", item.notes || "")}
                                onChange={(e) => setEditValue(item.id, "notes", e.target.value || null)}
                                className="min-w-[200px] min-h-[28px] h-7 text-xs resize"
                                placeholder="-"
                                data-testid={`input-notes-${item.id}`}
                              />
                            ) : (
                              <span className="whitespace-pre-wrap">{item.notes || "-"}</span>
                            )}
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
                              checked={item.statementBySupplier || false}
                              onCheckedChange={(checked) => handleCheckboxChange(item.id, "statementBySupplier", checked === true)}
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
                        </TableRow>
                      ))}
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

    </div>
  );
}
