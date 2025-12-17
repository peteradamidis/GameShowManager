import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Calendar, Users, AlertCircle, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DEFAULT_CONFIG: Record<string, string> = {
  title: "Availability Check",
  description: "Please let us know which recording days you're available to attend.",
  yesLabel: "Yes, I can attend",
  maybeLabel: "Maybe (unsure, will confirm later)",
  noLabel: "No, I cannot attend",
  notesLabel: "Additional Notes (Optional)",
  notesPlaceholder: "Any comments or special circumstances we should know about?",
  groupSwitchLabel: "Apply my selections to all group members",
  submitButtonText: "Submit Availability",
  successTitle: "Thank You!",
  successMessage: "Your availability has been recorded successfully. We'll be in touch with more details soon.",
};

type RecordDay = {
  id: string;
  date: string;
  totalSeats: number;
};

type Contestant = {
  id: string;
  name: string;
  age: number;
  gender: string;
};

type GroupMember = {
  id: string;
  name: string;
};

type CurrentAvailability = {
  id: string;
  recordDayId: string;
  responseValue: string;
};

type TokenData = {
  contestant: Contestant;
  groupMembers: GroupMember[];
  recordDays: RecordDay[];
  currentAvailability: CurrentAvailability[];
};

export default function AvailabilityResponsePage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [selectedDays, setSelectedDays] = useState<Map<string, string>>(new Map());
  const [applyToGroup, setApplyToGroup] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data: tokenData, isLoading, error } = useQuery<TokenData>({
    queryKey: ["/api/availability/token", token],
    enabled: !!token && !submitted,
  });

  const { data: formConfig } = useQuery<Record<string, string>>({
    queryKey: ["/api/form-configs", "availability"],
  });

  const getConfig = (key: string): string => {
    return formConfig?.[key] || DEFAULT_CONFIG[key] || "";
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const responses = Array.from(selectedDays.entries()).map(([recordDayId, responseValue]) => ({
        recordDayId,
        responseValue,
      }));

      return apiRequest("POST", `/api/availability/respond/${token}`, { responses, applyToGroup, notes });
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({
        title: "Success!",
        description: "Your availability has been recorded. Thank you!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit availability",
        variant: "destructive",
      });
    },
  });

  const handleToggleDay = (recordDayId: string, value: string) => {
    const newMap = new Map(selectedDays);
    if (newMap.get(recordDayId) === value) {
      newMap.delete(recordDayId);
    } else {
      newMap.set(recordDayId, value);
    }
    setSelectedDays(newMap);
  };

  const handleSubmit = () => {
    if (selectedDays.size === 0) {
      toast({
        title: "No days selected",
        description: "Please select your availability for at least one record day",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(180deg, #2a0a0a 0%, #1a0505 100%)' }}>
        <div className="w-full max-w-2xl">
          <div className="bg-white rounded-xl shadow-2xl p-12 text-center">
            <div className="animate-pulse">
              <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4"></div>
              <div className="h-4 w-32 bg-gray-100 rounded mx-auto"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !tokenData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(180deg, #2a0a0a 0%, #1a0505 100%)' }}>
        <div className="w-full max-w-2xl">
          <div style={{ background: 'linear-gradient(180deg, #8B0000 0%, #5a0000 100%)', padding: '20px', textAlign: 'center', borderRadius: '12px 12px 0 0' }}>
            <h2 style={{ color: '#D4AF37', fontSize: '24px', fontWeight: 'bold', margin: 0, letterSpacing: '2px' }}>
              DEAL OR NO DEAL
            </h2>
          </div>
          <div className="bg-white rounded-b-xl shadow-2xl p-8">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error ? "Invalid or expired link. Please contact the show producers." : "Failed to load availability form."}
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(180deg, #2a0a0a 0%, #1a0505 100%)' }}>
        <div className="w-full max-w-2xl">
          <div style={{ background: 'linear-gradient(180deg, #8B0000 0%, #5a0000 100%)', padding: '20px', textAlign: 'center', borderRadius: '12px 12px 0 0' }}>
            <h2 style={{ color: '#D4AF37', fontSize: '24px', fontWeight: 'bold', margin: 0, letterSpacing: '2px' }}>
              DEAL OR NO DEAL
            </h2>
          </div>
          <div className="bg-white rounded-b-xl shadow-2xl p-12 text-center">
            <div style={{ 
              width: '80px', 
              height: '80px', 
              borderRadius: '50%', 
              background: 'linear-gradient(135deg, #D4AF37 0%, #B8860B 100%)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 24px auto'
            }}>
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold mb-3" style={{ color: '#8B0000' }}>{getConfig("successTitle")}</h2>
            <p className="text-gray-600">
              {getConfig("successMessage")}
              {applyToGroup && tokenData?.groupMembers && tokenData.groupMembers.length > 0 && 
                ` Your selection has been applied to your group members as well.`
              }
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4" style={{ background: 'linear-gradient(180deg, #2a0a0a 0%, #1a0505 100%)' }}>
      <div className="max-w-3xl mx-auto py-8">
        <div style={{ background: 'linear-gradient(180deg, #8B0000 0%, #5a0000 100%)', padding: '20px', textAlign: 'center', borderRadius: '12px 12px 0 0' }}>
          <h2 style={{ color: '#D4AF37', fontSize: '24px', fontWeight: 'bold', margin: 0, letterSpacing: '2px' }}>
            DEAL OR NO DEAL
          </h2>
        </div>
        
        <div style={{ background: 'linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%)', padding: '20px 30px', textAlign: 'center' }}>
          <h1 style={{ color: '#D4AF37', fontSize: '22px', fontWeight: 'bold', margin: 0, letterSpacing: '2px', textTransform: 'uppercase' }}>
            {getConfig("title")}
          </h1>
        </div>
        
        <div className="bg-white shadow-2xl" style={{ borderRadius: '0 0 12px 12px' }}>
          <div className="p-6 border-b" style={{ borderColor: '#f0f0f0' }}>
            <p className="text-gray-600 text-center">
              Hello <span style={{ color: '#8B0000', fontWeight: 'bold' }}>{tokenData.contestant.name}</span>! {getConfig("description")}
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mt-3">
              <Users className="w-4 h-4" />
              <span>
                {tokenData.contestant.age} years old · {tokenData.contestant.gender}
              </span>
            </div>

            {tokenData.groupMembers.length > 0 && (
              <div className="mt-4 p-4 rounded-lg" style={{ background: 'linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%)', borderLeft: '4px solid #D4AF37' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4" style={{ color: '#8B0000' }} />
                  <span className="font-medium" style={{ color: '#8B0000' }}>You're attending with:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tokenData.groupMembers.map((member) => (
                    <Badge 
                      key={member.id} 
                      data-testid={`badge-group-member-${member.id}`}
                      style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #B8860B 100%)', color: '#2a0a0a', border: 'none' }}
                    >
                      {member.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5" style={{ color: '#8B0000' }} />
              <h3 className="font-bold text-lg" style={{ color: '#8B0000' }}>Recording Session Availability</h3>
            </div>
            <p className="text-gray-500 text-sm mb-6">
              For each recording date below, select your availability status.
            </p>
            
            <div className="space-y-4">
              {tokenData.recordDays.map((day) => {
                const current = selectedDays.get(day.id);
                const dateStr = new Date(day.date).toLocaleDateString('en-AU', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
                
                return (
                  <div 
                    key={day.id} 
                    className="p-4 rounded-lg border"
                    style={{ 
                      borderColor: current ? (current === 'yes' ? '#22c55e' : current === 'maybe' ? '#eab308' : '#ef4444') : '#e5e7eb',
                      backgroundColor: current ? (current === 'yes' ? '#f0fdf4' : current === 'maybe' ? '#fefce8' : '#fef2f2') : '#fafafa'
                    }}
                    data-testid={`record-day-${day.id}`}
                  >
                    <div className="mb-3">
                      <div className="font-semibold text-gray-800">{dateStr}</div>
                      <div className="text-sm text-gray-500">{day.totalSeats} seats available</div>
                    </div>
                    
                    <RadioGroup value={current || ''} onValueChange={(value) => handleToggleDay(day.id, value)}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label 
                          htmlFor={`yes-${day.id}`}
                          className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                            current === 'yes' 
                              ? 'bg-green-100 border-green-500 text-green-700' 
                              : 'bg-white border-gray-200 hover:border-green-300 hover:bg-green-50'
                          }`}
                        >
                          <RadioGroupItem value="yes" id={`yes-${day.id}`} data-testid={`radio-yes-${day.id}`} className="text-green-600" />
                          <span className="text-sm font-medium">{getConfig("yesLabel")}</span>
                        </label>
                        
                        <label 
                          htmlFor={`maybe-${day.id}`}
                          className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                            current === 'maybe' 
                              ? 'bg-yellow-100 border-yellow-500 text-yellow-700' 
                              : 'bg-white border-gray-200 hover:border-yellow-300 hover:bg-yellow-50'
                          }`}
                        >
                          <RadioGroupItem value="maybe" id={`maybe-${day.id}`} data-testid={`radio-maybe-${day.id}`} className="text-yellow-600" />
                          <span className="text-sm font-medium">{getConfig("maybeLabel")}</span>
                        </label>
                        
                        <label 
                          htmlFor={`no-${day.id}`}
                          className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                            current === 'no' 
                              ? 'bg-red-100 border-red-500 text-red-700' 
                              : 'bg-white border-gray-200 hover:border-red-300 hover:bg-red-50'
                          }`}
                        >
                          <RadioGroupItem value="no" id={`no-${day.id}`} data-testid={`radio-no-${day.id}`} className="text-red-600" />
                          <span className="text-sm font-medium">{getConfig("noLabel")}</span>
                        </label>
                      </div>
                    </RadioGroup>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-6 border-t" style={{ borderColor: '#f0f0f0', backgroundColor: '#fafafa' }}>
            <div className="mb-4">
              <Label htmlFor="notes" className="font-medium text-gray-700">{getConfig("notesLabel")}</Label>
              <Textarea
                id="notes"
                data-testid="textarea-notes"
                placeholder={getConfig("notesPlaceholder")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2 bg-white"
              />
            </div>

            {tokenData.groupMembers.length > 0 && (
              <div className="flex items-center space-x-3 p-4 rounded-lg" style={{ background: 'linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%)', borderLeft: '4px solid #D4AF37' }}>
                <Switch
                  id="apply-group"
                  data-testid="switch-apply-group"
                  checked={applyToGroup}
                  onCheckedChange={setApplyToGroup}
                />
                <Label htmlFor="apply-group" className="cursor-pointer text-gray-700">
                  {getConfig("groupSwitchLabel")} ({tokenData.groupMembers.length} {tokenData.groupMembers.length === 1 ? 'person' : 'people'})
                </Label>
              </div>
            )}
          </div>

          <div className="p-6 border-t" style={{ borderColor: '#f0f0f0' }}>
            <Button
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="w-full text-base font-bold py-6"
              size="lg"
              data-testid="button-submit"
              style={{ 
                background: 'linear-gradient(135deg, #D4AF37 0%, #B8860B 100%)', 
                color: '#2a0a0a',
                border: 'none',
                letterSpacing: '1px',
                textTransform: 'uppercase'
              }}
            >
              {submitMutation.isPending ? "Submitting..." : getConfig("submitButtonText")}
            </Button>
          </div>
        </div>
        
        <p className="text-center mt-6 text-sm" style={{ color: '#aa8888' }}>
          This is an automated message from the Deal or No Deal production team.
        </p>
      </div>
    </div>
  );
}
