import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  X, Search, Users, User, Eye, Check, ChevronLeft, ChevronRight,
  Phone, Mail, ShieldAlert, Heart, Plus, UserPlus, Pencil, AlertTriangle,
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
  postcode?: string | null; isTemporary?: boolean | null;
  phone?: string | null; email?: string | null; availabilityNotes?: string | null;
};
type PodiumEntry = { id: string; position: number; contestantId: string; contestant: Contestant };

// ─── TempContestantDialog ────────────────────────────────────────────────────

const TempContestantDialog = React.memo(function TempContestantDialog({
  open,
  onOpenChange,
  onSubmit,
  isCreating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; gender: string; age?: string; phone?: string; email?: string; notes?: string }) => Promise<void>;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<string>("");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) {
      setName(""); setGender(""); setAge(""); setPhone(""); setEmail(""); setNotes("");
    }
  }, [open]);

  const handleSubmit = async () => {
    await onSubmit({ name, gender, age, phone, email, notes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-new-temp-contestant-podium">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-amber-500" />
            Add Temporary Contestant
          </DialogTitle>
          <DialogDescription>
            Create a placeholder contestant who hasn't been imported from Cast It Reach yet. They can be updated later after proper audition.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="podium-temp-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="podium-temp-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Full name"
                data-testid="input-podium-temp-name"
              />
            </div>

            <div>
              <Label htmlFor="podium-temp-gender">Gender <span className="text-destructive">*</span></Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger data-testid="select-podium-temp-gender">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Male">Male</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="podium-temp-age">Age</Label>
              <Input
                id="podium-temp-age"
                type="number"
                value={age}
                onChange={e => setAge(e.target.value)}
                placeholder="Optional"
                data-testid="input-podium-temp-age"
              />
            </div>

            <div>
              <Label htmlFor="podium-temp-phone">Phone</Label>
              <Input
                id="podium-temp-phone"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="Optional"
                data-testid="input-podium-temp-phone"
              />
            </div>

            <div>
              <Label htmlFor="podium-temp-email">Email</Label>
              <Input
                id="podium-temp-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Optional"
                data-testid="input-podium-temp-email"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="podium-temp-notes">Notes</Label>
            <Textarea
              id="podium-temp-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this contestant..."
              className="h-20 resize-none"
              data-testid="input-podium-temp-notes"
            />
          </div>

          <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This contestant is marked as <strong>temporary</strong> until they complete their audition and are properly imported via Cast It Reach.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={isCreating || !name.trim() || !gender}
            className="bg-amber-600 hover:bg-amber-700"
            data-testid="button-create-podium-temp-contestant"
          >
            {isCreating ? "Creating..." : "Create & Assign to Position"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

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
  const [hoverOpen, setHoverOpen] = useState(false);

  // Only fetch when the hover card is actually open — avoids 26 parallel requests on mount
  const { data: details } = useQuery({
    queryKey: ['/api/contestants', entry?.contestantId],
    queryFn: async () => {
      if (!entry?.contestantId) return null;
      const r = await fetch(`/api/contestants/${entry.contestantId}`);
      if (!r.ok) throw new Error('Failed to fetch');
      return r.json();
    },
    enabled: hoverOpen && !!entry?.contestantId,
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
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1">
          <User className="h-3 w-3" />
          <span className="text-[10px] font-mono">#{pos}</span>
        </div>
      ) : (
        <div className="space-y-1 overflow-hidden">
          <div className="flex items-center gap-1 text-[10px] font-mono opacity-70">
            <span>#{pos}</span>
          </div>
          <div className="flex items-center gap-1 min-w-0 flex-wrap">
            <p className="font-medium text-xs truncate min-w-0 max-w-[80px]" title={entry.contestant.name}>
              {entry.contestant.name}
            </p>
            {entry.contestant.podiumStory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-center px-1 h-3.5 rounded bg-purple-200/70 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400 text-[9px] font-bold flex-shrink-0">
                    PS
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs"><p>Has podium story</p></TooltipContent>
              </Tooltip>
            )}
            {details && (hasMeaningfulMedicalNote(details.mobilityNotes) || hasMeaningfulMedicalNote(details.medicalInfo)) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div><Plus className="h-3 w-3 text-red-600 dark:text-red-400 flex-shrink-0" style={{ strokeWidth: 3 }} /></div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs"><p>Has mobility/medical notes</p></TooltipContent>
              </Tooltip>
            )}
            {details && hasMeaningfulMedicalNote(details.criminalRecord) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div><ShieldAlert className="h-3 w-3 text-orange-600 dark:text-orange-400 flex-shrink-0" /></div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs"><p>Has criminal record notes</p></TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-2 opacity-70 text-[10px]">
            <span>{entry.contestant.age}</span>
            <span>•</span>
            <span>{entry.contestant.gender?.[0]}</span>
          </div>
        </div>
      )}
    </Card>
  );

  if (!isEmpty) {
    return (
      <HoverCard open={hoverOpen} onOpenChange={setHoverOpen} openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>{cardContent}</HoverCardTrigger>
        <HoverCardContent
          className="w-80 z-[100] max-h-[80vh] overflow-y-auto"
          side="bottom" align="center" sideOffset={8}
          avoidCollisions collisionPadding={{ top: 150, bottom: 50, left: 20, right: 20 }}
          sticky="partial"
          data-testid={`hovercard-podium-${pos}`}
        >
          <div className="space-y-3">
            {details ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    {details.photoUrl ? <AvatarImage src={details.photoUrl} alt={details.name} className="object-cover" /> : null}
                    <AvatarFallback>{details.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 flex-wrap">
                        <h4 className="text-sm font-semibold">{details.name}</h4>
                        {details.availableForStandby && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-700">S</Badge>
                        )}
                        {details.podiumStory && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-pink-50 dark:bg-pink-950 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800">
                            <Heart className="h-2.5 w-2.5 mr-0.5" />Story
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
                        }`}>{details.auditionRating}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{details.age} years old • {details.gender}</p>
                    {details.phone && <p className="text-xs font-medium text-blue-600 dark:text-blue-400">{details.phone}</p>}
                    {details.location && <p className="text-xs text-muted-foreground">{details.location}</p>}
                  </div>
                </div>
                {details.phone && <div className="flex items-center gap-2 text-xs"><Phone className="h-3 w-3 text-muted-foreground" /><span>{details.phone}</span></div>}
                {details.email && <div className="flex items-center gap-2 text-xs"><Mail className="h-3 w-3 text-muted-foreground" /><span className="truncate">{details.email}</span></div>}
                {details.attendingWith && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Attending With</label>
                    <p className="text-xs mt-0.5">{details.attendingWith}</p>
                  </div>
                )}
                {details.availabilityNotes && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Availability Notes</label>
                    <p className="text-xs mt-0.5">{details.availabilityNotes}</p>
                  </div>
                )}
                {hasMeaningfulMedicalNote(details.medicalInfo) && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Medical Info</label>
                    <p className="text-xs mt-0.5">{details.medicalInfo}</p>
                  </div>
                )}
                {hasMeaningfulMedicalNote(details.mobilityNotes) && (
                  <div className="text-sm p-2 bg-amber-50 dark:bg-amber-950/50 rounded-md border border-amber-200 dark:border-amber-800">
                    <label className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1"><ShieldAlert className="h-3 w-3" />Mobility/Access Notes</label>
                    <p className="text-xs mt-0.5">{details.mobilityNotes}</p>
                  </div>
                )}
                {hasMeaningfulMedicalNote(details.criminalRecord) && (
                  <div className="text-sm">
                    <label className="text-xs font-medium text-muted-foreground">Criminal Record</label>
                    <p className="text-xs mt-0.5">{details.criminalRecord}</p>
                  </div>
                )}
                <div className="text-sm">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <div className="mt-1"><Badge variant="secondary">{details.availabilityStatus || 'Available'}</Badge></div>
                </div>
                <div className="pt-1 border-t text-xs text-muted-foreground">Podium Position #{pos}</div>
              </>
            ) : (
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
  const isDark = useIsDarkMode();
  const [recordDayId, setRecordDayId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  // Stories tab search/filter state
  const [storiesSearch, setStoriesSearch] = useState("");
  const [storiesRxFilter, setStoriesRxFilter] = useState("all");

  // Temporary contestant dialogs
  const [tempContestantDialogOpen, setTempContestantDialogOpen] = useState(false);
  const [isCreatingTempContestant, setIsCreatingTempContestant] = useState(false);
  const [editTempDialogOpen, setEditTempDialogOpen] = useState(false);
  const [editingTempContestantId, setEditingTempContestantId] = useState<string | null>(null);
  const [isUpdatingTempContestant, setIsUpdatingTempContestant] = useState(false);
  const [editTempName, setEditTempName] = useState("");
  const [editTempGender, setEditTempGender] = useState("");
  const [editTempAge, setEditTempAge] = useState("");
  const [editTempPhone, setEditTempPhone] = useState("");
  const [editTempEmail, setEditTempEmail] = useState("");
  const [editTempNotes, setEditTempNotes] = useState("");

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

  // All podium-story-tagged contestants across all record days
  const { data: allPodiumStories = [], isLoading: storiesLoading } = useQuery<any[]>({
    queryKey: ["/api/podium-stories"],
  });

  // Filtered stories based on name search and RX filter
  const filteredStories = useMemo(() => {
    return allPodiumStories.filter((c: any) => {
      if (storiesSearch && !c.name?.toLowerCase().includes(storiesSearch.toLowerCase())) return false;
      if (storiesRxFilter !== "all" && !c.episodes?.some((e: any) => e.recordDayId === storiesRxFilter)) return false;
      return true;
    });
  }, [allPodiumStories, storiesSearch, storiesRxFilter]);

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

  // Prefer richer podium-stories data (has episodes, phone, email) over the basic allContestants list
  const viewedContestant: any = viewContestantId
    ? (allPodiumStories.find((c: any) => c.id === viewContestantId) ?? allContestants.find(c => c.id === viewContestantId) ?? null)
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
          {allPodiumStories.length > 0 && (
            <Badge variant="outline" className="text-xs bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800">
              <Heart className="h-3 w-3 mr-1" />
              {allPodiumStories.length} {allPodiumStories.length === 1 ? 'story' : 'stories'}
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
      <div className="flex-1 overflow-hidden flex flex-col">
        {!recordDayId ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">
            <p className="text-base">Select a record day to manage podium positions</p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
            <div className="px-5 pt-3 shrink-0">
              <TabsList>
                <TabsTrigger value="positions" data-testid="tab-positions">Positions</TabsTrigger>
                <TabsTrigger value="stories" data-testid="tab-stories">
                  Podium Stories
                  {allPodiumStories.length > 0 && (
                    <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-pink-500 text-white">
                      {allPodiumStories.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Positions tab ── */}
            <TabsContent value="positions" className="flex-1 overflow-auto p-5 mt-0">
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
            </TabsContent>

            {/* ── Stories tab ── */}
            <TabsContent value="stories" className="flex-1 overflow-auto p-5 mt-0">
              {/* Toolbar: name search + RX filter */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search by name..."
                    value={storiesSearch}
                    onChange={e => setStoriesSearch(e.target.value)}
                    className="pl-8"
                    data-testid="input-stories-search"
                  />
                </div>
                <Select value={storiesRxFilter} onValueChange={setStoriesRxFilter}>
                  <SelectTrigger className="w-[160px]" data-testid="select-stories-rx">
                    <SelectValue placeholder="All RXs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All RXs</SelectItem>
                    {sortedDays.map(day => (
                      <SelectItem key={day.id} value={day.id}>
                        {day.rxNumber || (day.date ? new Date(day.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : day.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {storiesLoading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading stories...</div>
              ) : filteredStories.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                  <Heart className="h-10 w-10 opacity-20" />
                  <p className="font-medium">
                    {allPodiumStories.length === 0 ? "No podium stories tagged" : "No stories match your search"}
                  </p>
                  {allPodiumStories.length === 0 && (
                    <p className="text-sm">Tag contestants as Podium Story from their contestant profile to see them here.</p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    {filteredStories.length} contestant{filteredStories.length !== 1 ? 's' : ''} with podium stories
                  </p>

                  {/* Table header */}
                  <div className="rounded-md border overflow-hidden">
                    <div className="grid grid-cols-[2fr_1fr_1fr_3fr] gap-0 bg-muted/50 border-b px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <div>Contestant</div>
                      <div>Rating / RX</div>
                      <div>Case #</div>
                      <div>Story</div>
                    </div>

                    {filteredStories.map((c: any, idx: number) => {
                      const ratingColors = isDark ? ratingColorsDark : ratingColorsLight;
                      const colorInfo = c.auditionRating ? ratingColors[c.auditionRating] : null;
                      const rxLabels = c.episodes?.map((e: any) => e.rxNumber || '?').join(', ');
                      const isLast = idx === filteredStories.length - 1;
                      return (
                        <div
                          key={c.id}
                          className={`grid grid-cols-[2fr_1fr_1fr_3fr] gap-0 px-4 py-3 hover-elevate cursor-pointer ${!isLast ? 'border-b' : ''}`}
                          onClick={() => setViewContestantId(c.id)}
                          data-testid={`story-row-${c.id}`}
                        >
                          {/* Contestant name + photo */}
                          <div className="flex items-start gap-2.5 pr-4">
                            <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                              {c.photoUrl
                                ? <AvatarImage src={c.photoUrl} className="object-cover" />
                                : null}
                              <AvatarFallback className="text-[9px] bg-muted">
                                {c.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight truncate">{c.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[c.age ? `${c.age}yo` : null, c.gender].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                          </div>

                          {/* Rating + episodes */}
                          <div className="flex flex-col gap-1.5 justify-start pr-3">
                            {c.auditionRating && (
                              <span
                                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0"
                                style={colorInfo ? { backgroundColor: colorInfo.bg, color: colorInfo.text, border: `1px solid ${colorInfo.border}` } : undefined}
                              >
                                {c.auditionRating}
                              </span>
                            )}
                            {rxLabels && (
                              <span className="text-xs text-muted-foreground leading-tight">{rxLabels}</span>
                            )}
                          </div>

                          {/* Case number */}
                          <div className="flex items-start justify-start pr-3">
                            {c.podiumStoryCaseNumber != null ? (
                              <Badge variant="secondary" className="text-xs font-mono">
                                Case {c.podiumStoryCaseNumber}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </div>

                          {/* Story text */}
                          <div className="flex items-start">
                            {c.podiumStoryNote ? (
                              <p className="text-sm text-foreground leading-snug line-clamp-3">{c.podiumStoryNote}</p>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">No story notes yet</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
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
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedEntry.contestant.isTemporary && (
                    <Badge className="text-[9px] px-1.5 py-0 h-5 bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                      TEMP
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">Position #{selectedEntry.position}</Badge>
                </div>
              </div>
              {selectedEntry.contestant.isTemporary && (
                <Button
                  variant="outline"
                  className="w-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                  onClick={() => {
                    const c = allContestants.find(con => con.id === selectedEntry.contestant.id);
                    if (c) {
                      setEditingTempContestantId(c.id);
                      setEditTempName(c.name);
                      setEditTempGender(c.gender);
                      setEditTempAge(c.age?.toString() || "");
                      setEditTempPhone(c.phone || "");
                      setEditTempEmail(c.email || "");
                      setEditTempNotes(c.availabilityNotes || "");
                      setEditTempDialogOpen(true);
                    }
                  }}
                  data-testid="button-edit-podium-temp-contestant"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Temporary Contestant
                </Button>
              )}
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
              <div className="text-center py-8 text-muted-foreground space-y-4">
                <div>
                  <Users className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="font-medium">No available contestants</p>
                  <p className="text-sm">All contestants are already assigned to podium positions.</p>
                </div>
                <Button
                  variant="outline"
                  className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                  onClick={() => setTempContestantDialogOpen(true)}
                  data-testid="button-new-podium-temp-contestant"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create Temporary Contestant
                </Button>
              </div>
            ) : (
              <>
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
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-rating"><SelectValue placeholder="All" /></SelectTrigger>
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
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-gender"><SelectValue placeholder="All" /></SelectTrigger>
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
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-group-size"><SelectValue placeholder="All" /></SelectTrigger>
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
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-age"><SelectValue placeholder="All" /></SelectTrigger>
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
                        <SelectTrigger className="h-7 w-[90px] text-xs" data-testid="select-filter-status"><SelectValue placeholder="All" /></SelectTrigger>
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
                        <SelectTrigger className="h-7 w-[75px] text-xs" data-testid="select-filter-standby"><SelectValue placeholder="All" /></SelectTrigger>
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

                <ScrollArea className="h-[400px] border rounded-md bg-muted/20">
                  <div className="p-2 space-y-1">
                    {paginatedContestants.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">No contestants match your filters.</p>
                    ) : paginatedContestants.map((c: any) => {
                      const isSelected = selectedContestant === c.id;
                      const hasGroup = !!c.attendingWith;
                      const isAvailableForStandby = !!c.availableForStandby;
                      return (
                        <div
                          key={c.id}
                          onClick={() => setSelectedContestant(isSelected ? "" : c.id)}
                          className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 p-2 rounded-md cursor-pointer transition-all ${
                            isSelected ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"
                          }`}
                          data-testid={`contestant-card-${c.id}`}
                        >
                          <Avatar className="h-9 w-9 border border-border">
                            {c.photoUrl ? <AvatarImage src={c.photoUrl} alt={c.name} className="object-cover" /> : null}
                            <AvatarFallback className="text-xs bg-muted"><User className="h-4 w-4 text-muted-foreground" /></AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">{c.name}</span>
                              {isAvailableForStandby && (
                                <span className={`px-1 py-0.5 rounded text-[9px] font-bold flex-shrink-0 ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"}`}>S</span>
                              )}
                              {hasGroup && <Users className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? "text-primary-foreground/70" : "text-blue-500"}`} />}
                              {isSelected && <Check className="h-4 w-4 flex-shrink-0" />}
                            </div>
                            <div className={`text-xs truncate ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                              {c.gender === "Female" ? "F" : "M"}
                              {c.age && ` | ${c.age}yo`}
                              {hasGroup && ` | ${c.attendingWith}`}
                            </div>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isSelected ? "bg-primary-foreground/20 text-primary-foreground" : STATUS_COLORS[c.availabilityStatus] || "bg-gray-100 text-gray-600"}`}>
                            {STATUS_LABELS[c.availabilityStatus] || c.availabilityStatus || "?"}
                          </span>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${c.auditionRating ? RATING_COLORS[c.auditionRating] || "bg-gray-500 text-white" : "bg-muted text-muted-foreground"}`}>
                            {c.auditionRating || "?"}
                          </div>
                          <Button
                            size="icon" variant={isSelected ? "secondary" : "outline"} className="h-7 w-7"
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

                {filteredContestants.length > CONTESTANTS_PER_PAGE && (
                  <div className="flex items-center justify-between gap-2 pt-1 border-t shrink-0">
                    <span className="text-xs text-muted-foreground" data-testid="text-contestant-pagination">Page {contestantPage} of {totalPages}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => setContestantPage(p => Math.max(1, p - 1))} disabled={contestantPage <= 1} data-testid="button-prev-page">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setContestantPage(p => Math.min(totalPages, p + 1))} disabled={contestantPage >= totalPages} data-testid="button-next-page">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {selectedContestant && (
                  <div className="border rounded-md p-3 bg-card shrink-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Selected:</p>
                        <p className="text-sm text-muted-foreground truncate">{allContestants.find(c => c.id === selectedContestant)?.name}</p>
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

                {/* Create temp contestant as an alternative to selecting from the list */}
                <div className="shrink-0 pt-1 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Can't find them in the list?</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                    onClick={() => setTempContestantDialogOpen(true)}
                    data-testid="button-new-podium-temp-contestant"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create Temporary Contestant
                  </Button>
                </div>
              </>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* New Temporary Contestant Dialog */}
      <TempContestantDialog
        open={tempContestantDialogOpen}
        onOpenChange={setTempContestantDialogOpen}
        isCreating={isCreatingTempContestant}
        onSubmit={async (data) => {
          if (!data.name.trim() || !data.gender) {
            toast({ variant: "destructive", title: "Missing required fields", description: "Name and gender are required." });
            return;
          }
          setIsCreatingTempContestant(true);
          try {
            const res = await apiRequest("POST", "/api/contestants/temporary", {
              name: data.name.trim(),
              gender: data.gender,
              age: data.age || undefined,
              phone: data.phone || undefined,
              email: data.email || undefined,
              notes: data.notes || undefined,
            });
            const newContestant = await res.json();

            // Assign directly to the selected podium position
            await apiRequest("PUT", `/api/record-days/${recordDayId}/podium-positions/${selectedPosition}`, {
              contestantId: newContestant.id,
            });

            toast({
              title: "Temporary contestant added",
              description: `${newContestant.name} has been created and assigned to Position #${selectedPosition}.`,
            });

            queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
            queryClient.invalidateQueries({ queryKey: ["/api/contestants"] });
            setTempContestantDialogOpen(false);
            closeDialog();
          } catch (error: any) {
            toast({ variant: "destructive", title: "Failed to create contestant", description: error.message });
          } finally {
            setIsCreatingTempContestant(false);
          }
        }}
      />

      {/* Edit Temporary Contestant Dialog */}
      <Dialog open={editTempDialogOpen} onOpenChange={open => { if (!open) { setEditTempDialogOpen(false); setEditingTempContestantId(null); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-edit-podium-temp-contestant">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-amber-600" />
              Edit Temporary Contestant
            </DialogTitle>
            <DialogDescription>
              Update the temporary contestant's information. They remain marked as temporary until properly imported via Cast It Reach.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={editTempName} onChange={e => setEditTempName(e.target.value)} placeholder="Full name" data-testid="input-edit-podium-temp-name" />
            </div>

            <div className="grid gap-2">
              <Label>Gender <span className="text-destructive">*</span></Label>
              <Select value={editTempGender} onValueChange={setEditTempGender}>
                <SelectTrigger data-testid="select-edit-podium-temp-gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Male">Male</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Age</Label>
                <Input value={editTempAge} onChange={e => setEditTempAge(e.target.value)} placeholder="Age" type="number" data-testid="input-edit-podium-temp-age" />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={editTempPhone} onChange={e => setEditTempPhone(e.target.value)} placeholder="Phone number" data-testid="input-edit-podium-temp-phone" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={editTempEmail} onChange={e => setEditTempEmail(e.target.value)} placeholder="Email address" type="email" data-testid="input-edit-podium-temp-email" />
            </div>

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea value={editTempNotes} onChange={e => setEditTempNotes(e.target.value)} placeholder="Any additional notes..." className="min-h-[60px]" data-testid="textarea-edit-podium-temp-notes" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditTempDialogOpen(false); setEditingTempContestantId(null); }}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!editTempName.trim() || !editTempGender || !editingTempContestantId) {
                  toast({ variant: "destructive", title: "Missing required fields", description: "Name and gender are required." });
                  return;
                }
                setIsUpdatingTempContestant(true);
                try {
                  await apiRequest("PATCH", `/api/contestants/${editingTempContestantId}`, {
                    name: editTempName.trim(),
                    gender: editTempGender,
                    age: editTempAge ? parseInt(editTempAge) : undefined,
                    phone: editTempPhone || undefined,
                    email: editTempEmail || undefined,
                    notes: editTempNotes || undefined,
                  });
                  toast({ title: "Contestant updated", description: `${editTempName.trim()} has been updated.` });
                  queryClient.invalidateQueries({ queryKey: ["/api/contestants"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
                  setEditTempDialogOpen(false);
                  setEditingTempContestantId(null);
                } catch (error: any) {
                  toast({ variant: "destructive", title: "Failed to update contestant", description: error.message });
                } finally {
                  setIsUpdatingTempContestant(false);
                }
              }}
              disabled={isUpdatingTempContestant || !editTempName.trim() || !editTempGender}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-save-podium-temp-contestant"
            >
              {isUpdatingTempContestant ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contestant detail dialog — used by Stories tab click and assignment dialog eye button */}
      {viewedContestant && (
        <Dialog open={!!viewContestantId} onOpenChange={open => { if (!open) setViewContestantId(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{viewedContestant.name}</DialogTitle>
              <DialogDescription>Contestant details</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-start gap-4">
                <Avatar className="h-16 w-16 border border-border shrink-0">
                  {viewedContestant.photoUrl ? <AvatarImage src={viewedContestant.photoUrl} alt={viewedContestant.name} className="object-cover" /> : null}
                  <AvatarFallback><User className="h-6 w-6 text-muted-foreground" /></AvatarFallback>
                </Avatar>
                <div className="space-y-1 text-sm flex-1">
                  <p><span className="text-muted-foreground">Gender: </span>{viewedContestant.gender}</p>
                  {viewedContestant.age && <p><span className="text-muted-foreground">Age: </span>{viewedContestant.age}</p>}
                  {viewedContestant.auditionRating && <p><span className="text-muted-foreground">Rating: </span>{viewedContestant.auditionRating}</p>}
                  {viewedContestant.availabilityStatus && <p><span className="text-muted-foreground">Status: </span>{viewedContestant.availabilityStatus}</p>}
                  {viewedContestant.attendingWith && <p><span className="text-muted-foreground">With: </span>{viewedContestant.attendingWith}</p>}
                </div>
              </div>

              {(viewedContestant.phone || viewedContestant.email || viewedContestant.location) && (
                <div className="space-y-1.5 text-sm border-t pt-3">
                  {viewedContestant.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="select-all">{viewedContestant.phone}</span>
                    </div>
                  )}
                  {viewedContestant.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="select-all text-xs">{viewedContestant.email}</span>
                    </div>
                  )}
                  {viewedContestant.location && (
                    <p className="text-xs text-muted-foreground">{viewedContestant.location}</p>
                  )}
                </div>
              )}

              {viewedContestant.availabilityNotes && (
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Availability Notes</p>
                  <p className="text-xs">{viewedContestant.availabilityNotes}</p>
                </div>
              )}

              {viewedContestant.episodes?.length > 0 && (
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Episode History</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewedContestant.episodes.map((e: any, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {e.rxNumber || (e.date ? new Date(e.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Unknown')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
