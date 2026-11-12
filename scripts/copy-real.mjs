/**
 * scripts/copy-real.mjs
 * --------------------
 * Copies web/public/real/ (where Python exports SPHEREx QR2 files)
 * into public/real/ (served by Vite at /real/*).
 * Windows compatible and safe if web/public/real does not yet exist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'web', 'public', 'real');
const destDir = path.join(rootDir, 'public', 'real');

try {
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log(`[copy-real] Synchronized real SPHEREx data from ${srcDir} to ${destDir}`);
  } else {
    console.log('[copy-real] web/public/real does not exist yet; skipping copy (synthetic fallback will be used until export is run).');
  }
} catch (err) {
  console.warn('[copy-real] Warning copying real data:', err.message);
}
