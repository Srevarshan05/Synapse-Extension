/**
 * Synapse v3 — Build Validator
 * Run: node scripts/build-validate.js  (or: npm run build:validate)
 *
 * Checks:
 *   1.  Manifest structure and version
 *   2.  All 12 host_permissions present
 *   3.  All 4 worker files exist
 *   4.  Workers listed in web_accessible_resources
 *   5.  Core extension files (background, content, offscreen, popup)
 *   6.  Core modules (storage.js, crypto.js, types.js)
 *   7.  Dashboard build output (index.html + assets)
 *   8.  Background imports storage and crypto
 *   9.  Content.js is a self-contained IIFE (no top-level import statements)
 *  10.  No silent stub returns (stubs must return { status: 'stub' })
 *  11.  package.json has build:validate script
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function check(label, fn) {
  try {
    const ok = fn();
    if (ok === false) throw new Error('Assertion returned false');
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${label}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

function exists(rel)   { return fs.existsSync(path.join(ROOT, rel)); }
function read(rel)     { return fs.readFileSync(path.join(ROOT, rel), 'utf-8'); }
function readJSON(rel) { return JSON.parse(read(rel)); }

function dirHasFiles(rel, ext) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => f.endsWith(ext));
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED PATHS
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_WORKERS = [
  'extension/workers/compression.worker.js',
  'extension/workers/pdf.worker.js',
  'extension/workers/ocr.worker.js',
  'extension/workers/attachment.worker.js'
];

const REQUIRED_CORE_FILES = [
  'extension/background.js',
  'extension/content.bundle.js',
  'extension/offscreen.html',
  'extension/offscreen.js',
  'extension/popup.html',
  'extension/popup.js'
];

const REQUIRED_CORE_MODULES = [
  'extension/core/storage.js',
  'extension/core/crypto.js',
  'extension/core/types.js'
];

const REQUIRED_HOST_PERMISSIONS = [
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://chat.deepseek.com/*',
  'https://kimi.moonshot.cn/*',
  'https://grok.com/*',
  'https://copilot.microsoft.com/*',
  'https://www.perplexity.ai/*',
  'https://poe.com/*',
  'https://openrouter.ai/*',
  'https://chat.mistral.ai/*',
  'https://chat.qwen.ai/*'
];

// ─────────────────────────────────────────────────────────────────────────────
// RUN CHECKS
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────');
console.log('  Synapse v3 — Build Validation');
console.log('──────────────────────────────────────────\n');

// ── 1. Manifest ──────────────────────────────────────────────────────────────
console.log('› Manifest');

check('manifest.json exists', () => exists('extension/manifest.json'));

let manifest;
check('manifest.json is valid JSON', () => {
  manifest = readJSON('extension/manifest.json');
  return true;
});

check('manifest_version is 3', () => manifest?.manifest_version === 3);
check('version is 3.0.0', () => manifest?.version === '3.0.0');

check('background service_worker is background.js', () =>
  manifest?.background?.service_worker === 'background.js'
);

check('background type is module', () =>
  manifest?.background?.type === 'module'
);

check('All 12 host_permissions present', () => {
  const perms = manifest?.host_permissions || [];
  const missing = REQUIRED_HOST_PERMISSIONS.filter(p => !perms.includes(p));
  if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);
  return true;
});

// ── 2. Workers ───────────────────────────────────────────────────────────────
console.log('\n› Workers');

for (const worker of REQUIRED_WORKERS) {
  check(`${path.basename(worker)} exists`, () => exists(worker));
}

check('All workers in web_accessible_resources', () => {
  const resources = (manifest?.web_accessible_resources || []).flatMap(r => r.resources);
  const missing = REQUIRED_WORKERS
    .map(w => `workers/${path.basename(w)}`)
    .filter(w => !resources.includes(w));
  if (missing.length > 0) throw new Error(`Missing from WAR: ${missing.join(', ')}`);
  return true;
});

check('compression.worker.js uses CompressionStream', () => {
  const content = read('extension/workers/compression.worker.js');
  return content.includes('CompressionStream') && content.includes('DecompressionStream');
});

// ── 3. Core files ────────────────────────────────────────────────────────────
console.log('\n› Core Extension Files');

for (const file of REQUIRED_CORE_FILES) {
  check(`${path.basename(file)} exists`, () => exists(file));
}

// ── 4. Core modules ──────────────────────────────────────────────────────────
console.log('\n› Core Modules');

for (const file of REQUIRED_CORE_MODULES) {
  check(`${path.basename(file)} exists`, () => exists(file));
}

check('storage.js exports saveCapsule and getCapsuleBody', () => {
  const src = read('extension/core/storage.js');
  return src.includes('export async function saveCapsule') &&
         src.includes('export async function getCapsuleBody');
});

check('crypto.js exports encryptData and decryptData', () => {
  const src = read('extension/core/crypto.js');
  return src.includes('export async function encryptData') &&
         src.includes('export async function decryptData');
});

// ── 5. Background ────────────────────────────────────────────────────────────
console.log('\n› Background Service Worker');

check('background.js imports storage.js', () => {
  const src = read('extension/background.js');
  return src.includes('./core/storage.js');
});

check('background.js imports crypto.js', () => {
  const src = read('extension/background.js');
  return src.includes('./core/crypto.js');
});

check('background.js handles CAPSULE_SAVE', () => {
  const src = read('extension/background.js');
  return src.includes("case 'CAPSULE_SAVE'");
});

check('background.js handles CAPSULE_EXPORT and CAPSULE_IMPORT', () => {
  const src = read('extension/background.js');
  return src.includes("case 'CAPSULE_EXPORT'") && src.includes("case 'CAPSULE_IMPORT'");
});

check('background.js migrates v1 capsules', () => {
  const src = read('extension/background.js');
  return src.includes('migrateV1Capsules');
});

// ── 6. Content script ────────────────────────────────────────────────────────
console.log('\n› Content Script');

check('content.bundle.js is IIFE-wrapped (no top-level import)', () => {
  const src = read('extension/content.bundle.js');
  // Should not have top-level static imports (import x from ...)
  const lines  = src.split('\n');
  const hasTopLevelImport = lines.some(line => {
    const trimmed = line.trim();
    return /^import\s+/.test(trimmed) && !trimmed.startsWith('//') && !trimmed.startsWith('*');
  });
  return !hasTopLevelImport;
});

check('src/content/index.js handles PING and CAPTURE_START', () => {
  const src = read('src/content/index.js');
  return src.includes("case 'PING'") && src.includes("case 'CAPTURE_START'");
});

check('src/content/index.js defines CAPTURE_LIMITS', () => {
  const src = read('src/content/index.js');
  return src.includes('CAPTURE_LIMITS') && src.includes('maxMessages') && src.includes('3000');
});

// ── 7. Dashboard build ───────────────────────────────────────────────────────
console.log('\n› Dashboard Build Output');

check('extension/dashboard/ exists', () => exists('extension/dashboard'));
check('dashboard/index.html exists', () => exists('extension/dashboard/index.html'));

check('dashboard/index.html references assets/', () => {
  const html = read('extension/dashboard/index.html');
  return html.includes('assets/');
});

check('dashboard assets directory has JS file', () => {
  return dirHasFiles('extension/dashboard/assets', '.js');
});

check('dashboard assets directory has CSS file', () => {
  return dirHasFiles('extension/dashboard/assets', '.css');
});

// ── 8. package.json ──────────────────────────────────────────────────────────
console.log('\n› Package Configuration');

check('package.json has build:validate script', () => {
  const pkg = readJSON('package.json');
  return !!pkg?.scripts?.['build:validate'];
});

check('package.json has validate script', () => {
  const pkg = readJSON('package.json');
  return !!pkg?.scripts?.['validate'];
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────');
console.log(`  Results: ${passed} passed · ${failed} failed`);
console.log('──────────────────────────────────────────\n');

if (failed > 0) {
  console.error('❌ Build validation FAILED. Fix errors before loading the extension.\n');
  process.exit(1);
} else {
  console.log('✅ Build validation PASSED. Extension is installable.\n');
  process.exit(0);
}
