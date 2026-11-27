/**
 * Helpers puros da página "Configurações > Diagnóstico" (v2.4.0 Fase 5).
 * 100% local: calcula resumo do catálogo, estimativa de storage e formata
 * relatório copiável com os últimos 50 erros locais sem enviar nada para fora.
 */

import { inferDomainFromWork } from '../config/domainConfig.js';
import { formatLocalErrorLogForCopy } from './errorLogger.js';

export function formatBytesHuman(bytes = 0) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function estimateLocalStorageUsage(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage) {
    return { keysCount: 0, totalBytes: 0, formatted: '0 B' };
  }
  try {
    let totalBytes = 0;
    const keysCount = Number(storage.length) || 0;
    for (let i = 0; i < keysCount; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      const val = storage.getItem(key) || '';
      totalBytes += (key.length + val.length) * 2;
    }
    return {
      keysCount,
      totalBytes,
      formatted: formatBytesHuman(totalBytes),
    };
  } catch {
    return { keysCount: 0, totalBytes: 0, formatted: '0 B' };
  }
}

export function computeCatalogDiagnosticsSummary(items = []) {
  const safe = (Array.isArray(items) ? items : []).filter(Boolean);
  const backlog = safe.filter((w) => w.inBacklog !== false);
  const byDomain = { cinema: 0, reading: 0, games: 0, music: 0 };

  let completedWorks = 0;
  let inProgressWorks = 0;
  let queuedWorks = 0;

  for (const w of backlog) {
    const dom = inferDomainFromWork(w);
    if (byDomain[dom] !== undefined) byDomain[dom] += 1;
    if (w.status === 'completed') completedWorks += 1;
    else if (w.status === 'playing' || w.status === 'rewatching') inProgressWorks += 1;
    else if (w.status === 'queued') queuedWorks += 1;
  }

  let approxPayloadBytes = 0;
  try {
    approxPayloadBytes = new Blob([JSON.stringify(safe)]).size;
  } catch {
    try {
      approxPayloadBytes = JSON.stringify(safe).length * 2;
    } catch {
      approxPayloadBytes = 0;
    }
  }

  return {
    totalWorks: safe.length,
    backlogWorks: backlog.length,
    completedWorks,
    inProgressWorks,
    queuedWorks,
    byDomain,
    approxPayloadBytes,
    approxPayloadFormatted: formatBytesHuman(approxPayloadBytes),
  };
}

export async function collectStorageEstimate({
  navigatorImpl = typeof navigator !== 'undefined' ? navigator : null,
  storageImpl = typeof localStorage !== 'undefined' ? localStorage : null,
} = {}) {
  const ls = estimateLocalStorageUsage(storageImpl);
  let usageBytes = null;
  let quotaBytes = null;
  let persisted = null;

  try {
    if (navigatorImpl?.storage?.estimate) {
      const est = await navigatorImpl.storage.estimate();
      if (Number.isFinite(est?.usage)) usageBytes = est.usage;
      if (Number.isFinite(est?.quota)) quotaBytes = est.quota;
    }
    if (navigatorImpl?.storage?.persisted) {
      persisted = Boolean(await navigatorImpl.storage.persisted());
    }
  } catch {
    // Ambiente sem StorageManager
  }

  const usagePercent =
    usageBytes !== null && quotaBytes && quotaBytes > 0
      ? Math.min(100, Math.round((usageBytes / quotaBytes) * 1000) / 10)
      : null;

  return {
    usageBytes,
    quotaBytes,
    usagePercent,
    persisted,
    localStorageBytes: ls.totalBytes,
    localStorageKeys: ls.keysCount,
    formattedUsage: usageBytes !== null ? formatBytesHuman(usageBytes) : ls.formatted,
    formattedQuota: quotaBytes !== null ? formatBytesHuman(quotaBytes) : 'Indisponível',
    formattedLocalStorage: ls.formatted,
  };
}

export function buildDiagnosticsReportText({
  release = {},
  schemaVersion = 2,
  catalogSummary = null,
  storageSummary = null,
  errorLog = [],
  failedSyncItems = [],
} = {}) {
  const cat = catalogSummary || computeCatalogDiagnosticsSummary([]);
  const st = storageSummary || {};
  const failedList = Array.isArray(failedSyncItems) ? failedSyncItems : [];
  const lines = [
    `OmniPrism — Diagnóstico Local (${new Date().toISOString()})`,
    `Versão: ${release.label || release.version || 'desconhecida'} | Schema IndexedDB: v${schemaVersion}`,
    `Catálogo: ${cat.backlogWorks} obras (${cat.completedWorks} concluídas, ${cat.inProgressWorks} em andamento, ${cat.queuedWorks} na fila)`,
    `Domínios: Cinema ${cat.byDomain.cinema} | Leitura ${cat.byDomain.reading} | Games ${cat.byDomain.games} | Música ${cat.byDomain.music}`,
    `Tamanho aproximado do catálogo: ${cat.approxPayloadFormatted}`,
    `Storage: uso ${st.formattedUsage || 'N/D'} / cota ${st.formattedQuota || 'N/D'} | localStorage ${st.formattedLocalStorage || 'N/D'} (${st.localStorageKeys ?? 0} chaves) | persistente: ${st.persisted === true ? 'sim' : st.persisted === false ? 'não' : 'indisponível'}`,
  ];
  if (failedList.length > 0) {
    lines.push('');
    lines.push(`--- Obras com falha no envio à nuvem (${failedList.length}) ---`);
    failedList.forEach((f) => {
      lines.push(`- ${f.title || 'Sem título'}: ${f.reason || 'falha no envio'}`);
    });
  }
  lines.push('');
  lines.push(`--- Log local de erros (${Array.isArray(errorLog) ? errorLog.length : 0}/50) ---`);
  lines.push(formatLocalErrorLogForCopy(errorLog));
  return lines.join('\n');
}
