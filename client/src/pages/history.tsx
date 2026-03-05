import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { History, ArrowRightLeft, AlertTriangle, UserCheck, Search, MoveHorizontal, Calendar, UserMinus, UserPlus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

type MovementType = 'seat_change' | 'added_to_reschedule' | 'removed_from_reschedule' | 'standby_added' | 'standby_removed' | 'standby_seated' | 'returned_to_pool' | 'standby_to_reschedule';

interface HistoryEvent {
  id: string;
  type: 'rebooking' | 'attendance_issue' | 'standby_attendance' | 'movement';
  movementType?: MovementType;
  contestantId: string;
  contestantName: string;
  contestantEmail: string;
  timestamp: string;
  description: string;
  details: Record<string, any>;
  recordDayId?: string;
}

const ITEMS_PER_PAGE = 100;

export default function HistoryPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [recordDayFilter, setRecordDayFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: historyData, isLoading, error } = useQuery<{
    rebookings: any[];
    attendanceIssues: any[];
    standbyAttendance: any[];
    movements: any[];
  }>({
    queryKey: ['/api/history'],
  });

  const { data: contestants } = useQuery<any[]>({
    queryKey: ['/api/contestants'],
  });

  const { data: recordDays } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  const contestantMap = useMemo(() => {
    if (!Array.isArray(contestants)) return new Map();
    return new Map(contestants.map(c => [c.id, c]));
  }, [contestants]);

  const recordDayMap = useMemo(() => {
    if (!Array.isArray(recordDays)) return new Map();
    return new Map(recordDays.map(rd => [rd.id, rd]));
  }, [recordDays]);

  const formatRecordDay = (recordDayId: string) => {
    const rd = recordDayMap.get(recordDayId);
    return rd ? format(new Date(rd.date), "dd/MM/yyyy") : "Unknown";
  };

  const combinedEvents = useMemo<HistoryEvent[]>(() => {
    if (!historyData) return [];

    const events: HistoryEvent[] = [];

    historyData.rebookings?.forEach((r: any) => {
      const contestant = r.contestant || contestantMap.get(r.contestantId);
      events.push({
        id: r.id,
        type: 'rebooking',
        contestantId: r.contestantId,
        contestantName: contestant?.name || 'Unknown',
        contestantEmail: contestant?.email || '',
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
        recordDayId: r.toRecordDayId,
      });
    });

    historyData.attendanceIssues?.forEach((a: any) => {
      // Use embedded contestant data from API, fallback to lookup
      const contestant = a.contestant || contestantMap.get(a.contestantId);
      const issueLabel = a.issueType === 'no_show' ? 'No-Show' : a.issueType === 'early_leaver' ? 'Early Leaver' : 'No Longer Wants to Attend';
      events.push({
        id: a.id,
        type: 'attendance_issue',
        contestantId: a.contestantId,
        contestantName: contestant?.name || 'Unknown',
        contestantEmail: contestant?.email || '',
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
        recordDayId: a.recordDayId,
      });
    });

    historyData.standbyAttendance?.forEach((s: any) => {
      // Use embedded contestant data from API, fallback to lookup
      const contestant = s.contestant || contestantMap.get(s.contestantId);
      events.push({
        id: s.id,
        type: 'standby_attendance',
        contestantId: s.contestantId,
        contestantName: contestant?.name || 'Unknown',
        contestantEmail: contestant?.email || '',
        timestamp: s.attendedAt,
        description: `Attended as standby on ${formatRecordDay(s.recordDayId)} (Block ${s.blockNumber}, ${s.blockType?.toUpperCase() || 'Unknown'})`,
        details: {
          recordDay: formatRecordDay(s.recordDayId),
          block: s.blockNumber,
          seat: s.seatLabel,
          blockType: s.blockType,
          confirmedAttendance: s.confirmedAttendance,
        },
        recordDayId: s.recordDayId,
      });
    });

    historyData.movements?.forEach((m: any) => {
      const movementDescriptions: Record<MovementType, string> = {
        'seat_change': `Moved from Block ${m.fromBlockNumber} ${m.fromSeatLabel} to Block ${m.toBlockNumber} ${m.toSeatLabel}${m.recordDayId ? ` on ${formatRecordDay(m.recordDayId)}` : ''}`,
        'added_to_reschedule': `Added to reschedule list from Block ${m.fromBlockNumber} ${m.fromSeatLabel}${m.recordDayId ? ` on ${formatRecordDay(m.recordDayId)}` : ''}`,
        'removed_from_reschedule': `Removed from reschedule and placed in Block ${m.toBlockNumber} ${m.toSeatLabel}${m.recordDayId ? ` on ${formatRecordDay(m.recordDayId)}` : ''}`,
        'standby_added': `Added as standby${m.recordDayId ? ` for ${formatRecordDay(m.recordDayId)}` : ''}`,
        'standby_removed': `Removed from standby list${m.recordDayId ? ` for ${formatRecordDay(m.recordDayId)}` : ''}`,
        'standby_seated': `Standby seated${m.toSeatLabel ? ` in ${m.toSeatLabel}` : ''}${m.recordDayId ? ` on ${formatRecordDay(m.recordDayId)}` : ''}`,
        'returned_to_pool': `Returned to available pool from Block ${m.fromBlockNumber} ${m.fromSeatLabel}${m.recordDayId ? ` on ${formatRecordDay(m.recordDayId)}` : ''}`,
        'standby_to_reschedule': `Standby moved to reschedule list${m.recordDayId ? ` from ${formatRecordDay(m.recordDayId)}` : ''}`,
      };
      
      events.push({
        id: m.id,
        type: 'movement',
        movementType: m.movementType,
        contestantId: m.contestantId,
        contestantName: m.contestant?.name || 'Unknown',
        contestantEmail: m.contestant?.email || '',
        timestamp: m.createdAt,
        description: movementDescriptions[m.movementType as MovementType] || m.notes || 'Movement',
        details: {
          recordDay: m.recordDayId ? formatRecordDay(m.recordDayId) : null,
          fromBlock: m.fromBlockNumber,
          fromSeat: m.fromSeatLabel,
          toBlock: m.toBlockNumber,
          toSeat: m.toSeatLabel,
          notes: m.notes,
          movedBy: m.movedBy,
        },
        recordDayId: m.recordDayId,
      });
    });

    return events.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [historyData, contestantMap, recordDayMap]);

  const filteredEvents = useMemo(() => {
    // Reset to page 1 when filters change (handled via effect below)
    return combinedEvents.filter(event => {
      const matchesType = typeFilter === "all" || event.type === typeFilter;
      const matchesRecordDay = recordDayFilter === "all" || event.recordDayId === recordDayFilter;
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = searchQuery === "" || 
        event.contestantName.toLowerCase().includes(searchLower) ||
        event.contestantEmail.toLowerCase().includes(searchLower) ||
        event.description.toLowerCase().includes(searchLower);
      return matchesType && matchesRecordDay && matchesSearch;
    });
  }, [combinedEvents, typeFilter, recordDayFilter, searchQuery]);

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value);
    setCurrentPage(1);
  };

  const handleRecordDayFilterChange = (value: string) => {
    setRecordDayFilter(value);
    setCurrentPage(1);
  };

  // Sort record days by date for the filter dropdown
  const sortedRecordDays = useMemo(() => {
    if (!recordDays) return [];
    return [...recordDays].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [recordDays]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredEvents.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

  const rebookingCount = historyData?.rebookings?.length || 0;
  const issueCount = historyData?.attendanceIssues?.length || 0;
  const standbyCount = historyData?.standbyAttendance?.length || 0;
  const movementCount = historyData?.movements?.length || 0;

  const getEventIcon = (type: string, movementType?: MovementType) => {
    switch (type) {
      case 'rebooking':
        return <ArrowRightLeft className="h-4 w-4" />;
      case 'attendance_issue':
        return <AlertTriangle className="h-4 w-4" />;
      case 'standby_attendance':
        return <UserCheck className="h-4 w-4" />;
      case 'movement':
        switch (movementType) {
          case 'seat_change':
            return <MoveHorizontal className="h-4 w-4" />;
          case 'added_to_reschedule':
            return <Calendar className="h-4 w-4" />;
          case 'removed_from_reschedule':
            return <Calendar className="h-4 w-4" />;
          case 'standby_added':
            return <UserPlus className="h-4 w-4" />;
          case 'standby_removed':
            return <UserMinus className="h-4 w-4" />;
          case 'standby_seated':
            return <UserCheck className="h-4 w-4" />;
          case 'returned_to_pool':
            return <UserMinus className="h-4 w-4" />;
          case 'standby_to_reschedule':
            return <Calendar className="h-4 w-4" />;
          default:
            return <MoveHorizontal className="h-4 w-4" />;
        }
      default:
        return <History className="h-4 w-4" />;
    }
  };

  const getEventBadge = (type: string, details?: Record<string, any>, movementType?: MovementType) => {
    switch (type) {
      case 'rebooking':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">Rebooking</Badge>;
      case 'attendance_issue':
        if (details?.issueType === 'no_show') {
          return <Badge variant="destructive">No-Show</Badge>;
        }
        if (details?.issueType === 'no_longer_want_to_attend') {
          return <Badge variant="outline" className="text-rose-600 border-rose-500">No Longer Wants to Attend</Badge>;
        }
        return <Badge className="bg-amber-500 hover:bg-amber-600">Early Leaver</Badge>;
      case 'standby_attendance':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">Standby Attended</Badge>;
      case 'movement':
        const movementLabels: Record<MovementType, { label: string; className: string }> = {
          'seat_change': { label: 'Seat Change', className: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800' },
          'added_to_reschedule': { label: 'To Reschedule', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800' },
          'removed_from_reschedule': { label: 'From Reschedule', className: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-800' },
          'standby_added': { label: 'Standby Added', className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800' },
          'standby_removed': { label: 'Standby Removed', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800' },
          'standby_seated': { label: 'Standby Seated', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800' },
          'returned_to_pool': { label: 'Returned to Pool', className: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-800' },
          'standby_to_reschedule': { label: 'Standby to Reschedule', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800' },
        };
        const config = movementLabels[movementType as MovementType] || { label: 'Movement', className: '' };
        return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
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

  if (error) {
    return (
      <div className="container mx-auto py-8 text-center" data-testid="error-state">
        <h2 className="text-xl font-semibold text-destructive mb-2">Error Loading History</h2>
        <p className="text-muted-foreground">{(error as any).message || "An unexpected error occurred"}</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>Refresh Page</Button>
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="stat-movements">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Movements</CardTitle>
            <MoveHorizontal className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{movementCount}</div>
            <p className="text-xs text-muted-foreground">Seat changes & movements</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-rebookings">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rebookings</CardTitle>
            <ArrowRightLeft className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rebookingCount}</div>
            <p className="text-xs text-muted-foreground">Between record days</p>
          </CardContent>
        </Card>

        <Card data-testid="stat-attendance-issues">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attendance Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{issueCount}</div>
            <p className="text-xs text-muted-foreground">No-shows & early leavers</p>
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
                  placeholder="Search name, email, or details..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-8 w-full sm:w-64"
                  data-testid="input-search"
                />
              </div>
              <Select value={recordDayFilter} onValueChange={handleRecordDayFilterChange}>
                <SelectTrigger className="w-full sm:w-48" data-testid="select-record-day-filter">
                  <SelectValue placeholder="Filter by RX Day" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All RX Days</SelectItem>
                  {sortedRecordDays.map((rd) => (
                    <SelectItem key={rd.id} value={rd.id}>
                      {format(new Date(rd.date), "dd/MM/yyyy")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={handleTypeFilterChange}>
                <SelectTrigger className="w-full sm:w-48" data-testid="select-type-filter">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="movement">Movements</SelectItem>
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
              {searchQuery || typeFilter !== "all" || recordDayFilter !== "all"
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
                    <TableHead>RX Date</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="hidden lg:table-cell">By</TableHead>
                    <TableHead>Date/Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedEvents.map((event) => (
                    <TableRow key={`${event.type}-${event.id}`} data-testid={`row-event-${event.id}`}>
                      <TableCell className="text-center">
                        {getEventIcon(event.type, event.movementType)}
                      </TableCell>
                      <TableCell>
                        {getEventBadge(event.type, event.details, event.movementType)}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-contestant-${event.id}`}>
                        {event.contestantName}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {event.recordDayId ? formatRecordDay(event.recordDayId) : '-'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-md">
                        <div className="truncate" title={event.description}>
                          {event.description}
                        </div>
                        {(event.details.reason || event.details.notes) && (
                          <div className="text-xs mt-1 italic">
                            {event.details.reason ? `Reason: ${event.details.reason}` : event.details.notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm">
                        {event.details.rebookedBy || event.details.markedBy || event.details.movedBy || '-'}
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
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1}-{Math.min(endIndex, filteredEvents.length)} of {filteredEvents.length} events
                {filteredEvents.length !== combinedEvents.length && (
                  <span> (filtered from {combinedEvents.length} total)</span>
                )}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    data-testid="button-first-page"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-1 px-2">
                    <span className="text-sm font-medium">Page</span>
                    <Select
                      value={currentPage.toString()}
                      onValueChange={(v) => setCurrentPage(parseInt(v))}
                    >
                      <SelectTrigger className="w-16 h-9" data-testid="select-page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: totalPages }, (_, i) => (
                          <SelectItem key={i + 1} value={(i + 1).toString()}>
                            {i + 1}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">of {totalPages}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    data-testid="button-last-page"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
