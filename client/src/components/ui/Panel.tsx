import type { ReactNode } from 'react';

/** A bordered surface with an optional small-caps title. Host and phone use it. */
export function Panel({
  title,
  aside,
  className = '',
  children,
}: {
  title?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || aside) && (
        <div className="panel__head">
          {title && <h2 className="panel__title">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
