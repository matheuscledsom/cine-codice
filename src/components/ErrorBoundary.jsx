import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { Component } from 'react';
import { recordLocalError } from '../lib/errorLogger.js';
import { downloadEmergencyBackupFromStorage } from '../services/backupEngine.js';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      exportingBackup: false,
      exportFeedback: '',
    };
    this.handleRecover = this.handleRecover.bind(this);
    this.handleExportEmergencyBackup = this.handleExportEmergencyBackup.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message ? String(error.message).slice(0, 180) : '',
    };
  }

  componentDidCatch(error) {
    recordLocalError(error, {
      source: this.props.isGlobal ? 'global-error-boundary' : 'screen-error-boundary',
      screen: this.props.screenName || 'app',
    });
  }

  handleRecover() {
    this.setState({
      hasError: false,
      errorMessage: '',
      exportFeedback: '',
    });
    if (typeof this.props.onRecover === 'function') {
      this.props.onRecover();
    } else if (this.props.isGlobal && typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  async handleExportEmergencyBackup() {
    if (this.state.exportingBackup) return;
    this.setState({ exportingBackup: true, exportFeedback: '' });
    try {
      const res = await downloadEmergencyBackupFromStorage();
      this.setState({
        exportingBackup: false,
        exportFeedback: `Backup exportado (${res.worksCount} obras) em ${res.filename}.`,
      });
    } catch {
      this.setState({
        exportingBackup: false,
        exportFeedback: 'Não foi possível gerar o arquivo de backup neste navegador.',
      });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const screenLabel = this.props.screenName || 'esta tela';
    const wrapperClass = this.props.isGlobal
      ? 'flex min-h-screen items-center justify-center bg-app p-4 text-ink'
      : 'my-4';

    return (
      <div className={wrapperClass}>
        <section
          role="alert"
          data-testid={this.props.isGlobal ? 'global-error-boundary' : 'screen-error-boundary'}
          className="w-full max-w-md rounded-[6px] border border-line bg-card p-6 text-center space-y-4"
        >
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[6px] border border-line bg-app text-accent">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-editorial text-lg font-semibold text-ink">
              Algo interrompeu {screenLabel}
            </h2>
            <p className="text-xs leading-relaxed text-muted">
              Seu catálogo, anotações e progresso continuam salvos em segurança neste aparelho.
            </p>
            {this.state.errorMessage && (
              <p className="truncate text-[11px] font-mono text-subtle">
                {this.state.errorMessage}
              </p>
            )}
            {this.state.exportFeedback && (
              <p className="text-xs font-medium text-ink">
                {this.state.exportFeedback}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
              <span>{this.props.isGlobal ? 'Recarregar aplicativo' : 'Recuperar'}</span>
            </button>
            <button
              type="button"
              onClick={this.handleExportEmergencyBackup}
              disabled={this.state.exportingBackup}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3.5 py-2 text-xs font-medium text-ink transition-colors hover:border-accent disabled:opacity-50"
            >
              <Download className="h-4 w-4" strokeWidth={1.5} />
              <span>{this.state.exportingBackup ? 'Exportando...' : 'Exportar backup (.json)'}</span>
            </button>
            {this.props.onOpenBackup && (
              <button
                type="button"
                onClick={this.props.onOpenBackup}
                className="inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-app px-3.5 py-2 text-xs font-medium text-ink hover:border-accent"
              >
                Abrir Backups
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }
}
