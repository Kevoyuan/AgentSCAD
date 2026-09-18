'use client'

import React, { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PanelErrorBoundaryProps {
  panelName: string
  children: ReactNode
  onReset?: () => void
  resetKey?: string | number | null
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  className?: string
  showDetails?: boolean
}

interface PanelErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<PanelErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PanelErrorBoundary:${this.props.panelName}] Isolated error caught:`, error, errorInfo)
    this.setState({ errorInfo })
  }

  componentDidUpdate(prevProps: PanelErrorBoundaryProps) {
    if (
      this.state.hasError &&
      this.props.resetKey !== undefined &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      // Auto-heal on job/tab context switch
      this.handleReset()
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    })
    this.props.onReset?.()
  }

  handleCopyDiagnostics = () => {
    const diagnostic = [
      `Panel: ${this.props.panelName}`,
      `Error: ${this.state.error?.name || 'Error'}: ${this.state.error?.message || 'Unknown'}`,
      `Stack: ${this.state.error?.stack || 'No stack'}`,
      `Component Stack: ${this.state.errorInfo?.componentStack || 'No component stack'}`,
    ].join('\n')

    navigator.clipboard?.writeText(diagnostic).then(() => {
      this.setState({ copied: true })
      setTimeout(() => {
        this.setState({ copied: false })
      }, 2000)
    }).catch(() => {
      // Clipboard write failed silently
    })
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error || new Error('Unknown error'), this.handleReset)
      }
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          className={`flex flex-col items-center justify-center h-full w-full p-6 text-center bg-[var(--app-surface)] border border-[color:var(--app-border)] select-none min-w-0 overflow-hidden ${this.props.className || ''}`}
          role="alert"
          aria-live="assertive"
        >
          {/* Subsystem Isolation Badge */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-transparent border border-transparent text-[var(--shell-fail)] text-xs font-mono mb-3 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="uppercase tracking-wider font-semibold">
              {this.props.panelName} FAULT ISOLATED
            </span>
          </div>

          <h3 className="text-sm font-semibold tracking-tight text-[var(--app-text-primary)] mb-1.5">
            面板子系统已隔离
          </h3>
          <p className="text-xs text-[var(--app-text-muted)] max-w-sm mb-4 leading-relaxed">
            该面板发生未捕获渲染异常，其他面板与全局 CAD 会话已被安全隔离保护。可点击下方重试恢复或切换任务自愈。
          </p>

          {/* Monospace Error Diagnostic Box */}
          <div className="w-full max-w-md bg-[var(--app-bg)] border border-[color:var(--app-border-subtle)] rounded-[6px] p-3 text-left mb-4 overflow-x-auto max-h-32 text-xs font-mono tabular-nums">
            <div className="text-[11px] font-mono text-[var(--shell-fail)] font-semibold mb-1 truncate">
              {this.state.error?.name || 'RuntimeError'}: {this.state.error?.message || 'Unexpected failure'}
            </div>
            {this.state.error?.stack && (
              <pre className="text-[10px] text-[var(--app-text-dim)] font-mono leading-tight whitespace-pre-wrap break-all max-h-16 overflow-y-auto">
                {this.state.error.stack.split('\n').slice(0, 4).join('\n')}
              </pre>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              onClick={this.handleReset}
              className="h-7 text-xs font-medium gap-1.5 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] text-white px-3 rounded-[6px] active:scale-[0.98]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重试面板 (Retry)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={this.handleCopyDiagnostics}
              className="h-7 text-xs font-medium gap-1.5 border-[color:var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] px-2.5 rounded-[6px] active:scale-[0.98]"
            >
              {this.state.copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--shell-ok)]" />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  复制诊断
                </>
              )}
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
