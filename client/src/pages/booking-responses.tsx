import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Send, 
  MessageSquare,
  UtensilsCrossed, 
  HelpCircle, 
  Users,
  Mail,
  Phone,
  MapPin,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";

interface RecordDay {
  id: string;
  date: string;
  totalSeats: number;
  status: string;
}

interface BookingConfirmation {
  id: string;
  contestantId: string;
  seatAssignmentId: string;
  token: string;
  confirmationStatus: string;
  confirmedAt: string | null;
  attendingWith: string | null;
  notes: string | null;
  expiresAt: string;
  createdAt: string;
  contestant: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    location?: string;
    photoUrl?: string;
    attendingWith?: string;
  };
  seatAssignment: {
    blockNumber: number;
    seatLabel: string;
  };
}

type StatusFilter = "all" | "pending" | "confirmed" | "declined";

export default function BookingResponses() {
  const { toast } = useToast();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [selectedConfirmation, setSelectedConfirmation] = useState<BookingConfirmation | null>(null);
  const [followUpSubject, setFollowUpSubject] = useState("");
  const [followUpMessage, setFollowUpMessage] = useState("");

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: confirmations = [], isLoading } = useQuery<BookingConfirmation[]>({
    queryKey: ["/api/booking-confirmations/record-day", selectedRecordDay],
    enabled: !!selectedRecordDay,
  });

  const sendFollowUpMutation = useMutation({
    mutationFn: async (data: { confirmationId: string; subject: string; message: string }) => {
      return apiRequest(
        "POST",
        `/api/booking-confirmations/${data.confirmationId}/follow-up`,
        { subject: data.subject, message: data.message }
      );
    },
    onSuccess: () => {
      toast({ title: "Follow-up email sent successfully" });
      setFollowUpDialogOpen(false);
      setFollowUpMessage("");
      setFollowUpSubject("");
      setSelectedConfirmation(null);
    },
    onError: () => {
      toast({ 
        title: "Failed to send email", 
        description: "Please try again",
        variant: "destructive" 
      });
    },
  });

  const counts = {
    all: confirmations.length,
    pending: confirmations.filter(c => c.confirmationStatus === "pending").length,
    confirmed: confirmations.filter(c => c.confirmationStatus === "confirmed").length,
    declined: confirmations.filter(c => c.confirmationStatus === "declined").length,
  };

  const filteredConfirmations = statusFilter === "all" 
    ? confirmations 
    : confirmations.filter(c => c.confirmationStatus === statusFilter);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case "confirmed":
        return { 
          icon: CheckCircle, 
          label: "Confirmed", 
          className: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700" 
        };
      case "declined":
        return { 
          icon: XCircle, 
          label: "Declined", 
          className: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700" 
        };
      default:
        return { 
          icon: Clock, 
          label: "Pending", 
          className: "" 
        };
    }
  };

  const isDietaryNote = (notes: string) => {
    const dietaryKeywords = ["diet", "allerg", "vegetarian", "vegan", "halal", "kosher", "gluten", "lactose", "nut"];
    return dietaryKeywords.some(keyword => notes.toLowerCase().includes(keyword));
  };

  const handleReply = (confirmation: BookingConfirmation) => {
    setSelectedConfirmation(confirmation);
    setFollowUpSubject(`Re: Your Deal or No Deal Booking`);
    setFollowUpDialogOpen(true);
  };

  const selectedRecordDayData = recordDays.find(rd => rd.id === selectedRecordDay);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="page-title">Booking Responses</h1>
          <p className="text-muted-foreground">
            View and manage contestant booking confirmations
          </p>
        </div>
        {selectedRecordDay && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/booking-confirmations/record-day", selectedRecordDay] })}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <Select
            value={selectedRecordDay || ""}
            onValueChange={(value) => setSelectedRecordDay(value || null)}
          >
            <SelectTrigger className="w-[220px]" data-testid="select-record-day">
              <SelectValue placeholder="Select record day..." />
            </SelectTrigger>
            <SelectContent>
              {recordDays.map((rd) => (
                <SelectItem key={rd.id} value={rd.id}>
                  {format(new Date(rd.date), "EEEE, MMMM d, yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedRecordDay && (
          <div className="flex gap-2 flex-wrap">
            <Badge 
              variant={statusFilter === "all" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("all")}
              data-testid="filter-all"
            >
              All ({counts.all})
            </Badge>
            <Badge 
              variant={statusFilter === "pending" ? "default" : "outline"} 
              className="cursor-pointer"
              onClick={() => setStatusFilter("pending")}
              data-testid="filter-pending"
            >
              <Clock className="h-3 w-3 mr-1" />
              Pending ({counts.pending})
            </Badge>
            <Badge 
              variant={statusFilter === "confirmed" ? "default" : "outline"} 
              className={`cursor-pointer ${statusFilter === "confirmed" ? "bg-green-600 hover:bg-green-700" : ""}`}
              onClick={() => setStatusFilter("confirmed")}
              data-testid="filter-confirmed"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              Confirmed ({counts.confirmed})
            </Badge>
            <Badge 
              variant={statusFilter === "declined" ? "default" : "outline"} 
              className={`cursor-pointer ${statusFilter === "declined" ? "bg-red-600 hover:bg-red-700" : ""}`}
              onClick={() => setStatusFilter("declined")}
              data-testid="filter-declined"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Declined ({counts.declined})
            </Badge>
          </div>
        )}
      </div>

      {!selectedRecordDay && (
        <Card className="p-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Record Day Selected</h3>
          <p className="text-muted-foreground">
            Select a record day above to view booking responses
          </p>
        </Card>
      )}

      {selectedRecordDay && isLoading && (
        <div className="flex items-center justify-center p-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {selectedRecordDay && !isLoading && confirmations.length === 0 && (
        <Card className="p-12 text-center">
          <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Booking Emails Sent</h3>
          <p className="text-muted-foreground">
            Send booking emails from the Booking Master page to start collecting responses
          </p>
        </Card>
      )}

      {selectedRecordDay && !isLoading && filteredConfirmations.length === 0 && confirmations.length > 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            No {statusFilter} responses found
          </p>
        </Card>
      )}

      {selectedRecordDay && !isLoading && filteredConfirmations.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredConfirmations.map((confirmation) => {
            const statusInfo = getStatusInfo(confirmation.confirmationStatus);
            const StatusIcon = statusInfo.icon;
            
            return (
              <Card 
                key={confirmation.id} 
                className="overflow-hidden"
                data-testid={`response-card-${confirmation.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={confirmation.contestant.photoUrl} />
                        <AvatarFallback>
                          {confirmation.contestant.name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-semibold" data-testid={`contestant-name-${confirmation.id}`}>
                          {confirmation.contestant.name}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">
                            {confirmation.seatAssignment.blockNumber}{confirmation.seatAssignment.seatLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge className={statusInfo.className} data-testid={`status-${confirmation.id}`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {statusInfo.label}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-3">
                  <div className="space-y-1.5 text-sm">
                    {confirmation.contestant.email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        <span className="truncate">{confirmation.contestant.email}</span>
                      </div>
                    )}
                    {confirmation.contestant.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{confirmation.contestant.phone}</span>
                      </div>
                    )}
                    {confirmation.contestant.location && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{confirmation.contestant.location}</span>
                      </div>
                    )}
                  </div>

                  {(confirmation.attendingWith || confirmation.contestant.attendingWith) && (
                    <>
                      <Separator />
                      <div className="flex items-start gap-2">
                        <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <div>
                          <div className="text-xs text-muted-foreground mb-0.5">Attending with</div>
                          <div className="text-sm">
                            {confirmation.attendingWith || confirmation.contestant.attendingWith}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {confirmation.notes && (
                    <>
                      <Separator />
                      <div className="flex items-start gap-2">
                        {isDietaryNote(confirmation.notes) ? (
                          <UtensilsCrossed className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        ) : (
                          <HelpCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground mb-0.5">
                            {isDietaryNote(confirmation.notes) ? "Dietary Requirements" : "Question / Note"}
                          </div>
                          <div className="text-sm" data-testid={`notes-${confirmation.id}`}>
                            {confirmation.notes}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <Separator />
                  
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {confirmation.confirmedAt ? (
                        <>Responded {format(new Date(confirmation.confirmedAt), "MMM d 'at' h:mm a")}</>
                      ) : (
                        <>Sent {format(new Date(confirmation.createdAt), "MMM d 'at' h:mm a")}</>
                      )}
                    </div>
                    {confirmation.notes && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReply(confirmation)}
                        data-testid={`button-reply-${confirmation.id}`}
                      >
                        <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                        Reply
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Follow-up Email</DialogTitle>
            <DialogDescription>
              Reply to {selectedConfirmation?.contestant.name}'s message
            </DialogDescription>
          </DialogHeader>
          
          {selectedConfirmation?.notes && (
            <div className="bg-muted p-3 rounded-md text-sm">
              <div className="font-medium mb-1 text-xs text-muted-foreground">Their message:</div>
              <p>{selectedConfirmation.notes}</p>
            </div>
          )}
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="followup-subject">Subject</Label>
              <Input
                id="followup-subject"
                value={followUpSubject}
                onChange={(e) => setFollowUpSubject(e.target.value)}
                placeholder="Re: Your Deal or No Deal Booking"
                data-testid="input-followup-subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followup-message">Your Reply</Label>
              <Textarea
                id="followup-message"
                value={followUpMessage}
                onChange={(e) => setFollowUpMessage(e.target.value)}
                placeholder="Type your reply here..."
                rows={5}
                data-testid="input-followup-message"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFollowUpDialogOpen(false);
                setFollowUpMessage("");
                setFollowUpSubject("");
                setSelectedConfirmation(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedConfirmation && followUpMessage.trim()) {
                  sendFollowUpMutation.mutate({
                    confirmationId: selectedConfirmation.id,
                    message: followUpMessage,
                    subject: followUpSubject,
                  });
                }
              }}
              disabled={!followUpMessage.trim() || sendFollowUpMutation.isPending}
              data-testid="button-send-followup"
            >
              <Send className="h-4 w-4 mr-2" />
              {sendFollowUpMutation.isPending ? "Sending..." : "Send Reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
