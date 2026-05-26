import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Mic2, Search, CalendarDays, Hash, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";

type Episode = {
  recordDayId: string;
  rxNumber: string | null;
  date: string | null;
  lockedAt: Date | null;
  blockNumber: number | null;
  seatLabel: string | null;
};

type PodiumContestant = {
  id: string;
  name: string;
  gender: string | null;
  age: number | null;
  photoUrl: string | null;
  podiumStoryNote: string | null;
  podiumStoryCaseNumber: number | null;
  episodes: Episode[];
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function episodeLabel(ep: Episode): string {
  if (ep.rxNumber) return ep.rxNumber;
  if (ep.date) return formatDate(ep.date);
  return "Unknown episode";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function PodiumStoriesPage() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();

  const { data: contestants = [], isLoading } = useQuery<PodiumContestant[]>({
    queryKey: ["/api/podium-stories"],
  });

  // Only show contestants who actually have a story written (non-empty note).
  // Being merely tagged with the podium-story flag is not enough — the page is
  // meant to surface real stories, not empty tags left over from removed/edited
  // contestants.
  const withStories = useMemo(() => {
    return contestants.filter((c) => (c.podiumStoryNote || "").trim().length > 0);
  }, [contestants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return withStories;
    return withStories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.podiumStoryNote || "").toLowerCase().includes(q) ||
        c.episodes.some((ep) =>
          (ep.rxNumber || "").toLowerCase().includes(q)
        )
    );
  }, [withStories, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.podiumStoryCaseNumber !== null && b.podiumStoryCaseNumber !== null) {
        return a.podiumStoryCaseNumber - b.podiumStoryCaseNumber;
      }
      if (a.podiumStoryCaseNumber !== null) return -1;
      if (b.podiumStoryCaseNumber !== null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Mic2 className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Podium Stories</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              All contestants with a written podium story across every episode
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="text-sm px-3 py-1">
          {withStories.length} contestant{withStories.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name, story, or episode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-podium-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Mic2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">
              {search ? "No results found" : "No podium stories tagged yet"}
            </p>
            <p className="text-sm mt-1">
              {search
                ? "Try a different search term."
                : "Tag contestants with a podium story from the seating chart."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  </TableHead>
                  <TableHead>Contestant</TableHead>
                  <TableHead className="w-48">Story Notes</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Episodes
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <TableRow
                    key={c.id}
                    data-testid={`row-podium-${c.id}`}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/contestants?open=${c.id}`)}
                  >
                    <TableCell className="pl-4 text-sm font-mono text-muted-foreground">
                      {c.podiumStoryCaseNumber !== null ? (
                        <span className="font-semibold text-foreground">
                          {c.podiumStoryCaseNumber}
                        </span>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          {c.photoUrl && (
                            <AvatarImage src={c.photoUrl} alt={c.name} />
                          )}
                          <AvatarFallback className="text-xs">
                            {getInitials(c.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium leading-tight">{c.name}</p>
                          <p className="text-xs text-muted-foreground leading-tight">
                            {[c.gender, c.age ? `${c.age} yrs` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      {c.podiumStoryNote ? (
                        <p className="text-sm leading-snug text-foreground">
                          {c.podiumStoryNote}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          No notes
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      {c.episodes.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">
                          Not yet assigned to an episode
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {c.episodes.map((ep) => (
                            <Badge
                              key={ep.recordDayId}
                              variant="outline"
                              className="text-xs font-medium"
                              data-testid={`badge-episode-${c.id}-${ep.recordDayId}`}
                            >
                              {episodeLabel(ep)}
                              {ep.seatLabel && (
                                <span className="ml-1 text-muted-foreground font-normal">
                                  · {ep.seatLabel}
                                </span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
