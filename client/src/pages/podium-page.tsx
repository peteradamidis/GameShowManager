import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
  Trash2, History, BookOpen, Move,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragOverEvent,
} from "@dnd-kit/core";

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
  'V':  { bg: '#fce7f3', border: '#ec4899', text: '#831843' },
};

const ratingColorsDark: Record<string, { bg: string; border: string; text: string }> = {
  'A+': { bg: '#14532d', border: '#22c55e', text: '#dcfce7' },
  'A':  { bg: '#1e3a5f', border: '#60a5fa', text: '#dbeafe' },
  'P':  { bg: '#164e63', border: '#22d3ee', text: '#cffafe' },
  'B+': { bg: '#451a03', border: '#fbbf24', text: '#fef3c7' },
  'B':  { bg: '#431407', border: '#fb923c', text: '#fed7aa' },
  'C':  { bg: '#450a0a', border: '#f87171', text: '#fee2e2' },
  'R':  { bg: '#2d1b69', border: '#8b5cf6', text: '#ede9fe' },
  'V':  { bg: '#831843', border: '#f472b6', text: '#fce7f3' },
};

// ─── constants ───────────────────────────────────────────────────────────────

const CONTESTANTS_PER_PAGE = 50;

const ROWS_DOND = [
  { key: "top",    label: "Top Tier",    count: 8,  positions: [19,20,21,22,23,24,25,26], isPlayer: false },
  { key: "middle", label: "Middle Tier", count: 9,  positions: [10,11,12,13,14,15,16,17,18], isPlayer: false },
  { key: "bottom", label: "Bottom Tier", count: 9,  positions: [1,2,3,4,5,6,7,8,9], isPlayer: false },
];

const ROWS_CELEB = [
  { key: "top",    label: "Top Tier",    count: 10, positions: [16,17,18,19,20,21,22,23,24,25], isPlayer: false },
  { key: "middle", label: "Middle Tier", count: 8,  positions: [8,9,10,11,12,13,14,15],         isPlayer: false },
  { key: "bottom", label: "Bottom Tier", count: 7,  positions: [1,2,3,4,5,6,7],                 isPlayer: false },
  { key: "player", label: "Player's Case", count: 1, positions: [26],                           isPlayer: true  },
];

