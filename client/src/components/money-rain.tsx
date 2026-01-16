import { useState, useEffect } from "react";
import { DollarSign } from "lucide-react";

interface MoneyBill {
  id: number;
  left: number;
  delay: number;
  duration: number;
  rotation: number;
  size: number;
}

interface MoneyRainProps {
  isActive: boolean;
  onComplete: () => void;
}

export function MoneyRain({ isActive, onComplete }: MoneyRainProps) {
  const [bills, setBills] = useState<MoneyBill[]>([]);

  useEffect(() => {
    if (isActive) {
      const newBills: MoneyBill[] = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2 + Math.random() * 2,
        rotation: Math.random() * 360,
        size: 20 + Math.random() * 20,
      }));
      setBills(newBills);

      const timer = setTimeout(() => {
        setBills([]);
        onComplete();
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [isActive, onComplete]);

  if (!isActive || bills.length === 0) return null;

  return (
    <div 
      className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden"
      data-testid="money-rain-container"
    >
      {bills.map((bill) => (
        <div
          key={bill.id}
          className="absolute animate-fall"
          style={{
            left: `${bill.left}%`,
            animationDelay: `${bill.delay}s`,
            animationDuration: `${bill.duration}s`,
          }}
        >
          <div 
            className="relative"
            style={{
              transform: `rotate(${bill.rotation}deg)`,
              animation: `spin ${bill.duration}s linear infinite`,
            }}
          >
            <div 
              className="bg-green-500 rounded-sm flex items-center justify-center shadow-lg border border-green-600"
              style={{
                width: bill.size * 2,
                height: bill.size,
              }}
            >
              <DollarSign 
                className="text-green-100" 
                style={{ width: bill.size * 0.6, height: bill.size * 0.6 }}
              />
            </div>
          </div>
        </div>
      ))}
      
      <style>{`
        @keyframes fall {
          0% {
            transform: translateY(-100px);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translateY(100vh);
            opacity: 0;
          }
        }
        
        @keyframes spin {
          0% {
            transform: rotateY(0deg) rotateZ(0deg);
          }
          100% {
            transform: rotateY(360deg) rotateZ(20deg);
          }
        }
        
        .animate-fall {
          animation: fall 3s ease-in forwards;
        }
      `}</style>
    </div>
  );
}
