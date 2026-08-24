/**
 * The persistent left rail: brand, persona, navigation, agent mesh, governance
 * notice, appearance toggle.
 *
 * The mesh is live — dot colour reflects whether each worker's MCP servers are
 * connected right now, and the row highlights while that worker is producing
 * trace steps.
 */

import { TONE_VARIABLE } from '@bff/tone';
import type {
  MeshSummaryVM,
  NavItemVM,
  PersonaVM,
  ServiceHealthVM,
  ViewKey,
} from '@bff/viewmodels';
import { Button } from '@presentation/atoms/Button';
import { Icon } from '@presentation/atoms/Icon';
import { AgentMeshRow, AgentMeshRowSkeleton } from '@presentation/molecules/AgentMeshRow';
import { NavItem } from '@presentation/molecules/NavItem';
import { PersonaSwitcher } from '@presentation/organisms/PersonaSwitcher';
import styles from '@presentation/organisms/organisms.module.css';

export interface SidebarProps {
  readonly navItems: readonly NavItemVM[];
  readonly activeView: ViewKey;
  readonly onNavigate: (view: ViewKey) => void;
  readonly personas: readonly PersonaVM[];
  readonly actor: PersonaVM | null;
  readonly personasLoading: boolean;
  readonly onSelectPersona: (actorId: string) => void;
  readonly mesh: MeshSummaryVM;
  readonly meshLoading: boolean;
  readonly activeAgentKey: string | null;
  readonly health: ServiceHealthVM | undefined;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
}

export function Sidebar({
  navItems,
  activeView,
  onNavigate,
  personas,
  actor,
  personasLoading,
  onSelectPersona,
  mesh,
  meshLoading,
  activeAgentKey,
  health,
  theme,
  onToggleTheme,
}: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Icon name="shield" size={21} stroke="var(--blue)" />
        <div className={styles.brandText}>
          <span className={styles.brandName}>Access Advisor</span>
          <span className={styles.brandTagline}>Entitlement recommendations</span>
        </div>
      </div>

      <PersonaSwitcher
        personas={personas}
        actor={actor}
        isLoading={personasLoading}
        onSelect={onSelectPersona}
      />

      <nav className={styles.nav} aria-label="Primary">
        {navItems.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            active={item.key === activeView}
            onSelect={onNavigate}
          />
        ))}
      </nav>

      <div className={styles.meshSection}>
        <div className={styles.meshHeader}>
          <span className={styles.meshTitle}>Agent mesh</span>
          <span className={styles.meshStatus} style={{ color: TONE_VARIABLE[mesh.tone] }}>
            {mesh.label}
          </span>
        </div>
        <div className={styles.meshList}>
          {meshLoading
            ? Array.from({ length: 7 }, (_, index) => <AgentMeshRowSkeleton key={index} />)
            : mesh.agents.map((agent) => (
                <AgentMeshRow
                  key={agent.key}
                  agent={agent}
                  active={agent.key === activeAgentKey}
                />
              ))}
        </div>
        {health ? (
          <span className={styles.healthLine}>
            {health.providerLabel} · {health.supervisorModel} · {health.connectedServerCount}/
            {health.configuredServerCount} MCP connected
          </span>
        ) : null}
      </div>

      <div className={styles.sidebarFooter}>
        {/* This said "read-only service" until access requests were wired up.
            The claim has to track what the app actually does. */}
        <div className={styles.notice}>
          <span className={styles.noticeTitle}>How decisions are made</span>
          <p className={styles.noticeBody}>
            The agents only ever read. Whether access needs approval is decided from policy, and
            granting happens only after you confirm — or after a manager approves.
          </p>
        </div>
        <Button variant="quiet" size="sm" onClick={onToggleTheme}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
          {theme === 'light' ? 'Dark appearance' : 'Light appearance'}
        </Button>
      </div>
    </aside>
  );
}
