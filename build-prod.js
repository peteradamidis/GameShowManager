#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building for production (Digital Ocean)...');

// Create dist directory
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

try {
  // Build client using production Vite config (no Replit plugins)
  console.log('📦 Building client...');
  execSync('vite build --config vite.config.prod.ts', { stdio: 'inherit' });
  
  // Build server with esbuild
  console.log('📦 Building server...');
  execSync('esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit' });
  
  console.log('✅ Build completed successfully!');
  console.log('📂 Output: dist/');
  console.log('   - dist/public/ (frontend)');
  console.log('   - dist/index.js (server)');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
