/**
 * Composition root.
 *
 * The one place where hooks meet screens: it reads application state, asks the
 * BFF for view models, and hands screens nothing but view models and callbacks.
 * No screen below this file imports a hook or a wire type.
 *
 * Two personas share this shell. Rather than branch hook-by-hook, each mode's
 * wiring lives in its own hook — `useHrShell` and `useEmployeeShell` — and this
 * file stays composition, as its name claims.
 */

import { useCallback, useMemo, useState } from 'react';

import { useAgentRoster, useMcpStatus } from '@application/hooks/useAgentMesh';
import { useConsole } from '@application/hooks/useConsole';
import { useEmployeeShell } from '@application/hooks/useEmployeeShell';
import { useHrShell } from '@application/hooks/useHrShell';
import {
  normaliseEmployeeId,
  useRecommendationOutcomes,
  useRecommendationRun,
} from '@application/hooks/useRecommendation';
import { useServiceHealth } from '@application/hooks/useServiceHealth';
import { useNavigation } from '@application/state/NavigationProvider';
import { usePersona } from '@application/state/PersonaProvider';
import { useQueue } from '@application/state/QueueProvider';
import { useTheme } from '@application/state/ThemeProvider';
import { toMeshSummary } from '@bff/mappers/agents.mapper';
import { buildSuggestions } from '@bff/mappers/chat.mapper';
import { toQueueRows, toQueueStats } from '@bff/mappers/queue.mapper';
import { toTracePanel } from '@bff/mappers/trace.mapper';
import type { ActorMode, ViewKey } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { ErrorBoundary } from '@presentation/layout/ErrorBoundary';
import styles from '@presentation/layout/layout.module.css';
import { AppHeader } from '@presentation/organisms/AppHeader';
import { Sidebar } from '@presentation/organisms/Sidebar';
import { AssistantScreen } from '@presentation/screens/AssistantScreen';
import { ConsoleScreen } from '@presentation/screens/ConsoleScreen';
import { QueueScreen } from '@presentation/screens/QueueScreen';
import { RecommendationScreen } from '@presentation/screens/RecommendationScreen';
import { RequestsScreen } from '@presentation/screens/RequestsScreen';

export function AppShell() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { view, selectedEmployeeId, goTo, openReport } = useNavigation();
  const persona = usePersona();
  const queue = useQueue();

  const health = useServiceHealth();
  const run = useRecommendationRun();

  const roster = useAgentRoster();
  const mcp = useMcpStatus();

  const agents = useMemo(() => roster.data ?? [], [roster.data]);
  const mcpServers = useMemo(() => mcp.data ?? [], [mcp.data]);

  const consoleState = useConsole(agents);
  const outcomes = useRecommendationOutcomes(queue.employeeIds);

  // Both are mounted regardless of mode: a hook cannot be called conditionally,
  // and their queries are disabled when there is no actor to scope them to.
  const hr = useHrShell(queue.entries.length, selectedEmployeeId);
  const employee = useEmployeeShell();

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

  const navItems = persona.mode === 'hr' ? hr.navItems : employee.navItems;

  const suggestions = useMemo(
    () => buildSuggestions({ latest: run.lastOutcome ?? selectedOutcome ?? null, agents }),
    [run.lastOutcome, selectedOutcome, agents],
  );

  const headerCopy = buildHeaderCopy(view, persona.mode, {
    employeeId: selectedEmployeeId,
    employeeName:
      selectedOutcome?.kind === 'recommendation' ? selectedOutcome.view.employee.name : null,
    threadId: run.stream.threadId,
    actorName: persona.actor?.name ?? null,
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
        personas={persona.personas}
        actor={persona.actor}
        personasLoading={persona.isLoading}
        onSelectPersona={persona.setActor}
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
          // The run control is HR's; an employee never analyses somebody else.
          showRunControl={persona.mode === 'hr'}
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
              agents={agents}
              onRun={startRun}
              onGoToQueue={() => goTo('queue')}
              onSubmitRequests={(ids) => void hr.submitRequests(ids)}
              isSubmitting={hr.isSubmitting}
              submitSummary={hr.submitSummary}
            />
          ) : null}

          {view === 'hrRequests' ? (
            <RequestsScreen
              rows={hr.history.rows}
              isLoading={hr.history.isLoading}
              error={hr.history.error}
              emptyTitle="No access requests yet"
              emptyBody="Run a recommendation for a joiner and submit the entitlements you accept. What is granted immediately, and what is waiting on a manager, will show here."
              onRetry={hr.history.refetch}
            />
          ) : null}

          {view === 'chat' ? (
            <ConsoleScreen
              messages={consoleState.messages}
              suggestions={suggestions}
              isBusy={consoleState.isBusy}
              error={consoleState.error}
              liveThoughts={consoleState.liveThoughts}
              onAsk={(question) => void consoleState.ask(question)}
              onCancel={consoleState.cancel}
            />
          ) : null}

          {view === 'assistant' ? (
            <AssistantScreen
              turns={employee.assistant.turns}
              employeeName={persona.actor?.name ?? 'there'}
              isBusy={employee.assistant.isBusy}
              error={employee.assistant.error}
              liveThoughts={employee.assistant.liveThoughts}
              verdict={employee.verdict.verdict}
              verdictLoading={employee.verdict.isLoading}
              verdictError={employee.verdict.error}
              isSubmitting={employee.raise.isRaising}
              onAsk={(question) => void employee.assistant.ask(question)}
              onConfirm={(verdict) => void employee.confirm(verdict)}
              onDismissVerdict={employee.assistant.clearIntent}
              onCancel={employee.assistant.cancel}
            />
          ) : null}

          {view === 'approvals' ? (
            <RequestsScreen
              rows={employee.inbox.rows}
              isLoading={employee.inbox.isLoading}
              error={employee.inbox.error}
              emptyTitle="Nothing waiting on you"
              emptyBody="When somebody who reports to you asks for access that needs approval, it will appear here for you to approve or reject."
              onRetry={employee.inbox.refetch}
              onDecide={employee.decide}
              decidingId={employee.decision.decidingId}
              decisionError={employee.decision.error}
            />
          ) : null}

          {view === 'myRequests' ? (
            <RequestsScreen
              rows={employee.history.rows}
              isLoading={employee.history.isLoading}
              error={employee.history.error}
              emptyTitle="You have not asked for anything yet"
              emptyBody="Ask the assistant for the access you need. Whatever you request will show here, along with your manager's decision and their reason."
              onRetry={employee.history.refetch}
            />
          ) : null}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function buildHeaderCopy(
  view: ViewKey,
  mode: ActorMode,
  context: {
    employeeId: string | null;
    employeeName: string | null;
    threadId: string | null;
    actorName: string | null;
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
    case 'hrRequests':
      return { crumb: 'HR · raised for new joiners', title: 'Access requests' };
    case 'chat':
      return { crumb: 'Governance · read-only questions', title: 'Access governance' };
    case 'assistant':
      return {
        crumb: `Self-service · ${context.actorName ?? 'employee'}`,
        title: 'Request access',
      };
    case 'approvals':
      return { crumb: 'Manager · waiting on your decision', title: 'Approvals' };
    case 'myRequests':
      return {
        crumb: `Self-service · ${context.actorName ?? 'employee'}`,
        title: 'My requests',
      };
    default:
      // `mode` decides which views exist; an unreachable one is a bug, not a
      // state to render.
      return { crumb: mode, title: 'Access Advisor' };
  }
}
