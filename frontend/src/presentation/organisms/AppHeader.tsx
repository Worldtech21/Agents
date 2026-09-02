/**
 * The breadcrumb, title, employee-id field and run button.
 *
 * The run button is the single entry point to a supervisor run; while one is in
 * flight it becomes the cancel affordance, because an abandoned six-worker run
 * costs real tokens.
 *
 * `showRunControl` is false in employee mode: analysing a named joiner is HR's
 * job, and an employee has no business typing somebody else's id. The
 * breadcrumb and title stay, so the header still says where you are.
 */

import { type FormEvent, type ReactNode } from 'react';

import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import styles from '@presentation/organisms/organisms.module.css';
import atoms from '@presentation/atoms/atoms.module.css';

export interface AppHeaderProps {
  readonly crumb: string;
  readonly title: string;
  readonly employeeId: string;
  readonly onEmployeeIdChange: (value: string) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly isRunning: boolean;
  readonly disabled: boolean;
  /** False in employee mode, where there is nothing to run. */
  readonly showRunControl?: boolean;
  /** Controls the screen below owns — they sit here so no screen has to spend
      a strip of its own on a toolbar. */
  readonly viewActions?: ReactNode;
}

export function AppHeader({
  crumb,
  title,
  employeeId,
  onEmployeeIdChange,
  onRun,
  onCancel,
  isRunning,
  disabled,
  showRunControl = true,
  viewActions,
}: AppHeaderProps) {
  // Enter in the id field reaches this via implicit submission. It has to
  // re-check `disabled` itself: that guard used to be carried by the submit
  // button, and the form no longer has one.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isRunning && !disabled) onRun();
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerTitles}>
        <span className={styles.crumb}>{crumb}</span>
        <h3 className={styles.title}>{title}</h3>
      </div>

      <div className={styles.headerActions}>
        {viewActions}

        {!showRunControl ? null : (
          <form className={styles.headerRunForm} onSubmit={submit} role="search">
            <div className={styles.searchField}>
              <Icon name="search" size={15} stroke="var(--ink-48)" />
              <input
                className={styles.searchInput}
                value={employeeId}
                onChange={(event) => onEmployeeIdChange(event.target.value)}
                placeholder="Employee ID"
                aria-label="Employee ID"
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {/* Distinct keys, and neither button is a submit: the two states
                must never reconcile onto one DOM node. Sharing a node let a
                click land on cancel, flip the reused node to `type="submit"`
                during React's synchronous discrete-event flush, and then have
                the browser submit the form — cancelling the run and starting
                a fresh one on the same click. Enter still runs, via the
                form's implicit submission. */}
            {isRunning ? (
              <Button key="cancel" type="button" variant="primary" size="lg" busy onClick={onCancel}>
                <Icon name="spin" size={14} className={atoms.spinner} strokeWidth={1.8} />
                Cancel run
              </Button>
            ) : (
              <Button
                key="run"
                type="button"
                variant="primary"
                size="lg"
                disabled={disabled}
                onClick={onRun}
              >
                <Icon name="play" size={14} fill="currentColor" strokeWidth={1.8} />
                Run recommendation
              </Button>
            )}
          </form>
        )}
      </div>
    </header>
  );
}
