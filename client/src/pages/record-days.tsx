import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function RecordDays() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const recordDays: RecordDay[] = [
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
    {
      id: "4",
      date: "January 12, 2026",
      totalSeats: 140,
      filledSeats: 0,
      femalePercent: 0,
      status: "Draft",
    },
  ];

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
    </div>
  );
}
