import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Star, User, Users } from "lucide-react";
import { format } from "date-fns";

interface RecordDay {
  id: string;
  date: string;
  rxNumber: string;
  isLocked: boolean;
}

interface SeatAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  blockNumber: number;
  seatLabel: string;
  playerType: string | null;
  bookingConfirmationStatus: string | null;
  contestant: {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    age: number | null;
    phone: string | null;
    email: string | null;
    rating: number | null;
    suburb: string | null;
    medicalMobilityNotes: string | null;
    attendingWith: string | null;
  } | null;
  medicalMobilityNotesOverride?: string | null;
  attendingWithOverride?: string | null;
}

interface Contestant {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number | null;
  phone: string | null;
  email: string | null;
  auditionRating: string | null;
  suburb: string | null;
  medicalMobilityNotes: string | null;
  attendingWith: string | null;
}

export default function PlayersPage() {
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>('');

  const { data: recordDays = [], isLoading: loadingDays } = useQuery<RecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ['/api/contestants'],
  });

  const { data: rawAssignments = [], isLoading: loadingAssignments } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments', selectedRecordDayId !== 'all' ? selectedRecordDayId : undefined],
    queryFn: async () => {
      const url = selectedRecordDayId !== 'all' 
        ? `/api/seat-assignments?recordDayId=${selectedRecordDayId}`
        : '/api/seat-assignments';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch assignments');
      return response.json();
    },
    enabled: true,
  });

  const contestantsMap = useMemo(() => {
    return new Map(contestants.map(c => [c.id, c]));
  }, [contestants]);

  const allAssignments = useMemo(() => {
    return rawAssignments.map(a => {
      const contestant = contestantsMap.get(a.contestantId);
      return {
        ...a,
        contestant: contestant ? {
          id: contestant.id,
          firstName: contestant.firstName || contestant.name?.split(' ')[0] || '',
          lastName: contestant.lastName || contestant.name?.split(' ').slice(1).join(' ') || '',
          gender: contestant.gender,
          age: contestant.age,
          phone: contestant.phone,
          email: contestant.email,
          rating: contestant.auditionRating,
          suburb: contestant.suburb,
          medicalMobilityNotes: contestant.medicalMobilityNotes,
          attendingWith: contestant.attendingWith,
        } : null,
      };
    });
  }, [rawAssignments, contestantsMap]);

  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  // Set default to first record day when available
  useEffect(() => {
    if (!selectedRecordDayId && sortedRecordDays.length > 0) {
      setSelectedRecordDayId(sortedRecordDays[0].id);
    }
  }, [sortedRecordDays, selectedRecordDayId]);

  const { players, backups } = useMemo(() => {
    // Filter by selected record day
    const filtered = selectedRecordDayId 
      ? allAssignments.filter(a => a.recordDayId === selectedRecordDayId)
      : [];
    
    // Filter to only include assignments with contestant data
    const withContestants = filtered.filter(a => a.contestant);
    
    return {
      players: withContestants.filter(a => a.playerType === 'player').sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      }),
      backups: withContestants.filter(a => a.playerType === 'backup').sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      }),
    };
  }, [allAssignments, selectedRecordDayId]);

  const getRecordDayInfo = (recordDayId: string) => {
    const day = recordDays.find(d => d.id === recordDayId);
    return day ? `${day.rxNumber} - ${format(new Date(day.date), 'dd/MM/yyyy')}` : '';
  };

  const getStatusBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline" className="text-xs">Not Sent</Badge>;
    switch (status) {
      case 'confirmed':
        return <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 text-xs">Confirmed</Badge>;
      case 'declined':
        return <Badge className="bg-red-500/20 text-red-700 dark:text-red-400 text-xs">Declined</Badge>;
      case 'pending':
        return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">Pending</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const renderRating = (rating: number | null) => {
    if (!rating) return <span className="text-muted-foreground">-</span>;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            className={`h-3 w-3 ${i <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`}
          />
        ))}
      </div>
    );
  };

  const renderPlayerTable = (assignments: SeatAssignment[], title: string, icon: React.ReactNode, bgClass: string) => (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-2">{assignments.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4 text-center">No {title.toLowerCase()} found</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Block/Seat</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-16">Gender</TableHead>
                  <TableHead className="w-16">Age</TableHead>
                  <TableHead className="w-24">Rating</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Attending With</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map(assignment => {
                  const c = assignment.contestant;
                  if (!c) return null;
                  const attendingWith = assignment.attendingWithOverride || c.attendingWith;
                  const notes = assignment.medicalMobilityNotesOverride || c.medicalMobilityNotes;
                  
                  return (
                    <TableRow key={assignment.id} data-testid={`row-player-${assignment.id}`}>
                      <TableCell>
                        <Badge variant="outline" className={bgClass}>
                          B{assignment.blockNumber} {assignment.seatLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {c.firstName} {c.lastName}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={c.gender === 'Female' ? 'bg-pink-500/10 text-pink-700 dark:text-pink-400' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}
                        >
                          {c.gender === 'Female' ? 'F' : 'M'}
                        </Badge>
                      </TableCell>
                      <TableCell>{c.age || '-'}</TableCell>
                      <TableCell>{renderRating(c.rating)}</TableCell>
                      <TableCell className="text-sm">{c.suburb || '-'}</TableCell>
                      <TableCell>{getStatusBadge(assignment.bookingConfirmationStatus)}</TableCell>
                      <TableCell className="text-sm">{c.phone || '-'}</TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate" title={attendingWith || ''}>
                        {attendingWith || '-'}
                      </TableCell>
                      <TableCell className="text-sm max-w-[150px] truncate" title={notes || ''}>
                        {notes || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (loadingDays || loadingAssignments) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Players & Backups</h1>
          <p className="text-muted-foreground text-sm">View players and backups assigned to record days</p>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter by RX Day:</span>
          <Select value={selectedRecordDayId} onValueChange={setSelectedRecordDayId}>
            <SelectTrigger className="w-[220px]" data-testid="select-record-day-filter">
              <SelectValue placeholder="Select record day..." />
            </SelectTrigger>
            <SelectContent>
              {sortedRecordDays.map(day => (
                <SelectItem key={day.id} value={day.id}>
                  {day.rxNumber} - {format(new Date(day.date), 'dd/MM/yyyy')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{players.length}</p>
                <p className="text-sm text-muted-foreground">Players</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{backups.length}</p>
                <p className="text-sm text-muted-foreground">Backups</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {renderPlayerTable(
        players, 
        'Players', 
        <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
        'bg-blue-500/10 text-blue-700 dark:text-blue-400'
      )}
      
      {renderPlayerTable(
        backups, 
        'Backups', 
        <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
        'bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    </div>
  );
}
