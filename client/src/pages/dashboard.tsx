import { StatsCard } from "@/components/stats-card";
import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Clock, CheckCircle, Calendar, AlertTriangle, AlertCircle, CheckCircle2, Mail, Megaphone, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInDays, subDays, startOfWeek, endOfWeek, addWeeks, formatDistanceToNow } from "date-fns";

interface NoticeboardPost {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
  isPinned: boolean;
}

// Posts are "new" if created within the last 24 hours (since everyone shares the same login)
const isPostNew = (createdAt: string) => {
  const postDate = new Date(createdAt);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return postDate > oneDayAgo;
};

interface Contestant {
  id: string;
  availabilityStatus: string;
  gender: string;
  availableForStandby: boolean;
  auditionRating?: string | null;
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
  confirmedRsvp?: string | null;
}

type DeadlineStatus = 'overdue' | 'due-soon' | 'on-track';

interface DeadlineInfo {
  recordDayId: string;
  recordDate: Date;
  rxNumber?: string | null;
  emailDeadline: Date;
  confirmationDeadline: Date;
  daysUntilEmailDeadline: number;
  daysUntilConfirmationDeadline: number;
  daysUntilRecordDate: number;
  status: DeadlineStatus;
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

  // Fetch recent noticeboard posts
  const { data: recentPosts = [] } = useQuery<NoticeboardPost[]>({
    queryKey: ['/api/noticeboard/posts/recent'],
  });

  // Calculate new posts since last visit
  const newPostsCount = recentPosts.filter(p => isPostNew(p.createdAt)).length;

  // Calculate real statistics
  const totalApplicants = contestants.length;
  const availableContestants = contestants.filter(c => c.availabilityStatus === 'available').length;
  const availableStandbys = contestants.filter(c => 
    c.availableForStandby && c.availabilityStatus === 'available'
  ).length;

