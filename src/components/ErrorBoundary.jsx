import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
    this.handleRecover = this.handleRecover.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message ? String(error.message).slice(0, 180) : '',
    };
  }

  componentDidCatch(_error) {
    // Isola falhas na aba atual sem apagar dados locais
  }

  handleRecover() {
    this.setState({ hasError: false, errorMessage: '' });
    if (typeof this.props.onRecover === 'function') {
      this.props.onRecover();
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const screenLabel = this.props.screenName || 'esta tela';

    return (
      <section
        role="alert"
        className="my-4 rounded-[6px] border border-line bg-card p-5 text-center space-y-3"
      >
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[4px] border border-line bg-app text-accent">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-ink">
            Algo interrompeu {screenLabel}
          </h2>
          <p className="text-xs leading-relaxed text-muted">
            Sua cinemateca, anotações e progresso continuam salvos em segurança neste aparelho.
          </p>
          {this.state.errorMessage && (
            <p className="truncate text-[11px] font-mono text-subtle">
              {this.state.errorMessage}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={this.handleRecover}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
            <span>Recuperar</span>
          </button>
          {this.props.onOpenBackup && (
            <button
              type="button"
              onClick={this.props.onOpenBackup}
              className="inline-flex min-h-[44px] items-center rounded-[4px] border border-line bg-app px-3.5 py-2 text-xs font-medium text-ink hover:border-accent"
            >
              Abrir Backups
            </button>
          )}
        </div>
      </section>
    );
  }
}
