import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  GitMerge,
  History,
  KeyRound,
  Lock,
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
  exportSignedCcodexPayload,
  inspectBackupPayload,
  listAutoSnapshots,
  saveAutoSnapshot,
} from '../services/backupEngine';
import {
  buildCodiceDatabase,
  triggerFileDownload,
} from '../services/codiceDatabase';
import {
  getConfiguredGoogleClientId,
  requestGoogleDriveAccessToken,
  restoreLatestBackupFromGoogleDrive,
  setConfiguredGoogleClientId,
  uploadBackupToGoogleDrive,
} from '../services/googleDriveBackup';

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

function formatByteSize(bytes) {
  const num = Number(bytes) || 0;
  if (num <= 0) return '0 KB';
  if (num < 1024) return `${num} B`;
  return `${(num / 1024).toFixed(1)} KB`;
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
  const [rawPendingContent, setRawPendingContent] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [exportingCcodex, setExportingCcodex] = useState(false);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState('');
  const [restoreMode, setRestoreMode] = useState('merge');
  const [confirmSnapshotId, setConfirmSnapshotId] = useState(null);

  const [googleClientId, setGoogleClientId] = useState(() =>
    getConfiguredGoogleClientId()
  );
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveStatus, setDriveStatus] = useState('');

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
      setRawPendingContent('');
      setRequiresPassword(false);
      setImportPassword('');
      setConfirmSnapshotId(null);
      setRestoreMode('merge');
      setDriveStatus('');
      return;
    }
    setGoogleClientId(getConfiguredGoogleClientId());
    refreshSnapshots();
  }, [isOpen, refreshSnapshots]);

  if (!isOpen) return null;

  const buildCurrentDb = async () => {
    const episodeEvaluations =
      currentWorkspace?.episodeEvaluations ||
      (await getAllEpisodeEvaluations().catch(() => []));
    return buildCodiceDatabase({
      ...currentWorkspace,
      episodeEvaluations,
    });
  };

  const handleExportCcodex = async () => {
    setExportingCcodex(true);
    try {
      const db = await buildCurrentDb();
      const envelope = await exportSignedCcodexPayload(db, {
        password: exportPassword.trim(),
      });
      const dateStamp = new Date().toISOString().slice(0, 10);
      const suffix = envelope.encrypted ? 'encrypted' : 'gzip';
      triggerFileDownload(
        JSON.stringify(envelope, null, 2),
        `cine-codice-backup-${dateStamp}-${suffix}.ccodex`,
        'application/json;charset=utf-8'
      );
      const savings =
        envelope.uncompressedBytes > 0
          ? Math.max(
              0,
              Math.round(
                (1 - envelope.compressedBytes / envelope.uncompressedBytes) * 100
              )
            )
          : 0;
      showToast({
        message: envelope.encrypted
          ? `Backup .ccodex criptografado (AES-256-GCM · -${savings}% GZIP) exportado.`
          : `Backup .ccodex compactado (-${savings}% GZIP) exportado.`,
        type: 'success',
      });
    } catch {
      showToast({
        message: 'Não foi possível gerar o arquivo .ccodex.',
        type: 'error',
      });
    } finally {
      setExportingCcodex(false);
    }
  };

  const runInspection = async (rawText, passwordToUse = '') => {
    setInspectingFile(true);
    setParseError('');
    try {
      const result = await inspectBackupPayload(rawText, {
        password: passwordToUse,
      });
      if (!result.ok) {
        if (result.requiresPassword) {
          setRequiresPassword(true);
          setRawPendingContent(
            typeof rawText === 'string' ? rawText : JSON.stringify(rawText)
          );
        }
        setParseError(result.error || 'Arquivo inválido.');
        setPreview(null);
      } else {
        setRequiresPassword(false);
        setRawPendingContent('');
        setPreview(result);
      }
    } catch {
      setParseError('Não foi possível ler o arquivo selecionado.');
    } finally {
      setInspectingFile(false);
    }
  };

  const handleSelectBackupFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setSelectedFileName(file.name);
    setPreview(null);
    setRequiresPassword(false);
    try {
      const text = await file.text();
      await runInspection(text, importPassword.trim());
    } catch {
      setParseError('Não foi possível ler o arquivo selecionado.');
    }
  };

  const handleUnlockEncryptedBackup = async (e) => {
    e.preventDefault();
    if (!rawPendingContent) return;
    await runInspection(rawPendingContent, importPassword.trim());
  };

  const handleSaveGoogleClientId = (val) => {
    setGoogleClientId(val);
    setConfiguredGoogleClientId(val);
  };

  const handleUploadGoogleDrive = async () => {
    setDriveBusy(true);
    setDriveStatus('');
    try {
      const token = await requestGoogleDriveAccessToken({
        clientId: googleClientId,
      });
      const db = await buildCurrentDb();
      const envelope = await exportSignedCcodexPayload(db, {
        password: exportPassword.trim(),
      });
      const uploaded = await uploadBackupToGoogleDrive(envelope, {
        accessToken: token,
      });
      setDriveStatus(
        `Backup sincronizado no Google Drive (${uploaded?.name || 'cine-codice-latest.ccodex'}).`
      );
      showToast({
        message: 'Backup .ccodex enviado para o Google Drive com sucesso.',
        type: 'success',
      });
    } catch (err) {
      const msg = err?.message || 'Falha ao conectar ao Google Drive.';
      setDriveStatus(msg);
      showToast({ message: msg, type: 'error' });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleRestoreFromGoogleDrive = async () => {
    setDriveBusy(true);
    setDriveStatus('');
    try {
      const token = await requestGoogleDriveAccessToken({
        clientId: googleClientId,
      });
      const { file, rawContent } = await restoreLatestBackupFromGoogleDrive({
        accessToken: token,
      });
      setSelectedFileName(`Google Drive: ${file.name}`);
      await runInspection(rawContent, importPassword.trim());
      setDriveStatus(`Backup "${file.name}" carregado do Google Drive para revisão.`);
    } catch (err) {
      const msg = err?.message || 'Não foi possível restaurar do Google Drive.';
      setDriveStatus(msg);
      showToast({ message: msg, type: 'error' });
    } finally {
      setDriveBusy(false);
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
              Backup Criptografado (.ccodex), Google Drive e Snapshots
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Compressão GZIP nativa (~80% menor), criptografia AES-256-GCM opcional e nuvem pessoal.
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
          {/* Seção 1: Exportação Compactada GZIP (.ccodex) + Senha AES-GCM + JSON/CSV/MD */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                Exportar Catálogo (.ccodex GZIP + AES-256-GCM)
              </h3>
              <span className="text-[10px] font-medium text-accent">
                PBKDF2 150k · SHA-256
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
                  strokeWidth={1.5}
                />
                <input
                  type="password"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder="Senha opcional de criptografia (AES-256-GCM)..."
                  aria-label="Senha opcional para criptografar o backup .ccodex"
                  className="min-h-[42px] w-full rounded-[4px] border border-line bg-app pl-8 pr-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="button"
                disabled={exportingCcodex}
                onClick={handleExportCcodex}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[4px] border border-accent bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>
                  {exportingCcodex
                    ? 'Compactando...'
                    : exportPassword.trim()
                      ? 'Exportar .ccodex Criptografado'
                      : 'Exportar .ccodex (GZIP)'}
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onExportBackup?.()}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <span>JSON v4.0 + SHA-256</span>
              </button>

              <button
                type="button"
                onClick={() => onExportCsv?.()}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <span>Planilha (.csv)</span>
              </button>

              <button
                type="button"
                onClick={() => onExportBibtex?.()}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent"
              >
                <FileText className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <span>Markdown (.md)</span>
              </button>
            </div>
          </section>

          {/* Seção 1.5: Google Drive Pessoal */}
          <section className="space-y-2.5 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-accent" strokeWidth={1.5} />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  Backup no Google Drive Pessoal
                </h3>
              </div>
              <span className="text-[10px] text-muted">
                Pasta privada drive.appdata
              </span>
            </div>

            <div className="space-y-2 rounded-[4px] border border-line bg-app p-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={googleClientId}
                  onChange={(e) => handleSaveGoogleClientId(e.target.value)}
                  placeholder="Google Client ID OAuth 2.0 (ex: 12345-abc.apps.googleusercontent.com)"
                  aria-label="Google Client ID para backup no Google Drive"
                  className="min-h-[38px] flex-1 rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={driveBusy}
                  onClick={handleUploadGoogleDrive}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-accent/50 bg-accent/15 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                >
                  <Cloud className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>Enviar Backup para o Google Drive</span>
                </button>
                <button
                  type="button"
                  disabled={driveBusy}
                  onClick={handleRestoreFromGoogleDrive}
                  className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
                >
                  <Download className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                  <span>Restaurar do Google Drive</span>
                </button>
              </div>

              {driveStatus && (
                <p className="text-[11px] text-muted">{driveStatus}</p>
              )}
            </div>
          </section>

          {/* Seção 2: Importação e Verificação de Integridade (.ccodex e .json) */}
          <section className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                  Restaurar de Arquivo (.ccodex ou .json)
                </h3>
                <p className="mt-0.5 text-[11px] text-muted">
                  Compatível com .ccodex (GZIP / AES-256-GCM) e backups .json v1 a v4.0.
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
                    : selectedFileName || 'Selecionar .ccodex ou .json'}
                </span>
              </button>
            </div>

            {requiresPassword && (
              <form
                onSubmit={handleUnlockEncryptedBackup}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-[4px] border border-accent/50 bg-app p-3"
              >
                <div className="flex flex-1 items-center gap-2">
                  <KeyRound className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                  <input
                    type="password"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="Digite a senha para descriptografar o .ccodex..."
                    aria-label="Senha para descriptografar backup .ccodex"
                    className="min-h-[38px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-[38px] items-center justify-center rounded-[4px] border border-accent bg-accent px-3 text-xs font-semibold text-accent-ink"
                >
                  Desbloquear Backup
                </button>
              </form>
            )}

            {parseError && (
              <div className="flex items-start gap-2 rounded-[4px] border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>{parseError}</span>
              </div>
            )}

            {preview && (
              <div className="space-y-3 rounded-[6px] border border-line bg-app p-3.5">
                {/* Status SHA-256 & Container */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
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
                    {preview.format === 'ccodex-v1' && (
                      <span className="rounded-[4px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        {preview.encrypted ? 'AES-256-GCM + GZIP' : 'GZIP .ccodex'}
                        {preview.compressionStats?.compressedBytes
                          ? ` (${formatByteSize(preview.compressionStats.compressedBytes)})`
                          : ''}
                      </span>
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
          accept=".ccodex,.json,application/json"
          onChange={handleSelectBackupFile}
          className="hidden"
        />
      </div>
    </div>
  );
}
