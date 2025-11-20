import { StatsCard } from "@/components/stats-card";
import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Users, Clock, CheckCircle, Calendar } from "lucide-react";
import { useLocation } from "wouter";

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const upcomingRecordDays: RecordDay[] = [
    {
      id: "1",
      date: "December 15, 2025",
      totalSeats: 140,
      filledSeats: 140,
      femalePercent: 65,
      status: "Ready",
    },
    {
      id: "2",
      date: "December 22, 2025",
      totalSeats: 140,
      filledSeats: 98,
      femalePercent: 62,
      status: "Draft",
    },
    {
      id: "3",
      date: "January 5, 2026",
      totalSeats: 140,
      filledSeats: 45,
      femalePercent: 58,
      status: "Draft",
    },
  ];

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
          value={1247}
          icon={Users}
        />
        <StatsCard
          title="Pending Availability"
          value={342}
          icon={Clock}
          subtitle="Awaiting response"
        />
        <StatsCard
          title="Assigned Contestants"
          value={283}
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
      </div>
    </div>
  );
}
