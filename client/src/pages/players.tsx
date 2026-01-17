import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Star, User, Users, Play } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  rxEpNumber: string | null;
  bookingConfirmationStatus: string | null;
  contestant: {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    age: number | null;
    phone: string | null;
    email: string | null;
    rating: string | null;
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

interface EpisodeGroup {
  episodeNumber: string;
  players: SeatAssignment[];
  backups: SeatAssignment[];
}

export default function PlayersPage() {
  const { toast } = useToast();
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>('');

  const { data: recordDays = [], isLoading: loadingDays } = useQuery<RecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ['/api/contestants'],
  });

  const { data: rawAssignments = [], isLoading: loadingAssignments } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments', selectedRecordDayId || undefined],
    queryFn: async () => {
      const url = selectedRecordDayId 
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

  useEffect(() => {
    if (!selectedRecordDayId && sortedRecordDays.length > 0) {
      setSelectedRecordDayId(sortedRecordDays[0].id);
    }
  }, [sortedRecordDays, selectedRecordDayId]);

  const { players, backups } = useMemo(() => {
    const filtered = selectedRecordDayId 
      ? allAssignments.filter(a => a.recordDayId === selectedRecordDayId)
      : [];
    
    const withContestants = filtered.filter(a => a.contestant);
    
    return {
      players: withContestants.filter(a => a.playerType === 'player').sort((a, b) => {
        const epA = parseInt(a.rxEpNumber) || 99;
        const epB = parseInt(b.rxEpNumber) || 99;
        if (epA !== epB) return epA - epB;
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      }),
      backups: withContestants.filter(a => a.playerType === 'backup').sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      }),
    };
  }, [allAssignments, selectedRecordDayId]);

  const episodeGroups = useMemo(() => {
    const groups: EpisodeGroup[] = [];
    
    for (let ep = 1; ep <= 5; ep++) {
      const epStr = ep.toString();
      const epPlayers = players.filter(p => p.rxEpNumber === epStr);
      
      const blockNumbers = new Set(epPlayers.map(p => p.blockNumber));
      const epBackups = backups.filter(b => blockNumbers.has(b.blockNumber));
      
      groups.push({
        episodeNumber: epStr,
        players: epPlayers,
        backups: epBackups,
      });
    }
    
    const unassignedPlayers = players.filter(p => !p.rxEpNumber || !['1','2','3','4','5'].includes(p.rxEpNumber));
    const assignedBackupIds = new Set(groups.flatMap(g => g.backups.map(b => b.id)));
    const unassignedBackups = backups.filter(b => !assignedBackupIds.has(b.id));
    const assignedCount = groups.filter(g => g.players.length > 0).length;
    
    return { groups, unassignedPlayers, unassignedBackups, assignedCount };
  }, [players, backups]);

  const updateEpisodeMutation = useMutation({
    mutationFn: async ({ assignmentId, episodeNumber }: { assignmentId: string; episodeNumber: string | null }) => {
      const response = await apiRequest('PATCH', `/api/seat-assignments/${assignmentId}/workflow`, {
        rxEpNumber: episodeNumber,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Updated", description: "Episode number saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const handleEpisodeChange = (assignmentId: string, value: string) => {
    const episodeNumber = value === 'none' ? null : value;
    updateEpisodeMutation.mutate({ assignmentId, episodeNumber });
  };

  const renderPersonRow = (assignment: SeatAssignment, isPlayer: boolean, showEpisodeSelector: boolean = false, showEpisodeColumn: boolean = false) => {
    const c = assignment.contestant;
    if (!c) return null;
    const attendingWith = assignment.attendingWithOverride || c.attendingWith;
    const notes = assignment.medicalMobilityNotesOverride || c.medicalMobilityNotes;
    
    return (
      <TableRow key={assignment.id} className={isPlayer ? 'bg-blue-500/5' : 'bg-amber-500/5'}>
        {showEpisodeColumn && (
          <TableCell>
            {showEpisodeSelector ? (
              <Select 
                value={assignment.rxEpNumber || 'none'} 
                onValueChange={(v) => handleEpisodeChange(assignment.id, v)}
                disabled={updateEpisodeMutation.isPending}
              >
                <SelectTrigger className="w-16 h-7 text-xs" data-testid={`select-episode-${assignment.id}`}>
                  <SelectValue placeholder="-" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  <SelectItem value="1">EP 1</SelectItem>
                  <SelectItem value="2">EP 2</SelectItem>
                  <SelectItem value="3">EP 3</SelectItem>
                  <SelectItem value="4">EP 4</SelectItem>
                  <SelectItem value="5">EP 5</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="text-muted-foreground text-xs">-</span>
            )}
          </TableCell>
        )}
        <TableCell>
          <Badge variant="outline" className={isPlayer ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}>
            {isPlayer ? 'P' : 'B'} B{assignment.blockNumber} {assignment.seatLabel}
          </Badge>
        </TableCell>
        <TableCell className="font-medium">{c.firstName} {c.lastName}</TableCell>
        <TableCell>
          <Badge variant="outline" className={c.gender === 'Female' ? 'bg-pink-500/10 text-pink-700 dark:text-pink-400' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}>
            {c.gender === 'Female' ? 'F' : 'M'}
          </Badge>
        </TableCell>
        <TableCell>{c.age || '-'}</TableCell>
        <TableCell className="text-sm">{c.suburb || '-'}</TableCell>
        <TableCell className="text-sm">{c.phone || '-'}</TableCell>
        <TableCell className="text-sm max-w-[120px] truncate" title={attendingWith || ''}>{attendingWith || '-'}</TableCell>
        <TableCell className="text-sm max-w-[120px] truncate" title={notes || ''}>{notes || '-'}</TableCell>
      </TableRow>
    );
  };

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
          <p className="text-muted-foreground text-sm">Assign episode order for the day (5 episodes per day)</p>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">RX Day:</span>
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

      <div className="grid grid-cols-3 gap-4 mb-6">
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
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Play className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{episodeGroups.assignedCount}/5</p>
                <p className="text-sm text-muted-foreground">Episodes Assigned</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {episodeGroups.groups.map(group => {
        const hasConflict = group.players.length > 1;
        return (
          <Card key={group.episodeNumber} className={`mb-4 ${hasConflict ? 'border-red-500' : ''}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Badge className={group.players.length > 0 ? (hasConflict ? 'bg-red-500' : 'bg-green-500') : 'bg-muted text-muted-foreground'}>
                  EP {group.episodeNumber}
                </Badge>
                {hasConflict ? (
                  <span className="text-sm font-normal text-red-600 dark:text-red-400">
                    Conflict: {group.players.length} players assigned
                  </span>
                ) : group.players.length === 1 ? (
                  <span className="text-sm font-normal text-muted-foreground">
                    Block {group.players[0].blockNumber} - {group.players[0].contestant?.firstName} {group.players[0].contestant?.lastName}
                  </span>
                ) : (
                  <span className="text-sm font-normal text-muted-foreground italic">No player assigned</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {group.players.length > 0 || group.backups.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Episode</TableHead>
                      <TableHead className="w-24">Type/Seat</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-14">Gender</TableHead>
                      <TableHead className="w-14">Age</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Attending With</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.players.map(player => renderPersonRow(player, true, true, true))}
                    {group.backups.map(backup => renderPersonRow(backup, false, false, true))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">Assign a player to this episode from the unassigned list below</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {episodeGroups.unassignedPlayers.length > 0 && (
        <Card className="mb-4 border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-600 dark:text-amber-400">
              <User className="h-5 w-5" />
              Unassigned Players
              <Badge variant="secondary">{episodeGroups.unassignedPlayers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Episode</TableHead>
                  <TableHead className="w-24">Seat</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-14">Gender</TableHead>
                  <TableHead className="w-14">Age</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Attending With</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {episodeGroups.unassignedPlayers.map(player => renderPersonRow(player, true, true, true))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {episodeGroups.unassignedBackups.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg text-muted-foreground">
              <Users className="h-5 w-5" />
              Backups Without Episode (Block doesn't match any assigned player)
              <Badge variant="secondary">{episodeGroups.unassignedBackups.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Seat</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-14">Gender</TableHead>
                  <TableHead className="w-14">Age</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Attending With</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {episodeGroups.unassignedBackups.map(backup => renderPersonRow(backup, false, false))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
