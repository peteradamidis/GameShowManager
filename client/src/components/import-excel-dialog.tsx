import { useState, useCallback, useId } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle, Users, Mail, Phone, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DuplicateInfo {
  importName: string;
  importEmail: string | null;
  importPhone: string | null;
  matchType: 'exact_name' | 'email' | 'phone';
  existingContestant: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isTemporary: boolean;
  };
}

interface TemporaryUpdateInfo {
  existingId: string;
  importName: string;
}

interface PreviewData {
  totalInFile: number;
  uniqueCount: number;
  duplicateCount: number;
  duplicates: DuplicateInfo[];
  temporaryUpdatesCount: number;
  temporaryUpdates: TemporaryUpdateInfo[];
  emailPatchCount: number;
  emailPatches: Array<{ importName: string; email: string }>;
  dondHistoryMatchCount?: number;
}

interface ImportExcelDialogProps {
  onImport?: (file: File) => void;
  previewEndpoint?: string;
  triggerLabel?: string;
  dialogTitle?: string;
  dialogDescription?: string;
  "data-testid"?: string;
}

export function ImportExcelDialog({
  onImport,
  previewEndpoint = "/api/contestants/import-preview",
  triggerLabel = "Import Data",
  dialogTitle = "Import Contestant Data",
  dialogDescription = "Upload an Excel file exported from Cast It Reach with auditioned applicants.",
  "data-testid": testId = "button-import-data",
}: ImportExcelDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<'select' | 'preview' | 'importing'>('select');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const { toast } = useToast();
  // Unique id per instance so two dialogs on the same page don't share the file input id
  const fileInputId = useId();

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
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      setSelectedFile(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please upload an Excel file (.xlsx or .xls)",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleCheckDuplicates = async () => {
    if (!selectedFile) return;
    
    setIsLoadingPreview(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      const response = await fetch(previewEndpoint, {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Preview failed');
      }
      
      const data = await response.json();
      setPreviewData(data);
      setStep('preview');
    } catch (error: any) {
      toast({
        title: "Preview failed",
        description: error.message || "Could not analyze file for duplicates",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      if (onImport) {
        onImport(selectedFile);
      }
      handleClose();
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedFile(null);
    setStep('select');
    setPreviewData(null);
  };

  const getMatchTypeLabel = (matchType: string) => {
    switch (matchType) {
      case 'exact_name': return 'Same Name';
      case 'email': return 'Same Email';
      case 'phone': return 'Same Phone';
      default: return matchType;
    }
  };

  const getMatchTypeIcon = (matchType: string) => {
    switch (matchType) {
      case 'exact_name': return <Users className="h-3 w-3" />;
      case 'email': return <Mail className="h-3 w-3" />;
      case 'phone': return <Phone className="h-3 w-3" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else setOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button data-testid={testId}>
          <Upload className="h-4 w-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'select' && dialogTitle}
            {step === 'preview' && "Import Preview - Duplicate Check"}
          </DialogTitle>
          <DialogDescription>
            {step === 'select' && dialogDescription}
            {step === 'preview' && "Review potential duplicates before importing."}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {selectedFile ? (
              <div className="space-y-2">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-green-500" />
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="font-medium">Drop Excel file here</p>
                <p className="text-sm text-muted-foreground">or click to browse</p>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                  id={fileInputId}
                  data-testid="input-file-upload"
                />
                <label htmlFor={fileInputId}>
                  <Button variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
              </div>
            )}
          </div>
        )}

        {step === 'preview' && previewData && (
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-5 gap-2">
              <div className="p-3 rounded-lg border bg-muted/50">
                <p className="text-2xl font-bold">{previewData.totalInFile}</p>
                <p className="text-sm text-muted-foreground">Total in file</p>
              </div>
              <div className="p-3 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">{previewData.uniqueCount}</p>
                <p className="text-sm text-green-600 dark:text-green-500">New</p>
              </div>
              <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{previewData.temporaryUpdatesCount}</p>
                <p className="text-sm text-blue-600 dark:text-blue-500">Temp Updates</p>
              </div>
              <div className="p-3 rounded-lg border bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800">
                <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">{previewData.emailPatchCount || 0}</p>
                <p className="text-sm text-violet-600 dark:text-violet-500">Email Adds</p>
              </div>
              <div className="p-3 rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{previewData.duplicateCount}</p>
                <p className="text-sm text-amber-600 dark:text-amber-500">Duplicates</p>
              </div>
            </div>

            {previewData.temporaryUpdatesCount > 0 && (
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Temporary Contestants Found (Will be updated)</span>
                </div>
                <div className="max-h-[150px] overflow-y-auto border rounded-lg p-2 space-y-1">
                  {previewData.temporaryUpdates.map((t, i) => (
                    <div key={i} className="text-xs p-1.5 rounded bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 flex justify-between items-center">
                      <span>{t.importName}</span>
                      <Badge variant="outline" className="text-[9px] bg-blue-100 text-blue-700">TEMP</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(previewData.dondHistoryMatchCount || 0) > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20">
                <CheckCircle className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="text-sm text-indigo-700 dark:text-indigo-300">
                  <strong>{previewData.dondHistoryMatchCount}</strong> {previewData.dondHistoryMatchCount === 1 ? 'contestant has' : 'contestants have'} prior DOND history — a summary will be appended to their availability notes.
                </span>
              </div>
            )}

            {(previewData.emailPatchCount || 0) > 0 && (
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4 text-violet-500" />
                  <span className="text-sm font-medium">Email Will Be Added To Existing Contestants</span>
                </div>
                <div className="max-h-[150px] overflow-y-auto border border-violet-200 dark:border-violet-800 rounded-lg p-2 space-y-1">
                  {previewData.emailPatches.map((p, i) => (
                    <div key={i} className="text-xs p-1.5 rounded bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 flex justify-between items-center gap-2">
                      <span className="font-medium truncate">{p.importName}</span>
                      <span className="text-muted-foreground truncate">{p.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewData.duplicateCount > 0 ? (
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">Potential Duplicates (will be skipped)</span>
                </div>
                <ScrollArea className="flex-1 border rounded-lg min-h-0 max-h-[35vh]">
                  <div className="p-2 space-y-2">
                    {previewData.duplicates.map((dup, index) => (
                      <div key={index} className="p-3 rounded border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{dup.importName}</p>
                            <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                              {dup.importEmail && <p className="truncate">Email: {dup.importEmail}</p>}
                              {dup.importPhone && <p>Phone: {dup.importPhone}</p>}
                            </div>
                          </div>
                          <Badge variant="outline" className="gap-1 shrink-0 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700">
                            {getMatchTypeIcon(dup.matchType)}
                            {getMatchTypeLabel(dup.matchType)}
                          </Badge>
                        </div>
                        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                          <p className="text-xs text-muted-foreground mb-1">Matches existing contestant:</p>
                          <p className="text-sm font-medium">{dup.existingContestant.name}</p>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {dup.existingContestant.email && <span className="mr-3">Email: {dup.existingContestant.email}</span>}
                            {dup.existingContestant.phone && <span>Phone: {dup.existingContestant.phone}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-4 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-green-700 dark:text-green-400">No duplicates found! All contestants are new.</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-4">
          {step === 'select' && (
            <>
              <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
                Cancel
              </Button>
              <Button 
                onClick={handleCheckDuplicates} 
                disabled={!selectedFile || isLoadingPreview} 
                data-testid="button-check-duplicates"
              >
                {isLoadingPreview ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Check for Duplicates
                  </>
                )}
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('select')} data-testid="button-back">
                Back
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={previewData?.uniqueCount === 0 && previewData?.temporaryUpdatesCount === 0 && (previewData?.emailPatchCount || 0) === 0}
                data-testid="button-process-import"
              >
                <Upload className="h-4 w-4 mr-2" />
                {(previewData?.emailPatchCount || 0) > 0 && (previewData?.uniqueCount || 0) === 0 && (previewData?.temporaryUpdatesCount || 0) === 0
                  ? `Add Emails to ${previewData?.emailPatchCount} Contestants`
                  : `Import ${(previewData?.uniqueCount || 0) + (previewData?.temporaryUpdatesCount || 0) + (previewData?.emailPatchCount || 0)} Contestants`
                }
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
