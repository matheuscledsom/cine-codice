import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT_DIR = process.cwd();
const SCREENS_DIR = path.join(ROOT_DIR, '.night/screens');
const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
];

const TABS = [
  { id: 'home', labelMatch: /in[ií]cio/i },
  { id: 'list', labelMatch: /acervo|estante/i },
  { id: 'add', labelMatch: /catalogar/i },
  { id: 'stats', labelMatch: /m[eé]tricas|estat/i },
  { id: 'community', labelMatch: /rede|comunidade/i },
  { id: 'profile', labelMatch: /perfil/i },
];

const DEFAULT_THEMES = [
  { id: 'oled', storage: { mode: 'oled', font: 'inter', texture: 'clean' } },
  {
    id: 'pastel-glass',
    storage: {
      mode: 'oled',
      font: 'inter',
      texture: 'clean',
      specialThemeId: 'pastel-glass',
      pastelSubpaletteId: 'lavender-rose',
    },
  },
];

const ALL_THEMES = [
  ...DEFAULT_THEMES,
  { id: 'parchment', storage: { mode: 'parchment', font: 'literata', texture: 'paper' } },
  { id: 'windows-xp', storage: { mode: 'oled', specialThemeId: 'windows-xp' } },
  { id: 'windows-7', storage: { mode: 'oled', specialThemeId: 'windows-7' } },
  { id: 'frutiger-aero', storage: { mode: 'oled', specialThemeId: 'frutiger-aero' } },
  { id: 'manga-ink', storage: { mode: 'oled', specialThemeId: 'manga-ink' } },
  { id: 'focus-dim', storage: { mode: 'oled', specialThemeId: 'focus-dim' } },
];

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor vite preview não respondeu em ${timeoutMs}ms`);
}

function startPreviewServer() {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT_DIR,
    stdio: 'ignore',
    detached: false,
  });
}

async function resolveExecutablePath() {
  const candidates = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continue
    }
  }
  return undefined;
}

const args = new Set(process.argv.slice(2));
const themesToRun = args.has('--all-themes') ? ALL_THEMES : DEFAULT_THEMES;

await fs.mkdir(SCREENS_DIR, { recursive: true });
const server = startPreviewServer();
let browser = null;

try {
  await waitForServer(BASE_URL);
  const executablePath = await resolveExecutablePath();
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
  });

  const issues = [];
  let checksCount = 0;

  for (const theme of themesToRun) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });

      await context.addInitScript((themeObj) => {
        localStorage.setItem(
          'mlpd_livros_profile',
          JSON.stringify({
            id: 'local-smoke',
            handle: '@leitor_smoke',
            displayName: 'Leitor Smoke',
            onboardingCompleted: true,
            preferredCriteria: ['plot'],
            favoriteGenres: ['Literatura Clássica', 'Fantasia'],
            annualGoal: 12,
          })
        );
        localStorage.setItem('mlpd_livros_theme', JSON.stringify(themeObj));
      }, theme.storage);

      const page = await context.newPage();
      const consoleErrors = [];
      const badLocalResponses = [];
      let sawExternalFallback404 = false;

      page.on('response', (res) => {
        if (res.status() >= 400) {
          const url = res.url();
          if (url.startsWith(BASE_URL)) {
            badLocalResponses.push(`${res.status()} ${url}`);
          } else if (url.includes('covers.openlibrary.org') && res.status() === 404) {
            sawExternalFallback404 = true;
          }
        }
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const txt = msg.text();
          if (
            sawExternalFallback404 &&
            badLocalResponses.length === 0 &&
            txt.includes('status of 404')
          ) {
            return;
          }
          consoleErrors.push(txt);
        }
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(err.message);
      });

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });

      for (const tab of TABS) {
        if (tab.id !== 'home') {
          const navBtn = page.locator('nav button').filter({ hasText: tab.labelMatch }).first();
          if ((await navBtn.count()) > 0) {
            await navBtn.click();
            await page.waitForTimeout(120);
          }
        }

        const metrics = await page.evaluate(() => {
          const scrollW = document.documentElement.scrollWidth;
          const innerW = window.innerWidth;
          const badTargets = [];
          const candidates = document.querySelectorAll('nav button, button.bg-accent');
          candidates.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            if (rect.height < 42 && rect.width < 42) {
              badTargets.push({
                text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              });
            }
          });
          return { scrollW, innerW, badTargets };
        });

        checksCount += 1;
        if (metrics.scrollW > metrics.innerW + 1) {
          issues.push(
            `[${theme.id} ${vp.name} ${tab.id}] scroll horizontal: scrollWidth=${metrics.scrollW} > innerWidth=${metrics.innerW}`
          );
        }
        if (metrics.badTargets.length > 0) {
          issues.push(
            `[${theme.id} ${vp.name} ${tab.id}] alvos < 44px: ${JSON.stringify(metrics.badTargets.slice(0, 3))}`
          );
        }

        if (vp.name === '390x844' || (vp.name === '1280x800' && tab.id === 'home')) {
          await page.screenshot({
            path: path.join(SCREENS_DIR, `${theme.id}-${vp.name}-${tab.id}.png`),
            fullPage: false,
          });
        }
      }

      if (badLocalResponses.length > 0) {
        issues.push(`[${theme.id} ${vp.name}] HTTP erro local: ${badLocalResponses.join(' | ')}`);
      }
      if (consoleErrors.length > 0) {
        issues.push(`[${theme.id} ${vp.name}] erros de console: ${consoleErrors.join(' | ')}`);
      }

      await context.close();
    }
  }

  if (issues.length > 0) {
    console.error('FALHAS NO SMOKE VISUAL:');
    issues.forEach((i) => console.error(` - ${i}`));
    process.exit(1);
  }

  console.log(
    `Smoke visual aprovado: ${checksCount} checagens em ${themesToRun.length} temas e ${VIEWPORTS.length} viewports (screenshots em .night/screens/).`
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
