import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { History, ArrowRightLeft, AlertTriangle, UserCheck, Search } from "lucide-react";

interface HistoryEvent {
  id: string;
  type: 'rebooking' | 'attendance_issue' | 'standby_attendance';
  contestantId: string;
  contestantName: string;
  timestamp: string;
  description: string;
  details: Record<string, any>;
}

export default function HistoryPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: historyData, isLoading } = useQuery<{
    rebookings: any[];
    attendanceIssues: any[];
    standbyAttendance: any[];
  }>({
    queryKey: ['/api/history'],
  });

  const { data: contestants } = useQuery<any[]>({
    queryKey: ['/api/contestants'],
  });

  const { data: recordDays } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  const contestantMap = useMemo(() => 
    new Map(contestants?.map(c => [c.id, c]) || []),
    [contestants]
  );

  const recordDayMap = useMemo(() => 
    new Map(recordDays?.map(rd => [rd.id, rd]) || []),
    [recordDays]
  );

  const formatRecordDay = (recordDayId: string) => {
    const rd = recordDayMap.get(recordDayId);
    return rd ? format(new Date(rd.date), "dd/MM/yyyy") : "Unknown";
  };

  const combinedEvents = useMemo<HistoryEvent[]>(() => {
    if (!historyData) return [];

    const events: HistoryEvent[] = [];

    historyData.rebookings?.forEach((r: any) => {
      const contestant = contestantMap.get(r.contestantId);
      events.push({
        id: r.id,
        type: 'rebooking',
        contestantId: r.contestantId,
        contestantName: contestant?.name || 'Unknown',
        timestamp: r.rebookedAt,
        description: `Moved from ${formatRecordDay(r.fromRecordDayId)} (Block ${r.fromBlockNumber}, Seat ${r.fromSeatLabel}) to ${formatRecordDay(r.toRecordDayId)} (Block ${r.toBlockNumber}, Seat ${r.toSeatLabel})`,
        details: {
          fromRecordDay: formatRecordDay(r.fromRecordDayId),
          toRecordDay: formatRecordDay(r.toRecordDayId),
          fromBlock: r.fromBlockNumber,
          toBlock: r.toBlockNumber,
          fromSeat: r.fromSeatLabel,
          toSeat: r.toSeatLabel,
          reason: r.reason,
          rebookedBy: r.rebookedBy,
        },
      });
    });

    historyData.attendanceIssues?.forEach((a: any) => {
      const contestant = contestantMap.get(a.contestantId);
      const issueLabel = a.issueType === 'no_show' ? 'No-Show' : 'Early Leaver';
      events.push({
        id: a.id,
        type: 'attendance_issue',
        contestantId: a.contestantId,
        contestantName: contestant?.name || 'Unknown',
        timestamp: a.createdAt,
        description: `${issueLabel} on ${formatRecordDay(a.recordDayId)} (Block ${a.blockNumber}, Seat ${a.seatLabel})`,
        details: {
          recordDay: formatRecordDay(a.recordDayId),
          block: a.blockNumber,
          seat: a.seatLabel,
          issueType: a.issueType,
          notes: a.notes,
          markedBy: a.markedBy,
          movedToReschedule: a.movedToReschedule,
        },
      });
    });

    historyData.standbyAttendance?.forEach((s: any) => {
      const contestant = contestantMap.get(s.contestantId);
      events.push({
        id: s.id,
        type: 'standby_attendance',
        contestantId: s.contestantId,
        contestantName: contestant?.name || 'Unknown',
        timestamp: s.attendedAt,
        description: `Attended as standby on ${formatRecordDay(s.recordDayId)} (Block ${s.blockNumber}, ${s.blockType?.toUpperCase() || 'Unknown'})`,
        details: {
          recordDay: formatRecordDay(s.recordDayId),
          block: s.blockNumber,
          seat: s.seatLabel,
          blockType: s.blockType,
          confirmedAttendance: s.confirmedAttendance,
        },
      });
    });

    return events.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [historyData, contestantMap, recordDayMap]);

  const filteredEvents = useMemo(() => {
    return combinedEvents.filter(event => {
      const matchesType = typeFilter === "all" || event.type === typeFilter;
      const matchesSearch = searchQuery === "" || 
        event.contestantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [combinedEvents, typeFilter, searchQuery]);

  const rebookingCount = historyData?.rebookings?.length || 0;
  const issueCount = historyData?.attendanceIssues?.length || 0;
  const standbyCount = historyData?.standbyAttendance?.length || 0;

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'rebooking':
        return <ArrowRightLeft className="h-4 w-4" />;
      case 'attendance_issue':
        return <AlertTriangle className="h-4 w-4" />;
      case 'standby_attendance':
        return <UserCheck className="h-4 w-4" />;
      default:
        return <History className="h-4 w-4" />;
    }
  };

  const getEventBadge = (type: string, details?: Record<string, any>) => {
    switch (type) {
      case 'rebooking':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">Rebooking</Badge>;
      case 'attendance_issue':
        if (details?.issueType === 'no_show') {
          return <Badge variant="destructive">No-Show</Badge>;
        }
        return <Badge className="bg-amber-500 hover:bg-amber-600">Early Leaver</Badge>;
      case 'standby_attendance':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">Standby Attended</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

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
    <div className="container mx-auto py-8 space-y-6" data-testid="history-page">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="page-title">
          <History className="h-8 w-8" />
          History
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="stat-rebookings">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rebookings</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rebookingCount}</div>
            <p className="text-xs text-muted-foreground">Contestants moved between days</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-attendance-issues">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attendance Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{issueCount}</div>
            <p className="text-xs text-muted-foreground">No-shows and early leavers</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-standby-attendance">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Standby Attendance</CardTitle>
            <UserCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{standbyCount}</div>
            <p className="text-xs text-muted-foreground">Standbys who attended</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <CardTitle>All Events</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search contestant or details..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-full sm:w-64"
                  data-testid="input-search"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-48" data-testid="select-type-filter">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="rebooking">Rebookings</SelectItem>
                  <SelectItem value="attendance_issue">Attendance Issues</SelectItem>
                  <SelectItem value="standby_attendance">Standby Attendance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="empty-state">
              {searchQuery || typeFilter !== "all" 
                ? "No matching events found."
                : "No history events recorded yet."}
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Contestant</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="hidden lg:table-cell">By</TableHead>
                    <TableHead>Date/Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event) => (
                    <TableRow key={`${event.type}-${event.id}`} data-testid={`row-event-${event.id}`}>
                      <TableCell className="text-center">
                        {getEventIcon(event.type)}
                      </TableCell>
                      <TableCell>
                        {getEventBadge(event.type, event.details)}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-contestant-${event.id}`}>
                        {event.contestantName}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-md">
                        <div className="truncate" title={event.description}>
                          {event.description}
                        </div>
                        {event.details.reason && (
                          <div className="text-xs mt-1 italic">
                            Reason: {event.details.reason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm">
                        {event.details.rebookedBy || event.details.markedBy || '-'}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(event.timestamp), "dd/MM/yyyy HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {filteredEvents.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground text-center">
              Showing {filteredEvents.length} of {combinedEvents.length} events
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
