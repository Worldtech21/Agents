/**
 * Composition root.
 *
 * The one place where hooks meet screens: it reads application state, asks the
 * BFF for view models, and hands screens nothing but view models and callbacks.
 * No screen below this file imports a hook or a wire type.
 */

import { useCallback, useMemo, useState } from 'react';

import { useAgentRoster, useMcpStatus } from '@application/hooks/useAgentMesh';
import { useConsole } from '@application/hooks/useConsole';
import {
  normaliseEmployeeId,
  useRecommendationOutcomes,
  useRecommendationRun,
} from '@application/hooks/useRecommendation';
import { useServiceHealth } from '@application/hooks/useServiceHealth';
import { useNavigation } from '@application/state/NavigationProvider';
import { useQueue } from '@application/state/QueueProvider';
import { useTheme } from '@application/state/ThemeProvider';
import { toMeshSummary } from '@bff/mappers/agents.mapper';
import { buildSuggestions } from '@bff/mappers/chat.mapper';
import { toQueueRows, toQueueStats } from '@bff/mappers/queue.mapper';
import { toTracePanel } from '@bff/mappers/trace.mapper';
import type { NavItemVM, ViewKey } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { ErrorBoundary } from '@presentation/layout/ErrorBoundary';
import styles from '@presentation/layout/layout.module.css';
import { AppHeader } from '@presentation/organisms/AppHeader';
import { Sidebar } from '@presentation/organisms/Sidebar';
import { ConsoleScreen } from '@presentation/screens/ConsoleScreen';
import { QueueScreen } from '@presentation/screens/QueueScreen';
import { RecommendationScreen } from '@presentation/screens/RecommendationScreen';

