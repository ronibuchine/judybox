import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  playerNameKey,
  DRAWING_GRID,
  MAX_PLAYER_NAME_LENGTH,
  type DrawStroke,
  type PlayerStanding,
  type PlayerView,
  type SessionSnapshot,
} from '@judybox/shared';
import { StatusBadge } from '../components/StatusBadge';
import { SpecialNoteEditor } from '../components/SpecialNoteEditor';
import { useJudyBox } from '../net/useJudyBox';

/** The phone surface: join with a name, then follow the server's view. */
export function PlayerScreen(): JSX.Element {
  const {
    status,
    self,
    session,
    playerView,
    standing,
    joinError,
    notice,
    join,
    submit,
    setSpecialNote,
    setSpecialPick,
    clearJoinError,
  } = useJudyBox('player');

  return (
    <main className="screen screen--phone">
      <header className="phone__header">
        <h1>JudyBox</h1>
        <StatusBadge status={status} />
      </header>

      {self ? (
        <>
          <PlayPanel
            name={self.name}
            isSpecial={self.role === 'SPECIAL'}
            session={session}
            view={playerView}
            notice={notice}
            onSubmit={submit}
            onSaveNote={setSpecialNote}
            onPick={setSpecialPick}
          />
          {standing && <StandingBar standing={standing} />}
        </>
      ) : (
        <JoinPanel
          session={session}
          disabled={status !== 'connected'}
          errorMessage={joinError?.message ?? null}
          onSubmit={join}
          onClearError={clearJoinError}
        />
      )}
    </main>
  );
}

function StandingBar({ standing }: { standing: PlayerStanding }): JSX.Element {
  return (
    <footer className="standing">
      <span className="standing__score">{standing.score.toLocaleString('en-US')}</span>
      <span className="standing__meta">
        Rank {standing.rank} of {standing.totalPlayers}
      </span>
      {standing.delta !== 0 && (
        <span className={`standing__delta${standing.delta > 0 ? '' : ' standing__delta--down'}`}>
          {standing.delta > 0 ? '+' : ''}
          {standing.delta.toLocaleString('en-US')}
        </span>
      )}
    </footer>
  );
}

interface PlayPanelProps {
  name: string;
  isSpecial: boolean;
  session: SessionSnapshot | null;
  view: PlayerView | null;
  notice: string | null;
  onSubmit: (value: string) => void;
  onSaveNote: (text: string) => void;
  onPick: (targetPlayerId: string) => void;
}

