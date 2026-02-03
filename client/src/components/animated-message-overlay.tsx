import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

interface AnimatedMessageConfig {
  enabled: boolean;
  messageText: string;
  animationStyle: 'fade' | 'slide' | 'zoom';
  textStyle: 'simple' | 'bounce' | 'wave' | 'typewriter';
  colorTheme: 'gold' | 'red-orange' | 'blue-purple' | 'rainbow' | 'custom';
  customColor?: string;
  backgroundPattern: 'none' | 'sparkles' | 'stars' | 'particles';
  showConfetti: boolean;
}

// Color theme definitions
const colorThemes = {
  gold: {
    gradient: 'from-amber-600 via-yellow-500 to-amber-600',
    cardBg: 'from-amber-50 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/20',
    border: 'border-amber-400/50',
    accent: '#d97706',
    hintText: 'text-amber-700 dark:text-amber-300'
  },
  'red-orange': {
    gradient: 'from-red-600 via-orange-500 to-red-600',
    cardBg: 'from-red-50 to-orange-100 dark:from-red-900/30 dark:to-orange-900/20',
    border: 'border-orange-400/50',
    accent: '#ea580c',
    hintText: 'text-orange-700 dark:text-orange-300'
  },
  'blue-purple': {
    gradient: 'from-blue-600 via-purple-500 to-blue-600',
    cardBg: 'from-blue-50 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/20',
    border: 'border-purple-400/50',
    accent: '#7c3aed',
    hintText: 'text-purple-700 dark:text-purple-300'
  },
  rainbow: {
    gradient: 'from-red-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500',
    cardBg: 'from-pink-50 via-yellow-50 to-cyan-50 dark:from-pink-900/20 via-yellow-900/20 dark:to-cyan-900/20',
    border: 'border-pink-400/50',
    accent: '#ec4899',
    hintText: 'text-pink-700 dark:text-pink-300'
  },
  custom: {
    gradient: '',
    cardBg: 'from-gray-50 to-gray-100 dark:from-gray-900/30 dark:to-gray-800/20',
    border: 'border-gray-400/50',
    accent: '#6b7280',
    hintText: 'text-gray-700 dark:text-gray-300'
  }
};

// Sparkle component for background pattern
function Sparkles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-white rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0.5, 1.5, 0.5],
          }}
          transition={{
            duration: 1.5 + Math.random(),
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
    </div>
  );
}

// Floating stars component
function FloatingStars() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-yellow-400/60"
          style={{
            left: `${10 + Math.random() * 80}%`,
            top: `${10 + Math.random() * 80}%`,
            fontSize: `${12 + Math.random() * 16}px`,
          }}
          animate={{
            y: [0, -20, 0],
            x: [0, Math.random() > 0.5 ? 10 : -10, 0],
            rotate: [0, 360],
            opacity: [0.3, 0.8, 0.3],
          }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        >
          ★
        </motion.div>
      ))}
    </div>
  );
}

// Particles component
function Particles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 15 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-gradient-to-r from-white/40 to-white/20"
          style={{
            left: `${Math.random() * 100}%`,
            width: `${4 + Math.random() * 8}px`,
            height: `${4 + Math.random() * 8}px`,
          }}
          initial={{ top: '100%', opacity: 0 }}
          animate={{
            top: '-10%',
            opacity: [0, 0.6, 0],
          }}
          transition={{
            duration: 4 + Math.random() * 3,
            repeat: Infinity,
            delay: Math.random() * 3,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
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
  const colorTheme = config.colorTheme || 'gold';
  const backgroundPattern = config.backgroundPattern || 'none';
  const theme = colorThemes[colorTheme] || colorThemes.gold;
  
  // For custom color, generate inline styles
  const customColorStyle = colorTheme === 'custom' && config.customColor 
    ? { background: `linear-gradient(to right, ${config.customColor}, ${config.customColor})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
    : {};

  // Split text into words for animated styles
  const words = config.messageText.split(' ');
  
  // Get gradient class based on theme
  const getTextGradientClass = () => {
    if (colorTheme === 'custom') return '';
    return `bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`;
  };
  
  // Render background pattern
  const renderBackgroundPattern = () => {
    switch (backgroundPattern) {
      case 'sparkles': return <Sparkles />;
      case 'stars': return <FloatingStars />;
      case 'particles': return <Particles />;
      default: return null;
    }
  };

  // Render text based on selected style
  const renderText = () => {
    const textClass = `text-5xl md:text-6xl font-black ${getTextGradientClass()}`;
    
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
                className={textClass}
                style={customColorStyle}
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
                className={textClass}
                style={{ 
                  display: char === ' ' ? 'inline' : 'inline-block', 
                  width: char === ' ' ? '0.5em' : 'auto',
                  ...customColorStyle 
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </motion.span>
            ))}
          </div>
        );

      case 'typewriter':
        return (
          <motion.div className="mb-6 py-4 relative">
            <div className="relative inline-block">
              <h1
                className={`${textClass} whitespace-nowrap pb-2`}
                style={{ lineHeight: 1.3, ...customColorStyle }}
              >
                {config.messageText}
              </h1>
              <motion.div
                initial={{ left: 0 }}
                animate={{ left: '100%' }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="absolute top-0 bottom-0 right-0 bg-gradient-to-br"
                style={{ 
                  background: 'inherit',
                  borderLeft: `3px solid ${theme.accent}`
                }}
              />
              <motion.div
                initial={{ width: '100%' }}
                animate={{ width: 0 }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="absolute top-0 right-0 bottom-0"
                style={{ 
                  background: colorTheme === 'gold' ? 'linear-gradient(to bottom right, #fefce8, #fef9c3)' :
                              colorTheme === 'red-orange' ? 'linear-gradient(to bottom right, #fef2f2, #ffedd5)' :
                              colorTheme === 'blue-purple' ? 'linear-gradient(to bottom right, #eff6ff, #f3e8ff)' :
                              colorTheme === 'rainbow' ? 'linear-gradient(to bottom right, #fdf2f8, #fefce8, #ecfeff)' :
                              'linear-gradient(to bottom right, #f9fafb, #f3f4f6)'
                }}
              />
              <motion.div
                initial={{ left: 0, opacity: 1 }}
                animate={{ left: 'calc(100% + 4px)', opacity: 0 }}
                transition={{ 
                  left: { duration: 1.5, ease: "easeOut" },
                  opacity: { duration: 0.3, delay: 1.5 }
                }}
                className="absolute top-0 bottom-0 w-[3px]"
                style={{ backgroundColor: theme.accent }}
              />
            </div>
          </motion.div>
        );

      default: // simple
        return (
          <motion.h1
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className={`${textClass} mb-6`}
            style={customColorStyle}
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
          className={`relative p-12 bg-gradient-to-br ${theme.cardBg} rounded-2xl shadow-2xl max-w-3xl text-center border-4 ${theme.border} overflow-hidden`}
          data-testid="card-animated-message"
        >
          {renderBackgroundPattern()}
          <div data-testid="text-animated-message" className="relative z-10">
            {renderText()}
          </div>
          {textStyle !== 'simple' && (
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1, type: "spring", damping: 10 }}
              className="flex justify-center gap-2 mb-4 relative z-10"
            >
              {['★', '✦', '★'].map((star, i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, -8, 0], rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                  className="text-2xl"
                  style={{ color: theme.accent }}
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
            className={`${theme.hintText} animate-pulse font-medium relative z-10`}
            data-testid="text-dismiss-hint"
          >
            Click anywhere to continue
          </motion.p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