  // Rating counts
  const ratingCounts = contestants.reduce((acc, c) => {
    if (c.auditionRating) {
      acc[c.auditionRating] = (acc[c.auditionRating] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const sortedRatings = Object.entries(ratingCounts).sort((a, b) => {
    const order = ['A+', 'A', 'B+', 'B', 'C', 'P'];
    const aIndex = order.indexOf(a[0]) === -1 ? 999 : order.indexOf(a[0]);
    const bIndex = order.indexOf(b[0]) === -1 ? 999 : order.indexOf(b[0]);
    return aIndex - bIndex;
  });

  // Today's date
  const today = new Date();
  const formattedToday = format(today, "EEEE, MMMM d, yyyy");

  // Calculate deadlines
  const SENDING_EMAIL_LEAD_DAYS = 14; // 2 weeks before record day (Sending Email Deadline)
  const CONFIRMATION_LEAD_DAYS = 7; // 1 week before record day (Contestant Confirmation Deadline)
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
      const emailDeadline = subDays(recordDate, SENDING_EMAIL_LEAD_DAYS);
      const confirmationDeadline = subDays(recordDate, CONFIRMATION_LEAD_DAYS);
      const daysUntilEmailDeadline = differenceInDays(emailDeadline, today);
      const daysUntilConfirmationDeadline = differenceInDays(confirmationDeadline, today);
      const daysUntilRecordDate = differenceInDays(recordDate, today);
      
      // Count assigned seats for this record day
      const assignmentsForDay = seatAssignments.filter(sa => sa.recordDayId === rd.id);
      const totalSeats = rd.totalSeats || 154;
      const assignedSeats = assignmentsForDay.length;
      
      // Count confirmed (seat assignments with confirmedRsvp set)
      const confirmedCount = assignmentsForDay.filter(sa => sa.confirmedRsvp).length;
      const seatsAvailable = totalSeats - assignedSeats;
      
      // Determine status based on confirmation deadline (most critical)
      let status: DeadlineStatus;
      if (daysUntilConfirmationDeadline < 0) {
        status = 'overdue';
      } else if (daysUntilConfirmationDeadline <= DUE_SOON_THRESHOLD) {
        status = 'due-soon';
      } else {
        status = 'on-track';
      }
      
      return {
        recordDayId: rd.id,
        recordDate,
        rxNumber: rd.rxNumber,
        emailDeadline,
        confirmationDeadline,
        daysUntilEmailDeadline,
        daysUntilConfirmationDeadline,
        daysUntilRecordDate,
        status,
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

    const confirmedSeats = assignmentsForDay.filter(sa => sa.confirmedRsvp).length;
    
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
      confirmedSeats,
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
          bg: 'bg-slate-100 dark:bg-slate-800/50',
          border: 'border-slate-300 dark:border-slate-600',
          text: 'text-slate-600 dark:text-slate-400',
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Total Contestants"
          value={totalApplicants}
          icon={Users}
        />
        <StatsCard
          title="Total Available"
          value={availableContestants}
          icon={CheckCircle}
          subtitle="Contestants with available tag"
        />
        <StatsCard
          title="Available Standbys"
          value={availableStandbys}
          icon={Clock}
          subtitle="Standby tag + Available"
        />
      </div>

      {/* Ratings Breakdown */}
      <div className="flex flex-wrap gap-4">
        {sortedRatings.map(([rating, count]) => (
          <Card key={rating} className="bg-muted/30 flex-1 min-w-[100px]">
            <CardContent className="pt-4 pb-4">
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground mb-1">Rating {rating}</p>
                <div className="text-2xl font-bold">{count}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Crew Noticeboard Updates */}
      {recentPosts.length > 0 && (
        <Card data-testid="card-noticeboard-updates" className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Megaphone className="h-5 w-5 text-primary" />
                Crew Noticeboard
                {newPostsCount > 0 && (
                  <Badge variant="destructive" className="ml-2" data-testid="badge-new-posts">
                    {newPostsCount} new
                  </Badge>
                )}
              </CardTitle>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setLocation('/noticeboard')}
                data-testid="button-view-noticeboard"
              >
                View All
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentPosts.slice(0, 3).map((post) => {
                const isNew = isPostNew(post.createdAt);
                return (
                  <div
                    key={post.id}
                    className={`p-3 rounded-lg border cursor-pointer hover-elevate ${
                      isNew ? 'bg-primary/5 border-primary/30' : 'bg-muted/50'
                    }`}
                    onClick={() => setLocation('/noticeboard')}
                    data-testid={`noticeboard-preview-${post.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{post.authorName}</span>
                          {isNew && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">NEW</Badge>
                          )}
                          {post.isPinned && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0">Pinned</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invitation Deadlines Panel */}
      <Card data-testid="card-invitation-deadlines">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5" />
            Upcoming Deadlines
            <span className="text-sm font-normal text-muted-foreground ml-2">
              (Confirmed 1wk / Email 2wks before record)
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
                        <div className="text-sm flex flex-col gap-1 mt-1">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-semibold w-44">Confirmation Deadline:</span>
                            <span className={info.daysUntilConfirmationDeadline < 0 ? "text-red-600 font-bold" : "font-medium text-foreground"}>
                              {format(info.confirmationDeadline, "EEE, MMM d")}
                              {info.daysUntilConfirmationDeadline === 0 && <span className="text-red-600 dark:text-red-400 ml-1">(TODAY)</span>}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-semibold w-44">Sending Email Deadline:</span>
                            <span className={info.daysUntilEmailDeadline < 0 ? "text-red-600 font-bold" : "font-medium text-foreground"}>
                              {format(info.emailDeadline, "EEE, MMM d")}
                              {info.daysUntilEmailDeadline === 0 && <span className="text-red-600 dark:text-red-400 ml-1">(TODAY)</span>}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="text-sm text-right">
                        <div>
                          <span className="text-muted-foreground">Confirmed: </span>
                          <span className="font-medium">{info.confirmedCount}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Assigned: </span>
                          <span className="font-medium">{info.assignedSeats}</span>
                          <span className="text-muted-foreground"> / {info.totalSeats}</span>
                        </div>
                      </div>
                      <Badge 
                        variant={info.status === 'overdue' ? 'destructive' : info.status === 'due-soon' ? 'secondary' : 'default'}
                        className={`${style.text} ${style.bg} border ${style.border}`}
                      >
                        {info.status === 'overdue' 
                          ? `${Math.abs(info.daysUntilConfirmationDeadline)} days overdue`
                          : info.daysUntilConfirmationDeadline === 0 
                            ? 'Confirmation due today!'
                            : `${info.daysUntilConfirmationDeadline} days until confirmation`
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
