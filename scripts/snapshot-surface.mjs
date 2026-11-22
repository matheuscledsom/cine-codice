import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = process.cwd();
const BASELINE_PATH = path.join(ROOT_DIR, '.night/surface-baseline.json');

async function walkFiles(dir, extRegex) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath, extRegex)));
    } else if (extRegex.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function extractExportsFromSource(source) {
  const names = new Set();
  const declRegex =
    /^\s*export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m;
  while ((m = declRegex.exec(source)) !== null) {
    names.add(m[1]);
  }
  const braceRegex = /export\s*\{([^}]+)\}/g;
  while ((m = braceRegex.exec(source)) !== null) {
    m[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const asMatch = part.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
        names.add(asMatch ? asMatch[1] : part);
      });
  }
  if (/^\s*export\s+default\b/m.test(source)) {
    names.add('default');
  }
  return Array.from(names).sort();
}

async function collectSurfaceSnapshot() {
  const servicesDir = path.join(ROOT_DIR, 'src/services');
  const serviceFiles = await walkFiles(servicesDir, /\.js$/);
  const serviceExports = {};

  for (const file of serviceFiles) {
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    const code = await fs.readFile(file, 'utf8');
    serviceExports[rel] = extractExportsFromSource(code);
  }

  const allSrcFiles = await walkFiles(path.join(ROOT_DIR, 'src'), /\.(js|jsx)$/);
  const localStorageKeys = new Set();
  const indexedDbStores = new Set();

  for (const file of allSrcFiles) {
    const code = await fs.readFile(file, 'utf8');

    const storageLitRegex =
      /localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = storageLitRegex.exec(code)) !== null) {
      localStorageKeys.add(m[1]);
    }

    const keyConstRegex =
      /(?:STORAGE_KEY|KEY|DB_KEY)\s*[:=]\s*['"`]([a-zA-Z0-9_.:-]+)['"`]/g;
    while ((m = keyConstRegex.exec(code)) !== null) {
      if (m[1].includes('_') || m[1].includes('.')) {
        localStorageKeys.add(m[1]);
      }
    }

    const storeRegex =
      /(?:createObjectStore|objectStore)\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = storeRegex.exec(code)) !== null) {
      indexedDbStores.add(m[1]);
    }

    const dbNameRegex =
      /(?:DB_NAME|STORE_NAME)\s*=\s*['"`]([^'"`]+)['"`]/g;
    while ((m = dbNameRegex.exec(code)) !== null) {
      indexedDbStores.add(m[1]);
    }
  }

  const domainCfgUrl = `${pathToFileURL(path.join(ROOT_DIR, 'src/config/domainConfig.js')).href}?t=${Date.now()}`;
  const { domainConfig } = await import(domainCfgUrl);
  const routes = (domainConfig?.navigation || []).map((item) => item.id).sort();
  if (domainConfig?.storageKey) localStorageKeys.add(domainConfig.storageKey);
  if (domainConfig?.streakStorageKey) localStorageKeys.add(domainConfig.streakStorageKey);

  return {
    generatedAt: new Date().toISOString(),
    serviceExports,
    localStorageKeys: Array.from(localStorageKeys).sort(),
    indexedDbStores: Array.from(indexedDbStores).sort(),
    routes,
  };
}

function compareSurfaces(baseline, current) {
  const regressions = [];

  for (const [file, expectedExports] of Object.entries(baseline.serviceExports || {})) {
    const actual = new Set(current.serviceExports?.[file] || []);
    if (!current.serviceExports?.[file]) {
      regressions.push(`Arquivo de serviço removido ou movido: ${file}`);
      continue;
    }
    for (const sym of expectedExports) {
      if (!actual.has(sym)) {
        regressions.push(`Export removido de ${file}: ${sym}`);
      }
    }
  }

  const curStorage = new Set(current.localStorageKeys || []);
  for (const key of baseline.localStorageKeys || []) {
    if (!curStorage.has(key)) {
      regressions.push(`Chave de localStorage removida: ${key}`);
    }
  }

  const curStores = new Set(current.indexedDbStores || []);
  for (const store of baseline.indexedDbStores || []) {
    if (!curStores.has(store)) {
      regressions.push(`Object store / DB IndexedDB removido: ${store}`);
    }
  }

  const curRoutes = new Set(current.routes || []);
  for (const route of baseline.routes || []) {
    if (!curRoutes.has(route)) {
      regressions.push(`Aba/rota removida: ${route}`);
    }
  }

  return regressions;
}

const args = new Set(process.argv.slice(2));
const snapshot = await collectSurfaceSnapshot();

if (args.has('--save')) {
  await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    `Surface baseline salva: ${Object.keys(snapshot.serviceExports).length} serviços, ${snapshot.localStorageKeys.length} chaves localStorage, ${snapshot.indexedDbStores.length} stores IndexedDB, ${snapshot.routes.length} abas.`
  );
} else if (args.has('--compare')) {
  const rawBase = await fs.readFile(BASELINE_PATH, 'utf8');
  const baseline = JSON.parse(rawBase);
  const regressions = compareSurfaces(baseline, snapshot);
  if (regressions.length > 0) {
    console.error('REGRESSÃO NA SUPERFÍCIE PÚBLICA DETECTADA:');
    regressions.forEach((line) => console.error(` - ${line}`));
    process.exit(1);
  }
  console.log('Contrato de não-regressão aprovado (nenhum export, chave, store ou rota removida).');
} else {
  console.log(JSON.stringify(snapshot, null, 2));
}
