import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Calendar, MapPin, Clock, Users, AlertCircle, CheckCircle, XCircle } from "lucide-react";

const DEFAULT_CONFIG: Record<string, string> = {
  title: "Deal or No Deal",
  description: "Please confirm your attendance for the upcoming recording.",
  attendingWithLabel: "Update \"Attending With\" Information (optional)",
  attendingWithPlaceholder: "Enter names of people you're attending with",
  attendingWithHelp: "If your group has changed, please update it here",
  dietaryLabel: "Dietary Requirements (Optional)",
  dietaryPlaceholder: "Please list any dietary requirements or allergies",
  questionsLabel: "Questions (Optional)",
  questionsPlaceholder: "Any questions you have for the production team?",
  confirmButtonText: "Confirm Attendance",
  declineButtonText: "Cannot Attend",
  declineReasonRequired: "Please provide a reason for declining the booking",
  confirmedTitle: "Attendance Confirmed!",
  confirmedMessage: "Thank you for confirming your attendance! We look forward to seeing you at the recording.",
  declinedTitle: "Booking Cancelled",
  declinedMessage: "Your booking has been cancelled. If your circumstances change, please contact us.",
  toastConfirmedTitle: "Booking Confirmed!",
  toastConfirmedMessage: "Thank you for confirming your attendance!",
  toastDeclinedTitle: "Booking Cancelled",
  toastDeclinedMessage: "Your booking has been cancelled and you've been moved to the reschedule list.",
};

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
  const [dietary, setDietary] = useState("");
  const [questions, setQuestions] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<"confirmed" | "declined" | null>(null);

  const { data: tokenData, isLoading, error } = useQuery<TokenData>({
    queryKey: ["/api/booking-confirmations/token", token],
    enabled: !!token && !submitted,
    retry: false,
  });

  const { data: formConfig } = useQuery<Record<string, string>>({
    queryKey: ["/api/form-configs", "booking"],
  });

  const getConfig = (key: string): string => {
    return formConfig?.[key] || DEFAULT_CONFIG[key] || "";
  };

  const submitMutation = useMutation({
    mutationFn: async (confirmationStatus: "confirmed" | "declined") => {
      // Combine dietary and questions into notes field for backend
      const notesParts = [];
      if (dietary.trim()) notesParts.push(`Dietary Requirements: ${dietary.trim()}`);
      if (questions.trim()) notesParts.push(`Questions: ${questions.trim()}`);
      const notes = notesParts.join('\n\n');
      
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
        title: confirmationStatus === "confirmed" ? getConfig("toastConfirmedTitle") : getConfig("toastDeclinedTitle"),
        description: confirmationStatus === "confirmed" 
          ? getConfig("toastConfirmedMessage")
          : getConfig("toastDeclinedMessage"),
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
    if (!questions.trim()) {
      toast({
        title: "Reason required",
        description: getConfig("declineReasonRequired"),
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate("declined");
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#2a0a0a' }}>
        <div className="w-full max-w-2xl mx-4">
          <div className="bg-white rounded-xl p-12 text-center shadow-2xl">
            <p className="text-gray-500">Loading your booking details...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
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
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#2a0a0a' }}>
        <div className="w-full max-w-2xl">
          <div className="bg-white rounded-xl p-8 shadow-2xl">
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">{errorTitle}</p>
                <p className="text-red-700 mt-1">{errorMessage}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success/submitted state
  if (submitted) {
    return (
      <div className="min-h-screen p-4" style={{ backgroundColor: '#2a0a0a' }}>
        <div className="max-w-2xl mx-auto py-8">
          {/* Banner */}
          <img 
            src="/uploads/branding/dond_banner.png" 
            alt="Deal or No Deal" 
            className="w-full rounded-t-xl"
          />
          
          {/* Gold Title Bar */}
          <div 
            className="py-6 px-8 text-center"
            style={{ background: 'linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%)' }}
          >
            <h1 
              className="text-2xl md:text-3xl font-bold tracking-widest uppercase"
              style={{ color: '#D4AF37', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
            >
              {confirmationResult === "confirmed" ? getConfig("confirmedTitle") : getConfig("declinedTitle")}
            </h1>
          </div>
          
          {/* White Content Card */}
          <div className="mx-5 mb-6 -mt-0" style={{ marginTop: '-1px' }}>
            <div className="bg-white rounded-b-xl shadow-2xl p-8 text-center">
              {confirmationResult === "confirmed" ? (
                <>
                  <CheckCircle className="w-16 h-16 mx-auto mb-4" style={{ color: '#D4AF37' }} />
                  <p className="text-gray-600 mb-6">
                    {getConfig("confirmedMessage")}
                  </p>
                  
                  {/* Details Box */}
                  <div 
                    className="rounded-lg p-5 text-left"
                    style={{ 
                      background: 'linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%)',
                      borderLeft: '5px solid #D4AF37'
                    }}
                  >
                    <h2 
                      className="text-sm font-bold uppercase tracking-wide mb-3"
                      style={{ color: '#8B0000' }}
                    >
                      Your Record Day Details
                    </h2>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" style={{ color: '#D4AF37' }} />
                        <span className="font-medium">
                          {new Date(tokenData.booking.recordDate).toLocaleDateString('en-US', { 
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" style={{ color: '#D4AF37' }} />
                        <span>7:30AM</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 mt-0.5" style={{ color: '#D4AF37' }} />
                        <span>Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
                  <p className="text-gray-600">
                    {getConfig("declinedMessage")}
                  </p>
                </>
              )}
            </div>
          </div>
          
          {/* Footer */}
          <div className="text-center py-4">
            <p className="text-xs" style={{ color: '#aa8888' }}>
              This is an automated message from the Deal or No Deal production team.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Already responded state
  if (tokenData.confirmationStatus !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#2a0a0a' }}>
        <div className="w-full max-w-2xl">
          <div className="bg-white rounded-xl p-8 shadow-2xl">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-800">
                  You've already responded to this booking confirmation.
                  {tokenData.confirmationStatus === "confirmed" && " Your attendance is confirmed."}
                  {tokenData.confirmationStatus === "declined" && " This booking has been cancelled."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main form
  return (
    <div className="min-h-screen p-4" style={{ backgroundColor: '#2a0a0a' }}>
      <div className="max-w-2xl mx-auto py-8">
        {/* Banner */}
        <img 
          src="/uploads/branding/dond_banner.png" 
          alt="Deal or No Deal" 
          className="w-full rounded-t-xl"
        />
        
        {/* Gold Title Bar */}
        <div 
          className="py-6 px-8 text-center"
          style={{ background: 'linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%)' }}
        >
          <h1 
            className="text-2xl md:text-3xl font-bold tracking-widest uppercase"
            style={{ color: '#D4AF37', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
          >
            Booking Confirmation
          </h1>
        </div>
        
        {/* White Content Card */}
        <div className="mx-5 mb-6" style={{ marginTop: '-1px' }}>
          <div className="bg-white rounded-b-xl shadow-2xl p-8">
            {/* Greeting */}
            <p className="text-gray-700 text-lg mb-2">
              Hi {tokenData.contestant.name.split(' ')[0]},
            </p>
            <p className="text-gray-600 mb-6">
              {getConfig("description")}
            </p>
            
            {/* Details Box */}
            <div 
              className="rounded-lg p-5 mb-6"
              style={{ 
                background: 'linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%)',
                borderLeft: '5px solid #D4AF37'
              }}
            >
              <h2 
                className="text-sm font-bold uppercase tracking-wide mb-3"
                style={{ color: '#8B0000' }}
              >
                Your Record Day Details
              </h2>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5" style={{ color: '#D4AF37' }} />
                  <div>
                    <p className="text-xs text-gray-500">Recording Date</p>
                    <p className="font-semibold text-gray-800">
                      {new Date(tokenData.booking.recordDate).toLocaleDateString('en-US', { 
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                      })}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5" style={{ color: '#D4AF37' }} />
                  <div>
                    <p className="text-xs text-gray-500">Time</p>
                    <p className="font-semibold text-gray-800">7:30AM</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 mt-0.5" style={{ color: '#D4AF37' }} />
                  <div>
                    <p className="text-xs text-gray-500">Location</p>
                    <p className="font-semibold text-gray-800">Docklands Studios Melbourne</p>
                    <p className="text-sm text-gray-600">476 Docklands Drive, Docklands, VIC, 3008</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5" style={{ color: '#D4AF37' }} />
                  <div>
                    <p className="text-xs text-gray-500">Contestant</p>
                    <p className="font-semibold text-gray-800">{tokenData.contestant.name}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Group members alert */}
            {tokenData.groupMembers.length > 0 && (
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6">
                <Users className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-blue-800">Attending with: </span>
                  <span className="text-blue-700">{tokenData.groupMembers.map(m => m.name).join(", ")}</span>
                </div>
              </div>
            )}

            {/* Attending with input */}
            <div className="space-y-2 mb-6">
              <Label htmlFor="attending-with" data-testid="label-attending-with" className="text-gray-700">
                {getConfig("attendingWithLabel")}
              </Label>
              <Input
                id="attending-with"
                data-testid="input-attending-with"
                placeholder={tokenData.currentAttendingWith || getConfig("attendingWithPlaceholder")}
                value={attendingWith}
                onChange={(e) => setAttendingWith(e.target.value)}
                className="border-gray-300"
              />
              <p className="text-xs text-gray-500">
                {getConfig("attendingWithHelp")}
              </p>
            </div>

            {/* Dietary requirements input */}
            <div className="space-y-2 mb-6">
              <Label htmlFor="dietary" data-testid="label-dietary" className="text-gray-700">
                {getConfig("dietaryLabel")}
              </Label>
              <Textarea
                id="dietary"
                data-testid="textarea-dietary"
                placeholder={getConfig("dietaryPlaceholder")}
                value={dietary}
                onChange={(e) => setDietary(e.target.value)}
                rows={3}
                className="border-gray-300"
              />
            </div>

            {/* Questions input */}
            <div className="space-y-2 mb-6">
              <Label htmlFor="questions" data-testid="label-questions" className="text-gray-700">
                {getConfig("questionsLabel")}
              </Label>
              <Textarea
                id="questions"
                data-testid="textarea-questions"
                placeholder={getConfig("questionsPlaceholder")}
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
                rows={3}
                className="border-gray-300"
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Button
                data-testid="button-confirm"
                onClick={handleConfirm}
                disabled={submitMutation.isPending}
                className="flex-1 text-base py-6 font-bold uppercase tracking-wide"
                style={{ 
                  background: 'linear-gradient(135deg, #D4AF37 0%, #B8860B 100%)',
                  color: '#2a0a0a',
                  boxShadow: '0 4px 10px rgba(139,0,0,0.3)'
                }}
              >
                {submitMutation.isPending ? "Confirming..." : getConfig("confirmButtonText")}
              </Button>
              <Button
                data-testid="button-decline"
                variant="destructive"
                onClick={handleDecline}
                disabled={submitMutation.isPending}
                className="flex-1 text-base py-6"
              >
                {submitMutation.isPending ? "Cancelling..." : getConfig("declineButtonText")}
              </Button>
            </div>

            <p className="text-xs text-center text-gray-500 mt-6">
              If you confirm, you'll receive additional paperwork and arrival instructions closer to the recording date.
              If you cannot attend, we'll move you to our reschedule list for future opportunities.
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-xs" style={{ color: '#aa8888' }}>
            This is an automated message from the Deal or No Deal production team.
          </p>
        </div>
      </div>
    </div>
  );
}
