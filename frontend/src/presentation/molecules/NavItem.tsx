import type { NavItemVM } from '@bff/viewmodels';
import { Icon } from '@presentation/atoms/Icon';
import styles from '@presentation/molecules/molecules.module.css';

export interface NavItemProps {
  readonly item: NavItemVM;
  readonly active: boolean;
  readonly onSelect: (key: NavItemVM['key']) => void;
}

export function NavItem({ item, active, onSelect }: NavItemProps) {
  return (
    <button
      type="button"
      className={[styles.navItem, active ? styles.navItemActive : ''].filter(Boolean).join(' ')}
      onClick={() => onSelect(item.key)}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      <span className={styles.navBadge}>{item.badge}</span>
    </button>
  );
}
