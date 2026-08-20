/**
 * The breadcrumb, title, employee-id field and run button.
 *
 * The run button is the single entry point to a supervisor run; while one is in
 * flight it becomes the cancel affordance, because an abandoned six-worker run
 * costs real tokens.
 */

import { type FormEvent } from 'react';

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
}: AppHeaderProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isRunning) onRun();
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerTitles}>
        <span className={styles.crumb}>{crumb}</span>
        <h3 className={styles.title}>{title}</h3>
      </div>

      <form className={styles.headerActions} onSubmit={submit} role="search">
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

        {isRunning ? (
          <Button type="button" variant="primary" size="lg" busy onClick={onCancel}>
            <Icon name="spin" size={14} className={atoms.spinner} strokeWidth={1.8} />
            Cancel run
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="lg" disabled={disabled}>
            <Icon name="play" size={14} fill="currentColor" strokeWidth={1.8} />
            Run recommendation
          </Button>
        )}
      </form>
    </header>
  );
}
