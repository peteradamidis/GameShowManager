import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Image, FileText, Loader2, Copy, Check, Save, Mail } from "lucide-react";
import { useState, useEffect } from "react";

interface EmailAsset {
  path: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
}

// Default values for email template
const EMAIL_TEMPLATE_DEFAULTS = {
  booking_email_headline: 'Your Booking is Confirmed!',
  booking_email_intro: 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.',
  booking_email_instructions: 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.',
  booking_email_button_text: 'Confirm Attendance',
  booking_email_footer: 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.',
};

export default function Settings() {
  const { toast } = useToast();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [senderName, setSenderName] = useState("Deal or No Deal");
  const [senderNameChanged, setSenderNameChanged] = useState(false);
  
  // Email template state
  const [emailHeadline, setEmailHeadline] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_headline);
  const [emailIntro, setEmailIntro] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_intro);
  const [emailInstructions, setEmailInstructions] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_instructions);
  const [emailButtonText, setEmailButtonText] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_button_text);
  const [emailFooter, setEmailFooter] = useState(EMAIL_TEMPLATE_DEFAULTS.booking_email_footer);
  const [emailTemplateChanged, setEmailTemplateChanged] = useState(false);

  const { data: savedSenderName } = useQuery<string | null>({
    queryKey: ["/api/system-config/email_sender_name"],
  });
  
  // Fetch saved email template values
  const { data: savedHeadline } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_headline"] });
  const { data: savedIntro } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_intro"] });
  const { data: savedInstructions } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_instructions"] });
  const { data: savedButtonText } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_button_text"] });
  const { data: savedFooter } = useQuery<string | null>({ queryKey: ["/api/system-config/booking_email_footer"] });

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
    if (savedFooter) setEmailFooter(savedFooter);
  }, [savedFooter]);

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
  
  const saveEmailTemplateMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        apiRequest("PUT", "/api/system-config/booking_email_headline", { value: emailHeadline }),
        apiRequest("PUT", "/api/system-config/booking_email_intro", { value: emailIntro }),
        apiRequest("PUT", "/api/system-config/booking_email_instructions", { value: emailInstructions }),
        apiRequest("PUT", "/api/system-config/booking_email_button_text", { value: emailButtonText }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/system-config/booking_email_footer"] });
    },
    onError: (error: any) => {
      toast({ title: "Error saving template", description: error.message, variant: "destructive" });
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
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button data-testid="button-save-settings">Save Settings</Button>
        </div>
      </div>
    </div>
  );
}