export function AppShell() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { view, selectedEmployeeId, goTo, openReport } = useNavigation();
  const queue = useQueue();

  const health = useServiceHealth();
  const run = useRecommendationRun();

  const roster = useAgentRoster();
  const mcp = useMcpStatus();

  const agents = useMemo(() => roster.data ?? [], [roster.data]);
  const mcpServers = useMemo(() => mcp.data ?? [], [mcp.data]);

  const consoleState = useConsole(agents);
  const outcomes = useRecommendationOutcomes(queue.employeeIds);

  const [employeeField, setEmployeeField] = useState(selectedEmployeeId ?? '');

  /* --------------------------------------------------------------- trace --- */

  const selectedOutcome = selectedEmployeeId
    ? (outcomes.get(selectedEmployeeId) ?? (run.lastOutcome ?? undefined))
    : undefined;

  const trace = useMemo(
    () =>
      toTracePanel({
        envelopes: run.stream.envelopes,
        agents,
        running: run.isRunning,
        settled: run.lastOutcome !== null,
      }),
    [run.stream.envelopes, agents, run.isRunning, run.lastOutcome],
  );

  // The mesh is derived after the trace so the sidebar highlight follows the
  // delegation in the same render, rather than a frame behind it.
  const mesh = useMemo(
    () =>
      toMeshSummary({
        agents,
        mcpServers,
        activeAgentName: trace.activeAgentKey,
        running: run.isRunning,
        supervisorModel: health.data?.supervisorModel ?? null,
      }),
    [agents, mcpServers, trace.activeAgentKey, run.isRunning, health.data?.supervisorModel],
  );

  /* --------------------------------------------------------------- queue --- */

  const queueInput = useMemo(
    () => ({
      entries: queue.entries,
      outcomes,
      runningId: run.runningEmployeeId,
    }),
    [queue.entries, outcomes, run.runningEmployeeId],
  );

  const queueRows = useMemo(() => toQueueRows(queueInput), [queueInput]);
  const queueStats = useMemo(() => toQueueStats(queueInput), [queueInput]);

  /* ------------------------------------------------------------- actions --- */

  const startRun = useCallback(
    (rawId: string) => {
      const employeeId = normaliseEmployeeId(rawId);
      if (!employeeId) return;

      queue.add(employeeId);
      queue.markRun(employeeId);
      setEmployeeField(employeeId);
      openReport(employeeId);
      void run.run(employeeId).catch(() => {
        // Reported through `run.stream.error`; the screen renders it.
      });
    },
    [openReport, queue, run],
  );

  const navItems = useMemo<NavItemVM[]>(
    () => [
      { key: 'queue', label: 'Queue', icon: 'queue', badge: String(queue.entries.length) },
      {
        key: 'report',
        label: 'Recommendation',
        icon: 'report',
        badge: selectedEmployeeId ?? '—',
      },
      { key: 'chat', label: 'Console', icon: 'chat', badge: String(consoleState.messages.length) },
    ],
    [queue.entries.length, selectedEmployeeId, consoleState.messages.length],
  );

  const suggestions = useMemo(
    () => buildSuggestions({ latest: run.lastOutcome ?? selectedOutcome ?? null, agents }),
    [run.lastOutcome, selectedOutcome, agents],
  );

  const headerCopy = buildHeaderCopy(view, {
    employeeId: selectedEmployeeId,
    employeeName:
      selectedOutcome?.kind === 'recommendation' ? selectedOutcome.view.employee.name : null,
    threadId: run.stream.threadId,
  });

  const bootError = health.isError
    ? (health.error as Error)
    : ((roster.error ?? mcp.error) as Error | null);

  return (
    <div className={styles.shell}>
      <Sidebar
        navItems={navItems}
        activeView={view}
        onNavigate={goTo}
        mesh={mesh}
        meshLoading={roster.isLoading || mcp.isLoading}
        activeAgentKey={trace.activeAgentKey}
        health={health.data}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className={styles.main}>
        <AppHeader
          crumb={headerCopy.crumb}
          title={headerCopy.title}
          employeeId={employeeField}
          onEmployeeIdChange={setEmployeeField}
          onRun={() => startRun(employeeField)}
          onCancel={run.cancel}
          isRunning={run.isRunning}
          disabled={employeeField.trim().length === 0 || health.data?.ready === false}
        />

        {health.data && !health.data.ready ? (
          <div className={styles.banner} role="alert">
            <span className={styles.bannerMessage}>
              The graph is not ready — {health.data.error ?? 'the service reported a degraded state'}
              . Runs will fail until it recovers.
            </span>
            <Button
              variant="outline"
              size="sm"
              className={styles.bannerActions}
              onClick={() => void health.refetch()}
            >
              Re-check
            </Button>
          </div>
        ) : null}

        <ErrorBoundary label={`screen:${view}`} resetKey={view}>
          {view === 'queue' ? (
            <QueueScreen
              rows={queueRows}
              stats={queueStats}
              isBootstrapping={health.isLoading || roster.isLoading || mcp.isLoading}
              bootError={bootError}
              onRetryBoot={() => {
                void health.refetch();
                void roster.refetch();
                void mcp.refetch();
              }}
              runningEmployeeId={run.runningEmployeeId}
              onAdd={queue.add}
              onRun={startRun}
              onOpen={openReport}
              onRemove={queue.remove}
            />
          ) : null}

          {view === 'report' ? (
            <RecommendationScreen
              // Remount per joiner: entitlement selections and the payload
              // panel belong to one report, not to the screen.
              key={selectedEmployeeId ?? 'none'}
              employeeId={selectedEmployeeId}
              outcome={selectedOutcome}
              isRunning={run.isRunning}
              runError={run.stream.error}
              trace={trace}
              onRun={startRun}
              onGoToQueue={() => goTo('queue')}
            />
          ) : null}

          {view === 'chat' ? (
            <ConsoleScreen
              messages={consoleState.messages}
              suggestions={suggestions}
              isBusy={consoleState.isBusy}
              error={consoleState.error}
              onAsk={(question) => void consoleState.ask(question)}
              onCancel={consoleState.cancel}
            />
          ) : null}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function buildHeaderCopy(
  view: ViewKey,
  context: {
    employeeId: string | null;
    employeeName: string | null;
    threadId: string | null;
  },
): { crumb: string; title: string } {
  switch (view) {
    case 'queue':
      return {
        crumb: 'Autonomous mode · HR onboarding handoff',
        title: 'Provisioning queue',
      };
    case 'report':
      return {
        crumb: context.threadId
          ? `Recommendation · thread ${context.threadId.slice(0, 8)}`
          : 'Recommendation',
        title: context.employeeName ?? context.employeeId ?? 'No joiner selected',
      };
    case 'chat':
      return {
        crumb: 'Self-service · read-only questions',
        title: 'Access governance',
      };
  }
}
