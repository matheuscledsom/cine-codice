#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export function computeNextVersion(currentVersion, bumpType) {
  const match = String(currentVersion || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Versão semântica inválida: "${currentVersion}"`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (bumpType === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  if (bumpType === 'major') return `${major + 1}.0.0`;
  throw new Error(`Tipo de bump inválido: "${bumpType}". Use patch, minor ou major.`);
}

export function parseBumpCliArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  let bumpType = null;
  let codename = '';
  let summary = '';
  let dryRun = false;
  let noGit = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === 'patch' || arg === 'minor' || arg === 'major') {
      bumpType = arg;
    } else if (arg.startsWith('--name=')) {
      codename = arg.slice('--name='.length).replace(/^["']|["']$/g, '').trim();
    } else if (arg === '--name' && args[i + 1]) {
      codename = String(args[i + 1]).trim();
      i += 1;
    } else if (arg.startsWith('--summary=')) {
      summary = arg.slice('--summary='.length).replace(/^["']|["']$/g, '').trim();
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--no-git') {
      noGit = true;
    }
  }

  return { bumpType, codename, summary, dryRun, noGit };
}

export async function runVersionBump(
  argv,
  { rootDir = ROOT_DIR } = {}
) {
  const { bumpType, codename, summary, dryRun, noGit } = parseBumpCliArgs(argv);
  if (!bumpType) {
    throw new Error(
      'Informe o tipo de release: node scripts/bump-version.mjs [patch|minor|major --name="NovoNome"]'
    );
  }

  const pkgPath = path.join(rootDir, 'package.json');
  const versioningPath = path.join(rootDir, 'src/config/versioning.js');
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');

  const pkgRaw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const versioningUrl = `${pathToFileURL(versioningPath).href}?t=${Date.now()}`;
  const { CODICE_RELEASE } = await import(versioningUrl);

  const nextVersion = computeNextVersion(pkg.version || CODICE_RELEASE.version, bumpType);
  const resolvedCodename =
    bumpType === 'major' ? codename : codename || CODICE_RELEASE.codename;

  if (bumpType === 'major' && !resolvedCodename) {
    throw new Error(
      'Releases major exigem um novo codinome oficial. Exemplo: npm run version:major -- --name="Odin"'
    );
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const label = `v${nextVersion} · ${resolvedCodename}`;
  const releaseSummary =
    summary ||
    (bumpType === 'major'
      ? `Novo marco major ${resolvedCodename} (${nextVersion}).`
      : `Atualização ${bumpType} mantendo o ciclo ${resolvedCodename}.`);

  const nextRelease = {
    version: nextVersion,
    codename: resolvedCodename,
    label,
    releaseType: bumpType,
    date: dateStr,
    summary: releaseSummary,
  };

  if (dryRun) {
    return { nextRelease, committed: false };
  }

  pkg.version = nextVersion;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  const currentVersioningRaw = await fs.readFile(versioningPath, 'utf8');
  const updatedVersioning = currentVersioningRaw
    .replace(/export const CODICE_RELEASE = \{[\s\S]*?\};/, () => {
      return `export const CODICE_RELEASE = {\n  version: '${nextVersion}',\n  codename: '${resolvedCodename.replace(/'/g, "\\'")}',\n  label: '${label.replace(/'/g, "\\'")}',\n  releaseType: '${bumpType}',\n  date: '${dateStr}',\n  summary:\n    '${releaseSummary.replace(/'/g, "\\'")}',\n};`;
    })
    .replace(
      /export const RELEASE_HISTORY = \[/,
      `export const RELEASE_HISTORY = [\n  {\n    version: '${nextVersion}',\n    codename: '${resolvedCodename.replace(/'/g, "\\'")}',\n    label: '${label.replace(/'/g, "\\'")}',\n    releaseType: '${bumpType}',\n    date: '${dateStr}',\n    summary: '${releaseSummary.replace(/'/g, "\\'")}',\n    highlights: ['Release automatizado via bump-version.mjs.'],\n  },`
    );

  await fs.writeFile(versioningPath, updatedVersioning, 'utf8');

  const changelogRaw = await fs.readFile(changelogPath, 'utf8');
  const newSection = `## [${label}] — ${dateStr}\n\n**Resumo:** ${releaseSummary}\n\n`;
  const updatedChangelog = changelogRaw.includes('\n---\n\n')
    ? changelogRaw.replace('\n---\n\n', `\n---\n\n${newSection}`)
    : `${changelogRaw.trimEnd()}\n\n${newSection}`;
  await fs.writeFile(changelogPath, updatedChangelog, 'utf8');

  let committed = false;
  if (!noGit) {
    execFileSync(
      'git',
      ['add', 'package.json', 'src/config/versioning.js', 'CHANGELOG.md'],
      { cwd: rootDir, stdio: 'inherit' }
    );
    execFileSync(
      'git',
      ['commit', '-m', `chore(release): ${label}`],
      { cwd: rootDir, stdio: 'inherit' }
    );
    execFileSync(
      'git',
      ['tag', '-a', `v${nextVersion}`, '-m', `Códice ${label}`],
      { cwd: rootDir, stdio: 'inherit' }
    );
    committed = true;
  }

  return { nextRelease, committed };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  runVersionBump(process.argv.slice(2))
    .then(({ nextRelease, committed }) => {
      console.log(
        `Códice atualizado para ${nextRelease.label}${committed ? ' (commit + tag criados)' : ''}.`
      );
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
