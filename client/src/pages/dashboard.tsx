import { StatsCard } from "@/components/stats-card";
import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Users, Clock, CheckCircle, Calendar } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface Contestant {
  id: string;
  availabilityStatus: string;
  gender: string;
}

interface RecordDayData {
  id: string;
  date: string;
  rxNumber?: string | null;
  totalSeats: number;
  status: string;
}

interface SeatAssignment {
  id: string;
  recordDayId: string;
  contestantId: string;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();

  // Fetch real data from API
  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ['/api/contestants'],
  });

  const { data: recordDaysData = [] } = useQuery<RecordDayData[]>({
    queryKey: ['/api/record-days'],
  });

  const { data: seatAssignments = [] } = useQuery<SeatAssignment[]>({
    queryKey: ['/api/seat-assignments'],
  });

  // Calculate real statistics
  const totalApplicants = contestants.length;
  const pendingAvailability = contestants.filter(c => c.availabilityStatus === 'pending').length;
  const assignedContestants = contestants.filter(c => c.availabilityStatus === 'assigned').length;

  // Transform record days to the format expected by RecordDayCard
  const upcomingRecordDays: RecordDay[] = recordDaysData.map(rd => {
    const assignmentsForDay = seatAssignments.filter(sa => sa.recordDayId === rd.id);
    const filledSeats = assignmentsForDay.length;
    
    // Calculate female percentage from assigned contestants
    const assignedContestantIds = new Set(assignmentsForDay.map(sa => sa.contestantId));
    const assignedContestantsForDay = contestants.filter(c => assignedContestantIds.has(c.id));
    const femaleCount = assignedContestantsForDay.filter(c => c.gender === 'Female').length;
    const femalePercent = assignedContestantsForDay.length > 0 
      ? Math.round((femaleCount / assignedContestantsForDay.length) * 100) 
      : 0;

    // Map status to expected format
    const statusMap: Record<string, "Draft" | "Ready" | "Invited" | "Completed"> = {
      draft: "Draft",
      ready: "Ready",
      invited: "Invited",
      completed: "Completed",
    };

    return {
      id: rd.id,
      date: new Date(rd.date).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      }),
      rxNumber: rd.rxNumber,
      totalSeats: rd.totalSeats || 154,
      filledSeats,
      femalePercent,
      status: statusMap[rd.status] || "Draft",
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of contestant management and upcoming record days
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Applicants"
          value={totalApplicants}
          icon={Users}
        />
        <StatsCard
          title="Pending Availability"
          value={pendingAvailability}
          icon={Clock}
          subtitle="Awaiting response"
        />
        <StatsCard
          title="Assigned Contestants"
          value={assignedContestants}
          icon={CheckCircle}
        />
        <StatsCard
          title="Upcoming Record Days"
          value={upcomingRecordDays.length}
          icon={Calendar}
        />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Upcoming Record Days</h2>
        {upcomingRecordDays.length === 0 ? (
          <p className="text-muted-foreground">No record days scheduled yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcomingRecordDays.map((recordDay) => (
              <RecordDayCard
                key={recordDay.id}
                recordDay={recordDay}
                onViewSeating={() => setLocation(`/seating-chart?day=${recordDay.id}`)}
                onSendInvitations={() => console.log('Send invitations for', recordDay.date)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
