import { useState, useEffect, useMemo } from "react";
import { StatsCard } from "@/components/stats-card";
import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Users, Clock, CheckCircle, Calendar, AlertTriangle, AlertCircle, CheckCircle2, Mail, Megaphone, ChevronRight, Clapperboard, Bell, Send, Loader2, Eye, Download, FileText, Trophy, Sparkles, Armchair, UserCheck, UserX, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInDays, subDays, startOfWeek, endOfWeek, addWeeks, formatDistanceToNow, startOfDay } from "date-fns";

interface CountdownTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateTimeRemaining(targetDate: Date): CountdownTime {
  const now = new Date();
  const diff = targetDate.getTime() - now.getTime();
  
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  };
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
          <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
            {value.toString().padStart(2, '0')}
          </span>
        </div>
        <div className="absolute -inset-0.5 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl opacity-50 blur-sm -z-10" />
      </div>
      <span className="mt-2 text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function RxDayCountdown({ targetDate, rxNumber }: { targetDate: Date; rxNumber?: string | null }) {
  // Set target time to 7:30 AM AEDT (UTC+11)
  // AEDT is UTC+11, so 7:30 AM AEDT = 20:30 UTC previous day
  const targetWithTime = useMemo(() => {
    const date = new Date(targetDate);
    // Set to 7:30 AM in local AEDT time
    // Since we're working in AEDT (UTC+11), we set the UTC time to be 7:30 - 11 = -3:30 = 20:30 previous day
    date.setUTCHours(20, 30, 0, 0); // 20:30 UTC = 7:30 AM AEDT next day
    date.setUTCDate(date.getUTCDate() - 1); // Adjust to previous day since we want this time on the target day
    return date;
  }, [targetDate]);
  
  const [timeRemaining, setTimeRemaining] = useState<CountdownTime>(calculateTimeRemaining(targetWithTime));
  
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(calculateTimeRemaining(targetWithTime));
    }, 1000);
    
    return () => clearInterval(timer);
  }, [targetWithTime]);
  
  const isToday = timeRemaining.days === 0 && timeRemaining.hours === 0 && timeRemaining.minutes === 0 && timeRemaining.seconds === 0;
  
  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800">
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-full bg-orange-500/20">
              <Clapperboard className="h-8 w-8 text-orange-400" />
            </div>
            <div className="text-center lg:text-left">
              <h3 className="text-xl font-semibold text-white">
                {isToday ? "It's Showtime!" : "Next Record Day"}
              </h3>
              <p className="text-lg text-orange-300 font-medium">
                {rxNumber ? `${rxNumber} - ` : ''}{format(targetDate, "EEEE, d MMMM yyyy")}
              </p>
            </div>
          </div>
          
          {!isToday ? (
            <div className="flex items-center gap-3 sm:gap-4">
              <CountdownUnit value={timeRemaining.days} label="Days" />
              <div className="text-2xl font-bold text-orange-400 animate-pulse">:</div>
              <CountdownUnit value={timeRemaining.hours} label="Hours" />
              <div className="text-2xl font-bold text-orange-400 animate-pulse">:</div>
              <CountdownUnit value={timeRemaining.minutes} label="Mins" />
              <div className="text-2xl font-bold text-orange-400 animate-pulse">:</div>
              <CountdownUnit value={timeRemaining.seconds} label="Secs" />
            </div>
          ) : (
            <div className="px-6 py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 shadow-lg shadow-green-500/30">
              <span className="text-xl font-bold text-white">Recording Today!</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

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

interface UpcomingReminder {
  id: string;
  date: string;
  rxNumber?: string | null;
  contestantReminderSent: boolean;
  standbyReminderSent: boolean;
  contestantReminderSentAt?: string | null;
  standbyReminderSentAt?: string | null;
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

  // Fetch upcoming record days that need reminders (within 48 hours)
  const { data: upcomingReminders = [] } = useQuery<UpcomingReminder[]>({
    queryKey: ['/api/record-days/upcoming-reminders'],
    refetchInterval: 60000, // Refresh every minute
  });

  const { toast } = useToast();

  // Track which record day IDs are currently pending for each reminder type (as Sets for concurrent requests)
  const [pendingContestantReminders, setPendingContestantReminders] = useState<Set<string>>(new Set());
  const [pendingStandbyReminders, setPendingStandbyReminders] = useState<Set<string>>(new Set());
  
  // Preview dialog state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewType, setPreviewType] = useState<'contestant' | 'standby'>('contestant');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Function to open email preview
  const openPreview = async (recordDayId: string, type: 'contestant' | 'standby') => {
    setPreviewLoading(true);
    setPreviewType(type);
    setPreviewOpen(true);
    try {
      const res = await apiRequest('GET', `/api/record-days/${recordDayId}/preview-reminder?type=${type}`);
      const data = await res.json();
      setPreviewHtml(data.html);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load preview",
        variant: "destructive",
      });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Mutation for sending contestant reminders
  const sendContestantReminderMutation = useMutation({
    mutationFn: async (recordDayId: string) => {
      setPendingContestantReminders(prev => new Set(Array.from(prev).concat(recordDayId)));
      const res = await apiRequest('POST', `/api/record-days/${recordDayId}/send-contestant-reminder`);
      return res.json();
    },
    onSettled: (_data, _error, variables) => {
      // variables is the recordDayId passed to mutate()
      setPendingContestantReminders(prev => {
        const next = new Set(prev);
        next.delete(variables);
        return next;
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Reminders Sent",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days/upcoming-reminders'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reminders",
        variant: "destructive",
      });
    },
  });

  // Mutation for sending standby reminders
  const sendStandbyReminderMutation = useMutation({
    mutationFn: async (recordDayId: string) => {
      setPendingStandbyReminders(prev => new Set(Array.from(prev).concat(recordDayId)));
      const res = await apiRequest('POST', `/api/record-days/${recordDayId}/send-standby-reminder`);
      return res.json();
    },
    onSettled: (_data, _error, variables) => {
      // variables is the recordDayId passed to mutate()
      setPendingStandbyReminders(prev => {
        const next = new Set(prev);
        next.delete(variables);
        return next;
      });
    },
    onSuccess: (data) => {
      toast({
        title: "Reminders Sent",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days/upcoming-reminders'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reminders",
        variant: "destructive",
      });
    },
  });

  // Calculate new posts since last visit
  const newPostsCount = recentPosts.filter(p => isPostNew(p.createdAt)).length;

  // Today's date - normalize to start of day for accurate day comparisons
  const today = startOfDay(new Date());
  const formattedToday = format(today, "EEEE, d MMMM yyyy");

  // Calculate real statistics
  const totalApplicants = contestants.length;
  const availableContestants = contestants.filter(c => c.availabilityStatus === 'available').length;
  const availableStandbys = contestants.filter(c => 
    c.availableForStandby && c.availabilityStatus === 'available'
  ).length;

  const { data: winningAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments/with-winning-money'],
  });

  const { data: seatingStats, isLoading: seatingStatsLoading, error: seatingStatsError } = useQuery<{
    emptySeats: number;
    unlockedDaysCount: number;
    unassignedTotal: number;
    reschedulePool: number;
    studioOnce: number;
    studioTotal: number;
    standbysCameInNotRebooked: number;
    standbysStillNeeded: number;
    totalActiveStandbys: number;
    standbysPerDay: number;
  }>({
    queryKey: ['/api/dashboard/seating-stats'],
    refetchInterval: 120000,
    retry: 2,
  });

  const funStats = useMemo(() => {
    // A record day is "filmed" if its date is in the past, regardless of status string
    const filmedRecordDays = recordDaysData.filter(rd => {
      const recordDate = startOfDay(new Date(rd.date));
      return recordDate <= today;
    });

    const totalPrizeMoney = winningAssignments.reduce((sum, a) => sum + (Number(a.winningMoneyAmount) || 0), 0);
    
    // Calculate per-day winnings
    const winningsByDay = winningAssignments.reduce((acc, a) => {
      const dayId = a.recordDayId;
      acc[dayId] = (acc[dayId] || 0) + (Number(a.winningMoneyAmount) || 0);
      return acc;
    }, {} as Record<string, number>);

    let highestDay = { amount: 0, date: '', rxNumber: '' };
    let lowestDay = { amount: Infinity, date: '', rxNumber: '' };

    Object.entries(winningsByDay).forEach(([dayId, amountValue]) => {
      const amount = amountValue as number;
      const day = recordDaysData.find(rd => rd.id === dayId);
      if (!day) return;

      if (amount > highestDay.amount) {
        highestDay = { amount, date: format(new Date(day.date), "d MMM yyyy"), rxNumber: day.rxNumber || '' };
      }
      if (amount < lowestDay.amount) {
        lowestDay = { amount, date: format(new Date(day.date), "d MMM yyyy"), rxNumber: day.rxNumber || '' };
      }
    });

    // Handle empty state for lowest
    if (lowestDay.amount === Infinity) lowestDay.amount = 0;

    // Total episodes (sum of EP counts from RX numbers like "RX EP 6 - 10" = 5 eps)
    const totalEpisodes = filmedRecordDays.reduce((sum, rd) => {
      if (!rd.rxNumber) return sum + 1;
      const match = rd.rxNumber.match(/(\d+)\s*-\s*(\d+)/);
      if (match) {
        return sum + (parseInt(match[2]) - parseInt(match[1]) + 1);
      }
      return sum + 1;
    }, 0);

    const TOTAL_EPS_TARGET = 195;
    const epsRemaining = Math.max(0, TOTAL_EPS_TARGET - totalEpisodes);
    
    // Calculate average eps per day from filmed days to estimate remaining days
    const avgEpsPerDay = filmedRecordDays.length > 0 ? totalEpisodes / filmedRecordDays.length : 5;
    const daysRemaining = Math.ceil(epsRemaining / avgEpsPerDay);

    return {
      filmedCount: filmedRecordDays.length,
      totalEpisodes,
      totalPrizeMoney,
      highestDay,
      lowestDay,
      epsRemaining,
      daysRemaining
    };
  }, [recordDaysData, winningAssignments]);

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

  // Calculate deadlines
  const SENDING_EMAIL_LEAD_DAYS = 14; // 2 weeks before record day (Sending Email Deadline)
  const CONFIRMATION_LEAD_DAYS = 7; // 1 week before record day (Contestant Confirmation Deadline)
  const DUE_SOON_THRESHOLD = 3; // Days before deadline to show "due soon"
  
  // First, get all future record days sorted by date
  const futureRecordDays = recordDaysData
    .filter(rd => startOfDay(new Date(rd.date)) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Find the first upcoming record date and calculate the 2-week calendar window
  const firstRecordDate = futureRecordDays.length > 0 ? new Date(futureRecordDays[0].date) : null;
  // Start of the week containing the first record date (Monday)
  const weekStart = firstRecordDate ? startOfWeek(firstRecordDate, { weekStartsOn: 1 }) : null;
  // End of the second week (Sunday of week 2)
  const twoWeeksEnd = weekStart ? endOfWeek(addWeeks(weekStart, 1), { weekStartsOn: 1 }) : null;
  
  const deadlineInfos: DeadlineInfo[] = futureRecordDays
    .map(rd => {
      // Normalize all dates to start of day for accurate day counting
      const recordDate = startOfDay(new Date(rd.date));
      const emailDeadline = startOfDay(subDays(recordDate, SENDING_EMAIL_LEAD_DAYS));
      const confirmationDeadline = startOfDay(subDays(recordDate, CONFIRMATION_LEAD_DAYS));
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
      
      // Determine status based on the current phase
      // Email deadline comes first, then confirmation deadline, then record day
      let status: DeadlineStatus;
      if (daysUntilEmailDeadline > 0) {
        // Before email deadline
        status = daysUntilEmailDeadline <= DUE_SOON_THRESHOLD ? 'due-soon' : 'on-track';
      } else if (daysUntilConfirmationDeadline > 0) {
        // Email passed, before confirmation deadline
        status = daysUntilConfirmationDeadline <= DUE_SOON_THRESHOLD ? 'due-soon' : 'on-track';
      } else if (daysUntilRecordDate >= 0) {
        // Confirmation passed, on or before record day
        status = daysUntilRecordDate <= DUE_SOON_THRESHOLD ? 'due-soon' : 'on-track';
      } else {
        // Record day passed (shouldn't show, but fallback)
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
    // and only show days where record date hasn't passed yet
    .filter(d => {
      if (!weekStart || !twoWeeksEnd) return false;
      if (d.daysUntilRecordDate < 0) return false; // Hide after record day
      return d.recordDate >= weekStart && d.recordDate <= twoWeeksEnd;
    });

  // Transform record days to the format expected by RecordDayCard
  // Filter to only show record days within the next 2 calendar weeks
  const upcomingRecordDays: RecordDay[] = recordDaysData
    .filter(rd => {
      if (!weekStart || !twoWeeksEnd) return false;
      const recordDate = new Date(rd.date);
      if (recordDate < today) return false; // Hide past record days
      return recordDate >= weekStart && recordDate <= twoWeeksEnd;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(rd => {
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
        date: new Date(rd.date).toLocaleDateString('en-AU', { 
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

      {/* Next Record Day Banner */}
      {firstRecordDate && (
        <div className="space-y-4">
          <RxDayCountdown 
            targetDate={firstRecordDate} 
            rxNumber={futureRecordDays[0]?.rxNumber}
          />

          {/* Fun Stats Row - Highest/Lowest Paid Day and Other Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="overflow-hidden border-none shadow-lg bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 text-white p-4 hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-2 mb-2 text-slate-300">
                <Sparkles className="h-5 w-5 text-orange-400" />
                <span className="text-xs font-bold uppercase tracking-wider">Highest Winnings Day</span>
              </div>
              <p className="text-2xl font-black text-white">${funStats.highestDay.amount.toLocaleString()}</p>
              <p className="text-xs text-slate-400 font-medium truncate" title={funStats.highestDay.rxNumber}>
                {funStats.highestDay.rxNumber || funStats.highestDay.date}
              </p>
            </Card>

            <Card className="overflow-hidden border-none shadow-lg bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 text-white p-4 hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-2 mb-2 text-slate-300">
                <AlertCircle className="h-5 w-5 text-slate-300" />
                <span className="text-xs font-bold uppercase tracking-wider">Lowest Winnings Day</span>
              </div>
              <p className="text-2xl font-black text-white">${funStats.lowestDay.amount.toLocaleString()}</p>
              <p className="text-xs text-slate-400 font-medium truncate" title={funStats.lowestDay.rxNumber}>
                {funStats.lowestDay.rxNumber || funStats.lowestDay.date}
              </p>
            </Card>

            <Card className="overflow-hidden border-none shadow-lg bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 text-white p-4 hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-2 mb-2 text-slate-300">
                <Clapperboard className="h-5 w-5 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-wider">Filming Progress</span>
              </div>
              <p className="text-2xl font-black text-white">{funStats.totalEpisodes} Episodes</p>
              <p className="text-xs text-slate-400 font-medium">{funStats.filmedCount} Days Filmed</p>
            </Card>

            <Card className="overflow-hidden border-none shadow-lg bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 text-white p-4 hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-2 mb-2 text-slate-300">
                <Clock className="h-5 w-5 text-purple-400" />
                <span className="text-xs font-bold uppercase tracking-wider">Target: 195 Eps</span>
              </div>
              <p className="text-2xl font-black text-white">{funStats.epsRemaining} Left</p>
              <p className="text-xs text-slate-400 font-medium">~{funStats.daysRemaining} Days remaining</p>
            </Card>
          </div>
        </div>
      )}

      {/* 48-Hour Reminder Alert (HIDDEN FOR NOW AS PER USER REQUEST) */}
      {/*
      {upcomingReminders.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30" data-testid="card-reminder-alert">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-800 dark:text-amber-300">
              <Bell className="h-5 w-5" />
              48-Hour Reminder Emails
              <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700 dark:text-amber-400">
                {upcomingReminders.length} day{upcomingReminders.length !== 1 ? 's' : ''} coming up
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingReminders.map((reminder) => (
              <div 
                key={reminder.id} 
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white dark:bg-slate-900 border"
                data-testid={`reminder-day-${reminder.id}`}
              >
                <div>
                  <p className="font-medium">
                    {reminder.rxNumber && <span className="text-muted-foreground mr-2">{reminder.rxNumber}</span>}
                    {format(new Date(reminder.date), "EEEE, d MMMM yyyy")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openPreview(reminder.id, 'contestant')}
                      className="gap-1 px-2"
                      data-testid={`button-preview-contestant-${reminder.id}`}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant={reminder.contestantReminderSent ? "outline" : "default"}
                      onClick={() => sendContestantReminderMutation.mutate(reminder.id)}
                      disabled={pendingContestantReminders.has(reminder.id)}
                      className="gap-1"
                      data-testid={`button-send-contestant-reminder-${reminder.id}`}
                    >
                      {pendingContestantReminders.has(reminder.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {reminder.contestantReminderSent ? 'Resend to Contestants' : 'Send to Contestants'}
                      {reminder.contestantReminderSent && (
                        <CheckCircle className="h-3 w-3 text-green-600 ml-1" />
                      )}
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openPreview(reminder.id, 'standby')}
                      className="gap-1 px-2"
                      data-testid={`button-preview-standby-${reminder.id}`}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant={reminder.standbyReminderSent ? "outline" : "secondary"}
                      onClick={() => sendStandbyReminderMutation.mutate(reminder.id)}
                      disabled={pendingStandbyReminders.has(reminder.id)}
                      className="gap-1"
                      data-testid={`button-send-standby-reminder-${reminder.id}`}
                    >
                      {pendingStandbyReminders.has(reminder.id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {reminder.standbyReminderSent ? 'Resend to Standbys' : 'Send to Standbys'}
                      {reminder.standbyReminderSent && (
                        <CheckCircle className="h-3 w-3 text-green-600 ml-1" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      */}

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

      {/* Seating Stats Widget */}
      <Card data-testid="card-seating-stats">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Armchair className="h-5 w-5" />
            Series Seating Overview
            {seatingStats && (
              <Badge variant="outline" className="ml-2 text-xs font-normal text-muted-foreground">
                {seatingStats.unlockedDaysCount} day{seatingStats.unlockedDaysCount !== 1 ? 's' : ''} remaining
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {seatingStatsError ? (
            <div className="text-sm text-destructive py-2">
              Could not load seating stats — check that the server is running the latest build, then refresh.
            </div>
          ) : seatingStatsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading stats...
            </div>
          ) : !seatingStats ? (
            <div className="text-sm text-muted-foreground py-2">No data available.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

              {/* Stat 1: Empty seats */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40" data-testid="stat-empty-seats">
                <div className="p-2 rounded-md bg-amber-100 dark:bg-amber-900/30 shrink-0">
                  <Armchair className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold tabular-nums">{seatingStats.emptySeats.toLocaleString()}</div>
                  <div className="text-xs font-medium text-muted-foreground leading-tight">Empty seats left in series</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Across {seatingStats.unlockedDaysCount} upcoming day{seatingStats.unlockedDaysCount !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>

              {/* Stat 2: Unassigned people */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40" data-testid="stat-unassigned">
                <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30 shrink-0">
                  <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold tabular-nums">{seatingStats.unassignedTotal.toLocaleString()}</div>
                  <div className="text-xs font-medium text-muted-foreground leading-tight">Available &amp; unassigned (incl. reschedules)</div>
                  {seatingStats.reschedulePool > 0 && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      incl. {seatingStats.reschedulePool} on reschedule list
                    </div>
                  )}
                </div>
              </div>

              {/* Stat 3: Studio once */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40" data-testid="stat-studio-once">
                <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30 shrink-0">
                  <UserCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold tabular-nums">{seatingStats.studioOnce.toLocaleString()}</div>
                  <div className="text-xs font-medium text-muted-foreground leading-tight">Attended the studio once</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {seatingStats.studioTotal} total check-ins
                  </div>
                </div>
              </div>

              {/* Stat 4: Standbys came in, not rebooked */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40" data-testid="stat-standbys-unrebooked">
                <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900/30 shrink-0">
                  <UserX className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold tabular-nums">{seatingStats.standbysCameInNotRebooked.toLocaleString()}</div>
                  <div className="text-xs font-medium text-muted-foreground leading-tight">Standbys attended, not yet rebooked</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Need to be placed into future episodes</div>
                </div>
              </div>

              {/* Stat 5: Standbys still needed */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 sm:col-span-2 lg:col-span-2" data-testid="stat-standbys-needed">
                <div className="p-2 rounded-md bg-purple-100 dark:bg-purple-900/30 shrink-0">
                  <TrendingUp className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-bold tabular-nums">{seatingStats.standbysStillNeeded.toLocaleString()}</div>
                  <div className="text-xs font-medium text-muted-foreground leading-tight">More standbys needed for rest of series</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Based on {seatingStats.standbysPerDay}/day target &mdash; {seatingStats.totalActiveStandbys} already booked.
                    <span className="ml-1 text-purple-600 dark:text-purple-400">These will also reduce empty seats once rebooked.</span>
                  </div>
                </div>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      {/* Ratings Breakdown */}
      <div className="flex flex-wrap gap-3">
        {sortedRatings.map(([rating, count]) => (
          <Card key={rating} className="bg-muted/30 flex-1 min-w-[90px]">
            <CardContent className="py-2 px-3">
              <div className="text-center">
                <p className="text-xs font-medium text-muted-foreground">Rating {rating}</p>
                <div className="text-xl font-bold">{count}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* System Guide Download */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20" data-testid="card-system-guide">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-sm">System Guide</p>
                <p className="text-xs text-muted-foreground">Download the complete user manual</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('/api/guide/download', '_blank')}
              data-testid="button-download-guide"
            >
              <Download className="h-4 w-4 mr-1" />
              Download PDF
            </Button>
          </div>
        </CardContent>
      </Card>

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
                            {info.rxNumber || format(info.recordDate, "d MMM")}
                          </span>
                          <span className="font-semibold">
                            Record: {format(info.recordDate, "EEE, d MMM")}
                          </span>
                        </div>
                        <div className="text-sm flex flex-col gap-1 mt-1">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-semibold w-44">Sending Email Deadline:</span>
                            <span className={info.daysUntilEmailDeadline < 0 ? "text-red-600 font-bold" : "font-medium text-foreground"}>
                              {format(info.emailDeadline, "EEE, d MMM")}
                              {info.daysUntilEmailDeadline === 0 && <span className="text-red-600 dark:text-red-400 ml-1">(TODAY)</span>}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-semibold w-44">Confirmation Deadline:</span>
                            <span className={info.daysUntilConfirmationDeadline < 0 ? "text-red-600 font-bold" : "font-medium text-foreground"}>
                              {format(info.confirmationDeadline, "EEE, d MMM")}
                              {info.daysUntilConfirmationDeadline === 0 && <span className="text-red-600 dark:text-red-400 ml-1">(TODAY)</span>}
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
                        {info.daysUntilEmailDeadline > 0
                          ? info.daysUntilEmailDeadline === 1
                            ? '1 day until email deadline'
                            : `${info.daysUntilEmailDeadline} days until email deadline`
                          : info.daysUntilEmailDeadline === 0
                            ? 'Email deadline today!'
                            : info.daysUntilConfirmationDeadline > 0
                              ? info.daysUntilConfirmationDeadline === 1
                                ? '1 day until confirmation'
                                : `${info.daysUntilConfirmationDeadline} days until confirmation`
                              : info.daysUntilConfirmationDeadline === 0
                                ? 'Confirmation due today!'
                                : info.daysUntilRecordDate > 0
                                  ? info.daysUntilRecordDate === 1
                                    ? '1 day until record'
                                    : `${info.daysUntilRecordDate} days until record`
                                  : info.daysUntilRecordDate === 0
                                    ? 'Record day today!'
                                    : `${Math.abs(info.daysUntilRecordDate)} days past record`
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

      {/* Email Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-email-preview">
          <DialogHeader>
            <DialogTitle>
              {previewType === 'contestant' ? 'Contestant' : 'Standby'} Reminder Email Preview
            </DialogTitle>
            <DialogDescription>
              This is how the reminder email will appear to recipients.
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div 
              className="border rounded-lg overflow-hidden"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
