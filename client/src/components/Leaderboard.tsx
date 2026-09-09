import type { LeaderboardRow } from '@judybox/shared';

function formatScore(score: number): string {
  return score.toLocaleString('en-US');
}

/** Reusable standings table. Used on the TV and in the host panel. */
export function Leaderboard({
  rows,
  variant = 'default',
}: {
  rows: LeaderboardRow[];
  variant?: 'tv' | 'compact' | 'runners' | 'default';
}): JSX.Element {
  if (rows.length === 0) {
    return <p className="board__empty">No players yet.</p>;
  }

  return (
    <ol className={`board${variant === 'default' ? '' : ` board--${variant}`}`}>
      {rows.map((row, index) => (
        <li
          key={row.playerId}
          className={`board__row${row.rank === 1 ? ' board__row--leader' : ''}`}
          // Short, bounded stagger: the list is readable before it finishes.
          style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
        >
          <span className="board__rank numeral">{row.rank}</span>
          <span className="board__name">{row.playerName}</span>
          {/* Always rendered, so gaining points never nudges the name sideways. */}
          <span className={`board__delta numeral${row.delta > 0 ? '' : ' board__delta--down'}`}>
            {row.delta === 0 ? '' : `${row.delta > 0 ? '+' : ''}${formatScore(row.delta)}`}
          </span>
          <span className="board__score numeral">{formatScore(row.score)}</span>
        </li>
      ))}
    </ol>
  );
}
