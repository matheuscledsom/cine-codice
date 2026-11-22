import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  GitMerge,
  History,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAllEpisodeEvaluations } from '../api/cacheDb';
import { useToast } from '../context/ToastContext';
import {
  inspectBackupPayload,
  listAutoSnapshots,
  saveAutoSnapshot,
} from '../services/backupEngine';
import { triggerFileDownload } from '../services/codiceDatabase';

function formatSnapshotTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BackupRestoreModal({
  isOpen,
  onClose,
  currentWorkspace,
  onExportBackup,
  onExportCsv,
  onExportBibtex,
  onApplyRestore,
}) {
  const { showToast } = useToast();
  const fileInputRef = useRef(null);

  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [inspectingFile, setInspectingFile] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState('');
  const [restoreMode, setRestoreMode] = useState('merge');
  const [confirmSnapshotId, setConfirmSnapshotId] = useState(null);

  const refreshSnapshots = useCallback(async () => {
    setLoadingSnapshots(true);
    try {
      const list = await listAutoSnapshots();
      setSnapshots(list);
    } catch {
      setSnapshots([]);
    } finally {
      setLoadingSnapshots(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPreview(null);
      setParseError('');
      setSelectedFileName('');
      setConfirmSnapshotId(null);
      setRestoreMode('merge');
      return;
    }
    refreshSnapshots();
  }, [isOpen, refreshSnapshots]);

  if (!isOpen) return null;

  const handleSelectBackupFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setInspectingFile(true);
    setParseError('');
    setPreview(null);
    setSelectedFileName(file.name);

    try {
      const text = await file.text();
      const result = await inspectBackupPayload(text);
      if (!result.ok) {
        setParseError(result.error || 'Arquivo inválido.');
      } else {
        setPreview(result);
      }
    } catch {
      setParseError('Não foi possível ler o arquivo selecionado.');
    } finally {
      setInspectingFile(false);
    }
  };

  const handleCreateManualSnapshot = async () => {
    setSavingSnapshot(true);
    try {
      const episodeEvaluations =
        currentWorkspace?.episodeEvaluations ||
        (await getAllEpisodeEvaluations().catch(() => []));
      const res = await saveAutoSnapshot(
        {
          ...currentWorkspace,
          episodeEvaluations,
        },
        {
          reason: 'manual',
          label: 'Snapshot manual do catálogo',
          force: true,
        }
      );
      await refreshSnapshots();
      if (res?.snapshot) {
        showToast({
          message: 'Ponto de restauração salvo no IndexedDB.',
          type: 'success',
        });
      }
    } catch {
      showToast({
        message: 'Não foi possível criar o snapshot agora.',
        type: 'error',
      });
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handleRestoreFromPreview = async () => {
    if (!preview?.snapshot) return;
    await onApplyRestore?.(preview.snapshot, restoreMode, preview);
    setPreview(null);
    setSelectedFileName('');
    onClose?.();
  };

  const handleRestoreSnapshot = async (snap, mode) => {
    if (!snap?.payload) return;
    const inspected = await inspectBackupPayload(snap.payload);
    if (!inspected.ok) {
      showToast({
        message: 'Falha ao carregar os dados deste snapshot.',
        type: 'error',
      });
      return;
    }
    await onApplyRestore?.(inspected.snapshot, mode, inspected);
    setConfirmSnapshotId(null);
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Backup Profissional e Snapshots"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-[6px] sm:rounded-[6px] border border-line bg-card text-ink"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink">
              Backup Profissional (v4.0) e Snapshots
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Verificação SHA-256, pré-visualização detalhada, mesclagem segura e histórico local.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar gerenciador de backup"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 no-scrollbar">
          {/* Seção 1: Exportação Assinada + Planilhas / BibTeX */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Exportar Catálogo
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onExportBackup?.()}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] border border-accent bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition-opacity hover:opacity-90"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>JSON v4.0 + SHA-256</span>
              </button>

              <button
                type="button"
                onClick={() => onExportCsv?.()}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <span>Planilha (.csv)</span>
              </button>

              <button
                type="button"
                onClick={() => onExportBibtex?.()}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent"
              >
                <FileText className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <span>Markdown (.md)</span>
              </button>
            </div>
          </section>

          {/* Seção 2: Importação e Verificação de Integridade */}
          <section className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  Restaurar de Arquivo JSON
                </h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  Compatível com backups v1, v2, v3 e v4.0-codice-sql.
                </p>
              </div>
              <button
                type="button"
                disabled={inspectingFile}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent disabled:opacity-50"
              >
                <Upload className="h-4 w-4 text-accent" strokeWidth={1.5} />
                <span>
                  {inspectingFile
                    ? 'Verificando...'
                    : selectedFileName || 'Selecionar arquivo .json'}
                </span>
              </button>
            </div>

            {parseError && (
              <div className="flex items-start gap-2 rounded-[4px] border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>{parseError}</span>
              </div>
            )}

            {preview && (
              <div className="space-y-3 rounded-[6px] border border-line bg-app p-3.5">
                {/* Status SHA-256 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    {preview.checksumStatus === 'valid' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-accent" strokeWidth={1.5} />
                        <span className="text-accent">Assinatura SHA-256 verificada</span>
                      </>
                    ) : preview.checksumStatus === 'tampered' ? (
                      <>
                        <AlertTriangle className="h-4 w-4 text-rose-400" strokeWidth={1.5} />
                        <span className="text-rose-400">
                          Checksum SHA-256 divergente (arquivo alterado)
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-4 w-4 text-muted" strokeWidth={1.5} />
                        <span className="text-ink">
                          Backup legado ({preview.detectedSchemaVersion}) · migração v4 automática
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted">
                    {preview.computedDigest.slice(0, 12)}...
                  </span>
                </div>

                {/* Contagem Prévia */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { label: 'Obras', val: preview.counts.works },
                    { label: 'Citações', val: preview.counts.quotes },
                    { label: 'Resenhas', val: preview.counts.reviews },
                    { label: 'Diário', val: preview.counts.journalEntries },
                    { label: 'Sessões', val: preview.counts.readingSessions },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-[4px] border border-line bg-card px-2.5 py-2 text-center"
                    >
                      <p className="text-sm font-semibold tabular-nums text-ink">
                        {stat.val}
                      </p>
                      <p className="text-[10px] text-muted">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {preview.integrity?.orphanCount > 0 && (
                  <p className="text-[11px] text-muted">
                    Nota: {preview.integrity.orphanCount} registro(s) órfão(s) detectado(s) e preservado(s) para segurança.
                  </p>
                )}

                {/* Estratégia: Mesclar vs Substituir */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreMode('merge')}
                    className={`flex min-h-[44px] items-start gap-2.5 rounded-[4px] border p-2.5 text-left transition-colors ${
                      restoreMode === 'merge'
                        ? 'border-accent bg-accent/10 text-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    <GitMerge
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        restoreMode === 'merge' ? 'text-accent' : 'text-muted'
                      }`}
                      strokeWidth={1.5}
                    />
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        Mesclar sem sobrescrever
                      </p>
                      <p className="text-[10px] text-muted">
                        Une obras, citações e sessões mantendo os registros mais recentes.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRestoreMode('replace')}
                    className={`flex min-h-[44px] items-start gap-2.5 rounded-[4px] border p-2.5 text-left transition-colors ${
                      restoreMode === 'replace'
                        ? 'border-accent bg-accent/10 text-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    <RefreshCw
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        restoreMode === 'replace' ? 'text-accent' : 'text-muted'
                      }`}
                      strokeWidth={1.5}
                    />
                    <div>
                      <p className="text-xs font-semibold text-ink">
                        Substituir tudo
                      </p>
                      <p className="text-[10px] text-muted">
                        Salva um auto-snapshot antes e restaura exatamente este backup.
                      </p>
                    </div>
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPreview(null);
                      setSelectedFileName('');
                    }}
                    className="min-h-[40px] rounded-[4px] border border-line px-3 text-xs text-muted hover:text-ink"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreFromPreview}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90"
                  >
                    <Database className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>
                      {restoreMode === 'merge'
                        ? 'Confirmar Mesclagem'
                        : 'Substituir Catálogo'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Seção 3: Últimos 5 Auto-Snapshots Locais */}
          <section className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  Auto-Snapshots Locais (até 5 pontos)
                </h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  Capturados automaticamente no navegador para recuperação rápida.
                </p>
              </div>
              <button
                type="button"
                disabled={savingSnapshot}
                onClick={handleCreateManualSnapshot}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[4px] border border-line bg-app px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent disabled:opacity-50"
              >
                <History className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>{savingSnapshot ? 'Salvando...' : 'Criar snapshot agora'}</span>
              </button>
            </div>

            {loadingSnapshots ? (
              <div className="h-16 rounded-[4px] border border-line bg-app opacity-50" />
            ) : snapshots.length === 0 ? (
              <div className="rounded-[4px] border border-line bg-app px-4 py-5 text-center text-xs text-muted">
                Nenhum snapshot salvo ainda. Os backups automáticos serão listados aqui conforme o catálogo evoluir.
              </div>
            ) : (
              <div className="space-y-2">
                {snapshots.map((snap) => {
                  const isConfirming = confirmSnapshotId === snap.id;
                  return (
                    <div
                      key={snap.id}
                      className="rounded-[4px] border border-line bg-app p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-ink">
                              {snap.label || 'Auto-snapshot'}
                            </span>
                            <span className="rounded-[4px] border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted">
                              {snap.digest?.slice(0, 8)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                            {formatSnapshotTime(snap.createdAt)} ·{' '}
                            {snap.counts?.works || 0} obras ·{' '}
                            {snap.counts?.quotes || 0} citações ·{' '}
                            {snap.counts?.readingSessions || 0} sessões
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              triggerFileDownload(
                                JSON.stringify(snap.payload, null, 2),
                                `codice-snapshot-${snap.createdAt?.slice(0, 10) || 'local'}.json`,
                                'application/json;charset=utf-8'
                              )
                            }
                            aria-label="Baixar arquivo deste snapshot"
                            title="Baixar snapshot (.json)"
                            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-[4px] border border-line bg-card text-muted hover:border-accent hover:text-ink"
                          >
                            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>

                          {!isConfirming ? (
                            <button
                              type="button"
                              onClick={() => setConfirmSnapshotId(snap.id)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-2.5 text-xs font-medium text-ink transition-colors hover:border-accent"
                            >
                              <span>Restaurar</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleRestoreSnapshot(snap, 'merge')}
                                className="min-h-[38px] rounded-[4px] border border-accent bg-accent/15 px-2.5 text-[11px] font-semibold text-accent"
                              >
                                Mesclar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRestoreSnapshot(snap, 'replace')}
                                className="min-h-[38px] rounded-[4px] border border-accent bg-accent px-2.5 text-[11px] font-semibold text-accent-ink"
                              >
                                Substituir
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmSnapshotId(null)}
                                className="min-h-[38px] rounded-[4px] border border-line px-2 text-[11px] text-muted"
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleSelectBackupFile}
          className="hidden"
        />
      </div>
    </div>
  );
}
