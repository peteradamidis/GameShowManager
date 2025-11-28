import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

type ApiRecordDay = {
  id: string;
  date: string;
  totalSeats: number;
  status: string;
};

export default function RecordDays() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Fetch real record days from API
  const { data: apiRecordDays = [], isLoading } = useQuery<ApiRecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  // Fetch all seat assignments to calculate stats
  const { data: allAssignments = [] } = useQuery<Array<{ recordDayId: string; assignments: any[] }>>({
    queryKey: ['/api/all-seat-assignments'],
    queryFn: async () => {
      // Fetch assignments for all record days
      const promises = apiRecordDays.map(async (day) => {
        const response = await fetch(`/api/seat-assignments/${day.id}`);
        if (!response.ok) return { recordDayId: day.id, assignments: [] };
        const assignments = await response.json();
        return { recordDayId: day.id, assignments };
      });
      return await Promise.all(promises);
    },
    enabled: apiRecordDays.length > 0,
  });

  // Transform API data to RecordDay format and sort by date
  const recordDays: RecordDay[] = apiRecordDays
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((day) => {
      const dayAssignments = allAssignments.find((a) => a.recordDayId === day.id)?.assignments || [];
      const filledSeats = dayAssignments.length;
      const femaleCount = dayAssignments.filter((a: any) => a.gender === 'Female').length;
      const femalePercent = filledSeats > 0 ? Math.round((femaleCount / filledSeats) * 100) : 0;

      return {
        id: day.id,
        date: new Date(day.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        totalSeats: day.totalSeats || 154,
        filledSeats,
        femalePercent,
        status: day.status === 'draft' ? 'Draft' : day.status === 'ready' ? 'Ready' : 'Invited',
      };
    });

  const handleCreateRecordDay = () => {
    toast({
      title: "Record day created",
      description: "A new record day has been added to the schedule.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Record Days</h1>
          <p className="text-muted-foreground">
            Manage recording schedules and contestant assignments
          </p>
        </div>
        <Button onClick={handleCreateRecordDay} data-testid="button-create-record-day">
          <Plus className="h-4 w-4 mr-2" />
          Create Record Day
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading record days...
        </div>
      ) : recordDays.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No record days yet. Create one to get started!
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {recordDays.map((recordDay) => (
            <RecordDayCard
              key={recordDay.id}
              recordDay={recordDay}
              onViewSeating={() => setLocation(`/seating-chart?day=${recordDay.id}`)}
              onSendInvitations={() => {
                toast({
                  title: "Invitations sent",
                  description: `Record day invitations sent to all ${recordDay.filledSeats} assigned contestants.`,
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
