import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Users, Edit, Trash2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export interface RecordDay {
  id: string;
  date: string;
  rxNumber?: string | null;
  totalSeats: number;
  filledSeats: number;
  femalePercent: number;
}

interface RecordDayCardProps {
  recordDay: RecordDay;
  onViewSeating?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSendInvitations?: () => void;
}

export function RecordDayCard({ recordDay, onViewSeating, onEdit, onDelete, onSendInvitations }: RecordDayCardProps) {
  const fillPercent = Math.round((recordDay.filledSeats / recordDay.totalSeats) * 100);

  return (
    <Card data-testid={`card-record-day-${recordDay.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">{recordDay.date}</span>
            </CardTitle>
            <CardDescription>
              {recordDay.rxNumber || "Record Day"}
            </CardDescription>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {onEdit && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onEdit}
                data-testid={`button-edit-record-day-${recordDay.id}`}
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onDelete}
                className="text-destructive hover:text-destructive"
                data-testid={`button-delete-record-day-${recordDay.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
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
        </div>
      </CardContent>
    </Card>
  );
}
