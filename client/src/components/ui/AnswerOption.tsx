import type { ReactNode } from 'react';

/** A, B, C… Shared by the phone's answer buttons and the TV's option list. */
export const OPTION_KEYS = 'ABCDEFGH';

export function optionKey(index: number): string {
  return OPTION_KEYS[index] ?? String(index + 1);
}

/** A tappable answer on the phone. Full-width, thumb-sized, one per line. */
export function AnswerOption({
  index,
  label,
  selected,
  dimmed,
  disabled,
  onClick,
}: {
  index: number;
  label: ReactNode;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const classes = [
    'answer',
    selected ? 'answer--selected' : '',
    dimmed ? 'answer--dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick}>
      <span className="answer__key">{optionKey(index)}</span>
      <span className="answer__label">{label}</span>
      {selected && (
        <span className="answer__mark" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  );
}
