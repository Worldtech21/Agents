import type { AgentMeshItemVM } from '@bff/viewmodels';
import { Skeleton } from '@presentation/atoms/Skeleton';
import { StatusDot } from '@presentation/atoms/StatusDot';
import styles from '@presentation/molecules/molecules.module.css';

export interface AgentMeshRowProps {
  readonly agent: AgentMeshItemVM;
  readonly active: boolean;
}

export function AgentMeshRow({ agent, active }: AgentMeshRowProps) {
  return (
    <div
      className={[styles.meshRow, active ? styles.meshRowActive : ''].filter(Boolean).join(' ')}
      title={`${agent.name} — ${agent.statusLabel}. ${agent.description}`}
    >
      <StatusDot tone={agent.tone} size="sm" pulsing={active} className={styles.meshDot} />
      <span className={styles.meshName}>{agent.name}</span>
      <span className={styles.meshTools} aria-label={`${agent.toolsLabel} tools`}>
        {agent.toolsLabel}
      </span>
    </div>
  );
}

export function AgentMeshRowSkeleton() {
  return (
    <div className={styles.meshRow}>
      <Skeleton width="6px" height="6px" shape="pill" className={styles.meshDot} />
      <Skeleton width="72%" height="12px" />
      <Skeleton width="10px" height="11px" />
    </div>
  );
}
