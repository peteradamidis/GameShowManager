import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  X, Search, Users, User, Eye, Check, ChevronLeft, ChevronRight,
  Phone, Mail, ShieldAlert, Heart, Plus,
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

const hasMeaningfulMedicalNote = (v: string | undefined | null) => {
  if (!v) return false;
  const t = v.trim().toUpperCase();
  return !['', 'NA', 'N/A', 'N / A', 'NO', 'N', 'NONE', '-'].includes(t);
};

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// ─── rating colours (mirrors seat-card.tsx exactly) ─────────────────────────

const ratingColorsLight: Record<string, { bg: string; border: string; text: string }> = {
  'A+': { bg: '#dcfce7', border: '#16a34a', text: '#14532d' },
  'A':  { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' },
  'P':  { bg: '#cffafe', border: '#06b6d4', text: '#164e63' },
  'B+': { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
  'B':  { bg: '#fed7aa', border: '#f97316', text: '#7c2d12' },
  'C':  { bg: '#fee2e2', border: '#ef4444', text: '#7f1d1d' },
  'R':  { bg: '#ede9fe', border: '#7c3aed', text: '#3b0764' },
};

const ratingColorsDark: Record<string, { bg: string; border: string; text: string }> = {
  'A+': { bg: '#14532d', border: '#22c55e', text: '#dcfce7' },
  'A':  { bg: '#1e3a5f', border: '#60a5fa', text: '#dbeafe' },
  'P':  { bg: '#164e63', border: '#22d3ee', text: '#cffafe' },
  'B+': { bg: '#451a03', border: '#fbbf24', text: '#fef3c7' },
  'B':  { bg: '#431407', border: '#fb923c', text: '#fed7aa' },
  'C':  { bg: '#450a0a', border: '#f87171', text: '#fee2e2' },
  'R':  { bg: '#2d1b69', border: '#8b5cf6', text: '#ede9fe' },
};

// ─── constants ───────────────────────────────────────────────────────────────

const CONTESTANTS_PER_PAGE = 50;

const ROWS = [
  { key: "top",    label: "Top Tier",    count: 8,  positions: [19,20,21,22,23,24,25,26] },
  { key: "middle", label: "Middle Tier", count: 9,  positions: [10,11,12,13,14,15,16,17,18] },
  { key: "bottom", label: "Bottom Tier", count: 9,  positions: [1,2,3,4,5,6,7,8,9] },
];

const RATING_COLORS: Record<string, string> = {
  'A+': 'bg-emerald-500 text-white',
  'A':  'bg-green-500 text-white',
  'B+': 'bg-amber-500 text-white',
  'B':  'bg-orange-500 text-white',
  'C':  'bg-red-500 text-white',
  'P':  'bg-cyan-500 text-white',
};

const STATUS_COLORS: Record<string, string> = {
  'available':         'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  'assigned':          'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  'invited':           'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  'confirmed':         'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  'rescheduled':       'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  'returning_standby': 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
};

const STATUS_LABELS: Record<string, string> = {
  'available':         'Avail',
  'assigned':          'Asgnd',
  'invited':           'Invited',
  'confirmed':         'Conf',
  'rescheduled':       'Resc',
  'returning_standby': 'RetSB',
};

// ─── types ───────────────────────────────────────────────────────────────────

type RecordDay = { id: string; date: string | null; rxNumber: string | null; episodeNumber?: number | null };
type Contestant = {
  id: string; name: string; gender: string; photoUrl?: string | null;
  auditionRating?: string | null; availabilityStatus?: string | null;
  age?: number | null; attendingWith?: string | null;
  availableForStandby?: boolean | null; podiumStory?: boolean | null;
  postcode?: string | null;
};
type PodiumEntry = { id: string; position: number; contestantId: string; contestant: Contestant };

// ─── PodiumPositionCard ──────────────────────────────────────────────────────

function PodiumPositionCard({
  pos,
  entry,
  onClick,
}: {
  pos: number;
  entry: PodiumEntry | undefined;
  onClick: () => void;
}) {
  const isDark = useIsDarkMode();
  const ratingColors = isDark ? ratingColorsDark : ratingColorsLight;

  // Fetch full contestant details on hover (same pattern as SeatCard)
  const { data: details } = useQuery({
    queryKey: ['/api/contestants', entry?.contestantId],
    queryFn: async () => {
      if (!entry?.contestantId) return null;
      const r = await fetch(`/api/contestants/${entry.contestantId}`);
      if (!r.ok) throw new Error('Failed to fetch');
      return r.json();
    },
    enabled: !!entry?.contestantId,
  });

  const isEmpty = !entry;
  const rating = entry?.contestant.auditionRating ?? undefined;
  const colorInfo = rating ? ratingColors[rating] : null;

  const cardContent = (
    <Card
      className={[
        "p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity border-2 relative cursor-pointer hover-elevate",
        isEmpty ? "border-dashed bg-muted/30" : "",
      ].join(" ")}
      style={colorInfo ? {
        backgroundColor: colorInfo.bg,
        borderColor: colorInfo.border,
        color: colorInfo.text,
      } : undefined}
      onClick={onClick}
      data-testid={`podium-position-${pos}`}
    >
      {isEmpty ? (
        /* ── empty state ── */
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
          <User className="h-3 w-3" />
          <span className="text-[10px] font-mono">#{pos}</span>
        </div>
      ) : (
        /* ── occupied state (mirrors SeatCard body exactly) ── */
        <div className="space-y-1 overflow-hidden">
          {/* position label row */}
          <div className="flex items-center gap-1 text-[10px] font-mono opacity-70">
            <span>#{pos}</span>
          </div>

          {/* name + icon row */}
          <div className="flex items-center gap-1 min-w-0 flex-wrap">
            <p className="font-medium text-xs truncate min-w-0 max-w-[80px]" title={entry.contestant.name}>
              {entry.contestant.name}
            </p>

            {/* Podium story icon */}
            {entry.contestant.podiumStory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-center px-1 h-3.5 rounded bg-purple-200/70 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400 text-[9px] font-bold flex-shrink-0">
                    PS
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has podium story</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Medical/mobility icon (loaded once details arrive) */}
            {details && (hasMeaningfulMedicalNote(details.mobilityNotes) || hasMeaningfulMedicalNote(details.medicalInfo)) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Plus className="h-3 w-3 text-red-600 dark:text-red-400 flex-shrink-0" style={{ strokeWidth: 3 }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has mobility/medical notes</p>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Criminal record icon */}
            {details && hasMeaningfulMedicalNote(details.criminalRecord) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <ShieldAlert className="h-3 w-3 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>Has criminal record notes</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* age / gender row */}
          <div className="flex items-center gap-2 opacity-70 text-[10px]">
            <span>{entry.contestant.age}</span>
            <span>•</span>
            <span>{entry.contestant.gender?.[0]}</span>
          </div>
        </div>
      )}
    </Card>
  );

  // Wrap occupied positions with HoverCard (mirrors SeatCard)
  if (!isEmpty) {
    return (
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          {cardContent}
        </HoverCardTrigger>
        <HoverCardContent
          className="w-80 z-[100] max-h-[80vh] overflow-y-auto"
          side="bottom"
          align="center"
          sideOffset={8}
          avoidCollisions
          collisionPadding={{ top: 150, bottom: 50, left: 20, right: 20 }}
          sticky="partial"
          data-testid={`hovercard-podium-${pos}`}
        >
          <div className="space-y-3">
            {details ? (
              <>
                {/* Header: avatar + name + rating + age */}
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    {details.photoUrl ? (
                      <AvatarImage src={details.photoUrl} alt={details.name} className="object-cover" />
                    ) : null}
                    <AvatarFallback>
                      {details.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 flex-wrap">
                        <h4 className="text-sm font-semibold">{details.name}</h4>
                        {details.availableForStandby && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700">
                            S
                          </Badge>
                        )}
                        {details.podiumStory && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800">
                            <Heart className="h-2.5 w-2.5 mr-0.5" />
                            Story
                          </Badge>
                        )}
                      </div>
                      {details.auditionRating && (
                        <span className={`text-sm font-bold ${
                          details.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                          details.auditionRating === 'A'  ? 'text-green-600 dark:text-green-400' :
                          details.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                          details.auditionRating === 'B'  ? 'text-orange-600 dark:text-orange-400' :
                          details.auditionRating === 'C'  ? 'text-red-500 dark:text-red-400' :
                          details.auditionRating === 'P'  ? 'text-cyan-600 dark:text-cyan-400' : ''
                        }`}>
                          {details.auditionRating}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{details.age} years old • {details.gender}</p>
                    {details.phone && (
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">{details.phone}</p>
                    )}
                    {details.location && (
                      <p className="text-xs text-muted-foreground">{details.location}</p>
                    )}
                  </div>
                </div>

                {/* Phone */}
                {details.phone && (
                  <div className="flex items-center gap-2 text-xs">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    <span>{details.phone}</span>
                  </div>
                )}

                {/* Email */}
                {details.email && (
                  <div className="flex items-center gap-2 text-xs">
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate">{details.email}</span>
                  </div>
                )}

                {/* Attending With */}
                {details.attendingWith && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Attending With
                    </label>
                    <p className="text-xs mt-0.5">{details.attendingWith}</p>
                  </div>
                )}

                {/* Availability Notes */}
                {details.availabilityNotes && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Availability Notes</label>
                    <p className="text-xs mt-0.5">{details.availabilityNotes}</p>
                  </div>
                )}

                {/* Medical Info */}
                {hasMeaningfulMedicalNote(details.medicalInfo) && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Medical Info</label>
                    <p className="text-xs mt-0.5">{details.medicalInfo}</p>
                  </div>
                )}

                {/* Mobility/Access Notes */}
                {hasMeaningfulMedicalNote(details.mobilityNotes) && (
                  <div className="text-sm p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
                    <label className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      Mobility/Access Notes
                    </label>
                    <p className="text-xs mt-0.5">{details.mobilityNotes}</p>
                  </div>
                )}

                {/* Criminal Record */}
                {hasMeaningfulMedicalNote(details.criminalRecord) && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Criminal Record</label>
                    <p className="text-xs mt-0.5">{details.criminalRecord}</p>
                  </div>
                )}

                {/* Status */}
                <div className="text-sm">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <div className="mt-1">
                    <Badge variant="secondary">
                      {details.availabilityStatus || 'Available'}
                    </Badge>
                  </div>
                </div>

                {/* Position label */}
                <div className="pt-1 border-t text-xs text-muted-foreground">
                  Podium Position #{pos}
                </div>
              </>
            ) : (
              /* Loading skeleton while details fetch */
              <div className="space-y-2 animate-pulse">
                <div className="flex gap-3">
                  <div className="h-12 w-12 rounded-full bg-muted" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
                <div className="h-3 bg-muted rounded w-full" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </div>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  return cardContent;
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function PodiumPage() {
  const { toast } = useToast();
  const [recordDayId, setRecordDayId] = useState<string>("");
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  const [contestantSearch, setContestantSearch] = useState("");
  const [filterRating, setFilterRating] = useState("all");
  const [filterGender, setFilterGender] = useState("all");
  const [filterGroupSize, setFilterGroupSize] = useState("all");
  const [filterAge, setFilterAge] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterStandby, setFilterStandby] = useState("all");
  const [filterWithin20km, setFilterWithin20km] = useState(false);
  const [filterWithin60km, setFilterWithin60km] = useState(false);
  const [filterOver60km, setFilterOver60km] = useState(false);
  const [filterAllGroupAvailable, setFilterAllGroupAvailable] = useState(false);
  const [contestantPage, setContestantPage] = useState(1);
  const [selectedContestant, setSelectedContestant] = useState("");
  const [viewContestantId, setViewContestantId] = useState<string | null>(null);

  const { data: recordDays = [] } = useQuery<RecordDay[]>({ queryKey: ["/api/record-days"] });
  const { data: allContestants = [] } = useQuery<Contestant[]>({ queryKey: ["/api/contestants"] });
  const { data: podiumData = [], isLoading: podiumLoading } = useQuery<PodiumEntry[]>({
    queryKey: ["/api/record-days", recordDayId, "podium-positions"],
    enabled: !!recordDayId,
  });

  const positionMap = useMemo(() => {
    const map: Record<number, PodiumEntry> = {};
    podiumData.forEach(p => { map[p.position] = p; });
    return map;
  }, [podiumData]);

  const assignedContestantIds = useMemo(
    () => new Set(podiumData.map(p => p.contestantId)),
    [podiumData]
  );

  const availableContestants = useMemo(
    () => allContestants.filter(c => !assignedContestantIds.has(c.id)),
    [allContestants, assignedContestantIds]
  );

  const filteredContestants = useMemo(() => {
    return availableContestants.filter((c: any) => {
      if (contestantSearch) {
        const q = contestantSearch.toLowerCase();
        if (!c.name?.toLowerCase().includes(q)) return false;
      }
      if (filterRating !== "all" && c.auditionRating !== filterRating) return false;
      if (filterGender !== "all" && c.gender !== filterGender) return false;
      if (filterGroupSize !== "all") {
        const hasGroup = !!c.attendingWith;
        if (filterGroupSize === "1" && hasGroup) return false;
        if (filterGroupSize === "2" && !hasGroup) return false;
        if (filterGroupSize === "3+" && !hasGroup) return false;
      }
      if (filterAge !== "all" && c.age) {
        const age = Number(c.age);
        if (filterAge === "18-29" && (age < 18 || age > 29)) return false;
        if (filterAge === "30-39" && (age < 30 || age > 39)) return false;
        if (filterAge === "40-49" && (age < 40 || age > 49)) return false;
        if (filterAge === "50-59" && (age < 50 || age > 59)) return false;
        if (filterAge === "60+"   && age < 60) return false;
      }
      if (filterStatus !== "all" && c.availabilityStatus !== filterStatus) return false;
      if (filterStandby === "available"     && !c.availableForStandby) return false;
      if (filterStandby === "not_available" &&  c.availableForStandby) return false;
      return true;
    });
  }, [availableContestants, contestantSearch, filterRating, filterGender, filterGroupSize, filterAge, filterStatus, filterStandby, filterWithin20km, filterWithin60km, filterOver60km, filterAllGroupAvailable]);

  const assignMutation = useMutation({
    mutationFn: ({ position, contestantId }: { position: number; contestantId: string }) =>
      apiRequest("PUT", `/api/record-days/${recordDayId}/podium-positions/${position}`, { contestantId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to assign", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (position: number) =>
      apiRequest("DELETE", `/api/record-days/${recordDayId}/podium-positions/${position}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    },
  });

  function closeDialog() {
    setSelectedPosition(null);
    setSelectedContestant("");
    setContestantSearch("");
    setFilterRating("all");
    setFilterGender("all");
    setFilterGroupSize("all");
    setFilterAge("all");
    setFilterStatus("all");
    setFilterStandby("all");
    setFilterWithin20km(false);
    setFilterWithin60km(false);
    setFilterOver60km(false);
    setFilterAllGroupAvailable(false);
    setContestantPage(1);
  }

  function openPosition(pos: number) {
    if (!podiumLoading) {
      setSelectedPosition(pos);
      setContestantPage(1);
    }
  }

  const selectedEntry = selectedPosition != null ? positionMap[selectedPosition] : null;
  const filledCount = podiumData.length;

  const sortedDays = [...recordDays].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const totalPages = Math.ceil(filteredContestants.length / CONTESTANTS_PER_PAGE);
  const paginatedContestants = filteredContestants.slice(
    (contestantPage - 1) * CONTESTANTS_PER_PAGE,
    contestantPage * CONTESTANTS_PER_PAGE
  );

  const viewedContestant = viewContestantId
    ? (allContestants.find(c => c.id === viewContestantId) ?? null)
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Podium</h1>
          {recordDayId && (
            <Badge variant="outline" className="text-xs">
              {filledCount}/26 assigned
            </Badge>
          )}
        </div>
        <Select value={recordDayId} onValueChange={setRecordDayId}>
          <SelectTrigger className="w-64" data-testid="select-record-day">
            <SelectValue placeholder="Select a record day" />
          </SelectTrigger>
          <SelectContent>
            {sortedDays.map(day => (
              <SelectItem key={day.id} value={day.id}>
                {day.episodeNumber != null ? `Ep ${day.episodeNumber}` : ""}
                {day.episodeNumber != null && day.rxNumber ? " · " : ""}
                {day.rxNumber && !day.episodeNumber ? `${day.rxNumber} — ` : day.rxNumber ? `${day.rxNumber} — ` : ""}
                {day.date
                  ? new Date(day.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
                  : "No date"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-auto p-5">
        {!recordDayId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-base">Select a record day to manage podium positions</p>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto">
            {ROWS.map(row => (
              <div key={row.key}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {row.label} — {row.positions.filter(p => positionMap[p]).length}/{row.count} filled
                </p>
                <div className="flex gap-2 flex-wrap">
                  {row.positions.map(pos => (
                    <div key={pos} className="min-w-[72px] flex-1">
                      <PodiumPositionCard
                        pos={pos}
                        entry={positionMap[pos]}
                        onClick={() => openPosition(pos)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assignment Dialog */}
      <Dialog
        open={selectedPosition != null}
        onOpenChange={open => { if (!open) closeDialog(); }}
      >
        <DialogContent
          className="w-[95vw] max-w-5xl max-h-[90vh] flex flex-col gap-4 overflow-hidden"
          data-testid="dialog-assign-podium-position"
        >
          <DialogHeader className="pb-2">
            <DialogTitle>
              {selectedEntry
                ? `Position #${selectedPosition} — ${selectedEntry.contestant.name}`
                : `Assign to Position #${selectedPosition}`}
            </DialogTitle>
            <DialogDescription>
              {selectedEntry ? "Manage this podium position" : "Choose a contestant from the list below"}
            </DialogDescription>
          </DialogHeader>

          {/* Occupied: show remove option */}
          {selectedEntry ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted">
                <Avatar className="h-10 w-10 border border-border shrink-0">
                  {selectedEntry.contestant.photoUrl ? (
                    <AvatarImage src={selectedEntry.contestant.photoUrl} alt={selectedEntry.contestant.name} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="text-xs bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{selectedEntry.contestant.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{selectedEntry.contestant.gender}</p>
                </div>
                <Badge variant="secondary" className="text-xs shrink-0">Position #{selectedEntry.position}</Badge>
              </div>
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => removeMutation.mutate(selectedPosition!)}
                disabled={removeMutation.isPending}
              >
                <X className="h-4 w-4 mr-2" />
                Remove from Podium
              </Button>
            </div>
          ) : (
            availableContestants.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="font-medium">No available contestants</p>
                <p className="text-sm">All contestants are already assigned to podium positions.</p>
              </div>
            ) : (
              <>
                {/* Search and Filters */}
                <div className="space-y-2 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name..."
                      value={contestantSearch}
                      onChange={e => { setContestantSearch(e.target.value); setContestantPage(1); }}
                      className="pl-9"
                      autoFocus
                      data-testid="input-contestant-search"
                    />
                  </div>

                  <div className="flex flex-wrap items-end gap-2 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] font-medium">Rating</span>
                      <Select value={filterRating} onValueChange={v => { setFilterRating(v); setContestantPage(1); }}>
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-rating">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="A+">A+</SelectItem>
                          <SelectItem value="A">A</SelectItem>
                          <SelectItem value="B+">B+</SelectItem>
                          <SelectItem value="B">B</SelectItem>
                          <SelectItem value="C">C</SelectItem>
                          <SelectItem value="R">R</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] font-medium">Gender</span>
                      <Select value={filterGender} onValueChange={v => { setFilterGender(v); setContestantPage(1); }}>
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-gender">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Male">Male</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] font-medium">Group Size</span>
                      <Select value={filterGroupSize} onValueChange={v => { setFilterGroupSize(v); setContestantPage(1); }}>
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-group-size">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="1">Solo</SelectItem>
                          <SelectItem value="2">Pair</SelectItem>
                          <SelectItem value="3+">3+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] font-medium">Age</span>
                      <Select value={filterAge} onValueChange={v => { setFilterAge(v); setContestantPage(1); }}>
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-age">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="18-29">18-29</SelectItem>
                          <SelectItem value="30-39">30-39</SelectItem>
                          <SelectItem value="40-49">40-49</SelectItem>
                          <SelectItem value="50-59">50-59</SelectItem>
                          <SelectItem value="60+">60+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] font-medium">Status</span>
                      <Select value={filterStatus} onValueChange={v => { setFilterStatus(v); setContestantPage(1); }}>
                        <SelectTrigger className="h-7 w-[90px] text-xs" data-testid="select-filter-status">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="available">Available</SelectItem>
                          <SelectItem value="assigned">Assigned</SelectItem>
                          <SelectItem value="invited">Invited</SelectItem>
                          <SelectItem value="confirmed">Confirmed</SelectItem>
                          <SelectItem value="rescheduled">Reschedule</SelectItem>
                          <SelectItem value="returning_standby">Returning Standby</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground text-[10px] font-medium">Standby</span>
                      <Select value={filterStandby} onValueChange={v => { setFilterStandby(v); setContestantPage(1); }}>
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-standby">
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="available">Yes</SelectItem>
                          <SelectItem value="not_available">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <span className="ml-auto text-muted-foreground self-end pb-1" data-testid="text-contestant-count">
                      {filteredContestants.length > CONTESTANTS_PER_PAGE
                        ? `${(contestantPage - 1) * CONTESTANTS_PER_PAGE + 1}-${Math.min(contestantPage * CONTESTANTS_PER_PAGE, filteredContestants.length)} of ${filteredContestants.length}`
                        : `${filteredContestants.length} found`}
                    </span>
                  </div>
                </div>

                {/* Contestant List */}
                <ScrollArea className="h-[400px] border rounded-md bg-muted/20">
                  <div className="p-2 space-y-1">
                    {paginatedContestants.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No contestants match your filters.
                      </p>
                    ) : paginatedContestants.map((c: any) => {
                      const isSelected = selectedContestant === c.id;
                      const hasGroup = !!c.attendingWith;
                      const isAvailableForStandby = !!c.availableForStandby;

                      return (
                        <div
                          key={c.id}
                          onClick={() => setSelectedContestant(isSelected ? "" : c.id)}
                          className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 p-2 rounded-md cursor-pointer transition-all ${
                            isSelected
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "hover:bg-muted"
                          }`}
                          data-testid={`contestant-card-${c.id}`}
                        >
                          {/* Photo */}
                          <Avatar className="h-9 w-9 border border-border">
                            {c.photoUrl ? (
                              <AvatarImage src={c.photoUrl} alt={c.name} className="object-cover" />
                            ) : null}
                            <AvatarFallback className="text-xs bg-muted">
                              <User className="h-4 w-4 text-muted-foreground" />
                            </AvatarFallback>
                          </Avatar>

                          {/* Info */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">{c.name}</span>
                              {isAvailableForStandby && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${
                                  isSelected
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                                }`}>S</span>
                              )}
                              {hasGroup && (
                                <Users className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? "text-primary-foreground/70" : "text-blue-500"}`} />
                              )}
                              {isSelected && <Check className="h-4 w-4 flex-shrink-0" />}
                            </div>
                            <div className={`text-xs truncate ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                              {c.gender === "Female" ? "F" : "M"}
                              {c.age && ` | ${c.age}yo`}
                              {hasGroup && ` | ${c.attendingWith}`}
                            </div>
                          </div>

                          {/* Status badge */}
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : STATUS_COLORS[c.availabilityStatus] || "bg-gray-100 text-gray-600"
                          }`}>
                            {STATUS_LABELS[c.availabilityStatus] || c.availabilityStatus || "?"}
                          </span>

                          {/* Rating circle */}
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            c.auditionRating
                              ? RATING_COLORS[c.auditionRating] || "bg-gray-500 text-white"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {c.auditionRating || "?"}
                          </div>

                          {/* View button */}
                          <Button
                            size="icon"
                            variant={isSelected ? "secondary" : "outline"}
                            className="h-7 w-7"
                            onClick={e => { e.stopPropagation(); setViewContestantId(c.id); }}
                            data-testid={`button-view-contestant-${c.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Pagination */}
                {filteredContestants.length > CONTESTANTS_PER_PAGE && (
                  <div className="flex items-center justify-between gap-2 pt-1 border-t shrink-0">
                    <span className="text-xs text-muted-foreground" data-testid="text-contestant-pagination">
                      Page {contestantPage} of {totalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setContestantPage(p => Math.max(1, p - 1))}
                        disabled={contestantPage <= 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setContestantPage(p => Math.min(totalPages, p + 1))}
                        disabled={contestantPage >= totalPages}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Confirm Assign */}
                {selectedContestant && (
                  <div className="border rounded-md p-3 bg-card shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Selected:</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {allContestants.find(c => c.id === selectedContestant)?.name}
                        </p>
                      </div>
                      <Button
                        onClick={() => assignMutation.mutate({ position: selectedPosition!, contestantId: selectedContestant })}
                        disabled={assignMutation.isPending}
                        data-testid="button-confirm-assign"
                      >
                        Assign to Position #{selectedPosition}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Quick view dialog */}
      {viewedContestant && (
        <Dialog open={!!viewContestantId} onOpenChange={open => { if (!open) setViewContestantId(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{viewedContestant.name}</DialogTitle>
              <DialogDescription>Contestant details</DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16 border border-border shrink-0">
                {viewedContestant.photoUrl ? (
                  <AvatarImage src={viewedContestant.photoUrl} alt={viewedContestant.name} className="object-cover" />
                ) : null}
                <AvatarFallback>
                  <User className="h-6 w-6 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">Gender: </span>{viewedContestant.gender}</p>
                {viewedContestant.age && <p><span className="text-muted-foreground">Age: </span>{viewedContestant.age}</p>}
                {viewedContestant.auditionRating && <p><span className="text-muted-foreground">Rating: </span>{viewedContestant.auditionRating}</p>}
                {viewedContestant.availabilityStatus && <p><span className="text-muted-foreground">Status: </span>{viewedContestant.availabilityStatus}</p>}
                {viewedContestant.attendingWith && <p><span className="text-muted-foreground">With: </span>{viewedContestant.attendingWith}</p>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
