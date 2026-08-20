/**
 * Render-time error containment.
 *
 * React Query already routes *request* failures into `error` state, so this
 * catches the other kind: a component that threw while rendering. One boundary
 * wraps the shell (so a crash never leaves a blank page) and one wraps each
 * screen (so a bad recommendation payload cannot take the navigation with it).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@presentation/atoms/Button';
import { StateView } from '@presentation/molecules/StateViews';
import styles from '@presentation/layout/layout.module.css';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Shown instead of the default panel. */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Changing this resets the boundary — used to clear a crash on navigation. */
  readonly resetKey?: string | number;
  readonly label?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as console output rather than a reporting call: this app ships with
    // no telemetry backend, and swallowing the stack would be worse.
    console.error(`[${this.props.label ?? 'ErrorBoundary'}]`, error, info.componentStack);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className={styles.boundary}>
        <div className={styles.boundaryInner}>
          <StateView
            icon="alert"
            tone="warn"
            title="This view could not be rendered"
            body="The screen hit an unexpected error. The rest of the console is unaffected."
            detail={error.message}
            actions={
              <Button variant="outline" size="sm" onClick={this.reset}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    );
  }
}
