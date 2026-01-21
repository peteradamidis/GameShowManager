import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, X, Megaphone } from "lucide-react";

interface PopupConfig {
  enabled: boolean;
  title: string;
  description: string;
  mediaType: 'none' | 'image' | 'video';
  mediaUrl: string;
}

export function AnnouncementPopupModal() {
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: config } = useQuery<PopupConfig>({
    queryKey: ['/api/popup/config'],
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (config?.enabled) {
      const timer = setTimeout(() => {
        setOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [config?.enabled]);

  const handleClose = () => {
    setOpen(false);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleVideoEnd = () => {
    setIsPlaying(false);
  };

  if (!config?.enabled) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Megaphone className="h-5 w-5 text-primary" />
            {config.title}
          </DialogTitle>
          {config.description && (
            <DialogDescription>
              {config.description}
            </DialogDescription>
          )}
        </DialogHeader>
        
        {config.mediaType === 'video' && config.mediaUrl && (
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={config.mediaUrl}
              className="w-full max-h-[60vh] object-contain"
              controls={isPlaying}
              onEnded={handleVideoEnd}
              playsInline
            />
            
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Button
                  size="lg"
                  onClick={handlePlay}
                  className="rounded-full h-20 w-20 bg-white/90 hover:bg-white text-black"
                  data-testid="button-play-video"
                >
                  <Play className="h-10 w-10 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}

        {config.mediaType === 'image' && config.mediaUrl && (
          <div className="rounded-lg overflow-hidden">
            <img
              src={config.mediaUrl}
              alt={config.title}
              className="w-full max-h-[60vh] object-contain"
            />
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-close-popup">
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
