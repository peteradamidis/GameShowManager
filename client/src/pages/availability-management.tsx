import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Mail, Users, CheckCircle, Clock, XCircle, Filter, Copy } from "lucide-react";
import type { Contestant, RecordDay } from "@shared/schema";

type AvailabilityStats = {
  total: number;
  sent: number;
  responded: number;
  pending: number;
};

type ContestantWithAvailability = {
  id: string;
  contestantId: string;
  recordDayId: string;
  responseValue: string;
  respondedAt: string | null;
  notes: string | null;
  contestant: Contestant;
};

export default function AvailabilityManagement() {
  const { toast } = useToast();
  const [selectedContestants, setSelectedContestants] = useState<Set<string>>(new Set());
  const [selectedRecordDays, setSelectedRecordDays] = useState<Set<string>>(new Set());
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [filterRecordDayId, setFilterRecordDayId] = useState<string>("");

  const { data: stats } = useQuery<AvailabilityStats>({
    queryKey: ["/api/availability/status"],
  });

  const { data: contestants } = useQuery<Contestant[]>({
    queryKey: ["/api/contestants"],
  });

  const { data: recordDays } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: filteredAvailability } = useQuery<ContestantWithAvailability[]>({
    queryKey: ["/api/availability/record-day", filterRecordDayId],
    enabled: !!filterRecordDayId,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/availability/send", {
        contestantIds: Array.from(selectedContestants),
        recordDayIds: Array.from(selectedRecordDays),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Tokens generated!",
        description: `Generated ${data.tokens.length} availability check tokens.`,
      });
      setSendDialogOpen(false);
      setSelectedContestants(new Set());
      setSelectedRecordDays(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/availability/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send availability checks",
        variant: "destructive",
      });
    },
  });

  const toggleContestant = (id: string) => {
    const newSet = new Set(selectedContestants);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedContestants(newSet);
  };

  const toggleRecordDay = (id: string) => {
    const newSet = new Set(selectedRecordDays);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRecordDays(newSet);
  };

  const selectAllContestants = () => {
    if (contestants) {
      setSelectedContestants(new Set(contestants.map(c => c.id)));
    }
  };

  const clearContestantSelection = () => {
    setSelectedContestants(new Set());
  };

  const selectAllRecordDays = () => {
    if (recordDays) {
      setSelectedRecordDays(new Set(recordDays.map(rd => rd.id)));
    }
  };

  const clearRecordDaySelection = () => {
    setSelectedRecordDays(new Set());
  };

  const getResponseBadgeVariant = (responseValue: string) => {
    switch (responseValue) {
      case 'yes':
        return 'default';
      case 'maybe':
        return 'secondary';
      case 'no':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Availability Management</h1>
          <p className="text-muted-foreground mt-1">
            Send availability checks and track contestant responses
          </p>
        </div>
        <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-send-checks">
              <Mail className="w-4 h-4 mr-2" />
              Send Availability Checks
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Send Availability Checks</DialogTitle>
              <DialogDescription>
                Select contestants and record days to generate availability check tokens.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Select Record Days</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={selectAllRecordDays} data-testid="button-select-all-days">
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearRecordDaySelection} data-testid="button-clear-days">
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md p-4 space-y-2 max-h-40 overflow-auto">
                  {recordDays?.map((day) => (
                    <div key={day.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`day-${day.id}`}
                        checked={selectedRecordDays.has(day.id)}
                        onCheckedChange={() => toggleRecordDay(day.id)}
                        data-testid={`checkbox-day-${day.id}`}
                      />
                      <label
                        htmlFor={`day-${day.id}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {new Date(day.date).toLocaleDateString('en-US', { 
                          weekday: 'short', 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedRecordDays.size} day{selectedRecordDays.size !== 1 ? 's' : ''} selected
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Select Contestants</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={selectAllContestants} data-testid="button-select-all-contestants">
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" onClick={clearContestantSelection} data-testid="button-clear-contestants">
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="border rounded-md p-4 space-y-2 max-h-60 overflow-auto">
                  {contestants?.map((contestant) => (
                    <div key={contestant.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`contestant-${contestant.id}`}
                        checked={selectedContestants.has(contestant.id)}
                        onCheckedChange={() => toggleContestant(contestant.id)}
                        data-testid={`checkbox-contestant-${contestant.id}`}
                      />
                      <label
                        htmlFor={`contestant-${contestant.id}`}
                        className="text-sm font-medium leading-none cursor-pointer flex-1"
                      >
                        {contestant.name} ({contestant.age}, {contestant.gender})
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedContestants.size} contestant{selectedContestants.size !== 1 ? 's' : ''} selected
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSendDialogOpen(false)} data-testid="button-cancel-send">
                Cancel
              </Button>
              <Button
                onClick={() => sendMutation.mutate()}
                disabled={selectedContestants.size === 0 || selectedRecordDays.size === 0 || sendMutation.isPending}
                data-testid="button-confirm-send"
              >
                {sendMutation.isPending ? "Generating..." : "Generate Tokens"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Contestants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total">{stats?.total || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Checks Sent</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-sent">{stats?.sent || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Responded</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-responded">{stats?.responded || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-pending">{stats?.pending || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter by Record Day */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filter by Record Day
          </CardTitle>
          <CardDescription>
            View contestant availability for a specific record day
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={filterRecordDayId} onValueChange={setFilterRecordDayId}>
            <SelectTrigger data-testid="select-filter-day">
              <SelectValue placeholder="Select a record day" />
            </SelectTrigger>
            <SelectContent>
              {recordDays?.map((day) => (
                <SelectItem key={day.id} value={day.id} data-testid={`option-day-${day.id}`}>
                  {new Date(day.date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filterRecordDayId && filteredAvailability && (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">
                  {filteredAvailability.length} Response{filteredAvailability.length !== 1 ? 's' : ''}
                </h3>
              </div>
              <div className="border rounded-md divide-y max-h-96 overflow-auto">
                {filteredAvailability.map((item) => (
                  <div key={item.id} className="p-4 hover-elevate" data-testid={`availability-item-${item.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{item.contestant.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.contestant.age} • {item.contestant.gender}
                        </p>
                        {item.notes && (
                          <p className="text-sm text-muted-foreground mt-1">{item.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getResponseBadgeVariant(item.responseValue)} data-testid={`badge-response-${item.id}`}>
                          {item.responseValue}
                        </Badge>
                        {item.respondedAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.respondedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
