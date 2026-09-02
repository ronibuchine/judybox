import { useEffect, useRef } from 'react';
import { DRAWING_GRID, type DisplayView, type DrawStroke } from '@judybox/shared';
import { Leaderboard } from './Leaderboard';

/** Renders whatever the server says the TV should show. No local game logic. */
export function DisplayViewPanel({ view }: { view: DisplayView }): JSX.Element {
  switch (view.kind) {
    case 'game_select':
      return (
        <div className="stage">
          <p className="stage__kicker">Up next</p>
          <ul className="stage__list">
            {view.games.map((game) => (
              <li key={game.id}>{game.label}</li>
            ))}
          </ul>
        </div>
      );

    case 'game_intro':
      return (
        <div className="stage">
          <p className="stage__kicker">Get ready</p>
          <h2 className="stage__title">{view.gameName}</h2>
          <p className="stage__sub">{view.roundCount} rounds</p>
        </div>
      );

    case 'round_intro':
      return (
        <div className="stage">
          <p className="stage__kicker">
            Round {view.roundNumber} of {view.roundCount}
          </p>
          <h2 className="stage__title">{view.prompt}</h2>
          {view.meta && <p className="stage__sub">{view.meta}</p>}
          {view.imageUrl && <RoundImage src={view.imageUrl} alt={view.prompt} />}
        </div>
      );

    case 'question':
      return (
        <div className="stage">
          <h2 className="stage__title">{view.prompt}</h2>
          {view.imageUrl && <RoundImage src={view.imageUrl} alt={view.prompt} />}
          {view.scale ? (
            <p className="stage__scale">{view.scale.label}</p>
          ) : (
            <ul className="options options--tv">
              {view.options.map((option) => (
                <li key={option.id} className="options__item">
                  {option.label}
                </li>
              ))}
            </ul>
          )}
          <p className="stage__sub">
            {view.locked ? 'Answers locked' : `${view.answered} / ${view.expected} answered`}
            {view.specialStatus && (
              <span className="stage__special">
                {' · '}
                {view.specialStatus.name}{' '}
                {view.specialStatus.answered ? 'has answered' : 'is deciding…'}
              </span>
            )}
          </p>
        </div>
      );

    case 'reveal': {
      const total = Object.values(view.tallies).reduce((sum, count) => sum + count, 0);
      const revealed = view.options.find((option) => option.id === view.correctOptionId);
      return (
        <div className="stage">
          <h2 className="stage__title">{view.prompt}</h2>
          {view.imageUrl && <RoundImage src={view.imageUrl} alt={view.prompt} />}
          {view.revealLabel && revealed && (
            <p className="reveal__answer">
              <span className="reveal__label">{view.revealLabel}</span>
              <span className="reveal__value">{revealed.label}</span>
            </p>
          )}
          {view.note && <p className="reveal__note">&ldquo;{view.note}&rdquo;</p>}
          <ul className="options options--tv">
            {view.options.map((option) => {
              const count = view.tallies[option.id] ?? 0;
              const isCorrect = view.correctOptionId === option.id;
              return (
                <li
                  key={option.id}
                  className={`options__item${isCorrect ? ' options__item--correct' : ''}`}
                >
                  <span>{option.label}</span>
                  <span className="options__count">
                    {count}
                    {total > 0 ? ` / ${total}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    case 'rating_reveal':
      return (
        <div className="stage">
          <h2 className="stage__title">{view.prompt}</h2>
          {view.meta && <p className="stage__sub">{view.meta}</p>}
          {view.imageUrl && <RoundImage src={view.imageUrl} alt={view.prompt} />}
          <p className="reveal__answer">
            <span className="reveal__label">{view.revealLabel}</span>
            <span className="reveal__value">
              {view.actualScore === null ? 'no score' : view.actualScore}
            </span>
          </p>
          {view.note && <p className="reveal__note">&ldquo;{view.note}&rdquo;</p>}
          <ul className="stage__list">
            {view.guesses.map((guess) => (
              <li key={guess.playerName}>
                <span>{guess.playerName}</span>
                <span className="stage__value">
                  {guess.score}
                  {guess.distance === null
                    ? ''
                    : guess.distance === 0
                      ? ' ✓'
                      : ` (off by ${guess.distance})`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'results':
      return (
        <div className="stage">
          <p className="stage__kicker">{view.prompt}</p>
          <ul className="stage__list">
            {view.rows.map((row) => (
              <li key={row.playerName}>
                <span>{row.playerName}</span>
                <span className="stage__value">
                  {row.choiceLabel ?? 'no answer'}
                  {row.correct === true ? ' ✓' : row.correct === false ? ' ✗' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'caption_gallery':
      return (
        <div className="stage">
          <h2 className="stage__title">{view.prompt}</h2>
          {view.imageUrl && <RoundImage src={view.imageUrl} alt={view.prompt} />}
          {!view.revealed && (
            <p className="stage__sub">
              {view.judyDeciding ? 'Judy is choosing a winner…' : 'Judy has picked. Waiting on the host.'}
            </p>
          )}
          <ul className="stage__list stage__list--gallery">
            {view.entries.map((entry, index) => (
              <li
                key={entry.id}
                className={entry.isWinner ? 'stage__list-item--winner' : undefined}
              >
                <span className="gallery__caption">
                  {view.revealed ? (entry.playerName ?? '?') : `Entry ${index + 1}`}
                  {entry.isWinner ? ' 🏆' : ''}
                </span>
                <span className="stage__value">{entry.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'drawing_gallery':
      return (
        <div className="stage">
          <h2 className="stage__title">{view.prompt}</h2>
          {!view.revealed && (
            <p className="stage__sub">
              {view.judyDeciding ? 'Judy is choosing a winner…' : 'Judy has picked. Waiting on the host.'}
            </p>
          )}
          <ul className="gallery gallery--drawings">
            {view.entries.map((entry, index) => (
              <li key={entry.id} className={entry.isWinner ? 'gallery__tile--winner' : undefined}>
                <DrawingTile strokes={entry.strokes} />
                <span className="gallery__caption">
                  {view.revealed ? (entry.playerName ?? '?') : `Entry ${index + 1}`}
                  {entry.isWinner ? ' 🏆' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'leaderboard':
      return (
        <div className="stage">
          <p className="stage__kicker">Leaderboard</p>
          <Leaderboard rows={view.rows} />
        </div>
      );

    case 'game_complete':
      return (
        <div className="stage">
          <p className="stage__kicker">That&rsquo;s a wrap</p>
          <h2 className="stage__title">{view.gameName}</h2>
        </div>
      );

    case 'lobby':
    default:
      return <div className="stage" />;
  }
}

/** Falls back to a visible placeholder so a missing file is obvious, not blank. */
function RoundImage({ src, alt }: { src: string; alt: string }): JSX.Element {
  return (
    <img
      className="stage__image"
      src={src}
      alt={alt}
      onError={(event) => {
        event.currentTarget.classList.add('stage__image--missing');
        event.currentTarget.alt = 'Image missing';
      }}
    />
  );
}

/** Replays a bounded stroke list onto a small canvas; same encoding as the phone's. */
function DrawingTile({ strokes }: { strokes: readonly DrawStroke[] }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      if (stroke.points.length < 4) continue;
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = '#1a1030';
      ctx.lineWidth = stroke.size === 'thick' ? 8 : 3;
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

  return <canvas ref={canvasRef} className="gallery__canvas" width={220} height={220} />;
}
