import type { LeaderboardRow } from '@judybox/shared';

const MEDALS = ['🥇', '🥈', '🥉'];

function formatScore(score: number): string {
  return score.toLocaleString('en-US');
}

/** Reusable standings table. Used on the TV and in the host panel. */
export function Leaderboard({
  rows,
  compact = false,
}: {
  rows: LeaderboardRow[];
  compact?: boolean;
}): JSX.Element {
  if (rows.length === 0) {
    return <p className="stage__sub">No players yet.</p>;
  }

  return (
    <ol className={`leaderboard${compact ? ' leaderboard--compact' : ''}`}>
      {rows.map((row) => (
        <li key={row.playerId} className="leaderboard__row">
          <span className="leaderboard__rank">
            {row.rank <= MEDALS.length ? MEDALS[row.rank - 1] : row.rank}
          </span>
          <span className="leaderboard__name">{row.playerName}</span>
          {row.delta !== 0 && (
            <span
              className={`leaderboard__delta${row.delta > 0 ? '' : ' leaderboard__delta--down'}`}
            >
              {row.delta > 0 ? '+' : ''}
              {formatScore(row.delta)}
            </span>
          )}
          <span className="leaderboard__score">{formatScore(row.score)}</span>
        </li>
      ))}
    </ol>
  );
}
