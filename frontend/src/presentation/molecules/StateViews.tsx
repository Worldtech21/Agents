/**
 * Empty, error and refusal states.
 *
 * The design has no drawing for "nothing here yet" because its data was
 * hard-coded. Against a live service these are load-bearing: an unreachable
 * backend, a supervisor refusal and an empty queue are all ordinary outcomes,
 * and each says what happened and what to do next rather than showing a blank
 * panel.
 */

import type { ReactNode } from 'react';

import type { SupervisorRefusalVM } from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Icon, type IconName } from '@presentation/atoms/Icon';
import styles from '@presentation/molecules/molecules.module.css';

export interface StateViewProps {
  readonly icon?: IconName;
  readonly tone?: 'default' | 'warn';
  readonly title: string;
  readonly body: ReactNode;
  readonly detail?: string | null;
  readonly actions?: ReactNode;
  readonly inline?: boolean;
}

export function StateView({
  icon = 'alert',
  tone = 'default',
  title,
  body,
  detail = null,
  actions,
  inline = false,
}: StateViewProps) {
  return (
    <div
      className={[styles.state, inline ? styles.stateInline : ''].filter(Boolean).join(' ')}
      role={tone === 'warn' ? 'alert' : undefined}
    >
      <span
        className={[styles.stateIcon, tone === 'warn' ? styles.stateIconWarn : '']
          .filter(Boolean)
          .join(' ')}
      >
        <Icon name={icon} size={20} />
      </span>
      <h4 className={styles.stateTitle}>{title}</h4>
      <p className={styles.stateBody}>{body}</p>
      {detail ? <pre className={styles.stateDetail}>{detail}</pre> : null}
      {actions ? <div className={styles.stateActions}>{actions}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  readonly title?: string;
  readonly error: Error | null;
  readonly onRetry?: () => void;
  readonly inline?: boolean;
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, inline }: ErrorStateProps) {
  return (
    <StateView
      icon="alert"
      tone="warn"
      title={title}
      body={error?.message ?? 'The request failed without a message.'}
      inline={inline ?? false}
      actions={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <Icon name="replay" size={14} />
            Try again
          </Button>
        ) : null
      }
    />
  );
}

/**
 * A supervisor refusal — `MISSING_EMPLOYEE_ID` and friends.
 *
 * Rendered as an answer rather than an error: the supervisor did its job and
 * said why it could not continue.
 */
export function RefusalState({
  refusal,
  actions,
}: {
  refusal: SupervisorRefusalVM;
  actions?: ReactNode;
}) {
  return (
    <StateView
      icon="alert"
      tone="warn"
      title={refusal.title}
      body={refusal.message}
      detail={`code: ${refusal.code}${refusal.threadId ? `\nthread: ${refusal.threadId}` : ''}`}
      actions={actions ?? null}
    />
  );
}

/** The supervisor replied, but not in the JSON shape its contract requires. */
export function MalformedReplyState({
  reason,
  raw,
  actions,
}: {
  reason: string;
  raw: string;
  actions?: ReactNode;
}) {
  return (
    <StateView
      icon="alert"
      tone="warn"
      title="The reply did not match the output contract"
      body={reason}
      detail={raw ? raw.slice(0, 1200) : null}
      actions={actions ?? null}
    />
  );
}
