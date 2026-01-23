import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Users, Play, Phone, Mail, MapPin, Upload, FileText, X, GripVertical, Calendar, Search, Filter, Star, Trash2 } from "lucide-react";
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

// RX Planning types - stored in localStorage only (visual planning tool)
interface PlannedContestant {
  id: string;
  name: string;
  gender: string;
  age: number | null;
  rating: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  attendingWith: string | null;
}

interface RXPlanningData {
  [recordDayId: string]: {
    episodes: {
      [episodeNumber: string]: PlannedContestant[];
    };
  };
}

const PLANNING_STORAGE_KEY = 'rx-planning-data';

function loadPlanningData(): RXPlanningData {
  try {
    const stored = localStorage.getItem(PLANNING_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function savePlanningData(data: RXPlanningData) {
  localStorage.setItem(PLANNING_STORAGE_KEY, JSON.stringify(data));
}

// RX Planning Tab Component
function RXPlanningTab({ recordDays, contestants }: { recordDays: RecordDay[]; contestants: Contestant[] }) {
  const { toast } = useToast();
  const [selectedDayId, setSelectedDayId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [planningData, setPlanningData] = useState<RXPlanningData>(loadPlanningData);
  const [draggedContestant, setDraggedContestant] = useState<PlannedContestant | null>(null);
  const [dragSource, setDragSource] = useState<{ type: 'pool' | 'episode'; episode?: string } | null>(null);

  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  useEffect(() => {
    if (!selectedDayId && sortedRecordDays.length > 0) {
      setSelectedDayId(sortedRecordDays[0].id);
    }
  }, [sortedRecordDays, selectedDayId]);

  // Filter to A+ and A contestants only
  const eligibleContestants = useMemo(() => {
    return contestants.filter(c => {
      const rating = c.auditionRating?.toUpperCase();
      return rating === 'A+' || rating === 'A';
    });
  }, [contestants]);

  // Get contestants already planned for current day
  const plannedContestantIds = useMemo(() => {
    if (!selectedDayId || !planningData[selectedDayId]) return new Set<string>();
    const ids = new Set<string>();
    Object.values(planningData[selectedDayId].episodes || {}).forEach(epContestants => {
      epContestants.forEach(c => ids.add(c.id));
    });
    return ids;
  }, [selectedDayId, planningData]);

  // Filtered contestant pool (not yet assigned to any episode)
  const filteredPool = useMemo(() => {
    return eligibleContestants.filter(c => {
      if (plannedContestantIds.has(c.id)) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (!c.name.toLowerCase().includes(term) && 
            !c.email?.toLowerCase().includes(term) &&
            !c.phone?.includes(term)) return false;
      }
      if (ratingFilter !== 'all' && c.auditionRating?.toUpperCase() !== ratingFilter) return false;
      if (genderFilter !== 'all' && c.gender?.toLowerCase() !== genderFilter.toLowerCase()) return false;
      return true;
    });
  }, [eligibleContestants, plannedContestantIds, searchTerm, ratingFilter, genderFilter]);

  // Get episodes for current day
  const currentDayEpisodes = useMemo(() => {
    const episodes: { [key: string]: PlannedContestant[] } = { '1': [], '2': [], '3': [], '4': [], '5': [] };
    if (selectedDayId && planningData[selectedDayId]?.episodes) {
      Object.keys(episodes).forEach(ep => {
        episodes[ep] = planningData[selectedDayId].episodes[ep] || [];
      });
    }
    return episodes;
  }, [selectedDayId, planningData]);

  const handleDragStart = (contestant: PlannedContestant, source: { type: 'pool' | 'episode'; episode?: string }) => {
    setDraggedContestant(contestant);
    setDragSource(source);
  };

  const handleDragEnd = () => {
    setDraggedContestant(null);
    setDragSource(null);
  };

  const handleDrop = (targetEpisode: string) => {
    if (!draggedContestant || !selectedDayId) return;

    setPlanningData(prev => {
      const updated = { ...prev };
      if (!updated[selectedDayId]) {
        updated[selectedDayId] = { episodes: { '1': [], '2': [], '3': [], '4': [], '5': [] } };
      }

      // Remove from source if coming from an episode
      if (dragSource?.type === 'episode' && dragSource.episode) {
        updated[selectedDayId].episodes[dragSource.episode] = 
          (updated[selectedDayId].episodes[dragSource.episode] || [])
            .filter(c => c.id !== draggedContestant.id);
      }

      // Add to target episode
      if (!updated[selectedDayId].episodes[targetEpisode]) {
        updated[selectedDayId].episodes[targetEpisode] = [];
      }
      // Avoid duplicates
      if (!updated[selectedDayId].episodes[targetEpisode].find(c => c.id === draggedContestant.id)) {
        updated[selectedDayId].episodes[targetEpisode].push(draggedContestant);
      }

      savePlanningData(updated);
      return updated;
    });

    toast({ title: "Added to Episode " + targetEpisode });
    handleDragEnd();
  };

  const removeFromEpisode = (episodeNumber: string, contestantId: string) => {
    if (!selectedDayId) return;
    setPlanningData(prev => {
      const updated = { ...prev };
      if (updated[selectedDayId]?.episodes[episodeNumber]) {
        updated[selectedDayId].episodes[episodeNumber] = 
          updated[selectedDayId].episodes[episodeNumber].filter(c => c.id !== contestantId);
      }
      savePlanningData(updated);
      return updated;
    });
  };

  const clearDayPlan = () => {
    if (!selectedDayId) return;
    setPlanningData(prev => {
      const updated = { ...prev };
      delete updated[selectedDayId];
      savePlanningData(updated);
      return updated;
    });
    toast({ title: "Plan cleared", description: "All contestants removed from this day's plan" });
  };

  const convertToPlannedContestant = (c: Contestant): PlannedContestant => ({
    id: c.id,
    name: c.name,
    gender: c.gender,
    age: c.age,
    rating: c.auditionRating,
    location: c.suburb,
    phone: c.phone,
    email: c.email,
    photoUrl: c.photoUrl,
    attendingWith: c.attendingWith,
  });

  const selectedDay = sortedRecordDays.find(d => d.id === selectedDayId);

  return (
    <div className="space-y-6">
      {/* Header with day selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">RX Day Episode Planner</h2>
          <p className="text-sm text-muted-foreground">Drag A+ and A rated contestants into episode slots (visual planning only)</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedDayId} onValueChange={setSelectedDayId}>
            <SelectTrigger className="w-[220px]" data-testid="select-planning-day">
              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Select RX Day..." />
            </SelectTrigger>
            <SelectContent>
              {sortedRecordDays.map(day => (
                <SelectItem key={day.id} value={day.id}>
                  {day.rxNumber} - {format(new Date(day.date), 'dd/MM/yyyy')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            size="sm"
            onClick={clearDayPlan}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            data-testid="button-clear-plan"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear Plan
          </Button>
        </div>
      </div>

      {!selectedDayId ? (
        <Card className="p-8 text-center text-muted-foreground">
          Select an RX Day to start planning episodes
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contestant Pool - Left side */}
          <div className="lg:col-span-1">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Star className="h-5 w-5 text-amber-500" />
                  A+ / A Contestants
                  <Badge variant="secondary">{filteredPool.length}</Badge>
                </CardTitle>
                {/* Filters */}
                <div className="space-y-2 pt-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search name, email, phone..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-planning-search"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Select value={ratingFilter} onValueChange={setRatingFilter}>
                      <SelectTrigger className="flex-1" data-testid="select-rating-filter">
                        <SelectValue placeholder="Rating" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Ratings</SelectItem>
                        <SelectItem value="A+">A+ Only</SelectItem>
                        <SelectItem value="A">A Only</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={genderFilter} onValueChange={setGenderFilter}>
                      <SelectTrigger className="flex-1" data-testid="select-gender-filter">
                        <SelectValue placeholder="Gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Genders</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="max-h-[600px] overflow-y-auto">
                <div className="space-y-2">
                  {filteredPool.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {eligibleContestants.length === 0 ? 'No A+ or A rated contestants found' : 'All matching contestants have been planned'}
                    </p>
                  ) : (
                    filteredPool.map(c => {
                      const planned = convertToPlannedContestant(c);
                      return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={() => handleDragStart(planned, { type: 'pool' })}
                          onDragEnd={handleDragEnd}
                          className="flex items-center gap-3 p-2 rounded-lg border bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing transition-colors"
                          data-testid={`draggable-contestant-${c.id}`}
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={c.photoUrl || undefined} />
                            <AvatarFallback className="text-xs">
                              {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{c.name}</span>
                              <Badge variant="outline" className={c.auditionRating === 'A+' ? 'bg-amber-500/10 text-amber-700 border-amber-300' : 'bg-blue-500/10 text-blue-700 border-blue-300'}>
                                {c.auditionRating}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{c.gender}</span>
                              {c.age && <span>• {c.age}y</span>}
                              {c.suburb && <span>• {c.suburb}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Episode Slots - Right side */}
          <div className="lg:col-span-2">
            <div className="space-y-4">
              {['1', '2', '3', '4', '5'].map(epNum => {
                const epContestants = currentDayEpisodes[epNum] || [];
                return (
                  <Card 
                    key={epNum}
                    className={`transition-colors ${draggedContestant ? 'border-dashed border-2 border-primary/50' : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(epNum)}
                    data-testid={`episode-drop-zone-${epNum}`}
                  >
                    <CardHeader className="pb-2 pt-3">
                      <CardTitle className="flex items-center gap-3">
                        <Badge className={`text-base px-3 py-1 ${epContestants.length > 0 ? 'bg-green-500' : 'bg-muted text-muted-foreground'}`}>
                          EP {epNum}
                        </Badge>
                        <span className="text-sm font-normal text-muted-foreground">
                          {epContestants.length === 0 ? 'Drop contestants here' : `${epContestants.length} contestant${epContestants.length !== 1 ? 's' : ''} planned`}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-3">
                      {epContestants.length === 0 ? (
                        <div className="py-6 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                          Drag A+ or A contestants here
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {epContestants.map(c => (
                            <div
                              key={c.id}
                              draggable
                              onDragStart={() => handleDragStart(c, { type: 'episode', episode: epNum })}
                              onDragEnd={handleDragEnd}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 cursor-grab active:cursor-grabbing group"
                              data-testid={`planned-contestant-${epNum}-${c.id}`}
                            >
                              <Avatar className="h-7 w-7">
                                <AvatarImage src={c.photoUrl || undefined} />
                                <AvatarFallback className="text-xs bg-green-500/20 text-green-700">
                                  {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span className="font-medium text-sm">{c.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {c.rating} • {c.gender}{c.age ? ` • ${c.age}y` : ''}
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                onClick={() => removeFromEpisode(epNum, c.id)}
                                data-testid={`remove-contestant-${epNum}-${c.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Info notice */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="py-3">
          <p className="text-sm text-blue-700 dark:text-blue-400 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <strong>Note:</strong> This is a visual planning tool only. Changes here do not affect contestant bookings, statuses, or the seating chart. Use this to plan your ideal episode lineup before making actual assignments.
          </p>
        </CardContent>
      </Card>
    </div>
  );
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
          <Avatar 
            className={`h-16 w-16 border-2 border-background shadow-sm ${c.photoUrl ? 'cursor-pointer hover:ring-2 hover:ring-primary transition-all' : ''}`}
            onClick={() => c.photoUrl && setViewingPhoto({ url: c.photoUrl, name: `${c.firstName} ${c.lastName}` })}
          >
            <AvatarImage src={c.photoUrl || undefined} alt={`${c.firstName} ${c.lastName}`} />
            <AvatarFallback className={isPlayer ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'}>
              {getInitials(c.firstName, c.lastName)}
            </AvatarFallback>
          </Avatar>
          
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
      <Tabs defaultValue="players" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Players</h1>
            <TabsList>
              <TabsTrigger value="players" data-testid="tab-players">
                <User className="h-4 w-4 mr-2" />
                Players & Backups
              </TabsTrigger>
              <TabsTrigger value="planning" data-testid="tab-planning">
                <Calendar className="h-4 w-4 mr-2" />
                RX Planning
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="players" className="mt-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <p className="text-muted-foreground text-sm">Assign episode order for the day (5 episodes per day)</p>
            
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
            <DialogContent className="max-w-5xl max-h-[95vh] p-4">
              {viewingPhoto && (
                <div className="flex flex-col items-center">
                  <img
                    src={viewingPhoto.url}
                    alt={viewingPhoto.name}
                    className="max-h-[85vh] max-w-full object-contain rounded-lg"
                  />
                  <p className="mt-4 text-xl font-medium">{viewingPhoto.name}</p>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="planning" className="mt-0">
          <RXPlanningTab recordDays={recordDays} contestants={contestants} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
