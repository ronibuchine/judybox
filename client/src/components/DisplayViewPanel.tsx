import { useEffect, useRef, type ReactNode } from 'react';
import { DRAWING_GRID, type DisplayView, type DrawStroke, type LeaderboardRow, type ViewOption } from '@judybox/shared';
import { Leaderboard } from './Leaderboard';
import { Confetti, Media, Meter, Paged, Stage, optionKey } from './ui';

/** How many gallery entries the TV shows at once before it rotates. */
const CAPTIONS_PER_PAGE = 6;
const DRAWINGS_PER_PAGE = 8;
const ROWS_PER_PAGE = 8;
/** The TV never scrolls, so the standings show a podium and two runners-up. */
const PODIUM = 3;
const RUNNERS_UP = 2;

/** Renders whatever the server says the TV should show. No local game logic. */
export function DisplayViewPanel({ view }: { view: DisplayView }): JSX.Element {
  switch (view.kind) {
    case 'game_select':
      return (
        <Stage kicker="Tonight's line-up" title="Pick a game">
          <ul className="rows">
            {view.games.map((game, index) => (
              <li key={game.id} className="rows__row" style={rowDelay(index)}>
                <span>{game.label}</span>
                <span className="rows__value numeral">{String(index + 1).padStart(2, '0')}</span>
              </li>
            ))}
          </ul>
        </Stage>
      );

    case 'game_intro':
      return (
        <Stage
          kicker="Up next"
          title={view.gameName}
          sub={`${view.roundCount} ${view.roundCount === 1 ? 'round' : 'rounds'}`}
        />
      );

    case 'round_intro':
      return (
        <Stage kicker={`Round ${view.roundNumber} of ${view.roundCount}`}>
          <Split media={view.imageUrl ? <RoundImage src={view.imageUrl} alt={view.prompt} /> : null}>
            <h2 className="stage__title">{view.prompt}</h2>
            {view.meta && <p className="stage__sub">{view.meta}</p>}
          </Split>
        </Stage>
      );

    case 'question':
      return (
        <Stage>
          <Split media={view.imageUrl ? <RoundImage src={view.imageUrl} alt={view.prompt} /> : null}>
            <h2 className={view.imageUrl ? 'stage__title stage__title--sm' : 'stage__title'}>
              {view.prompt}
            </h2>
            {view.scale ? (
              <p className="stage__scale">{view.scale.label}</p>
            ) : (
              <OptionList options={view.options} />
            )}
            <Meter
              tv
              value={view.answered}
              max={view.expected}
              label={view.locked ? 'Answers locked' : `${view.answered} of ${view.expected} in`}
              aside={
                view.specialStatus && (
                  <span className={view.specialStatus.answered ? 'rows__value--hit' : ''}>
                    {view.specialStatus.name} {view.specialStatus.answered ? 'is ready' : 'is deciding…'}
                  </span>
                )
              }
            />
          </Split>
        </Stage>
      );

    case 'reveal': {
      const total = Object.values(view.tallies).reduce((sum, count) => sum + count, 0);
      const revealed = view.options.find((option) => option.id === view.correctOptionId);
      return (
        <Stage>
          <Split media={view.imageUrl ? <RoundImage src={view.imageUrl} alt={view.prompt} /> : null}>
            <h2 className="stage__title stage__title--sm">{view.prompt}</h2>
            {view.revealLabel && revealed && (
              <p className="reveal">
                <span className="reveal__label">{view.revealLabel}</span>
                <span className="reveal__value">{revealed.label}</span>
              </p>
            )}
            {view.note && <p className="stage__quote">&ldquo;{view.note}&rdquo;</p>}
            <OptionList
              options={view.options}
              tallies={view.tallies}
              total={total}
              correctOptionId={view.correctOptionId}
            />
          </Split>
        </Stage>
      );
    }

    case 'rating_reveal':
      return (
        <Stage>
          <Split media={view.imageUrl ? <RoundImage src={view.imageUrl} alt={view.prompt} /> : null}>
            <h2 className="stage__title stage__title--sm">{view.prompt}</h2>
            {view.meta && <p className="stage__sub">{view.meta}</p>}
            <p className="reveal">
              <span className="reveal__label">{view.revealLabel}</span>
              <span
                className={`stage__numeral${view.actualScore === null ? ' stage__numeral--muted' : ''}`}
              >
                {view.actualScore === null ? 'no score' : view.actualScore}
              </span>
            </p>
            {view.note && <p className="stage__quote">&ldquo;{view.note}&rdquo;</p>}
            <Paged items={view.guesses} perPage={ROWS_PER_PAGE}>
              {(entries) => (
                <ul className="rows">
                  {entries.map(({ item: guess, index }) => (
                    <li key={guess.playerName} className="rows__row" style={rowDelay(index)}>
                      <span>{guess.playerName}</span>
                      <span
                        className={`rows__value${guess.distance === 0 ? ' rows__value--hit' : ''} numeral`}
                      >
                        {guess.score}
                        {guess.distance === null
                          ? ''
                          : guess.distance === 0
                            ? ' · exact'
                            : ` · off by ${guess.distance}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          </Split>
        </Stage>
      );

    case 'results':
      return (
        <Stage kicker="How the room answered" title={view.prompt} titleSize="sm">
          <Paged items={view.rows} perPage={ROWS_PER_PAGE}>
            {(entries) => (
              <ul className="rows">
                {entries.map(({ item: row, index }) => (
                  <li key={row.playerName} className="rows__row" style={rowDelay(index)}>
                    <span>{row.playerName}</span>
                    <span
                      className={`rows__value${
                        row.correct === true
                          ? ' rows__value--hit'
                          : row.choiceLabel === null
                            ? ' rows__value--miss'
                            : ''
                      }`}
                    >
                      {row.choiceLabel ?? 'no answer'}
                      {row.correct === true ? ' ✓' : row.correct === false ? ' ✗' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </Stage>
      );

    case 'caption_gallery':
      return (
        <Stage sub={view.revealed ? undefined : judgingLabel(view.judyDeciding)}>
          <Split media={view.imageUrl ? <RoundImage src={view.imageUrl} alt={view.prompt} /> : null}>
            <h2 className="stage__title stage__title--sm">{view.prompt}</h2>
            <Paged
              items={view.entries}
              perPage={CAPTIONS_PER_PAGE}
              focusIndex={winnerIndex(view.entries, view.revealed)}
            >
              {(entries) => (
                <ul className="cards cards--paged">
                  {entries.map(({ item: entry, index }) => (
                    <li
                      key={entry.id}
                      className={`card-entry${entry.isWinner ? ' card-entry--winner' : ''}`}
                      style={rowDelay(index)}
                    >
                      <p className="card-entry__text">&ldquo;{entry.text}&rdquo;</p>
                      <p className="card-entry__by">
                        {view.revealed ? (entry.playerName ?? 'Unknown') : `Entry ${index + 1}`}
                        {entry.isWinner ? ' · winner' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          </Split>
        </Stage>
      );

    case 'drawing_gallery':
      return (
        <Stage
          kicker="Draw this"
          title={view.prompt}
          titleSize="sm"
          sub={view.revealed ? undefined : judgingLabel(view.judyDeciding)}
        >
          <Paged
            items={view.entries}
            perPage={DRAWINGS_PER_PAGE}
            focusIndex={winnerIndex(view.entries, view.revealed)}
          >
            {(entries) => (
              <ul className="tiles">
                {entries.map(({ item: entry, index }) => (
                  <li
                    key={entry.id}
                    className={`tile${entry.isWinner ? ' tile--winner' : ''}`}
                    style={rowDelay(index)}
                  >
                    <DrawingTile strokes={entry.strokes} />
                    <p className="tile__by">
                      {view.revealed ? (entry.playerName ?? 'Unknown') : `Entry ${index + 1}`}
                      {entry.isWinner ? ' · winner' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </Stage>
      );

    case 'leaderboard':
      return (
        <Stage kicker="Standings">
          <PodiumBoard rows={view.rows} />
        </Stage>
      );

    case 'game_complete':
      return <Stage kicker="That’s a wrap" title={view.gameName} />;

    case 'party_complete':
      return (
        <Stage kicker="Thanks for playing">
          <Confetti />
          <div className="finale">
            <div className="finale__board">
              <PodiumBoard rows={view.rows} />
            </div>
            <div className="finale__champion">
              <p className="finale__champion-label">
                The real champion tonight: <strong>{view.specialPlayerName}</strong>. 
              </p>
              <p className="finale__infinity">🏆</p>
            </div>
          </div>
        </Stage>
      );

    case 'lobby':
    default:
      return <Stage />;
  }
}

/** Top three plus two runners-up, capped so 20 players never overflow the TV. */
function PodiumBoard({ rows }: { rows: LeaderboardRow[] }): JSX.Element {
  const podium = rows.slice(0, PODIUM);
  const runners = rows.slice(PODIUM, PODIUM + RUNNERS_UP);
  const remaining = rows.length - podium.length - runners.length;
  return (
    <>
      <Leaderboard rows={podium} variant="tv" />
      {runners.length > 0 && <Leaderboard rows={runners} variant="runners" />}
      {remaining > 0 && (
        <p className="stage__sub">
          +{remaining} more {remaining === 1 ? 'player' : 'players'}
        </p>
      )}
    </>
  );
}

function judgingLabel(deciding: boolean): string {
  return deciding ? 'A winner is being chosen…' : 'The winner is locked in. Over to the host.';
}

/** Locks the pager onto the winning entry once names are out. */
function winnerIndex(entries: readonly { isWinner?: boolean }[], revealed: boolean): number | null {
  if (!revealed) return null;
  const index = entries.findIndex((entry) => entry.isWinner);
  return index === -1 ? null : index;
}

/** Bounded stagger so long lists still land quickly. */
function rowDelay(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, 8) * 45}ms` };
}

/**
 * Image-forward layout: when a round has a picture it leads on the left and
 * the words sit beside it, instead of squeezing both into one column.
 */
function Split({ media, children }: { media: ReactNode; children: ReactNode }): JSX.Element {
  if (!media) return <>{children}</>;
  return (
    <div className="stage__split stage__split--media">
      {media}
      <div className="stage__aside">{children}</div>
    </div>
  );
}

function OptionList({
  options,
  tallies,
  total = 0,
  correctOptionId = null,
}: {
  options: ViewOption[];
  tallies?: Record<string, number>;
  total?: number;
  correctOptionId?: string | null;
}): JSX.Element {
  return (
    <ul className={`tv-options${options.length > 3 ? ' tv-options--pair' : ''}`}>
      {options.map((option, index) => {
        const count = tallies?.[option.id] ?? 0;
        const share = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <li
            key={option.id}
            className={`tv-option${correctOptionId === option.id ? ' tv-option--correct' : ''}`}
          >
            {tallies && <span className="tv-option__fill" style={{ width: `${share}%` }} />}
            <span className="tv-option__key">{optionKey(index)}</span>
            <span className="tv-option__label">{option.label}</span>
            {tallies && (
              <span className="tv-option__count">
                {count}
                {total > 0 ? ` / ${total}` : ''}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RoundImage({ src, alt }: { src: string; alt: string }): JSX.Element {
  return <Media src={src} alt={alt} className="stage__media" />;
}

/** Replays a bounded stroke list onto a small canvas; same encoding as the phone's. */
function DrawingTile({ strokes }: { strokes: readonly DrawStroke[] }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f7f3ec';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      if (stroke.points.length < 4) continue;
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = '#241f1c';
      ctx.lineWidth = stroke.size === 'thick' ? 9 : 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < stroke.points.length; i += 2) {
        const x = (stroke.points[i]! / DRAWING_GRID) * canvas.width;
        const y = (stroke.points[i + 1]! / DRAWING_GRID) * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [strokes]);

  return <canvas ref={canvasRef} className="tile__canvas" width={260} height={260} />;
}
