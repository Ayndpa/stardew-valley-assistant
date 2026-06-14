import React from "react"
import { ErrorPage } from "./ErrorPage"

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: string | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private originalOnError: typeof window.onerror | null = null
  private originalOnUnhandledRejection: ((this: WindowEventHandlers, ev: PromiseRejectionEvent) => any) | null = null

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)
    this.setState({ error, errorInfo: errorInfo.componentStack ?? null })
  }

  componentDidMount() {
    this.originalOnError = window.onerror
    this.originalOnUnhandledRejection = window.onunhandledrejection

    window.onerror = (_message, _source, _lineno, _colno, error) => {
      if (error) {
        this.setState({ hasError: true, error, errorInfo: error.stack ?? null })
      }
      return true
    }

    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.setState({ hasError: true, error, errorInfo: error.stack ?? null })
    }
  }

  componentWillUnmount() {
    window.onerror = this.originalOnError
    window.onunhandledrejection = this.originalOnUnhandledRejection
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorPage
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
      )
    }

    return this.props.children
  }
}
