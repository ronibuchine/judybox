import { useEffect, useRef, useState } from 'react';
import type { SpecialNoteInput } from '@judybox/shared';

/**
 * The special player's comment box.
 *
 * Deliberately explicit rather than clever: an explanatory hint, a visible
 * character budget, and a manual Save. Nothing about it should be guessable.
 */
export function SpecialNoteEditor({
  note,
  onSave,
}: {
  note: SpecialNoteInput;
  onSave: (text: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(note.value);
  const savedValueRef = useRef(note.value);

  // Adopt server-side changes (refresh, reconnect, new round) without
  // discarding text the player is still typing.
  useEffect(() => {
    if (note.value !== savedValueRef.current) {
      savedValueRef.current = note.value;
      setDraft(note.value);
    }
  }, [note.value]);

  const trimmed = draft.trim();
  const savedValue = note.value.trim();
  const hasChanges = trimmed !== savedValue;
  const remaining = note.maxLength - draft.length;

  if (!note.editable) {
    return (
      <section className="note note--readonly">
        <p className="note__label">{note.label}</p>
        <p className="note__hint">{note.hint}</p>
        {note.value ? (
          <p className="note__saved-text">&ldquo;{note.value}&rdquo;</p>
        ) : (
          <p className="note__hint">You didn&rsquo;t add one this round.</p>
        )}
      </section>
    );
  }

  return (
    <section className="note">
      <label className="note__label" htmlFor="special-note">
        {note.label}
      </label>
      <p className="note__hint">{note.hint}</p>
      <textarea
        id="special-note"
        className="note__input"
        value={draft}
        maxLength={note.maxLength}
        rows={3}
        placeholder={note.placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="note__footer">
        <span className={`note__count${remaining <= 20 ? ' note__count--low' : ''}`}>
          {remaining} left
        </span>
        <button
          type="button"
          className="button button--quiet note__save"
          disabled={!hasChanges}
          onClick={() => {
            savedValueRef.current = trimmed;
            onSave(trimmed);
          }}
        >
          {!hasChanges && savedValue !== '' ? 'Saved' : 'Save comment'}
        </button>
      </div>
      {!hasChanges && savedValue !== '' && (
        <p className="note__status">Ready. This appears on the TV at the reveal.</p>
      )}
      {hasChanges && trimmed !== '' && (
        <p className="note__status note__status--pending">Not saved yet — tap Save comment.</p>
      )}
    </section>
  );
}
