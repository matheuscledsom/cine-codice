import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const PORT = 4181;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GLOBAL_TIMEOUT_MS = 45000;

const TABS = [
  { id: 'home', labelMatch: /in[ií]cio/i },
  { id: 'list', labelMatch: /acervo|estante/i },
  { id: 'add', labelMatch: /catalogar/i },
  { id: 'stats', labelMatch: /m[eé]tricas|estat/i },
  { id: 'community', labelMatch: /rede|comunidade/i },
  { id: 'profile', labelMatch: /perfil/i },
];

async function resolveExecutablePath() {
  const candidates = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continua
    }
  }
  return undefined;
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Preview server timeout');
}

function startPreview() {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'ignore',
    detached: true,
  });
}

function killProcessGroup(proc) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      // processo já encerrado
    }
  }
  setTimeout(() => {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        // já morto
      }
    }
  }, 400).unref();
}

let activeBrowser = null;
let activeServer = null;

const watchdog = setTimeout(async () => {
  console.error('TIMEOUT_45S: audit-a11y excedeu 45s');
  await activeBrowser?.close().catch(() => {});
  killProcessGroup(activeServer);
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);
watchdog.unref();

async function runAudit() {
  const server = startPreview();
  activeServer = server;
  const executablePath = await resolveExecutablePath();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
  });
  activeBrowser = browser;

  const results = {
    lang: '',
    hasSkipLink: false,
    hasMainLandmark: false,
    hasNavLandmark: false,
    tabsChecked: [],
    shortcutDialogPassed: false,
    buddySpoilerShieldDomPassed: false,
    localHttpErrors: [],
    pageErrors: [],
  };

  try {
    await waitForServer(BASE_URL);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    page.on('pageerror', (err) => results.pageErrors.push(String(err)));
    page.on('response', (res) => {
      if (res.url().startsWith(BASE_URL) && res.status() >= 400) {
        results.localHttpErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        'mlpd_livros_profile',
        JSON.stringify({
          id: 'audit-user',
          displayName: 'Auditor',
          handle: '@auditor',
          onboardingCompleted: true,
          preferredCriteria: ['plot'],
          favoriteGenres: ['Literatura Clássica', 'Fantasia'],
          annualGoal: 12,
        })
      );
      localStorage.setItem(
        'mlpd_livros_backlog',
        JSON.stringify([
          {
            id: 'buddy-audit-book',
            title: 'Dom Casmurro Teste',
            author: 'Machado de Assis',
            workType: 'book',
            status: 'playing',
            totalPages: 100,
            currentPage: 30,
            progressPercent: 30,
            inBacklog: true,
          },
        ])
      );
      localStorage.setItem(
        'codice_buddy_reads_v1',
        JSON.stringify({
          'title:dom-casmurro-teste': [
            {
              id: 'br-safe',
              authorName: 'Amigo Safe',
              progressPct: 10,
              text: 'COMENTARIO_SEGURO_10_PCT',
              createdAt: '2026-11-20T10:00:00Z',
            },
            {
              id: 'br-spoiler',
              authorName: 'Amigo Spoiler',
              progressPct: 85,
              text: 'SPOILER_SECRETO_PROIBIDO_85',
              createdAt: '2026-11-20T11:00:00Z',
            },
          ],
        })
      );
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const rootMeta = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      hasSkipLink: Boolean(document.querySelector('a[href="#main-content"]')),
      hasMainLandmark: Boolean(document.querySelector('main#main-content')),
      hasNavLandmark: Boolean(document.querySelector('nav')),
    }));

    Object.assign(results, rootMeta);

    for (const tab of TABS) {
      const btn = page.locator('nav button, nav a').filter({ hasText: tab.labelMatch }).first();
      if ((await btn.count()) > 0) {
        await btn.click();
        await page.waitForTimeout(350);
      }

      const tabReport = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(
          (el) => el.offsetParent !== null
        );
        const unlabeledButtons = btns
          .filter((el) => {
            const text = (el.innerText || '').trim();
            const aria = (el.getAttribute('aria-label') || '').trim();
            const title = (el.getAttribute('title') || '').trim();
            return !text && !aria && !title;
          })
          .map((el) => el.outerHTML.slice(0, 80));

        const imgsMissingAlt = Array.from(document.querySelectorAll('img'))
          .filter((img) => img.offsetParent !== null && img.getAttribute('alt') === null)
          .length;

        const headings = document.querySelectorAll('h1, h2, h3').length;
        return {
          visibleButtons: btns.length,
          unlabeledButtons,
          imgsMissingAlt,
          headings,
        };
      });

      results.tabsChecked.push({ tab: tab.id, ...tabReport });
    }

    // Testa atalho '?' para abrir modal de atalhos e Esc para fechar
    await page.locator('main#main-content').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.keyboard.press('?');
    await page.waitForTimeout(300);
    const dialogVisible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
    if (dialogVisible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const stillVisible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false);
      results.shortcutDialogPassed = !stillVisible;
    }

    // Testa Escudo Anti-Spoiler Buddy Read no DOM real
    const listNavBtn = page.locator('nav button, nav a').filter({ hasText: /acervo|estante/i }).first();
    if ((await listNavBtn.count()) > 0) {
      await listNavBtn.click();
      await page.waitForTimeout(350);
      const bookCard = page.locator('button').filter({ hasText: 'Dom Casmurro Teste' }).first();
      if ((await bookCard.count()) > 0) {
        await bookCard.click();
        await page.waitForTimeout(350);
        const conjuntaTab = page.locator('button').filter({ hasText: 'Conjunta' }).first();
        if ((await conjuntaTab.count()) > 0) {
          await conjuntaTab.click();
          await page.waitForTimeout(250);
          const domDump = await page.evaluate(() => document.body.innerHTML);
          const hasSafe = domDump.includes('COMENTARIO_SEGURO_10_PCT');
          const leaksSpoiler = domDump.includes('SPOILER_SECRETO_PROIBIDO_85');
          results.buddySpoilerShieldDomPassed = hasSafe && !leaksSpoiler;
        }
      }
    }

    await context.close();
  } finally {
    clearTimeout(watchdog);
    await browser.close().catch(() => {});
    killProcessGroup(server);
  }

  return results;
}

let exitCode = 0;
try {
  const report = await runAudit();
  console.log(JSON.stringify(report, null, 2));

  const totalUnlabeled = report.tabsChecked.reduce((s, t) => s + t.unlabeledButtons.length, 0);
  const totalImgsMissingAlt = report.tabsChecked.reduce((s, t) => s + t.imgsMissingAlt, 0);
  if (
    report.lang !== 'pt-BR' ||
    !report.hasSkipLink ||
    !report.hasMainLandmark ||
    !report.hasNavLandmark ||
    !report.buddySpoilerShieldDomPassed ||
    totalUnlabeled > 0 ||
    totalImgsMissingAlt > 0 ||
    report.localHttpErrors.length > 0 ||
    report.pageErrors.length > 0
  ) {
    exitCode = 1;
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  killProcessGroup(activeServer);
  process.exit(exitCode);
}
