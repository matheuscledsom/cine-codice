import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BASELINE_PATH = path.join(ROOT_DIR, '.night/baseline.json');
const CHECKPOINT_PATH = path.join(ROOT_DIR, 'PROGRESS_CHECKPOINT.json');

async function walkDist(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDist(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function measureDistAssets() {
  const files = await walkDist(DIST_DIR);
  let totalBytes = 0;
  let totalJsGzipBytes = 0;
  let initialJsGzipBytes = 0;
  let cssGzipBytes = 0;

  let indexHtml = '';
  try {
    indexHtml = await fs.readFile(path.join(DIST_DIR, 'index.html'), 'utf8');
  } catch {
    // fallback
  }

  for (const file of files) {
    const rel = path.relative(DIST_DIR, file).replace(/\\/g, '/');
    const buf = await fs.readFile(file);
    totalBytes += buf.length;

    if (rel.endsWith('.js')) {
      const gz = zlib.gzipSync(buf).length;
      totalJsGzipBytes += gz;
      const isInitialEntry =
        indexHtml.includes(rel) ||
        /^assets\/(index|vendor-react|vendor-icons)-/.test(rel);
      if (isInitialEntry) {
        initialJsGzipBytes += gz;
      }
    } else if (rel.endsWith('.css')) {
      cssGzipBytes += zlib.gzipSync(buf).length;
    }
  }

  return {
    totalBytes,
    totalJsGzipBytes,
    initialJsGzipBytes,
    cssGzipBytes,
  };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const args = new Set(process.argv.slice(2));
  const current = await measureDistAssets();

  let baseline = null;
  try {
    baseline = JSON.parse(await fs.readFile(BASELINE_PATH, 'utf8'));
  } catch {
    baseline = null;
  }

  let phaseNum = 0;
  try {
    const cp = JSON.parse(await fs.readFile(CHECKPOINT_PATH, 'utf8'));
    phaseNum = Number(cp.lastCompletedPhase) || 0;
  } catch {
    phaseNum = 0;
  }

  const strict = args.has('--strict') || phaseNum >= 5;

  if (!baseline?.dist) {
    console.log(
      `Perf budget (sem baseline ainda): total=${current.totalBytes}B, initialJsGz=${current.initialJsGzipBytes}B, cssGz=${current.cssGzipBytes}B.`
    );
    process.exit(0);
  }

  const baseInit = Number(baseline.dist.initialJsGzipBytes) || 1;
  const deltaBytes = current.initialJsGzipBytes - baseInit;
  const deltaPct = ((deltaBytes / baseInit) * 100).toFixed(2);
  const maxAllowed = Math.round(baseInit * 1.15);

  console.log(
    `Perf budget [${strict ? 'ESTRITO' : 'REGISTRO'}]: initialJsGz=${current.initialJsGzipBytes}B (baseline=${baseInit}B, delta=${deltaBytes >= 0 ? '+' : ''}${deltaBytes}B / ${deltaPct}%), cssGz=${current.cssGzipBytes}B.`
  );

  if (strict && current.initialJsGzipBytes > maxAllowed) {
    console.error(
      `ORÇAMENTO DE PERFORMANCE EXCEDIDO: ${current.initialJsGzipBytes}B > limite ${maxAllowed}B (+15% sobre baseline).`
    );
    process.exit(1);
  }
}
