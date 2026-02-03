import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

interface AnimatedMessageConfig {
  enabled: boolean;
  messageText: string;
  animationStyle: 'fade' | 'slide' | 'zoom';
  textStyle: 'simple' | 'bounce' | 'wave' | 'typewriter';
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
  const textStyle = config.textStyle || 'simple';

  // Split text into words for animated styles
  const words = config.messageText.split(' ');

  // Render text based on selected style
  const renderText = () => {
    switch (textStyle) {
      case 'bounce':
        return (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.3 } }
            }}
            className="flex flex-wrap justify-center gap-3 mb-6"
          >
            {words.map((word, index) => (
              <motion.span
                key={index}
                variants={{
                  hidden: { opacity: 0, y: 50, scale: 0.5 },
                  visible: { 
                    opacity: 1, y: 0, scale: 1,
                    transition: { type: "spring", damping: 10, stiffness: 200 }
                  }
                }}
                className="text-5xl md:text-6xl font-black bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 bg-clip-text text-transparent"
              >
                {word}
              </motion.span>
            ))}
          </motion.div>
        );

      case 'wave':
        return (
          <div className="flex flex-wrap justify-center gap-1 mb-6">
            {config.messageText.split('').map((char, index) => (
              <motion.span
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ 
                  opacity: 1, 
                  y: [0, -15, 0],
                }}
                transition={{ 
                  opacity: { delay: index * 0.03, duration: 0.3 },
                  y: { delay: 0.5 + index * 0.05, duration: 0.6, repeat: Infinity, repeatDelay: 2 }
                }}
                className="text-5xl md:text-6xl font-black bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 bg-clip-text text-transparent"
                style={{ display: char === ' ' ? 'inline' : 'inline-block', width: char === ' ' ? '0.5em' : 'auto' }}
              >
                {char === ' ' ? '\u00A0' : char}
              </motion.span>
            ))}
          </div>
        );

      case 'typewriter':
        return (
          <motion.div className="mb-6 overflow-hidden">
            <motion.h1
              initial={{ width: 0 }}
              animate={{ width: "100%" }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="text-5xl md:text-6xl font-black bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 bg-clip-text text-transparent whitespace-nowrap overflow-hidden"
              style={{ borderRight: "3px solid #d97706" }}
            >
              {config.messageText}
            </motion.h1>
          </motion.div>
        );

      default: // simple
        return (
          <motion.h1
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-5xl md:text-6xl font-black text-primary mb-6"
          >
            {config.messageText}
          </motion.h1>
        );
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleDismiss}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
        data-testid="overlay-animated-message"
      >
        <motion.div
          initial={selectedVariant.initial}
          animate={selectedVariant.animate}
          exit={selectedVariant.exit}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="relative p-12 bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/20 rounded-2xl shadow-2xl max-w-3xl text-center border-4 border-amber-400/50"
          data-testid="card-animated-message"
        >
          <div data-testid="text-animated-message">
            {renderText()}
          </div>
          {textStyle !== 'simple' && (
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1, type: "spring", damping: 10 }}
              className="flex justify-center gap-2 mb-4"
            >
              {['⭐', '✨', '⭐'].map((star, i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, -8, 0], rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                  className="text-2xl"
                >
                  {star}
                </motion.span>
              ))}
            </motion.div>
          )}
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: textStyle === 'simple' ? 0.8 : 1.5 }}
            className="text-amber-700 dark:text-amber-300 animate-pulse font-medium" 
            data-testid="text-dismiss-hint"
          >
            Click anywhere to continue
          </motion.p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
