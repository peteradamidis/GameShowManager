import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Mail } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export interface RecordDay {
  id: string;
  date: string;
  rxNumber?: string | null;
  totalSeats: number;
  filledSeats: number;
  femalePercent: number;
  status: "Draft" | "Ready" | "Invited" | "Completed";
}

interface RecordDayCardProps {
  recordDay: RecordDay;
  onViewSeating?: () => void;
  onSendInvitations?: () => void;
}

const statusColors = {
  Draft: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
  Ready: "bg-green-500/10 text-green-700 dark:text-green-400",
  Invited: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  Completed: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

export function RecordDayCard({ recordDay, onViewSeating, onSendInvitations }: RecordDayCardProps) {
  const fillPercent = Math.round((recordDay.filledSeats / recordDay.totalSeats) * 100);

  return (
    <Card data-testid={`card-record-day-${recordDay.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {recordDay.date}
            </CardTitle>
            <CardDescription>
              {recordDay.rxNumber || "Record Day"}
            </CardDescription>
          </div>
          <Badge variant="secondary" className={statusColors[recordDay.status]}>
            {recordDay.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Capacity</span>
            <span className="font-medium">
              {recordDay.filledSeats}/{recordDay.totalSeats}
            </span>
          </div>
          <Progress value={fillPercent} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Gender Balance</p>
            <p className="font-medium">{recordDay.femalePercent}% Female</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Fill Rate</p>
            <p className="font-medium">{fillPercent}%</p>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onViewSeating} data-testid={`button-view-seating-${recordDay.id}`}>
            <Users className="h-4 w-4 mr-2" />
            View Seating
          </Button>
          {recordDay.status === "Ready" && (
            <Button size="sm" onClick={onSendInvitations} data-testid={`button-send-invitations-${recordDay.id}`}>
              <Mail className="h-4 w-4 mr-2" />
              Send Invitations
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
