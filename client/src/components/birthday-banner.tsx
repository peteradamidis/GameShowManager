import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Cake, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BirthdayEntry } from "@shared/schema";

export function BirthdayBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const [confettiPieces, setConfettiPieces] = useState<Array<{ id: number; left: number; delay: number; duration: number; color: string }>>([]);

  const { data: birthdays } = useQuery<BirthdayEntry[]>({
    queryKey: ['/api/birthdays/today'],
    refetchInterval: 60000 * 60, // Check every hour
  });

  // Generate confetti on mount
  useEffect(() => {
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
    const pieces = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 3 + Math.random() * 2,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    setConfettiPieces(pieces);
  }, []);

  // Check if dismissed for today (using localStorage) and reset at midnight
  useEffect(() => {
    const checkDismissStatus = () => {
      const dismissedDate = localStorage.getItem('birthdayBannerDismissed');
      const today = new Date().toDateString();
      if (dismissedDate === today) {
        setIsDismissed(true);
      } else if (dismissedDate && dismissedDate !== today) {
        // It's a new day, clear the old dismiss and show banner again
        localStorage.removeItem('birthdayBannerDismissed');
        setIsDismissed(false);
      }
    };
    
    checkDismissStatus();
    
    // Check every minute for day change (handles midnight crossing while app is open)
    const interval = setInterval(checkDismissStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleDismiss = () => {
    const today = new Date().toDateString();
    localStorage.setItem('birthdayBannerDismissed', today);
    setIsDismissed(true);
  };

  if (isDismissed || !birthdays || birthdays.length === 0) {
    return null;
  }

  const names = birthdays.map(b => b.name);
  const displayText = names.length === 1 
    ? `Happy Birthday, ${names[0]}!` 
    : names.length === 2 
      ? `Happy Birthday, ${names[0]} & ${names[1]}!`
      : `Happy Birthday to ${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}!`;

  return (
    <div 
      className="relative overflow-hidden bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white"
      data-testid="birthday-banner"
    >
      {/* Animated confetti */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {confettiPieces.map((piece) => (
          <div
            key={piece.id}
            className="absolute w-2 h-2 rounded-sm animate-confetti-fall opacity-80"
            style={{
              left: `${piece.left}%`,
              backgroundColor: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
            }}
          />
        ))}
      </div>

      {/* Banner content */}
      <div className="relative flex items-center justify-center gap-4 px-4 py-3">
        <PartyPopper className="w-6 h-6 animate-bounce" />
        <div className="flex items-center gap-2">
          <Cake className="w-5 h-5" />
          <span className="text-lg font-bold tracking-wide animate-pulse">
            {displayText}
          </span>
          <Cake className="w-5 h-5" />
        </div>
        <PartyPopper className="w-6 h-6 animate-bounce" style={{ animationDelay: '0.5s' }} />
        
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white"
          onClick={handleDismiss}
          data-testid="dismiss-birthday-banner"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Sparkle animation style */}
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(-10px) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100px) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti-fall {
          animation: confetti-fall linear infinite;
        }
      `}</style>
    </div>
  );
}
