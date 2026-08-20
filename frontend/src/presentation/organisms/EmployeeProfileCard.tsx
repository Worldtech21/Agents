import type { EmployeeProfileVM } from '@bff/viewmodels';
import { Skeleton } from '@presentation/atoms/Skeleton';
import styles from '@presentation/organisms/organisms.module.css';

export function EmployeeProfileCard({ employee }: { employee: EmployeeProfileVM }) {
  return (
    <section className={styles.profileCard} aria-label="Joiner profile">
      <div className={styles.profileIdentity}>
        <div className={styles.profileTop}>
          <div className={styles.avatar} aria-hidden="true">
            {employee.initials}
          </div>
          <div className={styles.profileNames}>
            <h3 className={styles.profileName}>{employee.name}</h3>
            <span className={styles.profileSub}>
              {employee.employeeId} · {employee.statusLabel}
            </span>
          </div>
        </div>
        <p className={styles.profileHeadline}>{employee.headline}</p>
      </div>

      <dl className={styles.profileFields}>
        {employee.fields.map((field) => (
          <div key={field.label} className={styles.field}>
            <dt className={styles.fieldLabel}>{field.label}</dt>
            <dd className={styles.fieldValue} style={{ margin: 0 }}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function EmployeeProfileCardSkeleton() {
  return (
    <section className={styles.profileCard} aria-hidden="true">
      <div className={styles.profileIdentity}>
        <div className={styles.profileTop}>
          <Skeleton width="56px" height="56px" shape="pill" />
          <div className={styles.profileNames} style={{ flex: 1 }}>
            <Skeleton width="60%" height="30px" />
            <Skeleton width="40%" height="14px" style={{ marginTop: 6 }} />
          </div>
        </div>
        <Skeleton width="80%" height="17px" />
      </div>
      <div className={styles.profileFields}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className={styles.field}>
            <Skeleton width="56px" height="12px" />
            <Skeleton width="82%" height="14px" style={{ marginTop: 4 }} />
          </div>
        ))}
      </div>
    </section>
  );
}
