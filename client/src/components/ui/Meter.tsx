import type { ReactNode } from 'react';

/**
 * Submission progress. Shown large on the TV and small on the host panel so
 * both surfaces read the same number the same way.
 */
export function Meter({
  value,
  max,
  label,
  aside,
  tv = false,
}: {
  value: number;
  max: number;
  label: string;
  aside?: ReactNode;
  tv?: boolean;
}): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const done = max > 0 && value >= max;

  return (
    <div className={`meter${tv ? ' meter--tv' : ''}${done ? ' meter--done' : ''}`}>
      <div className="meter__track">
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="meter__label">
        <span>{label}</span>
        {aside}
      </p>
    </div>
  );
}
