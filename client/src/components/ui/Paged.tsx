import { useEffect, useState, type ReactNode } from 'react';

/** How long each page of a TV gallery stays up before it rotates. */
const PAGE_MS = 6000;

export interface PagedEntry<T> {
  item: T;
  index: number;
}

/**
 * Pages a gallery that cannot fit on one screen, rotating slowly so the TV
 * never scrolls. Once a winner exists the rotation stops on that page.
 */
export function Paged<T>({
  items,
  perPage,
  focusIndex = null,
  children,
}: {
  items: readonly T[];
  perPage: number;
  focusIndex?: number | null;
  children: (entries: PagedEntry<T>[]) => ReactNode;
}): JSX.Element {
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const locked = focusIndex !== null && focusIndex >= 0;
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [items.length, perPage]);

  useEffect(() => {
    if (locked || pageCount <= 1) return;
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % pageCount),
      PAGE_MS,
    );
    return () => window.clearInterval(timer);
  }, [locked, pageCount]);

  const active = locked
    ? Math.floor((focusIndex as number) / perPage)
    : Math.min(page, pageCount - 1);
  const start = active * perPage;
  const entries = items
    .slice(start, start + perPage)
    .map((item, offset) => ({ item, index: start + offset }));

  return (
    <div className="paged">
      <div className="paged__page" key={active}>
        {children(entries)}
      </div>
      {pageCount > 1 && (
        <div className="paged__dots" aria-hidden="true">
          {Array.from({ length: pageCount }, (_, index) => (
            <span
              key={index}
              className={`paged__dot${index === active ? ' paged__dot--on' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
