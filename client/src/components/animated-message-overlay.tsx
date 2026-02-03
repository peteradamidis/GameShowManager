import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

interface AnimatedMessageConfig {
  enabled: boolean;
  messageText: string;
  animationStyle: 'fade' | 'slide' | 'zoom';
  showConfetti: boolean;
}

export function AnimatedMessageOverlay({ config }: { config: AnimatedMessageConfig | null }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (config?.enabled) {
      const hasSeen = sessionStorage.getItem('hasSeenWelcomeMessage');
      if (!hasSeen) {
        setIsVisible(true);
        if (config.showConfetti) {
          confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            zIndex: 1000
          });
        }
      }
    }
  }, [config]);

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem('hasSeenWelcomeMessage', 'true');
  };

  if (!config || !isVisible) return null;

  const animationVariants = {
    fade: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 }
    },
    slide: {
      initial: { opacity: 0, y: 100 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -100 }
    },
    zoom: {
      initial: { opacity: 0, scale: 0.5 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 1.5 }
    }
  };

  const selectedVariant = animationVariants[config.animationStyle] || animationVariants.fade;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleDismiss}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
      >
        <motion.div
          initial={selectedVariant.initial}
          animate={selectedVariant.animate}
          exit={selectedVariant.exit}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="relative p-12 bg-white rounded-2xl shadow-2xl max-w-2xl text-center"
        >
          <h1 className="text-5xl font-bold text-primary mb-4 leading-tight">
            {config.messageText}
          </h1>
          <p className="text-muted-foreground animate-pulse">
            Click anywhere to continue
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
