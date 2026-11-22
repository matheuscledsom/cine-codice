import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = process.cwd();

const HEX_ALLOWLIST_FILES = new Set([
  'src/design/tokens.css',
  'src/index.css',
  'src/utils/themeTokens.js',
  'src/data/themePresets.js',
  'src/data/mockData.js',
  'src/config/domainConfig.js',
  'src/hooks/useTheme.js',
  'src/hooks/useAiConfig.js',
  'src/services/cinemaApi.js',
  'src/utils/editorialCardGenerator.js',
  'src/utils/qrCodeSvg.js',
  'src/graphics/posterGenerator.js',
  'src/graphics/dominantColor.js',
  'src/graphics/SpineRenderer.jsx',
]);

async function walkSrc(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkSrc(full)));
    } else if (/\.(js|jsx|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = await walkSrc(path.join(ROOT_DIR, 'src'));
const errors = [];
const warnings = [];

const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const secretRegex = /service_role|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}/;
const aiGradientRegex =
  /(?:from-(?:purple|violet|fuchsia|pink)-\d+.*to-(?:pink|rose|blue|cyan|indigo)-\d+|bg-clip-text\s+text-transparent)/;
const loremRegex = /\blorem\s+ipsum\b/i;

for (const file of files) {
  const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
  const content = await fs.readFile(file, 'utf8');
  const lines = content.split('\n');

  if (emojiRegex.test(content)) {
    errors.push(`${rel}: contém caractere emoji proibido em src/`);
  }

  if (secretRegex.test(content)) {
    errors.push(`${rel}: contém padrão de chave secreta proibida`);
  }

  if (/dangerouslySetInnerHTML/.test(content)) {
    errors.push(`${rel}: uso de dangerouslySetInnerHTML proibido`);
  }

  if (/\bconsole\.log\s*\(/.test(content)) {
    errors.push(`${rel}: contém console.log residual`);
  }

  if (aiGradientRegex.test(content)) {
    errors.push(`${rel}: contém gradiente típico genérico ou bg-clip-text proibido`);
  }

  if (loremRegex.test(content)) {
    errors.push(`${rel}: contém texto Lorem ipsum`);
  }

  // Checa box-shadow colorido saturado com blur > 20px em CSS
  if (rel.endsWith('.css')) {
    lines.forEach((line, idx) => {
      const shadowMatch = line.match(
        /box-shadow[^;]*?(rgba?\([^)]+\)|#[0-9A-Fa-f]{3,8}|var\(--accent[^)]*\))[^;]*?(\d+)px/
      );
      if (shadowMatch) {
        const blur = Number(shadowMatch[2]);
        if (blur > 20 && !/0,\s*0,\s*0|30,\s*27,\s*46/.test(shadowMatch[1])) {
          errors.push(`${rel}:${idx + 1}: box-shadow colorido com blur ${blur}px (> 20px)`);
        }
      }
    });
  }

  // Checa excesso de cores hex soltas fora dos arquivos de tokens/gráficos
  if (!HEX_ALLOWLIST_FILES.has(rel)) {
    const hexMatches = content.match(/#[0-9A-Fa-f]{3,6}\b/g) || [];
    if (hexMatches.length > 8) {
      warnings.push(`${rel}: ${hexMatches.length} cores hex inline (prefira tokens)`);
    }
  }
}

if (warnings.length > 0) {
  console.warn('Avisos de design (não bloqueantes):');
  warnings.forEach((w) => console.warn(` - ${w}`));
}

if (errors.length > 0) {
  console.error('FALHAS DE VALIDAÇÃO DE DESIGN:');
  errors.forEach((e) => console.error(` - ${e}`));
  process.exit(1);
}

console.log(`Design validator aprovado em ${files.length} arquivos de src/.`);
