import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Calendar, Users, AlertCircle, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

  const submitMutation = useMutation({
    mutationFn: async () => {
      const responses = Array.from(selectedDays.entries()).map(([recordDayId, responseValue]) => ({
        recordDayId,
        responseValue,
      }));

      return apiRequest(`/api/availability/respond/${token}`, {
        method: "POST",
        body: JSON.stringify({ responses, applyToGroup, notes }),
      });
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
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !tokenData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-12">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error ? "Invalid or expired link. Please contact the show producers." : "Failed to load availability form."}
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
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h2 className="text-2xl font-semibold mb-2">Thank You!</h2>
            <p className="text-muted-foreground">
              Your availability has been recorded successfully.
              {applyToGroup && tokenData.groupMembers.length > 0 && 
                ` Your selection has been applied to your group members as well.`
              }
            </p>
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
            <CardTitle className="text-2xl">TV Show Availability Check</CardTitle>
            <CardDescription>
              Hello {tokenData.contestant.name}! Please let us know which recording days you're available to attend.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Users className="w-4 h-4" />
              <span>
                {tokenData.contestant.age} years old • {tokenData.contestant.gender}
              </span>
            </div>

            {tokenData.groupMembers.length > 0 && (
              <div className="mb-6 p-4 bg-muted rounded-md">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4" />
                  <span className="font-medium">You're attending with:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tokenData.groupMembers.map((member) => (
                    <Badge key={member.id} variant="secondary" data-testid={`badge-group-member-${member.id}`}>
                      {member.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Recording Session Availability Form
            </CardTitle>
            <CardDescription>
              For each recording date below, select your availability status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {tokenData.recordDays.map((day) => {
              const current = selectedDays.get(day.id);
              const dateStr = new Date(day.date).toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              });
              
              return (
                <div key={day.id} className="space-y-3 pb-4 border-b last:border-b-0" data-testid={`record-day-${day.id}`}>
                  <div>
                    <div className="font-medium text-base">{dateStr}</div>
                    <div className="text-sm text-muted-foreground">{day.totalSeats} seats available</div>
                  </div>
                  
                  <RadioGroup value={current || ''} onValueChange={(value) => handleToggleDay(day.id, value)}>
                    <div className="flex items-center space-x-2 mb-2">
                      <RadioGroupItem value="yes" id={`yes-${day.id}`} data-testid={`radio-yes-${day.id}`} />
                      <Label htmlFor={`yes-${day.id}`} className="font-normal cursor-pointer">
                        Yes, I can attend
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2 mb-2">
                      <RadioGroupItem value="maybe" id={`maybe-${day.id}`} data-testid={`radio-maybe-${day.id}`} />
                      <Label htmlFor={`maybe-${day.id}`} className="font-normal cursor-pointer">
                        Maybe (unsure, will confirm later)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="no" id={`no-${day.id}`} data-testid={`radio-no-${day.id}`} />
                      <Label htmlFor={`no-${day.id}`} className="font-normal cursor-pointer">
                        No, I cannot attend
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label htmlFor="notes">Additional Notes (Optional)</Label>
              <Textarea
                id="notes"
                data-testid="textarea-notes"
                placeholder="Any comments or special circumstances we should know about?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-2"
              />
            </div>

            {tokenData.groupMembers.length > 0 && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="apply-group"
                  data-testid="switch-apply-group"
                  checked={applyToGroup}
                  onCheckedChange={setApplyToGroup}
                />
                <Label htmlFor="apply-group" className="cursor-pointer">
                  Apply my selections to all group members ({tokenData.groupMembers.length} {tokenData.groupMembers.length === 1 ? 'person' : 'people'})
                </Label>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="flex-1"
            size="lg"
            data-testid="button-submit"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Availability"}
          </Button>
        </div>
      </div>
    </div>
  );
}
