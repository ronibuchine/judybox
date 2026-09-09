import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
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
import { AnswerOption, Badge, Button, Media, WaitingState } from '../components/ui';
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const moreBelow = useScrollAffordance(scrollRef);

  return (
    <main className="screen screen--phone">
      <header className="phone__bar">
        <p className="wordmark">
          JudyBox<span className="wordmark__dot">.</span>
        </p>
        <div className="phone__who">
          {self && <span className="phone__name">{self.name}</span>}
          <StatusBadge status={status} />
        </div>
      </header>

      <div className="phone__scroll">
        <div className="phone__main" ref={scrollRef}>
          {self ? (
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
          ) : (
            <JoinPanel
              session={session}
              disabled={status !== 'connected'}
              errorMessage={joinError?.message ?? null}
              onSubmit={join}
              onClearError={clearJoinError}
            />
          )}
        </div>
        {moreBelow && <span className="phone__more">More below ↓</span>}
      </div>

      {self && standing && <StandingBar standing={standing} />}
    </main>
  );
}

/**
 * True while the scroller has content past the fold. Watches size and content
 * changes as well as scrolling, because a round can add a comment box below
 * the answer without the player touching anything.
 */
function useScrollAffordance(ref: RefObject<HTMLDivElement>): boolean {
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (): void => {
      setMoreBelow(element.scrollHeight - element.scrollTop - element.clientHeight > 24);
    };

    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const mutations = new MutationObserver(update);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });

    return () => {
      element.removeEventListener('scroll', update);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [ref]);

  return moreBelow;
}

