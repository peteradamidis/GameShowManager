import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, RefreshCw, FileText, ClipboardCheck } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const AVAILABILITY_DEFAULTS: Record<string, string> = {
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

const BOOKING_DEFAULTS: Record<string, string> = {
  title: "TV Show Booking Confirmation",
  description: "Please confirm your attendance for the upcoming recording.",
  attendingWithLabel: "Update \"Attending With\" Information (optional)",
  attendingWithPlaceholder: "Enter names of people you're attending with",
  attendingWithHelp: "If your group has changed, please update it here",
  notesLabel: "Dietary Requirements / Questions (Optional)",
  notesPlaceholder: "Any dietary requirements, special requests, or questions you have?",
  confirmButtonText: "Confirm Attendance",
  declineButtonText: "Cannot Attend",
  declineReasonRequired: "Please provide a reason for declining the booking",
  confirmedTitle: "Booking Confirmed!",
  confirmedMessage: "Thank you for confirming your attendance! We look forward to seeing you at the recording.",
  declinedTitle: "Booking Cancelled",
  declinedMessage: "Your booking has been cancelled. If your circumstances change, please contact us.",
  toastConfirmedTitle: "Booking Confirmed!",
  toastConfirmedMessage: "Thank you for confirming your attendance!",
  toastDeclinedTitle: "Booking Cancelled",
  toastDeclinedMessage: "Your booking has been cancelled and you've been moved to the reschedule list.",
};

type FormConfigEditorProps = {
  formType: "availability" | "booking";
  defaults: Record<string, string>;
  fieldLabels: Record<string, string>;
};

function FormConfigEditor({ formType, defaults, fieldLabels }: FormConfigEditorProps) {
  const { toast } = useToast();
  const [localConfigs, setLocalConfigs] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: savedConfigs, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/form-configs", formType],
  });

  const saveMutation = useMutation({
    mutationFn: async (configs: Record<string, string>) => {
      return await apiRequest("PUT", `/api/form-configs/${formType}`, configs);
    },
    onSuccess: () => {
      toast({
        title: "Saved",
        description: `${formType === "availability" ? "Availability" : "Booking"} form settings saved successfully.`,
      });
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ["/api/form-configs", formType] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save form settings",
        variant: "destructive",
      });
    },
  });

  const getValue = (key: string): string => {
    if (localConfigs[key] !== undefined) {
      return localConfigs[key];
    }
    if (savedConfigs && savedConfigs[key] !== undefined) {
      return savedConfigs[key];
    }
    return defaults[key] || "";
  };

  const handleChange = (key: string, value: string) => {
    setLocalConfigs((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const configsToSave: Record<string, string> = {};
    for (const key of Object.keys(defaults)) {
      configsToSave[key] = getValue(key);
    }
    saveMutation.mutate(configsToSave);
  };

  const handleReset = () => {
    setLocalConfigs({});
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Loading form settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.keys(defaults).map((key) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={`${formType}-${key}`}>{fieldLabels[key] || key}</Label>
          {key.includes("Message") || key.includes("description") || key.includes("Placeholder") ? (
            <Textarea
              id={`${formType}-${key}`}
              data-testid={`textarea-${formType}-${key}`}
              value={getValue(key)}
              onChange={(e) => handleChange(key, e.target.value)}
              rows={3}
            />
          ) : (
            <Input
              id={`${formType}-${key}`}
              data-testid={`input-${formType}-${key}`}
              value={getValue(key)}
              onChange={(e) => handleChange(key, e.target.value)}
            />
          )}
        </div>
      ))}

      <Separator />

      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saveMutation.isPending}
          data-testid={`button-save-${formType}`}
        >
          <Save className="w-4 h-4 mr-2" />
          {saveMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={!hasChanges}
          data-testid={`button-reset-${formType}`}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset
        </Button>
      </div>
    </div>
  );
}

const AVAILABILITY_FIELD_LABELS: Record<string, string> = {
  title: "Page Title",
  description: "Welcome Message",
  yesLabel: "\"Yes\" Option Label",
  maybeLabel: "\"Maybe\" Option Label",
  noLabel: "\"No\" Option Label",
  notesLabel: "Notes Field Label",
  notesPlaceholder: "Notes Field Placeholder",
  groupSwitchLabel: "Apply to Group Toggle Label",
  submitButtonText: "Submit Button Text",
  successTitle: "Success Message Title",
  successMessage: "Success Message Body",
};

const BOOKING_FIELD_LABELS: Record<string, string> = {
  title: "Page Title",
  description: "Welcome Message",
  attendingWithLabel: "Attending With Field Label",
  attendingWithPlaceholder: "Attending With Placeholder",
  attendingWithHelp: "Attending With Help Text",
  notesLabel: "Notes/Questions Field Label",
  notesPlaceholder: "Notes Field Placeholder",
  confirmButtonText: "Confirm Button Text",
  declineButtonText: "Decline Button Text",
  declineReasonRequired: "Decline Reason Required Message",
  confirmedTitle: "Confirmation Success Title",
  confirmedMessage: "Confirmation Success Message",
  declinedTitle: "Decline Success Title",
  declinedMessage: "Decline Success Message",
  toastConfirmedTitle: "Toast Notification: Confirmed Title",
  toastConfirmedMessage: "Toast Notification: Confirmed Message",
  toastDeclinedTitle: "Toast Notification: Declined Title",
  toastDeclinedMessage: "Toast Notification: Declined Message",
};

export default function FormsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Form Settings</h1>
        <p className="text-muted-foreground mt-1">
          Customize the text and labels shown on public forms sent to contestants.
        </p>
      </div>

      <Tabs defaultValue="availability" className="space-y-6">
        <TabsList>
          <TabsTrigger value="availability" data-testid="tab-availability">
            <ClipboardCheck className="w-4 h-4 mr-2" />
            Availability Form
          </TabsTrigger>
          <TabsTrigger value="booking" data-testid="tab-booking">
            <FileText className="w-4 h-4 mr-2" />
            Booking Form
          </TabsTrigger>
        </TabsList>

        <TabsContent value="availability">
          <Card>
            <CardHeader>
              <CardTitle>Availability Check Form</CardTitle>
              <CardDescription>
                Customize the text shown when contestants respond to availability check emails.
                This form is sent to contestants to ask which recording days they can attend.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormConfigEditor
                formType="availability"
                defaults={AVAILABILITY_DEFAULTS}
                fieldLabels={AVAILABILITY_FIELD_LABELS}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="booking">
          <Card>
            <CardHeader>
              <CardTitle>Booking Confirmation Form</CardTitle>
              <CardDescription>
                Customize the text shown when contestants confirm or decline their booking.
                This form is sent after a contestant has been assigned a seat.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormConfigEditor
                formType="booking"
                defaults={BOOKING_DEFAULTS}
                fieldLabels={BOOKING_FIELD_LABELS}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
