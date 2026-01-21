import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, X, Heart } from "lucide-react";

const STORAGE_KEY = "farewell_video_seen";
const VIDEO_URL = "/farewell-video.mp4";

export function FarewellVideoModal() {
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const hasSeenVideo = localStorage.getItem(STORAGE_KEY);
    if (!hasSeenVideo) {
      const timer = setTimeout(() => {
        setOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, "true");
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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Heart className="h-5 w-5 text-red-500 fill-red-500" />
            A Special Farewell Message
          </DialogTitle>
        </DialogHeader>
        
        <div className="relative bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            src={VIDEO_URL}
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

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-close-farewell">
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
