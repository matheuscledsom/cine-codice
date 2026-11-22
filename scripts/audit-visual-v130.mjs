import { chromium } from 'playwright';

const VIEWPORTS = [
  { name: 'Mobile (360px)', width: 360, height: 800 },
  { name: 'Tablet (768px)', width: 768, height: 1024 },
  { name: 'Desktop (1280px)', width: 1280, height: 800 },
];

const mockItems = [
  {
    id: 'w-dune',
    title: 'Duna: Parte 2',
    workType: 'movie',
    status: 'completed',
    rating: 95,
    ratingSource: 'manual',
    durationMinutes: 166,
    releaseYear: 2024,
    inBacklog: true,
    coverUrl: 'https://image.tmdb.org/t/p/w500/duna2.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/duna2_bg.jpg',
    favoriteRank: 1,
    isFavorite: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'w-op',
    title: 'One Piece',
    workType: 'anime',
    status: 'playing',
    rating: 98,
    ratingSource: 'manual',
    currentEpisode: 1015,
    totalEpisodes: 1122,
    inBacklog: true,
    coverUrl: 'https://image.tmdb.org/t/p/w500/onepiece.jpg',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'w-shogun',
    title: 'Xógum: A Gloriosa Saga do Japão',
    workType: 'series',
    status: 'completed',
    rating: 92,
    ratingSource: 'manual',
    currentSeason: 1,
    currentEpisode: 10,
    totalEpisodes: 10,
    inBacklog: true,
    coverUrl: 'https://image.tmdb.org/t/p/w500/shogun.jpg',
    updatedAt: new Date().toISOString(),
  },
];

const mockProfile = {
  displayName: 'Curador Lumière',
  handle: '@lumiere',
  bio: 'Amante de ficção científica, animes clássicos e direção autoral.',
  onboardingCompleted: true,
  avatarIcon: 'Film',
  viewerFocus: ['Filmes', 'Séries', 'Animes'],
};

async function runVisualAudit() {
  console.log('--- AUDITORIA VISUAL MULTI-RESOLUÇÃO (PLAYWRIGHT) ---');
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    console.log('Chrome nativo não encontrado, tentando chromium padrão...');
    browser = await chromium.launch();
  }

  const results = [];
  let hasFailure = false;

  for (const vp of VIEWPORTS) {
    console.log(`\nValidando Viewport: ${vp.name} (${vp.width}x${vp.height} px)...`);
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
    });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.addInitScript(({ items, profile }) => {
      localStorage.setItem('cine_codice_migration_version_v1', '2');
      localStorage.setItem('cine_codice_profile_v1', JSON.stringify(profile));
      localStorage.setItem('cine_codice_backlog_v1', JSON.stringify(items));
    }, { items: mockItems, profile: mockProfile });

    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Navega pelas principais telas
    const screens = [
      { name: 'Home', selector: 'button:has-text("Início")' },
      { name: 'Catálogo', selector: 'button:has-text("Catálogo")' },
      { name: 'Métricas', selector: 'button:has-text("Métricas")' },
      { name: 'Perfil', selector: 'button:has-text("Perfil")' },
    ];

    for (const scr of screens) {
      try {
        const btn = page.locator(scr.selector).first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(400);
        }
      } catch {
        // segue se não encontrar botão de aba
      }

      const overflow = await page.evaluate(() => {
        const scrollW = document.documentElement.scrollWidth;
        const innerW = window.innerWidth;
        return {
          scrollW,
          innerW,
          hasOverflow: scrollW > innerW + 1, // 1px tolerância para arredondamento
        };
      });

      const passed = !overflow.hasOverflow;
      if (!passed) hasFailure = true;

      results.push({
        viewport: vp.name,
        screen: scr.name,
        scrollWidth: overflow.scrollW,
        innerWidth: overflow.innerW,
        passed,
      });

      console.log(
        `  [${scr.name}] scrollWidth: ${overflow.scrollW}px / innerWidth: ${overflow.innerW}px -> ${
          passed ? 'PASSOU (0 overflow)' : 'FALHOU (Overflow detectado!)'
        }`
      );
    }

    if (consoleErrors.length > 0) {
      console.warn(`  Avisos/erros no console em ${vp.name}:`, consoleErrors);
    } else {
      console.log(`  Console limpo (0 erros em ${vp.name}).`);
    }

    await page.close();
  }

  await browser.close();

  console.log('\n--- RESUMO DA AUDITORIA VISUAL ---');
  const allPassed = results.every((r) => r.passed);
  console.log(`Total de verificações de tela: ${results.length}`);
  console.log(`Status final: ${allPassed ? '100% APROVADO (Zero overflow em todos os viewports)' : 'REPROVADO'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runVisualAudit().catch((err) => {
  console.error('Erro na auditoria visual:', err);
  process.exit(1);
});
