#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read version from manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const version = manifest.version;

const distDir = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'releases');
const zipName = `chat4o-ai-plugin-v${version}.zip`;
const zipPath = path.join(releaseDir, zipName);

console.log('🚀 Starting Chrome extension packaging...\n');

// Clean and build
console.log('📦 Building extension...');
try {
  execSync('pnpm run build', { cwd: rootDir, stdio: 'inherit' });
  console.log('✅ Build completed\n');
} catch (error) {
  console.error('❌ Build failed');
  process.exit(1);
}

// Check if dist exists
if (!fs.existsSync(distDir)) {
  console.error('❌ dist/ directory not found');
  process.exit(1);
}

// Create releases directory
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
  console.log('📁 Created releases/ directory');
}

// Create zip file
console.log(`📦 Creating ${zipName}...`);
try {
  // Use native zip command (works on macOS and Linux)
  execSync(`cd dist && zip -r "${zipPath}" . -x "*.DS_Store"`, {
    cwd: rootDir,
    stdio: 'inherit'
  });
  console.log('✅ Package created successfully\n');
} catch (error) {
  console.error('❌ Failed to create zip file');
  process.exit(1);
}

// Show summary
const stats = fs.statSync(zipPath);
const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✨ Packaging completed!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📦 Package: ${zipName}`);
console.log(`📍 Location: ${zipPath}`);
console.log(`📊 Size: ${sizeInMB} MB`);
console.log(`🔖 Version: ${version}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
