#!/usr/bin/env node
/**
 * RectoBase — Vercel Build Pre-script
 * Runs BEFORE npm install + deploy.
 *
 * What it does:
 * 1. Installs backend node_modules into /tmp/backend_node_modules
 * 2. Copies backend/src/ into api/_src/ so Vercel can bundle it with api/index.js
 * 3. Copies production/sql/001_schema.sql into api/ for reference
 *
 * Vercel runs this from project root (/vercel/path0/), so:
 *   BACKEND_SRC  = ./backend/src
 *   TARGET_DIR   = ./api/_src
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname; // /vercel/path0/scripts
const PROJECT_ROOT = path.join(ROOT, '..');
const BACKEND_SRC = path.join(PROJECT_ROOT, 'backend', 'src');
const TARGET_DIR = path.join(PROJECT_ROOT, 'api', '_src');

console.log('[prebuild] RectoBase — starting build prep...');
console.log('[prebuild] Backend src:', BACKEND_SRC);
console.log('[prebuild] Target dir:', TARGET_DIR);

// Clean previous _src
if (fs.existsSync(TARGET_DIR)) {
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  console.log('[prebuild] Removed existing _src/');
}

// Copy backend/src → api/_src/
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[prebuild] Source not found: ${src} — skipping`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(BACKEND_SRC, TARGET_DIR);
console.log(`[prebuild] Copied backend/src → api/_src/`);

// Patch require paths in copied files so they reference '_src' instead of 'backend/src'
function patchRequires(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchRequires(full);
    } else if (entry.name.endsWith('.js')) {
      let content = fs.readFileSync(full, 'utf8');
      const patched = content.replace(
        /require\(['"]\.\.\/(\.\.\/)?backend\/src/g,
        "require('./_src"
      ).replace(
        /require\(['"]backend\/src\//g,
        "require('./_src/"
      );
      if (patched !== content) {
        fs.writeFileSync(full, patched);
        console.log(`[prebuild] Patched: ${path.relative(PROJECT_ROOT, full)}`);
      }
    }
  }
}

patchRequires(TARGET_DIR);
console.log('[prebuild] All require paths patched.');

// Copy schema
const schemaSrc = path.join(PROJECT_ROOT, 'production', 'sql', '001_schema.sql');
const schemaDest = path.join(PROJECT_ROOT, 'api', '_schema.sql');
if (fs.existsSync(schemaSrc)) {
  fs.copyFileSync(schemaSrc, schemaDest);
  console.log('[prebuild] Copied 001_schema.sql → api/_schema.sql');
}

console.log('[prebuild] Build prep complete ✓');
