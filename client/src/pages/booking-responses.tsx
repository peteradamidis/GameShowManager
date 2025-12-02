import { useState, useEffect, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Send, 
  Mail,
  UtensilsCrossed, 
  HelpCircle, 
  Users,
  RefreshCw,
  ChevronRight,
  MailOpen
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
  lastSentAt: string | null;
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

interface BookingMessage {
  id: string;
  confirmationId: string;
  direction: "outbound" | "inbound";
  messageType: string;
  subject: string | null;
  body: string;
  sentAt: string;
  readAt: string | null;
}

type StatusFilter = "all" | "pending" | "confirmed" | "declined";

export default function BookingResponses() {
  const { toast } = useToast();
  const [selectedRecordDay, setSelectedRecordDay] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedConfirmation, setSelectedConfirmation] = useState<BookingConfirmation | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ["/api/record-days"],
  });

  const { data: confirmations = [], isLoading } = useQuery<BookingConfirmation[]>({
    queryKey: ["/api/booking-confirmations/record-day", selectedRecordDay],
    enabled: !!selectedRecordDay,
  });

  const { data: messages = [], refetch: refetchMessages } = useQuery<BookingMessage[]>({
    queryKey: [`/api/booking-confirmations/${selectedConfirmation?.id}/messages`],
    enabled: !!selectedConfirmation,
  });

  const sendReplyMutation = useMutation({
    mutationFn: async (data: { confirmationId: string; message: string }) => {
      return apiRequest(
        "POST",
        `/api/booking-confirmations/${data.confirmationId}/follow-up`,
        { subject: "Re: Your Deal or No Deal Booking", message: data.message }
      );
    },
    onSuccess: () => {
      toast({ title: "Reply sent successfully" });
      setReplyMessage("");
      refetchMessages();
      queryClient.invalidateQueries({ queryKey: ["/api/booking-confirmations/record-day", selectedRecordDay] });
    },
    onError: () => {
      toast({ 
        title: "Failed to send reply", 
        description: "Please try again",
        variant: "destructive" 
      });
    },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

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
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30"
        };
      case "declined":
        return { 
          icon: XCircle, 
          label: "Declined", 
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-100 dark:bg-red-900/30"
        };
      default:
        return { 
          icon: Clock, 
          label: "Awaiting Reply", 
          color: "text-amber-600 dark:text-amber-400",
          bgColor: "bg-amber-100 dark:bg-amber-900/30"
        };
    }
  };

  const isDietaryNote = (notes: string) => {
    const dietaryKeywords = ["diet", "allerg", "vegetarian", "vegan", "halal", "kosher", "gluten", "lactose", "nut"];
    return dietaryKeywords.some(keyword => notes.toLowerCase().includes(keyword));
  };

  const hasUnreadMessages = (confirmation: BookingConfirmation) => {
    return confirmation.confirmationStatus !== "pending" && confirmation.notes;
  };

  const handleSendReply = () => {
    if (!selectedConfirmation || !replyMessage.trim()) return;
    sendReplyMutation.mutate({
      confirmationId: selectedConfirmation.id,
      message: replyMessage.trim(),
    });
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold" data-testid="page-title">Booking Responses</h1>
          <p className="text-sm text-muted-foreground">
            Manage contestant booking confirmations
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <Select
            value={selectedRecordDay || ""}
            onValueChange={(value) => {
              setSelectedRecordDay(value || null);
              setSelectedConfirmation(null);
            }}
          >
            <SelectTrigger className="w-[240px]" data-testid="select-record-day">
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
          {selectedRecordDay && (
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/booking-confirmations/record-day", selectedRecordDay] });
                if (selectedConfirmation) {
                  refetchMessages();
                }
              }}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {!selectedRecordDay ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Mail className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Select a record day to view responses</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : confirmations.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MailOpen className="h-16 w-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No booking emails sent for this day</p>
            <p className="text-sm">Send booking emails from the Booking Master page</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden mt-4">
          <div className="w-80 border-r flex flex-col">
            <div className="p-3 border-b flex gap-1 flex-wrap">
              <Badge 
                variant={statusFilter === "all" ? "default" : "outline"} 
                className="cursor-pointer text-xs"
                onClick={() => setStatusFilter("all")}
                data-testid="filter-all"
              >
                All ({counts.all})
              </Badge>
              <Badge 
                variant={statusFilter === "pending" ? "default" : "outline"} 
                className="cursor-pointer text-xs"
                onClick={() => setStatusFilter("pending")}
                data-testid="filter-pending"
              >
                Pending ({counts.pending})
              </Badge>
              <Badge 
                variant={statusFilter === "confirmed" ? "default" : "outline"} 
                className="cursor-pointer text-xs"
                onClick={() => setStatusFilter("confirmed")}
                data-testid="filter-confirmed"
              >
                Confirmed ({counts.confirmed})
              </Badge>
              <Badge 
                variant={statusFilter === "declined" ? "default" : "outline"} 
                className="cursor-pointer text-xs"
                onClick={() => setStatusFilter("declined")}
                data-testid="filter-declined"
              >
                Declined ({counts.declined})
              </Badge>
            </div>
            
            <ScrollArea className="flex-1">
              {filteredConfirmations.map((confirmation) => {
                const statusInfo = getStatusInfo(confirmation.confirmationStatus);
                const StatusIcon = statusInfo.icon;
                const isSelected = selectedConfirmation?.id === confirmation.id;
                const hasNotes = !!confirmation.notes;
                
                return (
                  <div
                    key={confirmation.id}
                    onClick={() => setSelectedConfirmation(confirmation)}
                    className={`p-3 border-b cursor-pointer transition-colors hover-elevate ${
                      isSelected 
                        ? "bg-accent border-l-2 border-l-primary" 
                        : "hover:bg-muted/50"
                    }`}
                    data-testid={`inbox-item-${confirmation.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10 flex-shrink-0">
                        {confirmation.contestant.photoUrl ? (
                          <AvatarImage src={confirmation.contestant.photoUrl} alt={confirmation.contestant.name} />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          {confirmation.contestant.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-medium truncate ${hasNotes ? "text-foreground" : "text-muted-foreground"}`}>
                            {confirmation.contestant.name}
                          </span>
                          <StatusIcon className={`h-4 w-4 flex-shrink-0 ${statusInfo.color}`} />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            Block {confirmation.seatAssignment.blockNumber} • {confirmation.seatAssignment.seatLabel}
                          </span>
                          {hasNotes && (
                            <>
                              {isDietaryNote(confirmation.notes!) ? (
                                <UtensilsCrossed className="h-3 w-3 text-amber-500" />
                              ) : (
                                <HelpCircle className="h-3 w-3 text-blue-500" />
                              )}
                            </>
                          )}
                        </div>
                        {confirmation.confirmationStatus !== "pending" && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {confirmation.confirmationStatus === "confirmed" ? "Confirmed attendance" : "Declined booking"}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  </div>
                );
              })}
            </ScrollArea>
          </div>

          <div className="flex-1 flex flex-col">
            {!selectedConfirmation ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Select a contestant to view conversation</p>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 border-b bg-muted/30">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      {selectedConfirmation.contestant.photoUrl ? (
                        <AvatarImage src={selectedConfirmation.contestant.photoUrl} alt={selectedConfirmation.contestant.name} />
                      ) : null}
                      <AvatarFallback>
                        {selectedConfirmation.contestant.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-lg">{selectedConfirmation.contestant.name}</h2>
                        {(() => {
                          const statusInfo = getStatusInfo(selectedConfirmation.confirmationStatus);
                          return (
                            <Badge className={statusInfo.bgColor + " " + statusInfo.color + " border-0"}>
                              {statusInfo.label}
                            </Badge>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                        <span>Block {selectedConfirmation.seatAssignment.blockNumber} • Seat {selectedConfirmation.seatAssignment.seatLabel}</span>
                        {selectedConfirmation.contestant.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {selectedConfirmation.contestant.email}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {(selectedConfirmation.attendingWith || selectedConfirmation.notes) && (
                    <div className="mt-3 p-3 rounded-md bg-background border">
                      {selectedConfirmation.attendingWith && (
                        <div className="flex items-center gap-2 text-sm">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Attending with:</span>
                          <span>{selectedConfirmation.attendingWith}</span>
                        </div>
                      )}
                      {selectedConfirmation.notes && (
                        <div className="flex items-start gap-2 text-sm mt-2">
                          {isDietaryNote(selectedConfirmation.notes) ? (
                            <UtensilsCrossed className="h-4 w-4 text-amber-500 mt-0.5" />
                          ) : (
                            <HelpCircle className="h-4 w-4 text-blue-500 mt-0.5" />
                          )}
                          <span>{selectedConfirmation.notes}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4 max-w-2xl mx-auto">
                    {messages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">
                        <p>No messages yet</p>
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg p-3 ${
                              message.direction === "outbound"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            <div className="text-xs opacity-70 mb-1">
                              {message.direction === "outbound" ? "You" : selectedConfirmation.contestant.name}
                              {" • "}
                              {format(new Date(message.sentAt), "MMM d, h:mm a")}
                            </div>
                            <div className="text-sm whitespace-pre-wrap">
                              {message.body}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                <div className="p-4 border-t bg-muted/30">
                  <div className="flex gap-2 max-w-2xl mx-auto">
                    <Textarea
                      placeholder="Type your reply..."
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      className="min-h-[60px] resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                      data-testid="input-reply"
                    />
                    <Button
                      onClick={handleSendReply}
                      disabled={!replyMessage.trim() || sendReplyMutation.isPending}
                      className="self-end"
                      data-testid="button-send-reply"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Press Enter to send, Shift+Enter for new line
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
