import { StatsCard } from "@/components/stats-card";
import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, CheckCircle, Calendar, AlertTriangle, AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays, subDays, startOfWeek, endOfWeek, addWeeks } from "date-fns";

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

interface AvailabilityResponse {
  id: string;
  recordDayId: string;
  contestantId: string;
  responseValue: string;
}

type DeadlineStatus = 'overdue' | 'due-soon' | 'on-track';

interface DeadlineInfo {
  recordDayId: string;
  recordDate: Date;
  rxNumber?: string | null;
  deadline: Date;
  daysUntilDeadline: number;
  daysUntilRecordDate: number;
  status: DeadlineStatus;
  invitationsSent: number;
  confirmedCount: number;
  totalSeats: number;
  seatsAvailable: number;
  assignedSeats: number;
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

  const { data: availabilityResponses = [] } = useQuery<AvailabilityResponse[]>({
    queryKey: ['/api/availability-responses'],
  });

  // Calculate real statistics
  const totalApplicants = contestants.length;
  const pendingAvailability = contestants.filter(c => c.availabilityStatus === 'pending').length;
  const assignedContestants = contestants.filter(c => c.availabilityStatus === 'assigned').length;

  // Today's date
  const today = new Date();
  const formattedToday = format(today, "EEEE, MMMM d, yyyy");

  // Calculate deadlines for the first 2 calendar weeks of upcoming record days
  const INVITATION_LEAD_DAYS = 14; // 2 weeks before record day
  const DUE_SOON_THRESHOLD = 3; // Days before deadline to show "due soon"
  
  // First, get all future record days sorted by date
  const futureRecordDays = recordDaysData
    .filter(rd => new Date(rd.date) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Find the first upcoming record date and calculate the 2-week calendar window
  const firstRecordDate = futureRecordDays.length > 0 ? new Date(futureRecordDays[0].date) : null;
  // Start of the week containing the first record date (Monday)
  const weekStart = firstRecordDate ? startOfWeek(firstRecordDate, { weekStartsOn: 1 }) : null;
  // End of the second week (Sunday of week 2)
  const twoWeeksEnd = weekStart ? endOfWeek(addWeeks(weekStart, 1), { weekStartsOn: 1 }) : null;
  
  const deadlineInfos: DeadlineInfo[] = futureRecordDays
    .map(rd => {
      const recordDate = new Date(rd.date);
      const deadline = subDays(recordDate, INVITATION_LEAD_DAYS);
      const daysUntilDeadline = differenceInDays(deadline, today);
      const daysUntilRecordDate = differenceInDays(recordDate, today);
      
      // Count invitations sent for this record day (availability responses sent)
      const invitationsForDay = availabilityResponses.filter(ar => ar.recordDayId === rd.id);
      const invitationsSent = invitationsForDay.length;
      
      // Count confirmed (availability responses with 'yes')
      const confirmedCount = invitationsForDay.filter(ar => ar.responseValue === 'yes').length;
      
      // Count assigned seats
      const totalSeats = rd.totalSeats || 154;
      const assignedSeats = seatAssignments.filter(sa => sa.recordDayId === rd.id).length;
      const seatsAvailable = totalSeats - assignedSeats;
      
      // Determine status
      let status: DeadlineStatus;
      if (daysUntilDeadline < 0) {
        status = 'overdue';
      } else if (daysUntilDeadline <= DUE_SOON_THRESHOLD) {
        status = 'due-soon';
      } else {
        status = 'on-track';
      }
      
      return {
        recordDayId: rd.id,
        recordDate,
        rxNumber: rd.rxNumber,
        deadline,
        daysUntilDeadline,
        daysUntilRecordDate,
        status,
        invitationsSent,
        confirmedCount,
        totalSeats,
        seatsAvailable,
        assignedSeats,
      };
    })
    // Filter to show record days within the first 2 calendar weeks (Mon-Sun, Mon-Sun)
    .filter(d => {
      if (!weekStart || !twoWeeksEnd) return false;
      return d.recordDate >= weekStart && d.recordDate <= twoWeeksEnd;
    });

  // Transform record days to the format expected by RecordDayCard
  const upcomingRecordDays: RecordDay[] = recordDaysData.map(rd => {
    const assignmentsForDay = seatAssignments.filter(sa => sa.recordDayId === rd.id);
    const filledSeats = assignmentsForDay.length;
    
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
      status: statusMap[rd.status] || "Draft",
    };
  });

  // Helper to get status styling
  const getStatusStyle = (status: DeadlineStatus) => {
    switch (status) {
      case 'overdue':
        return {
          bg: 'bg-red-100 dark:bg-red-900/30',
          border: 'border-red-300 dark:border-red-700',
          text: 'text-red-700 dark:text-red-300',
          icon: AlertCircle,
          label: 'OVERDUE',
        };
      case 'due-soon':
        return {
          bg: 'bg-amber-100 dark:bg-amber-900/30',
          border: 'border-amber-300 dark:border-amber-700',
          text: 'text-amber-700 dark:text-amber-300',
          icon: AlertTriangle,
          label: 'DUE SOON',
        };
      case 'on-track':
        return {
          bg: 'bg-green-100 dark:bg-green-900/30',
          border: 'border-green-300 dark:border-green-700',
          text: 'text-green-700 dark:text-green-300',
          icon: CheckCircle2,
          label: 'ON TRACK',
        };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of contestant management and upcoming record days
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium" data-testid="text-today-date">{formattedToday}</span>
        </div>
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

      {/* Invitation Deadlines Panel */}
      <Card data-testid="card-invitation-deadlines">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" />
            Upcoming Two Weeks
            <span className="text-sm font-normal text-muted-foreground ml-2">
              (invites due 2 weeks before record)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deadlineInfos.length === 0 ? (
            <p className="text-muted-foreground text-sm">No record days within the next two weeks.</p>
          ) : (
            <div className="space-y-3">
              {deadlineInfos.map((info) => {
                const style = getStatusStyle(info.status);
                const StatusIcon = style.icon;
                
                return (
                  <div
                    key={info.recordDayId}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border ${style.bg} ${style.border}`}
                    data-testid={`deadline-row-${info.recordDayId}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusIcon className={`h-6 w-6 flex-shrink-0 ${style.text}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg font-bold">
                            {info.rxNumber || format(info.recordDate, "MMM d")}
                          </span>
                          <span className="font-semibold">
                            Record: {format(info.recordDate, "EEE, MMM d")}
                          </span>
                        </div>
                        <div className="font-semibold">
                          Deadline: {format(info.deadline, "EEE, MMM d")}
                          {info.daysUntilDeadline === 0 && <span className="text-red-600 dark:text-red-400 ml-1">(TODAY)</span>}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Invites: </span>
                        <span className="font-medium">{info.invitationsSent}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Confirmed: </span>
                        <span className="font-medium">{info.confirmedCount}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Assigned: </span>
                        <span className="font-medium">{info.assignedSeats}</span>
                        <span className="text-muted-foreground"> / {info.totalSeats}</span>
                      </div>
                      <Badge 
                        variant={info.status === 'overdue' ? 'destructive' : info.status === 'due-soon' ? 'secondary' : 'default'}
                        className={`${style.text} ${style.bg} border ${style.border}`}
                      >
                        {info.status === 'overdue' 
                          ? `${Math.abs(info.daysUntilDeadline)} days overdue`
                          : info.daysUntilDeadline === 0 
                            ? 'Due today!'
                            : `${info.daysUntilDeadline} days left`
                        }
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