const RATING_COLORS: Record<string, string> = {
  'A+': 'bg-emerald-500 text-white',
  'A':  'bg-green-500 text-white',
  'B+': 'bg-amber-500 text-white',
  'B':  'bg-orange-500 text-white',
  'C':  'bg-red-500 text-white',
  'P':  'bg-cyan-500 text-white',
  'R':  'bg-violet-500 text-white',
  'V':  'bg-pink-500 text-white',
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

type RecordDay = { id: string; date: string | null; rxNumber: string | null; episodeNumber?: number | null; lockedAt?: string | null };
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
  recordDayId,
  recordDays,
  onRemove,
  isQuickMoveMode,
  isQuickMoveSelected,
  isDragOver,
  isDragging,
}: {
  pos: number;
  entry: PodiumEntry | undefined;
  onClick: () => void;
  recordDayId: string;
  recordDays: RecordDay[];
  onRemove: (pos: number) => void;
  isQuickMoveMode?: boolean;
  isQuickMoveSelected?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
}) {
  const isDark = useIsDarkMode();
  const ratingColors = isDark ? ratingColorsDark : ratingColorsLight;
  const [hoverOpen, setHoverOpen] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

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

  // Fetch all seat assignments lazily to compute previous episode appearances
  const { data: allSeatAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments'],
    enabled: hoverOpen && !!entry?.contestantId,
  });

  // Previous appearances: locked days where this contestant had a seat (excluding current day)
  const previousAppearances = useMemo(() => {
    if (!entry?.contestantId || !allSeatAssignments.length) return [];
    return allSeatAssignments
      .filter((a: any) => a.contestantId === entry.contestantId && a.recordDayId !== recordDayId)
      .map((a: any) => {
        const day = recordDays.find(d => d.id === a.recordDayId);
        if (!day) return null;
        const label = day.rxNumber || (day.date ? new Date(day.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Unknown');
        const isPast = !!day.lockedAt;
        return { label, date: day.date, isPast, blockNumber: a.blockNumber, seatLabel: a.seatLabel };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
  }, [entry?.contestantId, allSeatAssignments, recordDays, recordDayId]);

  const isEmpty = !entry;
  const rating = entry?.contestant.auditionRating ?? undefined;
  const colorInfo = rating ? ratingColors[rating] : null;

  const cardContent = (
    <Card
      className={[
        "p-2 min-h-[70px] flex flex-col justify-center text-xs transition-opacity border-2 relative cursor-pointer hover-elevate",
        isEmpty ? "border-dashed bg-muted/30" : "",
        isQuickMoveSelected ? "ring-4 ring-cyan-500 dark:ring-cyan-400 rounded-md shadow-lg shadow-cyan-500/30" : "",
        isDragOver ? "ring-4 ring-primary rounded-md scale-105" : "",
        isDragging ? "opacity-40" : "",
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
      <>
      <HoverCard
        open={isQuickMoveMode || isDragging ? false : hoverOpen}
        onOpenChange={(o) => { if (!isQuickMoveMode && !isDragging) setHoverOpen(o); }}
        openDelay={200}
        closeDelay={100}
      >
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

                {/* Previous episode appearances */}
                {previousAppearances.length > 0 && (
                  <div className="text-sm p-2 bg-blue-50 dark:bg-blue-950/40 rounded-md border border-blue-200 dark:border-blue-800">
                    <label className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1 mb-1.5">
                      <History className="h-3 w-3" />
                      Previously Appeared In
                    </label>
                    <div className="space-y-1">
                      {previousAppearances.map((ep: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="font-medium text-blue-800 dark:text-blue-200">{ep.label}</span>
                          <span className="text-blue-600 dark:text-blue-400 text-[10px]">
                            {ep.isPast ? 'Past episode' : 'Upcoming'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Remove from position */}
                <div className="pt-2 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHoverOpen(false);
                      setShowRemoveConfirm(true);
                    }}
                    data-testid={`button-remove-podium-${pos}`}
                  >
                    <Trash2 className="h-3 w-3 mr-1.5" />
                    Remove from Position
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">Podium Position #{pos}</div>
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

      {/* Remove confirmation dialog — rendered outside HoverCard so it stays open after hover closes */}
      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Podium?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{entry?.contestant.name}</strong> from Position #{pos}? Their status will revert to available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-remove-podium-${pos}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onRemove(pos)}
              data-testid={`button-confirm-remove-podium-${pos}`}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
    );
  }

  return cardContent;
}

// ─── DraggableDroppablePodium ────────────────────────────────────────────────

function DraggableDroppablePodium({
  pos,
  entry,
  onClick,
  recordDayId,
  recordDays,
  onRemove,
  isQuickMoveMode,
  isQuickMoveSelected,
  isDragOver,
  onQuickMoveClick,
}: {
  pos: number;
  entry: PodiumEntry | undefined;
  onClick: () => void;
  recordDayId: string;
  recordDays: RecordDay[];
  onRemove: (pos: number) => void;
  isQuickMoveMode: boolean;
  isQuickMoveSelected: boolean;
  isDragOver: boolean;
  onQuickMoveClick: (pos: number) => void;
}) {
  const dragId = `podium-${pos}`;
  const isOccupied = !!entry;

  // Occupied seats are draggable (unless in quick-move mode)
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dragId,
    disabled: !isOccupied || isQuickMoveMode,
  });

  // All seats are droppable
  const { setNodeRef: setDropRef } = useDroppable({ id: dragId });

  const setRefs = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  const handleClick = () => {
    if (isQuickMoveMode) {
      onQuickMoveClick(pos);
    } else {
      onClick();
    }
  };

  return (
    <div
      ref={setRefs}
      {...(isQuickMoveMode ? {} : attributes)}
      {...(isQuickMoveMode ? {} : listeners)}
      style={isDragOver || isQuickMoveSelected ? { zIndex: 10 } : undefined}
      className={isQuickMoveMode ? "cursor-pointer" : ""}
      data-testid={`podium-drag-${pos}`}
    >
      <PodiumPositionCard
        pos={pos}
        entry={entry}
        onClick={handleClick}
        recordDayId={recordDayId}
        recordDays={recordDays}
        onRemove={onRemove}
        isQuickMoveMode={isQuickMoveMode}
        isQuickMoveSelected={isQuickMoveSelected}
        isDragOver={isDragOver}
        isDragging={isDragging}
      />
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function PodiumPage() {
  const { toast } = useToast();
  const isDark = useIsDarkMode();

  const [, setLocation] = useLocation();
  const { data: workspaceData } = useQuery<{ workspace: string }>({ queryKey: ['/api/workspace'] });
  const isCeleb = workspaceData?.workspace === 'celeb';
  const ROWS = isCeleb ? ROWS_CELEB : ROWS_DOND;

  // Redirect to home if not in CELEB workspace (once workspace is confirmed loaded)
  useEffect(() => {
    if (workspaceData && !isCeleb) {
      setLocation('/');
    }
  }, [workspaceData, isCeleb, setLocation]);

  const [recordDayId, setRecordDayId] = useState<string>(
    () => sessionStorage.getItem('podium-recordDayId') || ""
  );
  const [activeTab, setActiveTab] = useState("positions");
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  // ── Drag & Drop / Quick Move state ─────────────────────────────────────────
  const [quickMoveEnabled, setQuickMoveEnabled] = useState(false);
  const [quickMoveSelectedPosition, setQuickMoveSelectedPosition] = useState<number | null>(null);
  const [activeDragPos, setActiveDragPos] = useState<number | null>(null);
  const [overDragPos, setOverDragPos] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Clear quick move selection when mode is disabled
  useEffect(() => {
    if (!quickMoveEnabled) setQuickMoveSelectedPosition(null);
  }, [quickMoveEnabled]);

  // Escape to deselect in quick move mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && quickMoveSelectedPosition != null) {
        setQuickMoveSelectedPosition(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [quickMoveSelectedPosition]);

  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args);
  }, []);

  const parsePodiumDragId = (id: string | number | null | undefined): number | null => {
    if (typeof id !== 'string' || !id.startsWith('podium-')) return null;
    const n = parseInt(id.slice('podium-'.length), 10);
    return Number.isFinite(n) ? n : null;
  };

  // Persist selected episode across route navigations
  useEffect(() => {
    if (recordDayId) sessionStorage.setItem('podium-recordDayId', recordDayId);
    else sessionStorage.removeItem('podium-recordDayId');
  }, [recordDayId]);

  // Stories tab search/filter state
  const [storiesSearch, setStoriesSearch] = useState("");

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
  const [editingStory, setEditingStory] = useState<{ id: string; name: string; note: string; caseNumber: string } | null>(null);

  const { data: recordDays = [] } = useQuery<RecordDay[]>({ queryKey: ["/api/record-days"] });
  const { data: allContestants = [] } = useQuery<Contestant[]>({ queryKey: ["/api/contestants"] });

  const { data: podiumData = [], isLoading: podiumLoading } = useQuery<PodiumEntry[]>({
    queryKey: ["/api/record-days", recordDayId, "podium-positions"],
    enabled: !!recordDayId,
    staleTime: 0, // Always refetch when switching episodes
  });

  // All podium-story-tagged contestants (PS-tagged + currently in any podium slot)
  const { data: allPodiumStories = [], isLoading: storiesLoading } = useQuery<any[]>({
    queryKey: ["/api/podium-stories"],
  });

  // Episode-scoped stories: show all PS-tagged contestants assigned to the CURRENT episode.
  // A note is not required — newly tagged contestants appear immediately so the user can
  // open them in the stories tab and add a note/case number from there.
  const episodeStories = useMemo(() => {
    if (!podiumData.length) return [];
    const currentIds = new Set(podiumData.map(p => p.contestantId));
    return allPodiumStories.filter((c: any) => currentIds.has(c.id));
  }, [allPodiumStories, podiumData]);

  // Filtered stories based on name search — scoped to current episode
  const filteredStories = useMemo(() => {
    return episodeStories.filter((c: any) => {
      if (storiesSearch && !c.name?.toLowerCase().includes(storiesSearch.toLowerCase())) return false;
      return true;
    });
  }, [episodeStories, storiesSearch]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/podium-stories"] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to assign", description: err.message, variant: "destructive" });
    },
  });

  const swapMutation = useMutation({
    mutationFn: ({ sourcePosition, targetPosition }: { sourcePosition: number; targetPosition: number }) =>
      apiRequest("POST", `/api/record-days/${recordDayId}/podium-positions/swap`, { sourcePosition, targetPosition }),
    onMutate: async ({ sourcePosition, targetPosition }) => {
      const key = ["/api/record-days", recordDayId, "podium-positions"];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PodiumEntry[]>(key);
      if (previous) {
        queryClient.setQueryData<PodiumEntry[]>(key, previous.map(e => {
          if (e.position === sourcePosition) return { ...e, position: targetPosition };
          if (e.position === targetPosition) return { ...e, position: sourcePosition };
          return e;
        }));
      }
      return { previous };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["/api/record-days", recordDayId, "podium-positions"], ctx.previous);
      }
      toast({ title: "Failed to swap positions", description: err.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podium-stories"] });
    },
  });

  const handleDragStart = (event: any) => {
    const pos = parsePodiumDragId(event.active?.id);
    setActiveDragPos(pos);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const pos = parsePodiumDragId(event.over?.id ?? null);
    setOverDragPos(pos);
  };

  const handleDragEnd = (event: any) => {
    const source = parsePodiumDragId(event.active?.id);
    const target = parsePodiumDragId(event.over?.id ?? null);
    setActiveDragPos(null);
    setOverDragPos(null);
    if (source == null || target == null || source === target) return;
    swapMutation.mutate({ sourcePosition: source, targetPosition: target });
  };

  const handleDragCancel = () => {
    setActiveDragPos(null);
    setOverDragPos(null);
  };

  const handleQuickMoveClick = (clickedPos: number) => {
    if (!quickMoveEnabled) return;
    const clickedHasContestant = !!positionMap[clickedPos];

    // No selection yet → select if occupied
    if (quickMoveSelectedPosition == null) {
      if (clickedHasContestant) setQuickMoveSelectedPosition(clickedPos);
      return;
    }
    // Clicking same → deselect
    if (quickMoveSelectedPosition === clickedPos) {
      setQuickMoveSelectedPosition(null);
      return;
    }
    // Swap/move
    swapMutation.mutate({ sourcePosition: quickMoveSelectedPosition, targetPosition: clickedPos });
    setQuickMoveSelectedPosition(null);
  };

  const removeMutation = useMutation({
    mutationFn: (position: number) =>
      apiRequest("DELETE", `/api/record-days/${recordDayId}/podium-positions/${position}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podium-stories"] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    },
  });

  const togglePodiumStoryMutation = useMutation({
    mutationFn: ({ contestantId, current }: { contestantId: string; current: boolean }) =>
      apiRequest("PATCH", `/api/contestants/${contestantId}`, { podiumStory: !current }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contestants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podium-stories"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update Podium Story", description: err.message, variant: "destructive" });
    },
  });

  const updateRatingMutation = useMutation({
    mutationFn: ({ contestantId, rating }: { contestantId: string; rating: string }) =>
      apiRequest("PATCH", `/api/contestants/${contestantId}`, { auditionRating: rating || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contestants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update rating", description: err.message, variant: "destructive" });
    },
  });

  const updateStoryMutation = useMutation({
    mutationFn: ({ id, note, caseNumber }: { id: string; note: string; caseNumber: string }) =>
      apiRequest("PATCH", `/api/contestants/${id}`, {
        podiumStoryNote: note || null,
        podiumStoryCaseNumber: caseNumber ? parseInt(caseNumber, 10) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podium-stories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contestants"] });
      setEditingStory(null);
      toast({ title: "Story updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save story", description: err.message, variant: "destructive" });
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
          {episodeStories.length > 0 && (
            <Badge variant="outline" className="text-xs bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800">
              <Heart className="h-3 w-3 mr-1" />
              {episodeStories.length} {episodeStories.length === 1 ? 'story' : 'stories'}
            </Badge>
          )}
          {recordDayId && activeTab === 'positions' && (
            <Button
              size="sm"
              variant={quickMoveEnabled ? "default" : "outline"}
              onClick={() => setQuickMoveEnabled(v => !v)}
              className={quickMoveEnabled ? "bg-cyan-600 hover:bg-cyan-700 text-white" : ""}
              data-testid="button-podium-quick-move"
            >
              <Move className="h-3.5 w-3.5 mr-1.5" />
              {quickMoveEnabled
                ? (quickMoveSelectedPosition != null
                    ? `Quick Move · #${quickMoveSelectedPosition} selected`
                    : "Quick Move · pick a position")
                : "Quick Move"}
            </Button>
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
                  {episodeStories.length > 0 && (
                    <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-pink-500 text-white">
                      {episodeStories.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Positions tab ── */}
            <TabsContent value="positions" className="flex-1 overflow-auto p-5 mt-0">
              <DndContext
                sensors={sensors}
                collisionDetection={customCollisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <div className="space-y-6 max-w-5xl mx-auto">
                  {ROWS.map(row => (
                    <div key={row.key}>
                      {row.isPlayer && (
                        <div className="border-t border-dashed border-border mt-6 mb-6" />
                      )}
                      <p className={`text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 ${row.isPlayer ? "text-center" : ""}`}>
                        {row.label}{row.isPlayer ? "" : ` — ${row.positions.filter(p => positionMap[p]).length}/${row.count} filled`}
                      </p>
                      <div className={row.isPlayer ? "flex justify-center" : "flex gap-2 flex-wrap"}>
                        {row.positions.map(pos => (
                          <div key={pos} className={row.isPlayer ? "w-[100px]" : "min-w-[72px] flex-1"}>
                            <DraggableDroppablePodium
                              pos={pos}
                              entry={positionMap[pos]}
                              onClick={() => openPosition(pos)}
                              recordDayId={recordDayId}
                              recordDays={recordDays}
                              onRemove={(p) => removeMutation.mutate(p)}
                              isQuickMoveMode={quickMoveEnabled}
                              isQuickMoveSelected={quickMoveSelectedPosition === pos}
                              isDragOver={overDragPos === pos && activeDragPos !== pos}
                              onQuickMoveClick={handleQuickMoveClick}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <DragOverlay dropAnimation={null}>
                  {activeDragPos != null && positionMap[activeDragPos] ? (
                    <div className="opacity-90 pointer-events-none">
                      <PodiumPositionCard
                        pos={activeDragPos}
                        entry={positionMap[activeDragPos]}
                        onClick={() => {}}
                        recordDayId={recordDayId}
                        recordDays={recordDays}
                        onRemove={() => {}}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
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
                    <div className="grid grid-cols-[2fr_1fr_1fr_3fr_auto] gap-0 bg-muted/50 border-b px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      <div>Contestant</div>
                      <div>Rating / RX</div>
                      <div>Case #</div>
                      <div>Story</div>
                      <div></div>
                    </div>

                    {filteredStories.map((c: any, idx: number) => {
                      const ratingColors = isDark ? ratingColorsDark : ratingColorsLight;
                      const colorInfo = c.auditionRating ? ratingColors[c.auditionRating] : null;
                      const rxLabels = c.episodes?.map((e: any) => e.rxNumber || '?').join(', ');
                      const isLast = idx === filteredStories.length - 1;
                      return (
                        <div
                          key={c.id}
                          className={`grid grid-cols-[2fr_1fr_1fr_3fr_auto] gap-0 px-4 py-3 hover-elevate cursor-pointer ${!isLast ? 'border-b' : ''}`}
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

                          {/* Edit action */}
                          <div className="flex items-start justify-end pl-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={e => {
                                e.stopPropagation();
                                setEditingStory({
                                  id: c.id,
                                  name: c.name,
                                  note: c.podiumStoryNote || '',
                                  caseNumber: c.podiumStoryCaseNumber != null ? String(c.podiumStoryCaseNumber) : '',
                                });
                              }}
                              data-testid={`button-edit-story-${c.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
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
              {/* PS tag toggle + Rating change */}
              <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Podium Story</span>
                  <Button
                    variant={selectedEntry.contestant.podiumStory ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => togglePodiumStoryMutation.mutate({
                      contestantId: selectedEntry.contestant.id,
                      current: !!selectedEntry.contestant.podiumStory,
                    })}
                    disabled={togglePodiumStoryMutation.isPending}
                    data-testid="button-toggle-podium-story-dialog"
                  >
                    <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                    {selectedEntry.contestant.podiumStory ? "Tagged: PS" : "Tag as PS"}
                  </Button>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Rating</span>
                  <Select
                    value={selectedEntry.contestant.auditionRating ?? "none"}
                    onValueChange={v => updateRatingMutation.mutate({
                      contestantId: selectedEntry.contestant.id,
                      rating: v === "none" ? "" : v,
                    })}
                    disabled={updateRatingMutation.isPending}
                  >
                    <SelectTrigger className="h-9" data-testid="select-podium-rating">
                      <SelectValue placeholder="No rating" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No rating —</SelectItem>
                      <SelectItem value="A+">A+</SelectItem>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="P">P</SelectItem>
                      <SelectItem value="B+">B+</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                      <SelectItem value="R">R</SelectItem>
                      <SelectItem value="V">V</SelectItem>
                    </SelectContent>
                  </Select>
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
                          <SelectItem value="V">V</SelectItem>
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
      {/* Edit Story Dialog */}
      <Dialog open={!!editingStory} onOpenChange={open => { if (!open) setEditingStory(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Story — {editingStory?.name}</DialogTitle>
            <DialogDescription>Update the case number and story notes for this contestant.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Case Number</label>
              <input
                type="number"
                min={1}
                max={22}
                placeholder="e.g. 7"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={editingStory?.caseNumber ?? ''}
                onChange={e => setEditingStory(s => s ? { ...s, caseNumber: e.target.value } : s)}
                data-testid="input-story-case-number"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Story Notes</label>
              <Textarea
                placeholder="Enter the contestant's podium story…"
                className="resize-none min-h-[120px]"
                value={editingStory?.note ?? ''}
                onChange={e => setEditingStory(s => s ? { ...s, note: e.target.value } : s)}
                data-testid="textarea-story-note"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setEditingStory(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editingStory) return;
                updateStoryMutation.mutate({
                  id: editingStory.id,
                  note: editingStory.note,
                  caseNumber: editingStory.caseNumber,
                });
              }}
              disabled={updateStoryMutation.isPending}
              data-testid="button-save-story"
            >
              {updateStoryMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <p className="text-xs font-medium text-muted-foreground mb-1">CELEB Episodes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewedContestant.episodes.map((e: any, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {e.rxNumber || (e.date ? new Date(e.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Unknown')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {viewedContestant.dondEpisodes?.length > 0 && (
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">DOND Appearances</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewedContestant.dondEpisodes.map((e: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400">
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
