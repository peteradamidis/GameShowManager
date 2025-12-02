import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, Image, FileText, Copy, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface EmailAsset {
  path: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
}

export default function EmailAssetsPage() {
  const { toast } = useToast();

  const { data: assets = [], isLoading, refetch } = useQuery<EmailAsset[]>({
    queryKey: ["/api/email-assets"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.replace(/^\/objects\//, "");
      await apiRequest("DELETE", `/api/email-assets/${cleanPath}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-assets"] });
      toast({ title: "Asset deleted successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete failed", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleUploadComplete = (result: { objectPath: string; filename: string }) => {
    toast({ title: "File uploaded successfully", description: result.filename });
    refetch();
  };

  const handleUploadError = (error: string) => {
    toast({ title: "Upload failed", description: error, variant: "destructive" });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const getPublicUrl = (asset: EmailAsset) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}${asset.path}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (contentType: string) => contentType.startsWith("image/");
  const isPdf = (contentType: string) => contentType === "application/pdf";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="page-title">Email Assets</h1>
          <p className="text-muted-foreground">
            Upload images and PDFs to use in your booking emails
          </p>
        </div>
        <div className="flex gap-2">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How to Use</CardTitle>
          <CardDescription>Add these files to your booking emails</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">For Images in Email Body:</h4>
            <p className="text-sm text-muted-foreground">
              Copy the URL and paste it into the email template like this:
            </p>
            <code className="text-xs bg-muted px-2 py-1 rounded block mt-1">
              {'<img src="YOUR_IMAGE_URL" alt="Description" style="max-width: 100%;">'}
            </code>
          </div>
          <div>
            <h4 className="font-medium mb-2">For PDF Attachments:</h4>
            <p className="text-sm text-muted-foreground">
              PDFs can be selected as attachments when sending booking emails. 
              This feature will be available in the email preview dialog.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded Assets</CardTitle>
          <CardDescription>
            {assets.length} file{assets.length !== 1 ? "s" : ""} uploaded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : assets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No assets uploaded yet</p>
              <p className="text-sm">Upload images or PDFs to use in your emails</p>
            </div>
          ) : (
            <div className="space-y-4">
              {assets.map((asset) => (
                <div 
                  key={asset.path}
                  className="flex items-center gap-4 p-4 border rounded-lg"
                  data-testid={`asset-${asset.name}`}
                >
                  <div className="w-16 h-16 flex-shrink-0 bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                    {isImage(asset.contentType) ? (
                      <img 
                        src={getPublicUrl(asset)} 
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    ) : isPdf(asset.contentType) ? (
                      <FileText className="w-8 h-8 text-red-500" />
                    ) : (
                      <FileText className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{asset.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {asset.contentType} • {formatFileSize(asset.size)}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {getPublicUrl(asset)}
                    </p>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyToClipboard(getPublicUrl(asset))}
                      title="Copy URL"
                      data-testid={`copy-url-${asset.name}`}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(getPublicUrl(asset), "_blank")}
                      title="Open in new tab"
                      data-testid={`open-${asset.name}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(asset.path)}
                      disabled={deleteMutation.isPending}
                      title="Delete"
                      data-testid={`delete-${asset.name}`}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-destructive" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
