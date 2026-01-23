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
    blocks: {
      [blockNumber: string]: PlannedContestant[];
    };
  };
}

interface BlockTypeData {
  id?: string;
  recordDayId: string;
  blockNumber: number;
  blockType: 'PB' | 'NPB';
}

const PLANNING_STORAGE_KEY = 'rx-planning-data-v2';

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
  const [ageFilter, setAgeFilter] = useState<string>('all');
  const [planningData, setPlanningData] = useState<RXPlanningData>(loadPlanningData);
  const [draggedContestant, setDraggedContestant] = useState<PlannedContestant | null>(null);
  const [dragSource, setDragSource] = useState<{ type: 'pool' | 'block'; block?: string; dayId?: string } | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; name: string } | null>(null);
  const [viewingContestant, setViewingContestant] = useState<Contestant | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'weekly'>('single');

  // Fetch block types from API - refetch when tab is shown to sync with seating chart changes
  const { data: blockTypes = [] } = useQuery<BlockTypeData[]>({
    queryKey: ['/api/record-days', selectedDayId, 'block-types'],
    enabled: !!selectedDayId,
    staleTime: 0, // Always fetch fresh data to sync with seating chart
    refetchOnMount: 'always', // Refetch when component mounts (e.g., tab switch)
  });

  const updateBlockTypeMutation = useMutation({
    mutationFn: async ({ dayId, blockNumber, blockType }: { dayId: string; blockNumber: number; blockType: 'PB' | 'NPB' }) => {
      if (!dayId) throw new Error("No record day selected");
      const response = await apiRequest('PUT', `/api/record-days/${dayId}/block-types/${blockNumber}`, { blockType });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', variables.dayId, 'block-types'] });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      toast({ title: "Block type saved", description: "This change is reflected on the seating chart" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update block type", variant: "destructive" });
    },
  });

  const handleBlockTypeChange = (blockNumber: number, blockType: 'PB' | 'NPB') => {
    if (!selectedDayId) return;
    updateBlockTypeMutation.mutate({ dayId: selectedDayId, blockNumber, blockType });
  };

  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  useEffect(() => {
    if (!selectedDayId && sortedRecordDays.length > 0) {
      setSelectedDayId(sortedRecordDays[0].id);
    }
  }, [sortedRecordDays, selectedDayId]);

  // Get block type for a specific block
  const getBlockType = (blockNumber: number): 'PB' | 'NPB' | null => {
    const bt = blockTypes.find(b => b.blockNumber === blockNumber);
    return bt?.blockType || null;
  };

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
    Object.values(planningData[selectedDayId].blocks || {}).forEach(blockContestants => {
      blockContestants.forEach(c => ids.add(c.id));
    });
    return ids;
  }, [selectedDayId, planningData]);

  // Filtered contestant pool (not yet assigned to any block)
  const filteredPool = useMemo(() => {
    // In weekly view, exclude contestants planned in any of the week's days
    const excludeIds = viewMode === 'weekly' ? weekPlannedContestantIds : plannedContestantIds;
    return eligibleContestants.filter(c => {
      if (excludeIds.has(c.id)) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (!c.name.toLowerCase().includes(term) && 
            !c.email?.toLowerCase().includes(term) &&
            !c.phone?.includes(term)) return false;
      }
      if (ratingFilter !== 'all' && c.auditionRating?.toUpperCase() !== ratingFilter) return false;
      if (genderFilter !== 'all' && c.gender?.toLowerCase() !== genderFilter.toLowerCase()) return false;
      // Age filter
      if (ageFilter !== 'all' && c.age) {
        const age = c.age;
        switch (ageFilter) {
          case '18-29': if (age < 18 || age > 29) return false; break;
          case '30-39': if (age < 30 || age > 39) return false; break;
          case '40-49': if (age < 40 || age > 49) return false; break;
          case '50-59': if (age < 50 || age > 59) return false; break;
          case '60-69': if (age < 60 || age > 69) return false; break;
          case '70+': if (age < 70) return false; break;
        }
      } else if (ageFilter !== 'all' && !c.age) {
        return false; // Exclude contestants without age data when filtering by age
      }
      return true;
    });
  }, [eligibleContestants, plannedContestantIds, weekPlannedContestantIds, viewMode, searchTerm, ratingFilter, genderFilter, ageFilter]);

  // Get blocks for current day
  const currentDayBlocks = useMemo(() => {
    const blocks: { [key: string]: PlannedContestant[] } = { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] };
    if (selectedDayId && planningData[selectedDayId]?.blocks) {
      Object.keys(blocks).forEach(block => {
        blocks[block] = planningData[selectedDayId].blocks[block] || [];
      });
    }
    return blocks;
  }, [selectedDayId, planningData]);

  const handleDragStart = (contestant: PlannedContestant, source: { type: 'pool' | 'block'; block?: string }) => {
    setDraggedContestant(contestant);
    setDragSource(source);
  };

  const handleDragEnd = () => {
    setDraggedContestant(null);
    setDragSource(null);
  };

  const handleDrop = (targetBlock: string, targetDayId?: string) => {
    if (!draggedContestant) return;
    const dropDayId = targetDayId || selectedDayId;
    if (!dropDayId) return;

    setPlanningData(prev => {
      const updated = { ...prev };
      if (!updated[dropDayId]) {
        updated[dropDayId] = { blocks: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] } };
      }

      // Remove from source if coming from a block
      if (dragSource?.type === 'block' && dragSource.block) {
        const sourceDayId = dragSource.dayId || selectedDayId;
        if (sourceDayId && updated[sourceDayId]?.blocks[dragSource.block]) {
          updated[sourceDayId].blocks[dragSource.block] = 
            updated[sourceDayId].blocks[dragSource.block].filter(c => c.id !== draggedContestant.id);
        }
      }

      // Add to target block
      if (!updated[dropDayId].blocks[targetBlock]) {
        updated[dropDayId].blocks[targetBlock] = [];
      }
      // Avoid duplicates
      if (!updated[dropDayId].blocks[targetBlock].find(c => c.id === draggedContestant.id)) {
        updated[dropDayId].blocks[targetBlock].push(draggedContestant);
      }

      savePlanningData(updated);
      return updated;
    });

    toast({ title: "Added to Block " + targetBlock });
    handleDragEnd();
  };

  const removeFromBlock = (blockNumber: string, contestantId: string, dayId?: string) => {
    const removeDayId = dayId || selectedDayId;
    if (!removeDayId) return;
    setPlanningData(prev => {
      const updated = { ...prev };
      if (updated[removeDayId]?.blocks[blockNumber]) {
        updated[removeDayId].blocks[blockNumber] = 
          updated[removeDayId].blocks[blockNumber].filter(c => c.id !== contestantId);
      }
      savePlanningData(updated);
      return updated;
    });
  };

  // Get week's worth of RX days starting from selected day
  const weekDays = useMemo(() => {
    if (!selectedDayId) return [];
    const selectedIdx = sortedRecordDays.findIndex(d => d.id === selectedDayId);
    if (selectedIdx === -1) return [];
    // Get up to 4 consecutive days starting from selected
    return sortedRecordDays.slice(selectedIdx, selectedIdx + 4);
  }, [selectedDayId, sortedRecordDays]);

  // Get blocks for a specific day
  const getBlocksForDay = (dayId: string) => {
    const blocks: { [key: string]: PlannedContestant[] } = { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] };
    if (planningData[dayId]?.blocks) {
      Object.keys(blocks).forEach(block => {
        blocks[block] = planningData[dayId].blocks[block] || [];
      });
    }
    return blocks;
  };

  // Get all planned contestant IDs across week (for filtering pool)
  const weekPlannedContestantIds = useMemo(() => {
    const ids = new Set<string>();
    weekDays.forEach(day => {
      if (planningData[day.id]?.blocks) {
        Object.values(planningData[day.id].blocks).forEach(blockContestants => {
          blockContestants.forEach(c => ids.add(c.id));
        });
      }
    });
    return ids;
  }, [weekDays, planningData]);

  // Find full contestant record by ID
  const findContestant = (id: string) => contestants.find(c => c.id === id);

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

  // Count PB and NPB blocks
  const pbCount = blockTypes.filter(b => b.blockType === 'PB').length;
  const npbCount = blockTypes.filter(b => b.blockType === 'NPB').length;

  return (
    <div className="space-y-6">
      {/* Header with day selector and view mode */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">RX Day Block Planner</h2>
          <p className="text-sm text-muted-foreground">Configure PB/NPB blocks (syncs to seating chart) and plan contestants visually</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode toggle */}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={viewMode === 'single' ? 'default' : 'outline'}
              onClick={() => setViewMode('single')}
              data-testid="button-view-single"
            >
              Single Day
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'weekly' ? 'default' : 'outline'}
              onClick={() => setViewMode('weekly')}
              data-testid="button-view-weekly"
            >
              Weekly ({weekDays.length} days)
            </Button>
          </div>
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
            Clear
          </Button>
        </div>
      </div>

      {/* PB/NPB counter - only show in single day mode */}
      {selectedDayId && viewMode === 'single' && (
        <div className="flex items-center gap-4">
          <Badge className={`${pbCount === 5 ? 'bg-blue-500' : 'bg-muted'}`}>
            PB: {pbCount}/5
          </Badge>
          <Badge className={`${npbCount === 2 ? 'bg-amber-500' : 'bg-muted'}`}>
            NPB: {npbCount}/2
          </Badge>
          {pbCount === 5 && npbCount === 2 && (
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Configuration complete</span>
          )}
        </div>
      )}

      {!selectedDayId ? (
        <Card className="p-8 text-center text-muted-foreground">
          Select an RX Day to start planning blocks
        </Card>
      ) : (
        <div className="flex gap-6">
          {/* Contestant Pool - Left side */}
          <div className="w-80 flex-shrink-0">
            <Card className="h-full sticky top-4">
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
                  <Select value={ageFilter} onValueChange={setAgeFilter}>
                    <SelectTrigger data-testid="select-age-filter">
                      <SelectValue placeholder="Age Range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Ages</SelectItem>
                      <SelectItem value="18-29">18-29</SelectItem>
                      <SelectItem value="30-39">30-39</SelectItem>
                      <SelectItem value="40-49">40-49</SelectItem>
                      <SelectItem value="50-59">50-59</SelectItem>
                      <SelectItem value="60-69">60-69</SelectItem>
                      <SelectItem value="70+">70+</SelectItem>
                    </SelectContent>
                  </Select>
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
                          onClick={() => setViewingContestant(c)}
                          className="p-2 rounded-lg border bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing transition-colors"
                          data-testid={`draggable-contestant-${c.id}`}
                        >
                          <div className="flex gap-2 items-center">
                            <Avatar className="h-10 w-10 rounded-lg border flex-shrink-0">
                              <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                              <AvatarFallback className="text-xs rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                                {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-sm truncate">{c.name}</span>
                                <Badge variant="outline" className={`text-[10px] px-1 py-0 ${c.auditionRating === 'A+' ? 'bg-amber-500/10 text-amber-700 border-amber-300' : 'bg-blue-500/10 text-blue-700 border-blue-300'}`}>
                                  {c.auditionRating}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span>{c.gender === 'Female' ? 'F' : 'M'}</span>
                                {c.age && <><span>•</span><span>{c.age}y</span></>}
                                {c.suburb && <><span>•</span><span className="truncate max-w-[80px]">{c.suburb}</span></>}
                              </div>
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

          {/* Days/Blocks - Right side */}
          <div className="flex-1 overflow-x-auto">
            {viewMode === 'single' ? (
              /* Single Day View - Vertical Blocks */
              <div className="space-y-3">
                {['1', '2', '3', '4', '5', '6', '7'].map(blockNum => {
                  const blockContestants = currentDayBlocks[blockNum] || [];
                  const blockType = getBlockType(parseInt(blockNum));
                  const isPB = blockType === 'PB';
                  const isNPB = blockType === 'NPB';
                  
                  return (
                    <Card 
                      key={blockNum}
                      className={`transition-colors ${draggedContestant ? 'border-dashed border-2 border-primary/50' : ''} ${isPB ? 'border-blue-500/50' : isNPB ? 'border-amber-500/50' : ''}`}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => handleDrop(blockNum)}
                      data-testid={`block-drop-zone-${blockNum}`}
                    >
                      <div className="flex items-center gap-4 p-3">
                        <div className="flex items-center gap-2 w-32 flex-shrink-0">
                          <Badge className={`px-3 py-1 ${isPB ? 'bg-blue-500' : isNPB ? 'bg-amber-500' : 'bg-muted text-muted-foreground'}`}>
                            Block {blockNum}
                          </Badge>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant={isPB ? "default" : "outline"}
                              className="h-6 px-2 text-xs"
                              onClick={() => handleBlockTypeChange(parseInt(blockNum), 'PB')}
                              disabled={updateBlockTypeMutation.isPending}
                              data-testid={`button-set-pb-${blockNum}`}
                            >
                              PB
                            </Button>
                            <Button
                              size="sm"
                              variant={isNPB ? "default" : "outline"}
                              className="h-6 px-2 text-xs"
                              onClick={() => handleBlockTypeChange(parseInt(blockNum), 'NPB')}
                              disabled={updateBlockTypeMutation.isPending}
                              data-testid={`button-set-npb-${blockNum}`}
                            >
                              NPB
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 flex gap-2 flex-wrap min-h-[48px] p-2 rounded-lg border-2 border-dashed border-muted">
                          {blockContestants.length === 0 ? (
                            <span className="text-xs text-muted-foreground self-center">Drop contestants here</span>
                          ) : (
                            blockContestants.map(c => (
                              <div
                                key={c.id}
                                draggable
                                onDragStart={() => handleDragStart(c, { type: 'block', block: blockNum, dayId: selectedDayId })}
                                onDragEnd={handleDragEnd}
                                onClick={() => { const full = findContestant(c.id); if (full) setViewingContestant(full); }}
                                className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-grab group ${isPB ? 'bg-blue-500/10 border border-blue-500/30' : isNPB ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-green-500/10 border border-green-500/30'}`}
                                data-testid={`planned-contestant-${blockNum}-${c.id}`}
                              >
                                <Avatar className="h-8 w-8 rounded-lg">
                                  <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                                  <AvatarFallback className="text-xs rounded-lg bg-gradient-to-br from-blue-400 to-purple-500 text-white">
                                    {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="text-sm">
                                  <span className="font-medium">{c.name}</span>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    {c.gender === 'Female' ? 'F' : 'M'}{c.age ? `/${c.age}` : ''}
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 opacity-0 group-hover:opacity-100"
                                  onClick={(e) => { e.stopPropagation(); removeFromBlock(blockNum, c.id); }}
                                  data-testid={`remove-contestant-${blockNum}-${c.id}`}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Weekly View - Multiple Days Side by Side */
              <div className="flex gap-4">
                {weekDays.map(day => {
                  const dayBlocks = getBlocksForDay(day.id);
                  return (
                    <div key={day.id} className="min-w-[280px] flex-shrink-0">
                      <Card className="mb-3">
                        <CardHeader className="py-2 px-3">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {day.rxNumber} - {format(new Date(day.date), 'EEE dd/MM')}
                          </CardTitle>
                        </CardHeader>
                      </Card>
                      <div className="space-y-2">
                        {['1', '2', '3', '4', '5', '6', '7'].map(blockNum => {
                          const blockContestants = dayBlocks[blockNum] || [];
                          return (
                            <Card 
                              key={blockNum}
                              className={`transition-colors ${draggedContestant ? 'border-dashed border-primary/50' : ''}`}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => handleDrop(blockNum, day.id)}
                              data-testid={`weekly-block-${day.id}-${blockNum}`}
                            >
                              <div className="p-2">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="outline" className="text-xs">B{blockNum}</Badge>
                                  <span className="text-xs text-muted-foreground">{blockContestants.length} planned</span>
                                </div>
                                <div className="space-y-1 min-h-[32px]">
                                  {blockContestants.length === 0 ? (
                                    <div className="text-[10px] text-muted-foreground text-center py-1 border border-dashed rounded">
                                      Drop here
                                    </div>
                                  ) : (
                                    blockContestants.map(c => (
                                      <div
                                        key={c.id}
                                        draggable
                                        onDragStart={() => handleDragStart(c, { type: 'block', block: blockNum, dayId: day.id })}
                                        onDragEnd={handleDragEnd}
                                        onClick={() => { const full = findContestant(c.id); if (full) setViewingContestant(full); }}
                                        className="flex items-center gap-1 px-1 py-0.5 rounded bg-muted/50 cursor-grab group text-xs"
                                        data-testid={`weekly-contestant-${day.id}-${blockNum}-${c.id}`}
                                      >
                                        <Avatar className="h-5 w-5 rounded">
                                          <AvatarImage src={c.photoUrl || undefined} />
                                          <AvatarFallback className="text-[8px]">
                                            {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="truncate flex-1">{c.name}</span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-4 w-4 opacity-0 group-hover:opacity-100"
                                          onClick={(e) => { e.stopPropagation(); removeFromBlock(blockNum, c.id, day.id); }}
                                        >
                                          <X className="h-2 w-2" />
                                        </Button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info notice */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="py-3">
          <p className="text-sm text-blue-700 dark:text-blue-400 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <strong>PB/NPB settings sync to seating chart.</strong> Contestant placements are visual planning only and do not affect bookings or statuses.
          </p>
        </CardContent>
      </Card>

      {/* Photo lightbox */}
      <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-4" data-testid="dialog-photo-lightbox">
          {viewingPhoto && (
            <div className="flex flex-col items-center">
              <img
                src={viewingPhoto.url}
                alt={viewingPhoto.name}
                className="max-h-[80vh] max-w-full object-contain rounded-lg"
                data-testid="img-lightbox-photo"
              />
              <p className="mt-4 text-lg font-medium" data-testid="text-lightbox-name">{viewingPhoto.name}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Contestant Detail Dialog */}
      <Dialog open={!!viewingContestant} onOpenChange={(open) => !open && setViewingContestant(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-contestant-detail">
          <DialogHeader>
            <DialogTitle>Contestant Details</DialogTitle>
          </DialogHeader>
          {viewingContestant && (
            <div className="flex gap-6">
              {/* Photo */}
              <div className="flex-shrink-0">
                <Avatar 
                  className="h-32 w-32 rounded-xl border-2 cursor-pointer"
                  onClick={() => viewingContestant.photoUrl && setViewingPhoto({ url: viewingContestant.photoUrl, name: viewingContestant.name })}
                >
                  <AvatarImage src={viewingContestant.photoUrl || undefined} className="object-cover" />
                  <AvatarFallback className="text-3xl rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                    {viewingContestant.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
              {/* Info */}
              <div className="flex-1 space-y-4">
                <div>
                  <h3 className="text-xl font-semibold">{viewingContestant.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={viewingContestant.auditionRating === 'A+' ? 'bg-amber-500/10 text-amber-700 border-amber-300' : viewingContestant.auditionRating === 'A' ? 'bg-blue-500/10 text-blue-700 border-blue-300' : ''}>
                      {viewingContestant.auditionRating || 'Unrated'}
                    </Badge>
                    <Badge variant="outline" className={viewingContestant.gender === 'Female' ? 'bg-pink-500/10 text-pink-700 border-pink-300' : 'bg-blue-500/10 text-blue-700 border-blue-300'}>
                      {viewingContestant.gender || 'Unknown'}
                    </Badge>
                    {viewingContestant.age && (
                      <Badge variant="outline">{viewingContestant.age} years old</Badge>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {viewingContestant.email && (
                    <div>
                      <span className="text-muted-foreground">Email:</span>
                      <p className="font-medium">{viewingContestant.email}</p>
                    </div>
                  )}
                  {viewingContestant.phone && (
                    <div>
                      <span className="text-muted-foreground">Phone:</span>
                      <p className="font-medium">{viewingContestant.phone}</p>
                    </div>
                  )}
                  {viewingContestant.suburb && (
                    <div>
                      <span className="text-muted-foreground">Location:</span>
                      <p className="font-medium">{viewingContestant.suburb}</p>
                    </div>
                  )}
                  {viewingContestant.attendingWith && (
                    <div>
                      <span className="text-muted-foreground">Attending With:</span>
                      <p className="font-medium">{viewingContestant.attendingWith}</p>
                    </div>
                  )}
                  {viewingContestant.occupation && (
                    <div>
                      <span className="text-muted-foreground">Occupation:</span>
                      <p className="font-medium">{viewingContestant.occupation}</p>
                    </div>
                  )}
                  {viewingContestant.status && (
                    <div>
                      <span className="text-muted-foreground">Status:</span>
                      <p className="font-medium capitalize">{viewingContestant.status.replace('_', ' ')}</p>
                    </div>
                  )}
                </div>
                {viewingContestant.medicalMobilityNotes && (
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Medical/Mobility Notes:</span>
                    <p className="text-sm">{viewingContestant.medicalMobilityNotes}</p>
                  </div>
                )}
                {viewingContestant.notes && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Notes:</span>
                    <p>{viewingContestant.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
