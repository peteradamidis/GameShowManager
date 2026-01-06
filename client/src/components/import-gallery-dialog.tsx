import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, FileImage, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImportResult {
  message: string;
  imported: number;
  totalImages: number;
  unmatched: string[];
  errors: { name: string; error: string }[];
  results: { contestantId: string; contestantName: string; photoUrl: string }[];
}

export function ImportGalleryDialog() {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/contestants/import-gallery", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.details || "Failed to import gallery");
      }
      
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Gallery Import Complete",
        description: `Imported ${data.imported} photos from ${data.totalImages} images found`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.pdf')) {
      setSelectedFile(file);
      setImportResult(null);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF file from Cast It Reach Gallery export",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImportResult(null);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedFile(null);
    setImportResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleClose();
      } else {
        setOpen(true);
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-import-gallery">
          <Camera className="h-4 w-4 mr-2" />
          Import Photos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Photos from Gallery PDF</DialogTitle>
          <DialogDescription>
            Upload a Cast It Reach Gallery export (PDF) to automatically match and import contestant photos.
          </DialogDescription>
        </DialogHeader>

        {!importResult ? (
          <>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <FileImage className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              {selectedFile ? (
                <div className="space-y-2">
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedFile(null)}
                  >
                    Choose Different File
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    Drag and drop a PDF file here, or click to browse
                  </p>
                  <label>
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={handleFileSelect}
                      data-testid="input-gallery-file"
                    />
                    <Button variant="outline" asChild>
                      <span>Browse Files</span>
                    </Button>
                  </label>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={!selectedFile || importMutation.isPending}
                data-testid="button-import-gallery-submit"
              >
                {importMutation.isPending ? "Importing..." : "Import Photos"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle className="h-6 w-6 text-green-600" />
                <div>
                  <p className="font-medium text-green-700 dark:text-green-400">
                    {importResult.imported} photos imported
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Found {importResult.totalImages} images in PDF
                  </p>
                </div>
              </div>

              {importResult.unmatched.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {importResult.unmatched.length} unmatched entries
                    </span>
                  </div>
                  <ScrollArea className="h-32 rounded-md border p-2">
                    <div className="space-y-1">
                      {importResult.unmatched.map((name, i) => (
                        <p key={i} className="text-xs text-muted-foreground truncate">
                          {name}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <XCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {importResult.errors.length} errors
                    </span>
                  </div>
                  <ScrollArea className="h-24 rounded-md border p-2">
                    <div className="space-y-1">
                      {importResult.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-600 dark:text-red-400">
                          {err.name}: {err.error}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleClose} data-testid="button-import-gallery-done">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
