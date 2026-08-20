/**
 * Provider stack.
 *
 * Order matters: the query client wraps everything that fetches, the theme
 * provider owns `data-theme` before the first paint, and one error boundary
 * sits outside the shell so a crash there still renders something.
 */

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from '@application/queryClient';
import { NavigationProvider } from '@application/state/NavigationProvider';
import { QueueProvider } from '@application/state/QueueProvider';
import { ThemeProvider } from '@application/state/ThemeProvider';
import { AppShell } from '@presentation/layout/AppShell';
import { ErrorBoundary } from '@presentation/layout/ErrorBoundary';

export function App() {
  // Created once per mount rather than at module scope, so a test or an HMR
  // reload gets a clean cache instead of inheriting the previous one.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NavigationProvider>
          <QueueProvider>
            <ErrorBoundary label="app">
              <AppShell />
            </ErrorBoundary>
          </QueueProvider>
        </NavigationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
