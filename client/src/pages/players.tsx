import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Users, Play, Phone, Mail, MapPin, Upload, FileText, X, ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  castingCardUrl: string | null;
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
    photoUrl: string | null;
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
  photoUrl: string | null;
}

interface EpisodeGroup {
  episodeNumber: string;
  players: SeatAssignment[];
  backups: SeatAssignment[];
}

export default function PlayersPage() {
  const { toast } = useToast();
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>('');
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; name: string } | null>(null);

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
          photoUrl: contestant.photoUrl,
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

  const uploadCastingCardMutation = useMutation({
    mutationFn: async ({ assignmentId, file }: { assignmentId: string; file: File }) => {
      const formData = new FormData();
      formData.append('castingCard', file);
      const response = await fetch(`/api/seat-assignments/${assignmentId}/casting-card`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to upload casting card');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Success", description: "Casting card uploaded" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to upload", variant: "destructive" });
    },
  });

  const deleteCastingCardMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest('DELETE', `/api/seat-assignments/${assignmentId}/casting-card`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Deleted", description: "Casting card removed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete", variant: "destructive" });
    },
  });

  const handleCastingCardUpload = (assignmentId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        uploadCastingCardMutation.mutate({ assignmentId, file });
      }
    };
    input.click();
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
  };

  const renderPersonCard = (assignment: SeatAssignment, isPlayer: boolean, showEpisodeSelector: boolean = false) => {
    const c = assignment.contestant;
    if (!c) return null;
    const attendingWith = assignment.attendingWithOverride || c.attendingWith;
    const notes = assignment.medicalMobilityNotesOverride || c.medicalMobilityNotes;
    
    return (
      <div 
        key={assignment.id} 
        className={`p-4 rounded-lg border ${isPlayer ? 'bg-blue-500/5 border-blue-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}
        data-testid={`card-person-${assignment.id}`}
      >
        <div className="flex gap-4">
          <div 
            className={`relative group ${c.photoUrl ? 'cursor-pointer' : ''}`}
            onClick={() => c.photoUrl && setViewingPhoto({ url: c.photoUrl, name: `${c.firstName} ${c.lastName}` })}
          >
            <Avatar className="h-16 w-16 border-2 border-background shadow-sm">
              <AvatarImage src={c.photoUrl || undefined} alt={`${c.firstName} ${c.lastName}`} />
              <AvatarFallback className={isPlayer ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'}>
                {getInitials(c.firstName, c.lastName)}
              </AvatarFallback>
            </Avatar>
            {c.photoUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="h-5 w-5 text-white" />
              </div>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-lg">{c.firstName} {c.lastName}</span>
              <Badge variant="outline" className={isPlayer ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}>
                {isPlayer ? 'PLAYER' : 'BACKUP'}
              </Badge>
              <Badge variant="outline" className={c.gender === 'Female' ? 'bg-pink-500/10 text-pink-700 dark:text-pink-400' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}>
                {c.gender === 'Female' ? 'F' : 'M'} {c.age || ''}
              </Badge>
              {showEpisodeSelector && (
                <Select 
                  value={assignment.rxEpNumber || 'none'} 
                  onValueChange={(v) => handleEpisodeChange(assignment.id, v)}
                  disabled={updateEpisodeMutation.isPending}
                >
                  <SelectTrigger className="w-20 h-7 text-xs" data-testid={`select-episode-${assignment.id}`}>
                    <SelectValue placeholder="EP -" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="1">EP 1</SelectItem>
                    <SelectItem value="2">EP 2</SelectItem>
                    <SelectItem value="3">EP 3</SelectItem>
                    <SelectItem value="4">EP 4</SelectItem>
                    <SelectItem value="5">EP 5</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            
            <div className="flex items-center gap-1 text-sm mb-1">
              <Badge className="bg-primary/10 text-primary font-bold">
                Block {assignment.blockNumber} - Seat {assignment.seatLabel}
              </Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
              {c.phone && (
                <div className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  <span>{c.phone}</span>
                </div>
              )}
              {c.email && (
                <div className="flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{c.email}</span>
                </div>
              )}
              {c.suburb && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  <span>{c.suburb}</span>
                </div>
              )}
              {attendingWith && (
                <div className="flex items-center gap-1 truncate">
                  <Users className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate" title={attendingWith}>{attendingWith}</span>
                </div>
              )}
            </div>
            
            {notes && (
              <div className="mt-2 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                {notes}
              </div>
            )}
            
            {isPlayer && (
              <div className="mt-3 flex items-center gap-2">
                {assignment.castingCardUrl ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => window.open(assignment.castingCardUrl!, '_blank')}
                      data-testid={`button-view-casting-card-${assignment.id}`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View Casting Card
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteCastingCardMutation.mutate(assignment.id)}
                      disabled={deleteCastingCardMutation.isPending}
                      data-testid={`button-delete-casting-card-${assignment.id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => handleCastingCardUpload(assignment.id)}
                    disabled={uploadCastingCardMutation.isPending}
                    data-testid={`button-upload-casting-card-${assignment.id}`}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload Casting Card
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
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
          <Card key={group.episodeNumber} className={`mb-4 ${hasConflict ? 'border-red-500 border-2' : ''}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3">
                <Badge className={`text-lg px-3 py-1 ${group.players.length > 0 ? (hasConflict ? 'bg-red-500' : 'bg-green-500') : 'bg-muted text-muted-foreground'}`}>
                  EP {group.episodeNumber}
                </Badge>
                {hasConflict ? (
                  <span className="text-base font-semibold text-red-600 dark:text-red-400">
                    Conflict: {group.players.length} players assigned
                  </span>
                ) : group.players.length === 1 ? (
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground text-base font-bold px-3 py-1">
                      BLOCK {group.players[0].blockNumber}
                    </Badge>
                    <span className="text-base font-medium">
                      {group.players[0].contestant?.firstName} {group.players[0].contestant?.lastName}
                    </span>
                  </div>
                ) : (
                  <span className="text-base font-normal text-muted-foreground italic">No player assigned</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {group.players.length > 0 || group.backups.length > 0 ? (
                <div className="space-y-3">
                  {group.players.map(player => renderPersonCard(player, true, true))}
                  {group.backups.length > 0 && (
                    <>
                      {group.players.length > 0 && <div className="border-t pt-3 mt-3" />}
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Backups for this block</p>
                      {group.backups.map(backup => renderPersonCard(backup, false, false))}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Assign a player to this episode from the unassigned list below</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {episodeGroups.unassignedPlayers.length > 0 && (
        <Card className="mb-4 border-dashed border-amber-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-600 dark:text-amber-400">
              <User className="h-5 w-5" />
              Unassigned Players
              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400">{episodeGroups.unassignedPlayers.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">Select an episode for each player using the dropdown</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {episodeGroups.unassignedPlayers.map(player => renderPersonCard(player, true, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {episodeGroups.unassignedBackups.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-muted-foreground">
              <Users className="h-5 w-5" />
              Backups Without Episode
              <Badge variant="secondary">{episodeGroups.unassignedBackups.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">These backups' blocks don't match any assigned player</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {episodeGroups.unassignedBackups.map(backup => renderPersonCard(backup, false, false))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photo lightbox dialog */}
      <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
        <DialogContent className="max-w-3xl p-2">
          {viewingPhoto && (
            <div className="flex flex-col items-center">
              <img
                src={viewingPhoto.url}
                alt={viewingPhoto.name}
                className="max-h-[80vh] w-auto object-contain rounded-lg"
              />
              <p className="mt-3 text-lg font-medium">{viewingPhoto.name}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
