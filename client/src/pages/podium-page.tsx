import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { X, UserPlus } from "lucide-react";
import backdropSrc from "@assets/stage-backdrop_1779190275090.png";

// Row layout: bottom=9, middle=9, top=8 (total 26)
const ROWS = [
  { key: "top",    count: 8, positions: [19,20,21,22,23,24,25,26], topPct: 39, widthPct: 45 },
  { key: "middle", count: 9, positions: [10,11,12,13,14,15,16,17,18], topPct: 52, widthPct: 57 },
  { key: "bottom", count: 9, positions: [1,2,3,4,5,6,7,8,9], topPct: 64, widthPct: 66 },
];

type RecordDay = { id: string; date: string | null; rxNumber: string | null };
type Contestant = { id: string; name: string; gender: string; photoUrl?: string | null };
type PodiumEntry = { id: string; position: number; contestantId: string; contestant: Contestant };

export default function PodiumPage() {
  const { toast } = useToast();
  const [recordDayId, setRecordDayId] = useState<string>("");
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: allContestants = [] } = useQuery<Contestant[]>({
    queryKey: ["/api/contestants"],
  });

  const { data: podiumData = [], isLoading: podiumLoading } = useQuery<PodiumEntry[]>({
    queryKey: ["/api/record-days", recordDayId, "podium-positions"],
    enabled: !!recordDayId,
  });

  const positionMap = useMemo(() => {
    const map: Record<number, PodiumEntry> = {};
    podiumData.forEach(p => { map[p.position] = p; });
    return map;
  }, [podiumData]);

  const assignMutation = useMutation({
    mutationFn: ({ position, contestantId }: { position: number; contestantId: string }) =>
      apiRequest("PUT", `/api/record-days/${recordDayId}/podium-positions/${position}`, { contestantId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/record-days", recordDayId, "podium-positions"] });
      setSelectedPosition(null);
      setSearchQuery("");
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
      setSelectedPosition(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    },
  });

  const assignedContestantIds = useMemo(() => new Set(podiumData.map(p => p.contestantId)), [podiumData]);

  const availableContestants = useMemo(() =>
    allContestants
      .filter(c => !assignedContestantIds.has(c.id))
      .filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [allContestants, assignedContestantIds, searchQuery]
  );

  const selectedEntry = selectedPosition != null ? positionMap[selectedPosition] : null;
  const filledCount = podiumData.length;

  const sortedDays = [...recordDays].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Podium</h1>
          {recordDayId && (
            <Badge variant="outline" className="text-xs">
              {filledCount}/26 assigned
            </Badge>
          )}
        </div>
        <Select value={recordDayId} onValueChange={setRecordDayId}>
          <SelectTrigger className="w-60" data-testid="select-record-day">
            <SelectValue placeholder="Select a record day" />
          </SelectTrigger>
          <SelectContent>
            {sortedDays.map(day => (
              <SelectItem key={day.id} value={day.id}>
                {day.rxNumber ? `${day.rxNumber} — ` : ""}
                {day.date ? new Date(day.date).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "No date"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-4">
        {!recordDayId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 mt-20">
            <p className="text-base">Select a record day to manage podium positions</p>
          </div>
        ) : (
          <div className="relative w-full" style={{ maxWidth: "900px" }}>
            <img
              src={backdropSrc}
              alt="Podium stage backdrop"
              className="w-full block select-none"
              draggable={false}
            />

            {/* Overlay rows */}
            {ROWS.map(row => (
              <div
                key={row.key}
                className="absolute flex items-stretch justify-center"
                style={{
                  top: `${row.topPct}%`,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: `${row.widthPct}%`,
                  gap: "3px",
                }}
              >
                {row.positions.map(pos => {
                  const entry = positionMap[pos];
                  return (
                    <button
                      key={pos}
                      data-testid={`podium-position-${pos}`}
                      onClick={() => {
                        if (!podiumLoading) setSelectedPosition(pos);
                      }}
                      className={[
                        "flex-1 min-w-0 rounded flex flex-col items-center justify-center py-1 px-0.5 transition-all",
                        entry
                          ? "bg-teal-600/90 hover:bg-teal-500/90 text-white shadow-sm"
                          : "bg-black/50 hover:bg-black/70 text-white/60 border border-white/20",
                      ].join(" ")}
                      style={{ minHeight: "28px" }}
                    >
                      <span className="text-[9px] font-bold opacity-70 leading-none">{pos}</span>
                      {entry ? (
                        <span className="text-[9px] font-medium leading-tight text-center truncate w-full px-0.5 mt-0.5">
                          {entry.contestant.name.split(" ")[0]}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assignment Dialog */}
      <Dialog
        open={selectedPosition != null}
        onOpenChange={open => {
          if (!open) {
            setSelectedPosition(null);
            setSearchQuery("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Position {selectedPosition}
              {selectedEntry ? ` — ${selectedEntry.contestant.name}` : " — Empty"}
            </DialogTitle>
          </DialogHeader>

          {selectedEntry ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{selectedEntry.contestant.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{selectedEntry.contestant.gender}</p>
                </div>
                <Badge variant="secondary" className="text-xs shrink-0">Pos {selectedEntry.position}</Badge>
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
            <div className="space-y-3">
              <Input
                placeholder="Search contestants..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                data-testid="input-contestant-search"
                autoFocus
              />
              <div className="max-h-72 overflow-y-auto space-y-0.5 rounded-md border">
                {availableContestants.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {searchQuery ? "No contestants match your search" : "All contestants are assigned"}
                  </p>
                ) : (
                  availableContestants.map(c => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2"
                      onClick={() => assignMutation.mutate({ position: selectedPosition!, contestantId: c.id })}
                      disabled={assignMutation.isPending}
                      data-testid={`assign-contestant-${c.id}`}
                    >
                      <UserPlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground capitalize shrink-0">{c.gender}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