function PlayPanel({
  name,
  isSpecial,
  session,
  view,
  notice,
  onSubmit,
  onSaveNote,
  onPick,
}: PlayPanelProps): JSX.Element {
  if (!view || view.kind === 'idle') {
    const total = session?.players.length ?? 0;
    return (
      <section className="phone__body">
        <p className="phone__headline">You&rsquo;re in, {name}.</p>
        {isSpecial && <p className="badge badge--special">Special player</p>}
        <p className="phone__sub">{view?.message ?? 'Waiting for the host to start.'}</p>
        <p className="phone__meta">
          {total} {total === 1 ? 'player' : 'players'} in the lobby
        </p>
      </section>
    );
  }

  if (view.kind === 'choose') {
    return (
      <section className="phone__body">
        {view.headline && (
          <p className={`phone__headline-sm${view.special ? ' phone__headline-sm--special' : ''}`}>
            {view.headline}
          </p>
        )}
        {view.special && <p className="badge badge--special">Private answer</p>}
        {view.note?.editable && (
          <p className="phone__cue">Pick an answer, then add a comment for the TV below.</p>
        )}
        {view.imageUrl && <img className="phone__image" src={view.imageUrl} alt={view.prompt} />}
        <p className="phone__prompt">{view.prompt}</p>
        <div className="options">
          {view.options.map((option) => {
            const selected = view.selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`button option${selected ? ' option--selected' : ''}`}
                disabled={view.selectedOptionId !== null || view.locked}
                onClick={() => onSubmit(option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {view.selectedOptionId !== null && <p className="phone__sub">Answer locked in.</p>}
        {view.note && <SpecialNoteEditor note={view.note} onSave={onSaveNote} />}
        {notice && <p className="phone__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'rate') {
    return (
      <section className="phone__body">
        {view.headline && (
          <p className={`phone__headline-sm${view.special ? ' phone__headline-sm--special' : ''}`}>
            {view.headline}
          </p>
        )}
        {view.special && <p className="badge badge--special">Private score</p>}
        {view.note?.editable && (
          <p className="phone__cue">Set your score, then add a comment for the TV below.</p>
        )}
        {view.imageUrl && <img className="phone__image" src={view.imageUrl} alt={view.prompt} />}
        <p className="phone__prompt">{view.prompt}</p>
        <RatingSlider view={view} onSubmit={onSubmit} />
        {view.note && <SpecialNoteEditor note={view.note} onSave={onSaveNote} />}
        {notice && <p className="phone__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'round_result') {
    return (
      <section className="phone__body">
        <p className="phone__headline">{view.message}</p>
        {view.correct !== null && (
          <p className={`badge ${view.correct ? 'badge--ok' : 'badge--miss'}`}>
            {view.correct ? 'Correct' : 'Incorrect'}
          </p>
        )}
        {view.note && <SpecialNoteEditor note={view.note} onSave={onSaveNote} />}
        {notice && <p className="phone__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'caption') {
    return (
      <section className="phone__body">
        <p className="phone__cue">Write an anonymous caption for the TV.</p>
        {view.imageUrl && <img className="phone__image" src={view.imageUrl} alt={view.prompt} />}
        <p className="phone__prompt">{view.prompt}</p>
        <CaptionInput view={view} onSubmit={onSubmit} />
        {notice && <p className="phone__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'draw') {
    return (
      <section className="phone__body">
        <p className="phone__prompt">{view.prompt}</p>
        {view.submitted ? (
          <p className="phone__sub">Your drawing is in. Look at the TV.</p>
        ) : (
          <DrawCanvas view={view} onSubmit={onSubmit} />
        )}
        {notice && <p className="phone__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'judge') {
    return (
      <section className="phone__body">
        <p className="badge badge--special">Pick a winner</p>
        <p className="phone__prompt">{view.prompt}</p>
        <JudgePanel view={view} onPick={onPick} />
        {notice && <p className="phone__error">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="phone__body">
      <p className="phone__headline">{view.message}</p>
      {view.note && <SpecialNoteEditor note={view.note} onSave={onSaveNote} />}
      {notice && <p className="phone__error">{notice}</p>}
    </section>
  );
}

/**
 * Score slider. Once submitted the server echoes `submittedValue`, which
 * becomes the source of truth so a refresh or reconnect shows the real score.
 */
function RatingSlider({
  view,
  onSubmit,
}: {
  view: Extract<PlayerView, { kind: 'rate' }>;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(view.submittedValue ?? view.defaultValue);
  const submitted = view.submittedValue !== null;

  useEffect(() => {
    if (view.submittedValue !== null) setValue(view.submittedValue);
  }, [view.submittedValue]);

  return (
    <div className="rating">
      <output className="rating__value">{value}</output>
      <input
        className="rating__slider"
        type="range"
        min={view.min}
        max={view.max}
        step={view.step}
        value={value}
        disabled={submitted || view.locked}
        aria-label="Score"
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <div className="rating__ends">
        <span>{view.min}</span>
        <span>{view.max}</span>
      </div>
      <button
        type="button"
        className="button"
        disabled={submitted || view.locked}
        onClick={() => onSubmit(String(value))}
      >
        {submitted ? `Locked in at ${view.submittedValue}` : 'Submit'}
      </button>
    </div>
  );
}

function CaptionInput({
  view,
  onSubmit,
}: {
  view: Extract<PlayerView, { kind: 'caption' }>;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const submitted = view.submittedText !== null;
  const shown = submitted ? (view.submittedText ?? '') : text;

  return (
    <div className="caption">
      <textarea
        className="input caption__input"
        value={shown}
        onChange={(event) => setText(event.target.value)}
        maxLength={view.maxLength}
        placeholder="Type your caption\u2026"
        disabled={submitted}
        rows={3}
        aria-label="Caption"
      />
      <p className="phone__meta">
        {shown.length} / {view.maxLength}
      </p>
      <button
        type="button"
        className="button"
        disabled={submitted || text.trim() === ''}
        onClick={() => onSubmit(text)}
      >
        {submitted ? 'Submitted' : 'Submit caption'}
      </button>
    </div>
  );
}

/** Renders a stroke list onto whatever canvas is given, scaled to its pixel size. */
function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly DrawStroke[],
  width: number,
  height: number,
): void {
  for (const stroke of strokes) {
    if (stroke.points.length < 4) continue;
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#1a1030';
    ctx.lineWidth = stroke.size === 'thick' ? 10 : 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < stroke.points.length; i += 2) {
      const x = (stroke.points[i]! / DRAWING_GRID) * width;
      const y = (stroke.points[i + 1]! / DRAWING_GRID) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function gridPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const clamp = (n: number): number => Math.max(0, Math.min(DRAWING_GRID, Math.round(n)));
  return [
    clamp(((event.clientX - rect.left) / rect.width) * DRAWING_GRID),
    clamp(((event.clientY - rect.top) / rect.height) * DRAWING_GRID),
  ];
}

/** Deliberately simple: canvas, draw, clear, submit, two brush sizes, an eraser. */
function DrawCanvas({
  view,
  onSubmit,
}: {
  view: Extract<PlayerView, { kind: 'draw' }>;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<number[] | null>(null);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [brush, setBrush] = useState<'thin' | 'thick'>('thin');
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintStrokes(ctx, strokes, canvas.width, canvas.height);
  }, [strokes]);

  const full = strokes.length >= view.maxStrokes;

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (full) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    activeStroke.current = gridPoint(event, canvas);
  };

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const points = activeStroke.current;
    const canvas = canvasRef.current;
    if (!points || !canvas) return;
    if (points.length / 2 >= view.maxPointsPerStroke) return;

    const [x, y] = gridPoint(event, canvas);
    const lastX = points[points.length - 2]!;
    const lastY = points[points.length - 1]!;
    // Skip near-duplicate points so a slow drag doesn't burn through the point budget.
    if (Math.abs(x - lastX) < 4 && Math.abs(y - lastY) < 4) return;
    points.push(x, y);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      paintStrokes(
        ctx,
        [{ points: [lastX, lastY, x, y], size: brush, ...(erasing ? { erase: true } : {}) }],
        canvas.width,
        canvas.height,
      );
    }
  };

  const commit = (): void => {
    const points = activeStroke.current;
    activeStroke.current = null;
    if (!points || points.length < 4) return;
    setStrokes((previous) => [
      ...previous,
      { points, size: brush, ...(erasing ? { erase: true } : {}) },
    ]);
  };

  return (
    <div className="draw">
      <canvas
        ref={canvasRef}
        className="draw__canvas"
        width={320}
        height={320}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={commit}
        onPointerLeave={commit}
      />
      <div className="draw__tools">
        <button
          type="button"
          className={`button button--quiet${brush === 'thin' && !erasing ? ' button--active' : ''}`}
          onClick={() => {
            setBrush('thin');
            setErasing(false);
          }}
        >
          Thin
        </button>
        <button
          type="button"
          className={`button button--quiet${brush === 'thick' && !erasing ? ' button--active' : ''}`}
          onClick={() => {
            setBrush('thick');
            setErasing(false);
          }}
        >
          Thick
        </button>
        <button
          type="button"
          className={`button button--quiet${erasing ? ' button--active' : ''}`}
          onClick={() => setErasing(true)}
        >
          Eraser
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={strokes.length === 0}
          onClick={() => setStrokes([])}
        >
          Clear
        </button>
      </div>
      {full && <p className="phone__sub">That is as much detail as this canvas holds.</p>}
      <button
        type="button"
        className="button"
        disabled={strokes.length === 0}
        onClick={() => onSubmit(JSON.stringify(strokes))}
      >
        Submit drawing
      </button>
    </div>
  );
}

function DrawingThumbnail({ strokes }: { strokes: readonly DrawStroke[] }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintStrokes(ctx, strokes, canvas.width, canvas.height);
  }, [strokes]);

  return <canvas ref={canvasRef} className="judge__thumb" width={160} height={160} />;
}

/** Shared by both anonymous-judging games: tap an entry, tap again to change your mind. */
function JudgePanel({
  view,
  onPick,
}: {
  view: Extract<PlayerView, { kind: 'judge' }>;
  onPick: (targetPlayerId: string) => void;
}): JSX.Element {
  if (view.entries.length === 0) {
    return <p className="phone__sub">No submissions came in this round.</p>;
  }

  return (
    <div className="judge">
      <ul className="judge__list">
        {view.entries.map((entry) => {
          const picked = view.pickedId === entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`judge__entry${picked ? ' judge__entry--picked' : ''}`}
                onClick={() => onPick(entry.id)}
              >
                {entry.text !== undefined ? (
                  <span className="judge__text">{entry.text}</span>
                ) : (
                  <DrawingThumbnail strokes={entry.strokes ?? []} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {view.pickedId !== null && (
        <p className="phone__sub">Picked. Tap another entry to change your mind.</p>
      )}
    </div>
  );
}

interface JoinPanelProps {
  session: SessionSnapshot | null;
  disabled: boolean;
  errorMessage: string | null;
  onSubmit: (name: string) => void;
  onClearError: () => void;
}

function JoinPanel({
  session,
  disabled,
  errorMessage,
  onSubmit,
  onClearError,
}: JoinPanelProps): JSX.Element {
  const [name, setName] = useState('');
  const [confirmingSpecial, setConfirmingSpecial] = useState(false);

  const specialName = session?.specialPlayerName ?? '';
  const wantsSpecial = specialName !== '' && playerNameKey(name) === playerNameKey(specialName);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (disabled || name.trim() === '') return;
    // Entering the reserved name is a distinct decision, so confirm it once.
    if (wantsSpecial && !confirmingSpecial) {
      setConfirmingSpecial(true);
      return;
    }
    onSubmit(name);
  };

  if (confirmingSpecial) {
    return (
      <section className="phone__body">
        <p className="phone__headline">You&rsquo;re joining as {specialName}.</p>
        <p className="phone__sub">
          This is the special player for this party. Only one device can be {specialName}.
        </p>
        {errorMessage && <p className="phone__error">{errorMessage}</p>}
        <div className="phone__actions">
          <button
            type="button"
            className="button"
            onClick={() => onSubmit(name)}
            disabled={disabled}
          >
            Confirm
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setConfirmingSpecial(false);
              onClearError();
            }}
          >
            Use a different name
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="phone__body">
      <p className="phone__headline">What&rsquo;s your name?</p>
      <form className="phone__form" onSubmit={handleSubmit}>
        <input
          className="input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (errorMessage) onClearError();
          }}
          placeholder="Your name"
          maxLength={MAX_PLAYER_NAME_LENGTH}
          autoComplete="off"
          autoCapitalize="words"
          aria-label="Your name"
        />
        {errorMessage && <p className="phone__error">{errorMessage}</p>}
        {wantsSpecial && !errorMessage && (
          <p className="phone__note">{specialName} is the special player for this party.</p>
        )}
        <button type="submit" className="button" disabled={disabled || name.trim() === ''}>
          {disabled ? 'Connecting…' : 'Join'}
        </button>
      </form>
    </section>
  );
}
