import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Image, FileText, Loader2, Copy, Check, Save, Mail, Download, Database, Clock, RefreshCw, Lock, Server, Send, Eye, ClipboardCheck } from "lucide-react";
import { useState, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

// Form Settings Constants and Component
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

interface EmailAsset {
  path: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
}

// Username change form schema
const usernameChangeSchema = z.object({
  newUsername: z.string().min(3, "Username must be at least 3 characters"),
});

type UsernameChangeForm = z.infer<typeof usernameChangeSchema>;

// Password change form schema
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type PasswordChangeForm = z.infer<typeof passwordChangeSchema>;

// Default values for email templates
const EMAIL_TEMPLATE_DEFAULTS = {
  // Booking email
  booking_email_headline: 'Your Booking is Confirmed!',
  booking_email_intro: 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.',
  booking_email_instructions: 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.',
  booking_email_button_text: 'Confirm Attendance',
  booking_email_additional_instructions: 'We will be recording multiple episodes on the day. The recording of these shows will take approximately 10 hours. Please be prepared to make yourself available for the full length of time.\n\nPlease find attached important information relating to your attendance at the Deal or No Deal recording. Please read this attachment thoroughly and get in touch ASAP should there be any issues.\n\nYou will receive another email closer to your record date with additional paperwork.',
  booking_email_footer: 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.',
  // Availability email
  availability_email_subject: 'Deal or No Deal - Availability Confirmation Request',
  availability_email_headline: 'Confirm Your Availability',
  availability_email_intro: 'Thank you for registering to be part of the Deal or No Deal audience! We\'re excited to potentially have you join us for an upcoming recording session.',
  availability_email_instructions: 'Please click the button below to let us know which recording dates work for you. This helps us plan our audience seating and ensures we can accommodate you on your preferred day.',
  availability_email_footer: 'This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.',
  // Standby email  
  standby_email_headline: 'You\'re on Our Standby List!',
  standby_email_intro: 'You have been added to our standby list for an upcoming Deal or No Deal recording. This means you may be called to attend if a seat becomes available.',
  standby_email_instructions: 'Please confirm your availability as a standby by clicking the button below. We\'ll be in touch if a spot opens up for you.',
  standby_email_footer: 'This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.',
};

export default function Settings() {
  const { toast } = useToast();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("Deal or No Deal");
  const [senderNameChanged, setSenderNameChanged] = useState(false);
  
  // Booking email template state
  const [emailHeadline, setEmailHeadline] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_headline);
  const [emailIntro, setEmailIntro] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_intro);
  const [emailInstructions, setEmailInstructions] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_instructions);
  const [emailButtonText, setEmailButtonText] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_button_text);
  const [emailAdditionalInstructions, setEmailAdditionalInstructions] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_additional_instructions);
  const [emailFooter, setEmailFooter] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_footer);
  const [emailTemplateChanged, setEmailTemplateChanged] = useState(false);
  
  // Availability email template state
  const [availEmailSubject, setAvailEmailSubject] = useState(EMAIL_TEMPLATE_DEFAULTS.availability_email_subject);
  const [availEmailHeadline, setAvailEmailHeadline] = useState(EMAIL_TEMPLATE_DEFAULTS.availability_email_headline);
  const [availEmailIntro, setAvailEmailIntro] = useState(EMAIL_TEMPLATE_DEFAULTS.availability_email_intro);
  const [availEmailInstructions, setAvailEmailInstructions] = useState(EMAIL_TEMPLATE_DEFAULTS.availability_email_instructions);
  const [availEmailFooter, setAvailEmailFooter] = useState(EMAIL_TEMPLATE_DEFAULTS.availability_email_footer);
  const [availTemplateChanged, setAvailTemplateChanged] = useState(false);
  
  // Standby email template state
  const [standbyEmailHeadline, setStandbyEmailHeadline] = useState(EMAIL_TEMPLATE_DEFAULTS.standby_email_headline);
  const [standbyEmailIntro, setStandbyEmailIntro] = useState(EMAIL_TEMPLATE_DEFAULTS.standby_email_intro);
  const [standbyEmailInstructions, setStandbyEmailInstructions] = useState(EMAIL_TEMPLATE_DEFAULTS.standby_email_instructions);
  const [standbyEmailFooter, setStandbyEmailFooter] = useState(EMAIL_TEMPLATE_DEFAULTS.standby_email_footer);
  const [standbyTemplateChanged, setStandbyTemplateChanged] = useState(false);
  
  // Auto-confirmation PDF state
  const [autoConfirmationPdf, setAutoConfirmationPdf] = useState<string>("");
  const [autoConfirmationPdfChanged, setAutoConfirmationPdfChanged] = useState(false);

  const { data: savedSenderName } = useQuery<string | null>({
    queryKey: ["/api/system-config/email_sender_name"],
  });
  
  // Fetch saved booking email template values
  const { data: savedHeadline } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_headline"] });
  const { data: savedIntro } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_intro"] });
  const { data: savedInstructions } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_instructions"] });
  const { data: savedButtonText } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_button_text"] });
  const { data: savedAdditionalInstructions } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_additional_instructions"] });
  const { data: savedFooter } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_footer"] });
  const { data: savedAutoConfirmationPdf } = useQuery<string | null>({ queryKey: ["/api/system-config/auto_confirmation_pdf_path"] });
  
  // Fetch saved availability email template values
  const { data: savedAvailSubject } = useQuery<string | null>({ queryKey: ["/api/system-config/availability_email_subject"] });
  const { data: savedAvailHeadline } = useQuery<string | null>({ queryKey: ["/api/system-config/availability_email_headline"] });
  const { data: savedAvailIntro } = useQuery<string | null>({ queryKey: ["/api/system-config/availability_email_intro"] });
  const { data: savedAvailInstructions } = useQuery<string | null>({ queryKey: ["/api/system-config/availability_email_instructions"] });
  const { data: savedAvailFooter } = useQuery<string | null>({ queryKey: ["/api/system-config/availability_email_footer"] });
  
  // Fetch saved standby email template values
  const { data: savedStandbyHeadline } = useQuery<string | null>({ queryKey: ["/api/system-config/standby_email_headline"] });
  const { data: savedStandbyIntro } = useQuery<string | null>({ queryKey: ["/api/system-config/standby_email_intro"] });
  const { data: savedStandbyInstructions } = useQuery<string | null>({ queryKey: ["/api/system-config/standby_email_instructions"] });
  const { data: savedStandbyFooter } = useQuery<string | null>({ queryKey: ["/api/system-config/standby_email_footer"] });

  useEffect(() => {
    if (savedSenderName) {
      setSenderName(savedSenderName);
    }
  }, [savedSenderName]);
  
  // Load saved email template values
  useEffect(() => {
    if (savedHeadline) setEmailHeadline(savedHeadline);
  }, [savedHeadline]);
  useEffect(() => {
    if (savedIntro) setEmailIntro(savedIntro);
  }, [savedIntro]);
  useEffect(() => {
    if (savedInstructions) setEmailInstructions(savedInstructions);
  }, [savedInstructions]);
  useEffect(() => {
    if (savedButtonText) setEmailButtonText(savedButtonText);
  }, [savedButtonText]);
  useEffect(() => {
    if (savedAdditionalInstructions) setEmailAdditionalInstructions(savedAdditionalInstructions);
  }, [savedAdditionalInstructions]);
  useEffect(() => {
    if (savedFooter) setEmailFooter(savedFooter);
  }, [savedFooter]);
  
  useEffect(() => {
    if (savedAutoConfirmationPdf) setAutoConfirmationPdf(savedAutoConfirmationPdf);
  }, [savedAutoConfirmationPdf]);
  
  // Load saved availability email template values
  useEffect(() => {
    if (savedAvailSubject) setAvailEmailSubject(savedAvailSubject);
  }, [savedAvailSubject]);
  useEffect(() => {
    if (savedAvailHeadline) setAvailEmailHeadline(savedAvailHeadline);
  }, [savedAvailHeadline]);
  useEffect(() => {
    if (savedAvailIntro) setAvailEmailIntro(savedAvailIntro);
  }, [savedAvailIntro]);
  useEffect(() => {
    if (savedAvailInstructions) setAvailEmailInstructions(savedAvailInstructions);
  }, [savedAvailInstructions]);
  useEffect(() => {
    if (savedAvailFooter) setAvailEmailFooter(savedAvailFooter);
  }, [savedAvailFooter]);
  
  // Load saved standby email template values
  useEffect(() => {
    if (savedStandbyHeadline) setStandbyEmailHeadline(savedStandbyHeadline);
  }, [savedStandbyHeadline]);
  useEffect(() => {
    if (savedStandbyIntro) setStandbyEmailIntro(savedStandbyIntro);
  }, [savedStandbyIntro]);
  useEffect(() => {
    if (savedStandbyInstructions) setStandbyEmailInstructions(savedStandbyInstructions);
  }, [savedStandbyInstructions]);
  useEffect(() => {
    if (savedStandbyFooter) setStandbyEmailFooter(savedStandbyFooter);
  }, [savedStandbyFooter]);

  const saveSenderNameMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("PUT", "/api/system-config/email_sender_name", { value: name });
    },
    onSuccess: () => {
      toast({ title: "Sender name saved" });
      setSenderNameChanged(false);
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/email_sender_name"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
  
  const saveAutoConfirmationPdfMutation = useMutation({
    mutationFn: async (pdfPath: string) => {
      return await apiRequest("PUT", "/api/system-config/auto_confirmation_pdf_path", { value: pdfPath });
    },
    onSuccess: () => {
      toast({ title: "Auto-confirmation PDF saved", description: "This PDF will be attached to confirmation emails sent after contestants confirm their booking." });
      setAutoConfirmationPdfChanged(false);
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/auto_confirmation_pdf_path"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
  
  const saveEmailTemplateMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        apiRequest("PUT", "/api/system-config/booking_email_headline", { value: emailHeadline }),
        apiRequest("PUT", "/api/system-config/booking_email_intro", { value: emailIntro }),
        apiRequest("PUT", "/api/system-config/booking_email_instructions", { value: emailInstructions }),
        apiRequest("PUT", "/api/system-config/booking_email_button_text", { value: emailButtonText }),
        apiRequest("PUT", "/api/system-config/booking_email_additional_instructions", { value: emailAdditionalInstructions }),
        apiRequest("PUT", "/api/system-config/booking_email_footer", { value: emailFooter }),
      ]);
    },
    onSuccess: () => {
      toast({ title: "Email template saved", description: "Your changes will apply to all new booking emails." });
      setEmailTemplateChanged(false);
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_headline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_intro"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_button_text"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_additional_instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_footer"] });
    },
    onError: (error: any) => {
      toast({ title: "Error saving template", description: error.message, variant: "destructive" });
    },
  });
  
  const saveAvailEmailTemplateMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        apiRequest("PUT", "/api/system-config/availability_email_subject", { value: availEmailSubject }),
        apiRequest("PUT", "/api/system-config/availability_email_headline", { value: availEmailHeadline }),
        apiRequest("PUT", "/api/system-config/availability_email_intro", { value: availEmailIntro }),
        apiRequest("PUT", "/api/system-config/availability_email_instructions", { value: availEmailInstructions }),
        apiRequest("PUT", "/api/system-config/availability_email_footer", { value: availEmailFooter }),
      ]);
    },
    onSuccess: () => {
      toast({ title: "Availability email template saved", description: "Your changes will apply to all new availability check emails." });
      setAvailTemplateChanged(false);
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/availability_email_subject"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/availability_email_headline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/availability_email_intro"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/availability_email_instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/availability_email_footer"] });
    },
    onError: (error: any) => {
      toast({ title: "Error saving template", description: error.message, variant: "destructive" });
    },
  });
  
  const saveStandbyEmailTemplateMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        apiRequest("PUT", "/api/system-config/standby_email_headline", { value: standbyEmailHeadline }),
        apiRequest("PUT", "/api/system-config/standby_email_intro", { value: standbyEmailIntro }),
        apiRequest("PUT", "/api/system-config/standby_email_instructions", { value: standbyEmailInstructions }),
        apiRequest("PUT", "/api/system-config/standby_email_footer", { value: standbyEmailFooter }),
      ]);
    },
    onSuccess: () => {
      toast({ title: "Standby email template saved", description: "Your changes will apply to all new standby booking emails." });
      setStandbyTemplateChanged(false);
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/standby_email_headline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/standby_email_intro"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/standby_email_instructions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/standby_email_footer"] });
    },
    onError: (error: any) => {
      toast({ title: "Error saving template", description: error.message, variant: "destructive" });
    },
  });

  // Password change form
  const passwordForm = useForm<PasswordChangeForm>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: PasswordChangeForm) => {
      const response = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      return response;
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      passwordForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error changing password", 
        description: error.message || "Failed to change password. Check your current password.", 
        variant: "destructive" 
      });
    },
  });

  const onPasswordSubmit = (data: PasswordChangeForm) => {
    changePasswordMutation.mutate(data);
  };

  // Username change form
  const usernameForm = useForm<UsernameChangeForm>({
    resolver: zodResolver(usernameChangeSchema),
    defaultValues: {
      newUsername: "",
    },
  });

  const changeUsernameMutation = useMutation({
    mutationFn: async (data: UsernameChangeForm) => {
      const response = await apiRequest("POST", "/api/auth/change-username", {
        newUsername: data.newUsername,
      });
      return response;
    },
    onSuccess: () => {
      toast({ title: "Username changed", description: "Your username has been updated successfully." });
      usernameForm.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/check"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error changing username", 
        description: error.message || "Failed to change username.", 
        variant: "destructive" 
      });
    },
  });

  const onUsernameSubmit = (data: UsernameChangeForm) => {
    changeUsernameMutation.mutate(data);
  };

  // SMTP Configuration
  interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    fromEmail: string;
    fromName: string;
    hasPassword: boolean;
  }

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('Deal or No Deal');
  const [smtpChanged, setSmtpChanged] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');

  const { data: smtpConfig, isLoading: smtpLoading } = useQuery<SmtpConfig>({
    queryKey: ['/api/smtp/config'],
  });

  useEffect(() => {
    if (smtpConfig) {
      setSmtpHost(smtpConfig.host || '');
      setSmtpPort(String(smtpConfig.port || 587));
      setSmtpSecure(smtpConfig.secure || false);
      setSmtpUsername(smtpConfig.username || '');
      setSmtpFromEmail(smtpConfig.fromEmail || '');
      setSmtpFromName(smtpConfig.fromName || 'Deal or No Deal');
    }
  }, [smtpConfig]);

  const saveSmtpMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/smtp/config", {
        host: smtpHost,
        port: parseInt(smtpPort, 10),
        secure: smtpSecure,
        username: smtpUsername,
        password: smtpPassword || undefined,
        fromEmail: smtpFromEmail,
        fromName: smtpFromName,
      });
    },
    onSuccess: () => {
      toast({ title: "SMTP configuration saved" });
      setSmtpChanged(false);
      setSmtpPassword('');
      queryClient.invalidateQueries({ queryKey: ['/api/smtp/config'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const testSmtpMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/smtp/test");
    },
    onSuccess: () => {
      toast({ title: "Connection successful", description: "SMTP server connection verified." });
    },
    onError: (error: any) => {
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
    },
  });

  const sendTestEmailMutation = useMutation({
    mutationFn: async (toEmail: string) => {
      return await apiRequest("POST", "/api/smtp/test-email", { toEmail });
    },
    onSuccess: () => {
      toast({ title: "Test email sent", description: "Check your inbox for the test email." });
      setTestEmailAddress('');
    },
    onError: (error: any) => {
      toast({ title: "Failed to send", description: error.message, variant: "destructive" });
    },
  });

  const { data: assets = [], isLoading: assetsLoading } = useQuery<EmailAsset[]>({
    queryKey: ['/api/email-assets'],
  });

  const deleteMutation = useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.replace('/objects/', '');
      await apiRequest("DELETE", `/api/email-assets/${cleanPath}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-assets'] });
      toast({ title: "File deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/email-assets'] });
    toast({ title: "File uploaded successfully" });
  };

  const handleUploadError = (error: string) => {
    toast({ title: "Upload failed", description: error, variant: "destructive" });
  };

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
    toast({ title: "URL copied to clipboard" });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "Unknown size";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const isImage = (contentType: string) => contentType.startsWith('image/');
  const isPdf = (contentType: string) => contentType === 'application/pdf';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Configure application preferences and defaults
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-xl">
          <TabsTrigger value="general" data-testid="tab-general">
            <Lock className="w-4 h-4 mr-2" />
            General
          </TabsTrigger>
          <TabsTrigger value="email" data-testid="tab-email">
            <Mail className="w-4 h-4 mr-2" />
            Email
          </TabsTrigger>
          <TabsTrigger value="forms" data-testid="tab-forms">
            <ClipboardCheck className="w-4 h-4 mr-2" />
            Forms
          </TabsTrigger>
          <TabsTrigger value="backup" data-testid="tab-backup">
            <Database className="w-4 h-4 mr-2" />
            Backup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>Seating Configuration</CardTitle>
            <CardDescription>
              Default settings for seating assignments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="blocks">Number of Blocks</Label>
              <Input
                id="blocks"
                type="number"
                defaultValue={7}
                data-testid="input-blocks"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seats">Seats Per Block</Label>
              <Input
                id="seats"
                type="number"
                defaultValue={20}
                data-testid="input-seats"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="female-target">Target Female Percentage</Label>
              <Input
                id="female-target"
                type="number"
                defaultValue={65}
                data-testid="input-female-target"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Change Username
            </CardTitle>
            <CardDescription>
              Update your account username
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...usernameForm}>
              <form onSubmit={usernameForm.handleSubmit(onUsernameSubmit)} className="space-y-4">
                <FormField
                  control={usernameForm.control}
                  name="newUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Username</FormLabel>
                      <FormControl>
                        <Input 
                          type="text" 
                          placeholder="Enter new username (min 3 characters)" 
                          {...field} 
                          data-testid="input-new-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  disabled={changeUsernameMutation.isPending}
                  data-testid="button-change-username"
                >
                  {changeUsernameMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Changing...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 mr-2" />
                      Change Username
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Change Password
            </CardTitle>
            <CardDescription>
              Update your account password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...passwordForm}>
              <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                <FormField
                  control={passwordForm.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Password</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder="Enter current password" 
                          {...field} 
                          data-testid="input-current-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder="Enter new password (min 6 characters)" 
                          {...field} 
                          data-testid="input-new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={passwordForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder="Confirm new password" 
                          {...field} 
                          data-testid="input-confirm-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  disabled={changePasswordMutation.isPending}
                  data-testid="button-change-password"
                >
                  {changePasswordMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Changing...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 mr-2" />
                      Change Password
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
          </div>
        </TabsContent>

        <TabsContent value="email">
          <div className="grid gap-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  SMTP Email Configuration
            </CardTitle>
            <CardDescription>
              Configure your Outlook/Exchange SMTP server for sending emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {smtpLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading configuration...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">SMTP Server</Label>
                    <Input
                      id="smtp-host"
                      value={smtpHost}
                      onChange={(e) => { setSmtpHost(e.target.value); setSmtpChanged(true); }}
                      placeholder="smtp.office365.com"
                      data-testid="input-smtp-host"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input
                      id="smtp-port"
                      value={smtpPort}
                      onChange={(e) => { setSmtpPort(e.target.value); setSmtpChanged(true); }}
                      placeholder="587"
                      data-testid="input-smtp-port"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-username">Username / Email</Label>
                    <Input
                      id="smtp-username"
                      value={smtpUsername}
                      onChange={(e) => { setSmtpUsername(e.target.value); setSmtpChanged(true); }}
                      placeholder="user@company.com"
                      data-testid="input-smtp-username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-password">Password</Label>
                    <Input
                      id="smtp-password"
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => { setSmtpPassword(e.target.value); setSmtpChanged(true); }}
                      placeholder={smtpConfig?.hasPassword ? "••••••••" : "Enter password"}
                      data-testid="input-smtp-password"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-from-email">From Email Address</Label>
                    <Input
                      id="smtp-from-email"
                      value={smtpFromEmail}
                      onChange={(e) => { setSmtpFromEmail(e.target.value); setSmtpChanged(true); }}
                      placeholder="bookings@company.com"
                      data-testid="input-smtp-from-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-from-name">From Name</Label>
                    <Input
                      id="smtp-from-name"
                      value={smtpFromName}
                      onChange={(e) => { setSmtpFromName(e.target.value); setSmtpChanged(true); }}
                      placeholder="Deal or No Deal"
                      data-testid="input-smtp-from-name"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="smtp-secure"
                    checked={smtpSecure}
                    onCheckedChange={(checked) => { setSmtpSecure(checked); setSmtpChanged(true); }}
                    data-testid="switch-smtp-secure"
                  />
                  <Label htmlFor="smtp-secure">Use SSL/TLS (port 465)</Label>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveSmtpMutation.mutate()}
                    disabled={!smtpChanged || saveSmtpMutation.isPending}
                    data-testid="button-save-smtp"
                  >
                    {saveSmtpMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    Save Configuration
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => testSmtpMutation.mutate()}
                    disabled={!smtpHost || testSmtpMutation.isPending}
                    data-testid="button-test-smtp"
                  >
                    {testSmtpMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Server className="w-4 h-4 mr-2" />
                    )}
                    Test Connection
                  </Button>
                </div>

                <div className="border-t pt-4 space-y-2">
                  <Label>Send Test Email</Label>
                  <div className="flex gap-2">
                    <Input
                      value={testEmailAddress}
                      onChange={(e) => setTestEmailAddress(e.target.value)}
                      placeholder="test@example.com"
                      data-testid="input-test-email"
                    />
                    <Button
                      variant="outline"
                      onClick={() => sendTestEmailMutation.mutate(testEmailAddress)}
                      disabled={!testEmailAddress || !smtpHost || sendTestEmailMutation.isPending}
                      data-testid="button-send-test-email"
                    >
                      {sendTestEmailMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      Send Test
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
                  <p><strong>Outlook/Office 365:</strong> smtp.office365.com, port 587, STARTTLS</p>
                  <p><strong>Exchange Server:</strong> Use your internal Exchange SMTP server address</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email Settings</CardTitle>
            <CardDescription>
              Configuration for email sending and deliverability
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sender-name">Email Sender Name</Label>
              <p className="text-sm text-muted-foreground">
                This name appears in the "From" field of emails sent to contestants
              </p>
              <div className="flex gap-2">
                <Input
                  id="sender-name"
                  value={senderName}
                  onChange={(e) => {
                    setSenderName(e.target.value);
                    setSenderNameChanged(true);
                  }}
                  placeholder="e.g., Deal or No Deal"
                  data-testid="input-sender-name"
                />
                <Button
                  onClick={() => saveSenderNameMutation.mutate(senderName)}
                  disabled={!senderNameChanged || saveSenderNameMutation.isPending}
                  data-testid="button-save-sender-name"
                >
                  {saveSenderNameMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
            
            <div className="border-t pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-send availability forms</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically send forms after importing contestants
                  </p>
                </div>
                <Switch data-testid="switch-auto-send" />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Send reminder emails</Label>
                  <p className="text-sm text-muted-foreground">
                    Send reminders to contestants who haven't responded
                  </p>
                </div>
                <Switch data-testid="switch-reminders" />
              </div>
            </div>
            
            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Email Deliverability Tips</h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                <li>Ask recipients to add your email address to their contacts</li>
                <li>Avoid using too many images or ALL CAPS in emails</li>
                <li>Keep subject lines clear and descriptive</li>
                <li>Test emails at mail-tester.com before sending to large groups</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Booking Email Template
            </CardTitle>
            <CardDescription>
              Customize the wording of booking confirmation emails. The professional design with banner image will be used automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-headline">Headline</Label>
              <p className="text-xs text-muted-foreground">The gold title shown below the banner</p>
              <Input
                id="email-headline"
                value={emailHeadline}
                onChange={(e) => {
                  setEmailHeadline(e.target.value);
                  setEmailTemplateChanged(true);
                }}
                placeholder="Your Booking is Confirmed!"
                data-testid="input-email-headline"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email-intro">Introduction Paragraph</Label>
              <p className="text-xs text-muted-foreground">Shown after "Hi [Name]," - can include HTML for styling</p>
              <Textarea
                id="email-intro"
                value={emailIntro}
                onChange={(e) => {
                  setEmailIntro(e.target.value);
                  setEmailTemplateChanged(true);
                }}
                placeholder="Congratulations! You've secured your spot..."
                className="min-h-[80px]"
                data-testid="input-email-intro"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email-instructions">Instructions</Label>
              <p className="text-xs text-muted-foreground">Text before the confirm button</p>
              <Textarea
                id="email-instructions"
                value={emailInstructions}
                onChange={(e) => {
                  setEmailInstructions(e.target.value);
                  setEmailTemplateChanged(true);
                }}
                placeholder="Please confirm your attendance..."
                className="min-h-[60px]"
                data-testid="input-email-instructions"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email-button-text">Button Text</Label>
              <p className="text-xs text-muted-foreground">Text on the gold confirm button</p>
              <Input
                id="email-button-text"
                value={emailButtonText}
                onChange={(e) => {
                  setEmailButtonText(e.target.value);
                  setEmailTemplateChanged(true);
                }}
                placeholder="Confirm Attendance"
                data-testid="input-email-button-text"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email-additional-instructions">Additional Instructions</Label>
              <p className="text-xs text-muted-foreground">Text shown below the button - appears in a bordered box. Use blank lines to separate paragraphs.</p>
              <Textarea
                id="email-additional-instructions"
                value={emailAdditionalInstructions}
                onChange={(e) => {
                  setEmailAdditionalInstructions(e.target.value);
                  setEmailTemplateChanged(true);
                }}
                placeholder="We will be recording multiple episodes on the day..."
                className="min-h-[120px]"
                data-testid="input-email-additional-instructions"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email-footer">Footer Message</Label>
              <p className="text-xs text-muted-foreground">Small text at the bottom - can include HTML</p>
              <Textarea
                id="email-footer"
                value={emailFooter}
                onChange={(e) => {
                  setEmailFooter(e.target.value);
                  setEmailTemplateChanged(true);
                }}
                placeholder="This is an automated message..."
                className="min-h-[60px]"
                data-testid="input-email-footer"
              />
            </div>
            
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => saveEmailTemplateMutation.mutate()}
                disabled={!emailTemplateChanged || saveEmailTemplateMutation.isPending}
                data-testid="button-save-email-template"
              >
                {saveEmailTemplateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Template
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Availability Email Template
            </CardTitle>
            <CardDescription>
              Customize the wording of availability check emails sent to contestants.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="avail-email-subject">Email Subject</Label>
              <p className="text-xs text-muted-foreground">The subject line of the email</p>
              <Input
                id="avail-email-subject"
                value={availEmailSubject}
                onChange={(e) => {
                  setAvailEmailSubject(e.target.value);
                  setAvailTemplateChanged(true);
                }}
                placeholder="Deal or No Deal - Availability Confirmation Request"
                data-testid="input-avail-email-subject"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="avail-email-headline">Headline</Label>
              <p className="text-xs text-muted-foreground">The gold title shown below the banner</p>
              <Input
                id="avail-email-headline"
                value={availEmailHeadline}
                onChange={(e) => {
                  setAvailEmailHeadline(e.target.value);
                  setAvailTemplateChanged(true);
                }}
                placeholder="Confirm Your Availability"
                data-testid="input-avail-email-headline"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="avail-email-intro">Introduction Paragraph</Label>
              <p className="text-xs text-muted-foreground">Shown after "Hi [Name]," - can include HTML for styling</p>
              <Textarea
                id="avail-email-intro"
                value={availEmailIntro}
                onChange={(e) => {
                  setAvailEmailIntro(e.target.value);
                  setAvailTemplateChanged(true);
                }}
                placeholder="Thank you for registering..."
                className="min-h-[80px]"
                data-testid="input-avail-email-intro"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="avail-email-instructions">Instructions</Label>
              <p className="text-xs text-muted-foreground">Text before the response buttons</p>
              <Textarea
                id="avail-email-instructions"
                value={availEmailInstructions}
                onChange={(e) => {
                  setAvailEmailInstructions(e.target.value);
                  setAvailTemplateChanged(true);
                }}
                placeholder="Please click the button below..."
                className="min-h-[60px]"
                data-testid="input-avail-email-instructions"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="avail-email-footer">Footer Message</Label>
              <p className="text-xs text-muted-foreground">Small text at the bottom - can include HTML</p>
              <Textarea
                id="avail-email-footer"
                value={availEmailFooter}
                onChange={(e) => {
                  setAvailEmailFooter(e.target.value);
                  setAvailTemplateChanged(true);
                }}
                placeholder="This is an automated message..."
                className="min-h-[60px]"
                data-testid="input-avail-email-footer"
              />
            </div>
            
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => saveAvailEmailTemplateMutation.mutate()}
                disabled={!availTemplateChanged || saveAvailEmailTemplateMutation.isPending}
                data-testid="button-save-avail-email-template"
              >
                {saveAvailEmailTemplateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Template
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-purple-200 dark:border-purple-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
              <Mail className="w-5 h-5" />
              Standby Email Template
            </CardTitle>
            <CardDescription>
              Customize the wording of standby booking emails sent to contestants on the standby list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="standby-email-headline">Headline</Label>
              <p className="text-xs text-muted-foreground">The purple title shown below the banner</p>
              <Input
                id="standby-email-headline"
                value={standbyEmailHeadline}
                onChange={(e) => {
                  setStandbyEmailHeadline(e.target.value);
                  setStandbyTemplateChanged(true);
                }}
                placeholder="You're on Our Standby List!"
                data-testid="input-standby-email-headline"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="standby-email-intro">Introduction Paragraph</Label>
              <p className="text-xs text-muted-foreground">Shown after "Hi [Name]," - can include HTML for styling</p>
              <Textarea
                id="standby-email-intro"
                value={standbyEmailIntro}
                onChange={(e) => {
                  setStandbyEmailIntro(e.target.value);
                  setStandbyTemplateChanged(true);
                }}
                placeholder="You have been added to our standby list..."
                className="min-h-[80px]"
                data-testid="input-standby-email-intro"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="standby-email-instructions">Instructions</Label>
              <p className="text-xs text-muted-foreground">Text before the response buttons</p>
              <Textarea
                id="standby-email-instructions"
                value={standbyEmailInstructions}
                onChange={(e) => {
                  setStandbyEmailInstructions(e.target.value);
                  setStandbyTemplateChanged(true);
                }}
                placeholder="Please confirm your availability as a standby..."
                className="min-h-[60px]"
                data-testid="input-standby-email-instructions"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="standby-email-footer">Footer Message</Label>
              <p className="text-xs text-muted-foreground">Small text at the bottom - can include HTML</p>
              <Textarea
                id="standby-email-footer"
                value={standbyEmailFooter}
                onChange={(e) => {
                  setStandbyEmailFooter(e.target.value);
                  setStandbyTemplateChanged(true);
                }}
                placeholder="This is an automated message..."
                className="min-h-[60px]"
                data-testid="input-standby-email-footer"
              />
            </div>
            
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => saveStandbyEmailTemplateMutation.mutate()}
                disabled={!standbyTemplateChanged || saveStandbyEmailTemplateMutation.isPending}
                data-testid="button-save-standby-email-template"
              >
                {saveStandbyEmailTemplateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Template
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Email Template Previews
            </CardTitle>
            <CardDescription>
              View how each type of email will appear to contestants. Previews use your saved template text with sample contestant data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">Booking Confirmation Email</h4>
                  <p className="text-sm text-muted-foreground">
                    Sent when a contestant is booked for a recording day
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => window.open('/api/email-preview/booking', '_blank')}
                  data-testid="button-preview-booking-email"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
              </div>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <h4 className="font-medium">Availability Check Email</h4>
                  <p className="text-sm text-muted-foreground">
                    Sent to check if contestants are available for upcoming dates
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => window.open('/api/email-preview/availability', '_blank')}
                  data-testid="button-preview-availability-email"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
              </div>
              
              <div className="flex items-center justify-between p-4 border rounded-lg bg-purple-50 dark:bg-purple-950/20">
                <div className="space-y-1">
                  <h4 className="font-medium text-purple-700 dark:text-purple-300">Standby Booking Email</h4>
                  <p className="text-sm text-muted-foreground">
                    Sent to contestants assigned as standbys for a recording day
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => window.open('/api/email-preview/standby', '_blank')}
                  data-testid="button-preview-standby-email"
                  className="border-purple-300 hover:bg-purple-100 dark:border-purple-700 dark:hover:bg-purple-900/30"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground pt-2">
              Previews show your saved template with sample data. Save changes above, then click Preview to see updates.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email Assets</CardTitle>
            <CardDescription>
              Upload images and PDFs to use in your booking emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <ObjectUploader
                accept="image/*"
                onComplete={handleUploadComplete}
                onError={handleUploadError}
                buttonVariant="outline"
              >
                <Image className="w-4 h-4 mr-2" />
                Upload Image
              </ObjectUploader>
              <ObjectUploader
                accept="application/pdf"
                onComplete={handleUploadComplete}
                onError={handleUploadError}
                buttonVariant="outline"
              >
                <FileText className="w-4 h-4 mr-2" />
                Upload PDF
              </ObjectUploader>
            </div>

            <div className="text-sm text-muted-foreground space-y-2">
              <p><strong>For Images:</strong> Copy the URL and paste it into your email template like:</p>
              <code className="block bg-muted p-2 rounded text-xs">
                {`<img src="YOUR_IMAGE_URL" alt="Description" style="max-width: 100%;">`}
              </code>
              <p className="mt-2"><strong>For PDFs:</strong> Select as attachments when sending booking emails.</p>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Uploaded Files ({assets.length})</h4>
              {assetsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : assets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files uploaded yet</p>
              ) : (
                <div className="space-y-2">
                  {assets.map((asset) => (
                    <div
                      key={asset.path}
                      className="flex items-center justify-between p-2 border rounded-md"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {isImage(asset.contentType) ? (
                          <Image className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        ) : isPdf(asset.contentType) ? (
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className="text-sm truncate" title={asset.name}>
                          {asset.name}
                        </span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          ({formatFileSize(asset.size)})
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => copyToClipboard(asset.url)}
                          title="Copy URL"
                          data-testid={`button-copy-${asset.name}`}
                        >
                          {copiedUrl === asset.url ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(asset.path)}
                          disabled={deleteMutation.isPending}
                          title="Delete file"
                          data-testid={`button-delete-${asset.name}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Auto-Confirmation PDF Selection */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-2">Auto-Confirmation Email PDF</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Select the PDF to attach when contestants confirm their booking. This works offline once configured.
              </p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Select 
                    value={autoConfirmationPdf} 
                    onValueChange={(value) => {
                      setAutoConfirmationPdf(value);
                      setAutoConfirmationPdfChanged(true);
                    }}
                  >
                    <SelectTrigger data-testid="select-auto-confirmation-pdf">
                      <SelectValue placeholder="Select a PDF..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No PDF attachment</SelectItem>
                      {assets.filter(a => isPdf(a.contentType)).map((asset) => (
                        <SelectItem key={asset.path} value={asset.path}>
                          {asset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => saveAutoConfirmationPdfMutation.mutate(autoConfirmationPdf)}
                  disabled={!autoConfirmationPdfChanged || saveAutoConfirmationPdfMutation.isPending}
                  data-testid="button-save-auto-confirmation-pdf"
                >
                  {saveAutoConfirmationPdfMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save
                </Button>
              </div>
              {autoConfirmationPdf && autoConfirmationPdf !== "none" && (
                <p className="text-xs text-green-600 mt-2">
                  Currently using: {assets.find(a => a.path === autoConfirmationPdf)?.name || autoConfirmationPdf}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
          </div>
        </TabsContent>

        <TabsContent value="forms">
          <div className="grid gap-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5" />
                  Form Settings
                </CardTitle>
                <CardDescription>
                  Customize the text and labels shown on public forms sent to contestants.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="availability" className="space-y-6">
                  <TabsList>
                    <TabsTrigger value="availability" data-testid="tab-availability-form">
                      <ClipboardCheck className="w-4 h-4 mr-2" />
                      Availability Form
                    </TabsTrigger>
                    <TabsTrigger value="booking" data-testid="tab-booking-form">
                      <FileText className="w-4 h-4 mr-2" />
                      Booking Form
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="availability">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium">Availability Check Form</h4>
                        <p className="text-sm text-muted-foreground">
                          Customize the text shown when contestants respond to availability check emails.
                        </p>
                      </div>
                      <FormConfigEditor
                        formType="availability"
                        defaults={AVAILABILITY_DEFAULTS}
                        fieldLabels={AVAILABILITY_FIELD_LABELS}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="booking">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium">Booking Confirmation Form</h4>
                        <p className="text-sm text-muted-foreground">
                          Customize the text shown when contestants confirm or decline their booking.
                        </p>
                      </div>
                      <FormConfigEditor
                        formType="booking"
                        defaults={BOOKING_DEFAULTS}
                        fieldLabels={BOOKING_FIELD_LABELS}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="backup">
          <div className="grid gap-6 max-w-2xl">
            <BackupSection />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface BackupStatus {
  schedulerRunning: boolean;
  schedulerInitialized: boolean;
  lastBackupTime: string | null;
  lastBackupStatus: 'success' | 'error' | null;
  lastBackupError: string | null;
  consecutiveFailures: number;
  backupInterval: string;
  backupPath: string;
  fileInfo: {
    exists: boolean;
    size?: number;
    modifiedAt?: string;
  };
}

function BackupSection() {
  const { toast } = useToast();
  const [isRunningBackup, setIsRunningBackup] = useState(false);

  const { data: backupStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<BackupStatus>({
    queryKey: ['/api/backup/status'],
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: summary } = useQuery<{
    recordDays: number;
    contestants: number;
    groups: number;
    seatAssignments: number;
    standbys: number;
    canceledAssignments: number;
  }>({
    queryKey: ['/api/backup/summary'],
  });

  const handleManualBackup = async () => {
    setIsRunningBackup(true);
    try {
      const response = await apiRequest("POST", "/api/backup/manual");
      const data = await response.json();
      if (data.success) {
        toast({
          title: "Backup completed",
          description: "All data has been backed up successfully.",
        });
        refetchStatus();
      } else {
        throw new Error(data.error || "Backup failed");
      }
    } catch (error: any) {
      toast({
        title: "Backup failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRunningBackup(false);
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const response = await fetch("/api/backup/download");
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Download failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().split('T')[0];
      a.download = `contestant-backup-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download started",
        description: "Your backup file is being downloaded.",
      });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDownloadExcel = async () => {
    try {
      const response = await fetch("/api/backup/download-excel");
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Download failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().split('T')[0];
      a.download = `contestant-backup-${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download started",
        description: "Your Excel backup file is being downloaded.",
      });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "Unknown";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return "Never";
    return new Date(isoString).toLocaleString();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5" />
          Data Backup
        </CardTitle>
        <CardDescription>
          Automatic backups run every hour. You can also trigger a manual backup anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-sm">Auto-Backup Status</span>
            </div>
            <p className="text-sm font-medium">
              {statusLoading ? "Loading..." : backupStatus?.schedulerRunning ? "Running (every hour)" : 
                backupStatus?.schedulerInitialized ? "Stopped (too many failures)" : "Not started"}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <RefreshCw className="h-4 w-4" />
              <span className="text-sm">Last Backup</span>
            </div>
            <p className="text-sm font-medium">
              {statusLoading ? "Loading..." : formatTime(backupStatus?.fileInfo?.modifiedAt || backupStatus?.lastBackupTime)}
            </p>
          </div>
        </div>

        {backupStatus?.lastBackupStatus === 'error' && backupStatus?.lastBackupError && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive font-medium">Last backup failed</p>
            <p className="text-sm text-destructive/80">{backupStatus.lastBackupError}</p>
            {backupStatus.consecutiveFailures > 1 && (
              <p className="text-xs text-muted-foreground mt-1">
                {backupStatus.consecutiveFailures} consecutive failures
              </p>
            )}
          </div>
        )}

        {summary && (
          <div className="p-3 rounded-lg border">
            <p className="text-sm text-muted-foreground mb-2">Data included in backup:</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>{summary.recordDays} record days</span>
              <span>{summary.contestants} contestants</span>
              <span>{summary.seatAssignments} seat assignments</span>
              <span>{summary.standbys} standbys</span>
              <span>{summary.groups} groups</span>
            </div>
          </div>
        )}

        {backupStatus?.fileInfo?.exists && (
          <div className="text-sm text-muted-foreground">
            Backup file size: {formatFileSize(backupStatus.fileInfo.size)}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button 
            onClick={handleManualBackup} 
            disabled={isRunningBackup}
            data-testid="button-manual-backup"
          >
            {isRunningBackup ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Backing up...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Run Backup Now
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            onClick={handleDownloadBackup}
            disabled={!backupStatus?.fileInfo?.exists}
            data-testid="button-download-backup"
          >
            <Download className="w-4 h-4 mr-2" />
            Download JSON
          </Button>
          <Button 
            variant="outline" 
            onClick={handleDownloadExcel}
            disabled={!backupStatus?.fileInfo?.exists}
            data-testid="button-download-excel"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Excel
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p><strong>What's included:</strong> Record days, contestants, groups, seat assignments, standbys, and canceled assignments.</p>
          <p><strong>Storage:</strong> Backups are saved to the server and overwrite the previous backup each hour.</p>
        </div>
      </CardContent>
    </Card>
  );
}
