import type { ReactNode } from 'react';

type Tone = 'neutral' | 'special' | 'ok' | 'miss' | 'accent';

/** Small status pill. Tone carries the meaning; the label carries the words. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
