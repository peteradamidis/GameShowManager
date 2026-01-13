import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";

export default function AttendanceIssuesPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

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
    new Date(b.markedAt).getTime() - new Date(a.markedAt).getTime()
  );

  const noShowCount = issues?.filter(i => i.issueType === 'no_show').length || 0;
  const earlyLeaverCount = issues?.filter(i => i.issueType === 'early_leaver').length || 0;

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedIssues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                        {recordDay ? format(new Date(recordDay.date), 'MMM d, yyyy') : 'Unknown'}
                      </TableCell>
                      <TableCell>
                        Block {issue.blockNumber}, Seat {issue.seatLabel}
                      </TableCell>
                      <TableCell className="capitalize">
                        {issue.markedBy || 'Unknown'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(issue.markedAt), 'MMM d, yyyy h:mm a')}
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
