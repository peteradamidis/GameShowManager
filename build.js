#!/usr/bin/env node
import { execSync } from 'child_process';

console.log('🔨 Building application...');

const isProduction = process.env.NODE_ENV === 'production' || !process.env.REPL_ID;

if (isProduction) {
  console.log('📍 Production build detected - using clean Vite config');
  
  try {
    console.log('📦 Building client...');
    execSync('npx vite build --config vite.config.prod.ts', { stdio: 'inherit' });
    
    console.log('📦 Building server...');
    execSync('npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit' });
    
    console.log('✅ Production build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('📍 Development build detected - using standard Vite config');
  
  try {
    console.log('📦 Building client...');
    execSync('npx vite build', { stdio: 'inherit' });
    
    console.log('📦 Building server...');
    execSync('npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit' });
    
    console.log('✅ Development build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}
