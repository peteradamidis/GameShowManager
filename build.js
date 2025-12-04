#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building application...');

// Detect if we're in a production-like environment (Digital Ocean, etc)
const isProduction = process.env.NODE_ENV === 'production' || !process.env.REPL_ID;

if (isProduction) {
  console.log('📍 Production build detected - using clean Vite config');
  
  // Use production config
  try {
    console.log('📦 Building client...');
    execSync('vite build --config vite.config.prod.ts', { stdio: 'inherit' });
    
    console.log('📦 Building server...');
    execSync('esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit' });
    
    console.log('✅ Production build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('📍 Development build detected - using standard Vite config');
  
  // Use standard config (with Replit plugins)
  try {
    console.log('📦 Building client...');
    execSync('vite build', { stdio: 'inherit' });
    
    console.log('📦 Building server...');
    execSync('esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit' });
    
    console.log('✅ Development build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}
