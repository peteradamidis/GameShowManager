import { useState, useRef } from "react";
import type { ReactNode, ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

interface ObjectUploaderProps {
  maxFileSize?: number;
  allowedFileTypes?: string[];
  accept?: string;
  onComplete?: (result: { objectPath: string; filename: string }) => void;
  onError?: (error: string) => void;
  buttonClassName?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  children: ReactNode;
}

export function ObjectUploader({
  maxFileSize = 10485760,
  accept = "image/*,application/pdf",
  onComplete,
  onError,
  buttonClassName,
  buttonVariant = "default",
  buttonSize = "default",
  children,
}: ObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxFileSize) {
      onError?.(`File too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB`);
      return;
    }

    setIsUploading(true);

    try {
      const response = await apiRequest("POST", "/api/objects/upload", {
        filename: file.name,
      });
      const data = await response.json();

      const uploadResponse = await fetch(data.uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload failed");
      }

      onComplete?.({
        objectPath: data.objectPath,
        filename: file.name,
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      onError?.(error.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={accept}
        style={{ display: "none" }}
      />
      <Button 
        onClick={handleClick} 
        className={buttonClassName}
        variant={buttonVariant}
        size={buttonSize}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Uploading...
          </>
        ) : (
          children
        )}
      </Button>
    </>
  );
}