function StandingBar({ standing }: { standing: PlayerStanding }): JSX.Element {
  return (
    <footer className="standing">
      <span className="standing__score">{standing.score.toLocaleString('en-US')}</span>
      <span className="standing__meta numeral">
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

/**
 * A private aside for the special player, chosen from the prompt so it stays
 * put while she reads it. Nobody else's screen ever shows these.
 */
const SPECIAL_ASIDES = [
  'The whole room is waiting on your taste.',
  'No pressure. Well — a little pressure.',
  'Tonight your opinion is the scoring rubric.',
  'They are all guessing. You simply know.',
  'This only counts because you said so.',
  'Be honest. It is more fun when you are honest.',
];

function specialAside(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return SPECIAL_ASIDES[Math.abs(hash) % SPECIAL_ASIDES.length] as string;
}

function SpecialCue({ seed, label }: { seed: string; label: string }): JSX.Element {
  return (
    <div className="special-card">
      <div className="special-card__head">
        <Badge tone="special">{label}</Badge>
        <span className="special-card__rule" />
      </div>
      <p className="special-card__aside">{specialAside(seed)}</p>
    </div>
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
      <section className="play play--center">
        {isSpecial && <Badge tone="special">Guest of honour</Badge>}
        <p className="play__eyebrow">You&rsquo;re in</p>
        <p className="enter__title">{name}</p>
        <WaitingState sub={view?.message ?? 'Waiting for the host to start.'} />
        <p className="play__meta">
          {total} {total === 1 ? 'person' : 'people'} in the lobby
        </p>
      </section>
    );
  }

  if (view.kind === 'choose') {
    const answered = view.selectedOptionId !== null;
    return (
      <section className={`play${view.special ? ' play--special' : ''}`}>
        {view.special && <SpecialCue seed={view.prompt} label="Only you see this" />}
        {view.headline && !view.special && <p className="play__eyebrow">{view.headline}</p>}
        {view.note?.editable && (
          <p className="play__hint">Answer first — there is a comment box below for the TV.</p>
        )}
        {view.imageUrl && (
          <Media src={view.imageUrl} alt={view.prompt} className="play__media" />
        )}
        <p className="play__prompt">{view.prompt}</p>
        <div className="answers">
          {view.options.map((option, index) => {
            const selected = view.selectedOptionId === option.id;
            return (
              <AnswerOption
                key={option.id}
                index={index}
                label={option.label}
                selected={selected}
                dimmed={answered && !selected}
                disabled={answered || view.locked}
                onClick={() => onSubmit(option.id)}
              />
            );
          })}
        </div>
        {answered && <p className="play__hint">Locked in. Look at the TV.</p>}
        {view.note && (
          <div className="play__note">
            <SpecialNoteEditor note={view.note} onSave={onSaveNote} />
          </div>
        )}
        {notice && <p className="play__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'rate') {
    return (
      <section className={`play${view.special ? ' play--special' : ''}`}>
        {view.special && <SpecialCue seed={view.prompt} label="Only you see this" />}
        {view.headline && !view.special && <p className="play__eyebrow">{view.headline}</p>}
        {view.note?.editable && (
          <p className="play__hint">Set your score — there is a comment box below for the TV.</p>
        )}
        {view.imageUrl && (
          <Media src={view.imageUrl} alt={view.prompt} className="play__media" />
        )}
        <p className="play__prompt">{view.prompt}</p>
        <RatingSlider view={view} onSubmit={onSubmit} />
        {view.note && (
          <div className="play__note">
            <SpecialNoteEditor note={view.note} onSave={onSaveNote} />
          </div>
        )}
        {notice && <p className="play__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'round_result') {
    return (
      <section className="play play--center">
        {view.correct !== null && (
          <Badge tone={view.correct ? 'ok' : 'miss'}>{view.correct ? 'Correct' : 'Missed it'}</Badge>
        )}
        <p className="play__prompt">{view.message}</p>
        {view.note && (
          <div className="play__note">
            <SpecialNoteEditor note={view.note} onSave={onSaveNote} />
          </div>
        )}
        {notice && <p className="play__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'caption') {
    return (
      <section className="play">
        <p className="play__eyebrow">Anonymous</p>
        {view.imageUrl && (
          <Media src={view.imageUrl} alt={view.prompt} className="play__media" />
        )}
        <p className="play__prompt">{view.prompt}</p>
        <p className="play__hint">Names only appear on the TV once it&rsquo;s revealed.</p>
        <CaptionInput view={view} onSubmit={onSubmit} />
        {notice && <p className="play__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'draw') {
    return (
      <section className="play">
        <p className="play__eyebrow">Draw this</p>
        <p className="play__prompt">{view.prompt}</p>
        {view.submitted ? (
          <WaitingState title="Your drawing is in." sub="Look at the TV." />
        ) : (
          <DrawCanvas view={view} onSubmit={onSubmit} />
        )}
        {notice && <p className="play__error">{notice}</p>}
      </section>
    );
  }

  if (view.kind === 'judge') {
    return (
      <section className="play play--special">
        <SpecialCue seed={view.prompt} label="Your call" />
        <p className="play__prompt">{view.prompt}</p>
        <JudgePanel view={view} onPick={onPick} />
        {notice && <p className="play__error">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="play play--center">
      <WaitingState title={view.message} />
      {view.note && (
        <div className="play__note">
          <SpecialNoteEditor note={view.note} onSave={onSaveNote} />
        </div>
      )}
      {notice && <p className="play__error">{notice}</p>}
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

  const span = view.max - view.min;
  const pct = span > 0 ? ((value - view.min) / span) * 100 : 0;

  return (
    <>
      <div className="rate">
        <output className="rate__value">{value}</output>
        <input
          className="rate__slider"
          style={{ '--pct': pct } as CSSProperties}
          type="range"
          min={view.min}
          max={view.max}
          step={view.step}
          value={value}
          disabled={submitted || view.locked}
          aria-label="Score"
          onChange={(event) => setValue(Number(event.target.value))}
        />
        <div className="rate__ends">
          <span>{view.min}</span>
          <span>{view.max}</span>
        </div>
      </div>
      <div className="play__actions">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={submitted || view.locked}
          onClick={() => onSubmit(String(value))}
        >
          {submitted ? `Locked in at ${view.submittedValue}` : 'Submit score'}
        </Button>
      </div>
    </>
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
    <>
      <div className="compose">
        <textarea
          className="field field--area"
          value={shown}
          onChange={(event) => setText(event.target.value)}
          maxLength={view.maxLength}
          placeholder="Type your answer…"
          disabled={submitted}
          rows={3}
          aria-label="Your answer"
        />
        <div className="compose__foot">
          <span className="play__meta">
            {shown.length} / {view.maxLength}
          </span>
          {submitted && <Badge tone="ok">Sent</Badge>}
        </div>
      </div>
      <div className="play__actions">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={submitted || text.trim() === ''}
          onClick={() => onSubmit(text)}
        >
          {submitted ? 'Submitted' : 'Submit answer'}
        </Button>
      </div>
    </>
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
    ctx.strokeStyle = '#241f1c';
    ctx.lineWidth = stroke.size === 'thick' ? width / 32 : width / 110;
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
    <>
      <div className="draw">
        <canvas
          ref={canvasRef}
          className="draw__canvas"
          width={512}
          height={512}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={commit}
          onPointerLeave={commit}
        />
        <div className="draw__tools">
          <Button
            variant="ghost"
            active={brush === 'thin' && !erasing}
            onClick={() => {
              setBrush('thin');
              setErasing(false);
            }}
          >
            Thin
          </Button>
          <Button
            variant="ghost"
            active={brush === 'thick' && !erasing}
            onClick={() => {
              setBrush('thick');
              setErasing(false);
            }}
          >
            Thick
          </Button>
          <Button variant="ghost" active={erasing} onClick={() => setErasing(true)}>
            Erase
          </Button>
          <Button variant="ghost" disabled={strokes.length === 0} onClick={() => setStrokes([])}>
            Clear
          </Button>
        </div>
        {full && <p className="play__hint">That is as much detail as this canvas holds.</p>}
      </div>
      <div className="play__actions">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={strokes.length === 0}
          onClick={() => onSubmit(JSON.stringify(strokes))}
        >
          Submit drawing
        </Button>
      </div>
    </>
  );
}

function DrawingThumbnail({
  strokes,
  className = 'judge__thumb',
}: {
  strokes: readonly DrawStroke[];
  className?: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintStrokes(ctx, strokes, canvas.width, canvas.height);
  }, [strokes]);

  return <canvas ref={canvasRef} className={className} width={320} height={320} />;
}

/**
 * Drawings are judged one at a time on a swipeable deck. A scrollable list of
 * thumbnails would make every entry too small to actually judge.
 */
function JudgeDeck({
  entries,
  pickedId,
  onPick,
}: {
  entries: Extract<PlayerView, { kind: 'judge' }>['entries'];
  pickedId: string | null;
  onPick: (targetPlayerId: string) => void;
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const step = (delta: number): void => {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.max(0, Math.min(entries.length - 1, active + delta));
    track.scrollTo({ left: next * (track.clientWidth + 12), behavior: 'smooth' });
  };

  return (
    <div className="deck">
      <div
        className="deck__track"
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget;
          setActive(Math.round(track.scrollLeft / (track.clientWidth + 12)));
        }}
      >
        {entries.map((entry) => {
          const picked = pickedId === entry.id;
          return (
            <div
              key={entry.id}
              className={`deck__slide${picked ? ' deck__slide--picked' : ''}`}
            >
              <DrawingThumbnail strokes={entry.strokes ?? []} className="deck__canvas" />
              <Button
                variant={picked ? 'primary' : 'secondary'}
                block
                onClick={() => onPick(entry.id)}
              >
                {picked ? 'Picked' : 'Pick this one'}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="deck__foot">
        <Button variant="ghost" size="sm" disabled={active === 0} onClick={() => step(-1)}>
          ‹
        </Button>
        <span className="deck__count">
          {active + 1} / {entries.length}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={active >= entries.length - 1}
          onClick={() => step(1)}
        >
          ›
        </Button>
      </div>
      <p className="play__hint">Swipe to see them all. Tap again to change your mind.</p>
    </div>
  );
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
    return <WaitingState title="No submissions came in this round." />;
  }

  if (view.entries.some((entry) => entry.strokes !== undefined)) {
    return <JudgeDeck entries={view.entries} pickedId={view.pickedId} onPick={onPick} />;
  }

  return (
    <div className="judge">
      {view.entries.map((entry) => {
        const picked = view.pickedId === entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            className={`judge__entry${picked ? ' judge__entry--picked' : ''}`}
            onClick={() => onPick(entry.id)}
          >
            <span>&ldquo;{entry.text}&rdquo;</span>
          </button>
        );
      })}
      <p className="play__hint">
        {view.pickedId !== null
          ? 'Picked. Tap another to change your mind.'
          : 'Tap the one you like best.'}
      </p>
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
      <section className="enter">
        <Badge tone="special">Guest of honour</Badge>
        <p className="enter__title">You&rsquo;re joining as {specialName}.</p>
        <p className="enter__sub">
          This party has one guest of honour, and only one device can be {specialName}.
        </p>
        {errorMessage && <p className="play__error">{errorMessage}</p>}
        <div className="play__actions">
          <Button variant="primary" size="lg" block onClick={() => onSubmit(name)} disabled={disabled}>
            That&rsquo;s me
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => {
              setConfirmingSpecial(false);
              onClearError();
            }}
          >
            Use a different name
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="enter">
      <p className="play__eyebrow">Welcome</p>
      <p className="enter__title">What should we call you?</p>
      <form className="enter__form" onSubmit={handleSubmit}>
        <input
          className="field field--center"
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
        {errorMessage && <p className="play__error">{errorMessage}</p>}
        {wantsSpecial && !errorMessage && (
          <p className="play__hint">{specialName} is the guest of honour tonight.</p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={disabled || name.trim() === ''}
        >
          {disabled ? 'Connecting…' : 'Join the party'}
        </Button>
      </form>
    </section>
  );
}
