import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Calendar, MapPin, Users, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Contestant = {
  id: string;
  name: string;
  age: number;
  gender: string;
  attendingWith?: string;
};

type GroupMember = {
  id: string;
  name: string;
};

type Booking = {
  recordDate: string;
  seatLocation: string;
};

type TokenData = {
  contestant: Contestant;
  groupMembers: GroupMember[];
  booking: Booking;
  confirmationStatus: string;
  currentAttendingWith?: string;
  currentNotes?: string;
};

export default function BookingConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [attendingWith, setAttendingWith] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<"confirmed" | "declined" | null>(null);

  const { data: tokenData, isLoading, error } = useQuery<TokenData>({
    queryKey: ["/api/booking-confirmations/token", token],
    enabled: !!token && !submitted,
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: async (confirmationStatus: "confirmed" | "declined") => {
      const response = await fetch(`/api/booking-confirmations/respond/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationStatus, attendingWith, notes }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw data;
      }
      
      return data;
    },
    onSuccess: (data, confirmationStatus) => {
      setSubmitted(true);
      setConfirmationResult(confirmationStatus);
      toast({
        title: confirmationStatus === "confirmed" ? "Booking Confirmed!" : "Booking Cancelled",
        description: confirmationStatus === "confirmed" 
          ? "Thank you for confirming your attendance!" 
          : "Your booking has been cancelled and you've been moved to the reschedule list.",
        variant: confirmationStatus === "confirmed" ? "default" : "destructive",
      });
    },
    onError: (error: any) => {
      let errorMessage = "Failed to submit confirmation";
      
      if (error.error) {
        errorMessage = error.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      // Handle already responded case
      if (error.alreadyResponded) {
        errorMessage = `This link has already been used. You previously ${error.previousResponse === 'confirmed' ? 'confirmed' : 'declined'} this booking.`;
      }
      
      toast({
        title: "Cannot Submit Response",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleConfirm = () => {
    submitMutation.mutate("confirmed");
  };

  const handleDecline = () => {
    if (!notes.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for declining the booking",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate("declined");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Loading your booking details...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !tokenData) {
    const errorData = error as any;
    let errorTitle = "Invalid Confirmation Link";
    let errorMessage = "This confirmation link is not valid. Please contact the show producers if you believe this is an error.";
    
    if (errorData?.message?.includes("expired")) {
      errorTitle = "Link Expired";
      errorMessage = "This confirmation link has expired. Please contact the show producers to request a new confirmation link.";
    } else if (errorData?.message?.includes("already been used")) {
      errorTitle = "Link Already Used";
      errorMessage = "This confirmation link has already been used. If you need to make changes, please contact the show producers.";
    } else if (errorData?.message?.includes("no longer active")) {
      errorTitle = "Link Inactive";
      errorMessage = "This confirmation link is no longer active. Please contact the show producers for assistance.";
    } else if (errorData?.message?.includes("revoked")) {
      errorTitle = "Link Revoked";
      errorMessage = "This confirmation link has been replaced by a newer one. Please check your email for the latest booking confirmation link.";
    }
    
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-12">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">{errorTitle}</p>
                  <p>{errorMessage}</p>
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-12 text-center">
            {confirmationResult === "confirmed" ? (
              <>
                <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
                <h2 className="text-2xl font-semibold mb-2">Booking Confirmed!</h2>
                <p className="text-muted-foreground mb-4">
                  Thank you for confirming your attendance, {tokenData.contestant.name}!
                </p>
                <div className="bg-muted p-4 rounded-lg text-sm space-y-1">
                  <div className="flex items-center justify-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span className="font-medium">{new Date(tokenData.booking.recordDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>{tokenData.booking.seatLocation}</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  You'll receive additional information about paperwork and arrival details closer to the recording date.
                </p>
              </>
            ) : (
              <>
                <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
                <h2 className="text-2xl font-semibold mb-2">Booking Cancelled</h2>
                <p className="text-muted-foreground">
                  Your booking has been cancelled and you've been moved to the reschedule list. 
                  We'll reach out if an alternative date becomes available.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenData.confirmationStatus !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-12 text-center">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You've already responded to this booking confirmation.
                {tokenData.confirmationStatus === "confirmed" && " Your attendance is confirmed."}
                {tokenData.confirmationStatus === "declined" && " This booking has been cancelled."}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-3xl mx-auto py-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">TV Show Booking Confirmation</CardTitle>
            <CardDescription>
              Hello {tokenData.contestant.name}! Please confirm your attendance for the upcoming recording.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted p-4 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Recording Date</p>
                  <p className="font-semibold">
                    {new Date(tokenData.booking.recordDate).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Assigned Seat</p>
                  <p className="font-semibold">{tokenData.booking.seatLocation}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Contestant</p>
                  <p className="font-semibold">
                    {tokenData.contestant.name} • {tokenData.contestant.age} years • {tokenData.contestant.gender}
                  </p>
                </div>
              </div>
            </div>

            {tokenData.groupMembers.length > 0 && (
              <Alert>
                <Users className="h-4 w-4" />
                <AlertDescription>
                  <span className="font-medium">Attending with: </span>
                  {tokenData.groupMembers.map(m => m.name).join(", ")}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="attending-with" data-testid="label-attending-with">
                Update "Attending With" Information (optional)
              </Label>
              <Input
                id="attending-with"
                data-testid="input-attending-with"
                placeholder={tokenData.currentAttendingWith || "Enter names of people you're attending with"}
                value={attendingWith}
                onChange={(e) => setAttendingWith(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                If your group has changed, please update it here
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" data-testid="label-notes">
                Special Requests or Dietary Requirements (optional)
              </Label>
              <Textarea
                id="notes"
                data-testid="textarea-notes"
                placeholder="Any special requirements, dietary restrictions, or notes for the production team..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Button
                data-testid="button-confirm"
                onClick={handleConfirm}
                disabled={submitMutation.isPending}
                className="flex-1"
                size="lg"
              >
                {submitMutation.isPending ? "Confirming..." : "Confirm Attendance"}
              </Button>
              <Button
                data-testid="button-decline"
                variant="destructive"
                onClick={handleDecline}
                disabled={submitMutation.isPending}
                className="flex-1"
                size="lg"
              >
                {submitMutation.isPending ? "Cancelling..." : "Cannot Attend"}
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              If you confirm, you'll receive additional paperwork and arrival instructions closer to the recording date.
              If you cannot attend, we'll move you to our reschedule list for future opportunities.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
