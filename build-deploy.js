// build-deploy.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Temporarily rename the original vite.config.ts
console.log('Backing up original vite.config.ts...');
if (fs.existsSync('vite.config.ts')) {
  fs.renameSync('vite.config.ts', 'vite.config.ts.original');
}

// Copy our deployment config to vite.config.ts
console.log('Creating deployment vite config...');
if (fs.existsSync('vite.config.deploy.ts')) {
  fs.copyFileSync('vite.config.deploy.ts', 'vite.config.ts');
}

try {
  // Run the build
  console.log('Building client...');
  execSync('vite build', { stdio: 'inherit' });
  
  console.log('Building server...');
  execSync('esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit' });
  
  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
} finally {
  // Restore the original vite.config.ts
  console.log('Restoring original vite.config.ts...');
  if (fs.existsSync('vite.config.ts.original')) {
    if (fs.existsSync('vite.config.ts')) {
      fs.unlinkSync('vite.config.ts');
    }
    fs.renameSync('vite.config.ts.original', 'vite.config.ts');
  }
}
