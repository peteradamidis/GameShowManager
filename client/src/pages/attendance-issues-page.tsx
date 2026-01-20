import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AlertTriangle, Clock, CalendarPlus, Check, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AttendanceIssuesPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const { data: issues, isLoading } = useQuery<any[]>({
    queryKey: ['/api/attendance-issues'],
  });

  const { data: contestants } = useQuery<any[]>({
    queryKey: ['/api/contestants'],
  });

  const { data: recordDays } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  const contestantMap = new Map(contestants?.map(c => [c.id, c]) || []);
  const recordDayMap = new Map(recordDays?.map(rd => [rd.id, rd]) || []);

  const filteredIssues = issues?.filter(issue => {
    const matchesType = typeFilter === "all" || issue.issueType === typeFilter;
    const contestant = contestantMap.get(issue.contestantId);
    const matchesSearch = searchQuery === "" || 
      (contestant && contestant.name?.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesType && matchesSearch;
  }) || [];

  const sortedIssues = [...filteredIssues].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const noShowCount = issues?.filter(i => i.issueType === 'no_show').length || 0;
  const earlyLeaverCount = issues?.filter(i => i.issueType === 'early_leaver').length || 0;

  const moveToRescheduleMutation = useMutation({
    mutationFn: async (issueId: string) => {
      return apiRequest('POST', `/api/attendance-issues/${issueId}/move-to-reschedule`, {
        movedBy: 'producer',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/attendance-issues'] });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'] });
      toast({
        title: "Moved to Reschedule",
        description: "Contestant has been added to the reschedule list.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to move to reschedule",
        description: error?.message || "Could not move contestant to reschedule list.",
        variant: "destructive",
      });
    },
  });

  const removeIssueMutation = useMutation({
    mutationFn: async (issueId: string) => {
      return apiRequest('DELETE', `/api/attendance-issues/${issueId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/attendance-issues'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Issue Removed",
        description: "Attendance issue has been removed and contestant count decremented.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove issue",
        description: error?.message || "Could not remove attendance issue.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto py-8" data-testid="loading-state">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6" data-testid="attendance-issues-page">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold" data-testid="page-title">Attendance Issues</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="no-show-count-card">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">No-Shows</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="no-show-count">{noShowCount}</div>
            <p className="text-xs text-muted-foreground">Total no-show incidents</p>
          </CardContent>
        </Card>

        <Card data-testid="early-leaver-count-card">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Early Leavers</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="early-leaver-count">{earlyLeaverCount}</div>
            <p className="text-xs text-muted-foreground">Total early leaver incidents</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issue History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="w-48">
              <Select value={typeFilter} onValueChange={setTypeFilter} data-testid="select-type-filter">
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="no_show">No-Shows</SelectItem>
                  <SelectItem value="early_leaver">Early Leavers</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Search by contestant name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs"
              data-testid="input-search"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contestant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Record Day</TableHead>
                <TableHead>Block/Seat</TableHead>
                <TableHead>Marked By</TableHead>
                <TableHead>Date/Time</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedIssues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No attendance issues recorded
                  </TableCell>
                </TableRow>
              ) : (
                sortedIssues.map((issue) => {
                  const contestant = contestantMap.get(issue.contestantId);
                  const recordDay = recordDayMap.get(issue.recordDayId);
                  
                  return (
                    <TableRow key={issue.id} data-testid={`issue-row-${issue.id}`}>
                      <TableCell className="font-medium">
                        {contestant ? contestant.name : 'Unknown'}
                        {contestant && (contestant.noShowCount > 0 || contestant.earlyLeaverCount > 0) && (
                          <div className="flex gap-1 mt-1">
                            {contestant.noShowCount > 0 && (
                              <Badge variant="destructive" className="text-xs" data-testid={`no-show-badge-${issue.id}`}>
                                {contestant.noShowCount} NS
                              </Badge>
                            )}
                            {contestant.earlyLeaverCount > 0 && (
                              <Badge className="text-xs bg-amber-500" data-testid={`early-leaver-badge-${issue.id}`}>
                                {contestant.earlyLeaverCount} EL
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {issue.issueType === 'no_show' ? (
                          <Badge variant="destructive" data-testid={`type-badge-${issue.id}`}>No-Show</Badge>
                        ) : (
                          <Badge className="bg-amber-500" data-testid={`type-badge-${issue.id}`}>Early Leaver</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {recordDay ? format(new Date(recordDay.date), 'd MMM yyyy') : 'Unknown'}
                      </TableCell>
                      <TableCell>
                        Block {issue.blockNumber}, Seat {issue.seatLabel}
                      </TableCell>
                      <TableCell className="capitalize">
                        {issue.markedBy || 'Unknown'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(issue.createdAt), 'd MMM yyyy h:mm a')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {issue.movedToReschedule ? (
                            <Badge variant="outline" className="text-green-600 border-green-600" data-testid={`badge-rescheduled-${issue.id}`}>
                              <Check className="h-3 w-3 mr-1" />
                              Rescheduled
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => moveToRescheduleMutation.mutate(issue.id)}
                              disabled={moveToRescheduleMutation.isPending}
                              data-testid={`button-move-to-reschedule-${issue.id}`}
                            >
                              <CalendarPlus className="h-3 w-3 mr-1" />
                              Move to Reschedule
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                disabled={removeIssueMutation.isPending}
                                data-testid={`button-remove-issue-${issue.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove Attendance Issue?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will remove the {issue.issueType === 'no_show' ? 'no-show' : 'early leaver'} record for{' '}
                                  <strong>{contestant?.name || 'this contestant'}</strong> and decrement their count.
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => removeIssueMutation.mutate(issue.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
