import type { ReactNode } from 'react';

/**
 * The TV's single layout primitive: an optional kicker, a headline, a
 * subheading, then whatever the state needs. Every display state uses it, so
 * type sizes and rhythm stay identical between games.
 */
export function Stage({
  kicker,
  title,
  titleSize = 'lg',
  sub,
  footer,
  children,
}: {
  kicker?: ReactNode;
  title?: ReactNode;
  titleSize?: 'lg' | 'sm';
  sub?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section className="stage">
      {kicker !== undefined && <p className="stage__kicker">{kicker}</p>}
      {title !== undefined && (
        <h2 className={`stage__title${titleSize === 'sm' ? ' stage__title--sm' : ''}`}>{title}</h2>
      )}
      {sub !== undefined && <p className="stage__sub">{sub}</p>}
      {children !== undefined && <div className="stage__body">{children}</div>}
      {footer !== undefined && <div className="stage__footer">{footer}</div>}
    </section>
  );
}
