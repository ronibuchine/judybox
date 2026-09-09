/** Any "nothing to do yet" state on the phone or the TV. */
export function WaitingState({ title, sub }: { title?: string; sub?: string }): JSX.Element {
  return (
    <div className="waiting">
      <span className="waiting__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {title && <p className="waiting__title">{title}</p>}
      {sub && <p className="waiting__sub">{sub}</p>}
    </div>
  );
}
