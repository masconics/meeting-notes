import { Component, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { AlertCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="flex justify-center">
              <HugeiconsIcon icon={AlertCircleIcon} className="size-10 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-pretty text-muted-foreground">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <p className="text-xs text-muted-foreground">
              Your notes are stored on this Mac — try again, or restart the app if this keeps happening.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </Button>
              <Button
                variant="ghost"
                onClick={() => window.location.reload()}
              >
                Reload app
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
