import type { ConnectionInfo } from '@judybox/shared';
import { StatusBadge } from '../components/StatusBadge';
import { Leaderboard } from '../components/Leaderboard';
import { useApi, useJudyBox } from '../net/useJudyBox';

/** Manual award step. Matches the default in scoring config. */
const AWARD_STEP = 100;

/** The laptop control surface. Every button comes from the server. */
export function HostScreen(): JSX.Element {
  const { status, session, engine, leaderboard, notice, serverRestarts, hostAction, awardPoints } =
    useJudyBox('host');
  const { data } = useApi<ConnectionInfo>('/api/connection-info');

  const players = session?.players ?? [];
  const connected = players.filter((player) => player.connected).length;
  const special = players.find((player) => player.role === 'SPECIAL');
  const actions = engine?.availableActions ?? [];

  return (
    <main className="screen screen--host">
      <header className="host__header">
        <h1>JudyBox — Host</h1>
        <StatusBadge status={status} />
      </header>

      <section className="host__panel">
        <h2>Game</h2>
        <dl className="host__facts">
          <dt>Game</dt>
          <dd>{engine?.gameName ?? 'None'}</dd>
          <dt>Round</dt>
          <dd>
            {engine && engine.roundCount > 0
              ? `${engine.roundNumber} / ${engine.roundCount}`
              : '—'}
          </dd>
          <dt>State</dt>
          <dd className="host__phase">{engine?.phase ?? '…'}</dd>
          <dt>Answered</dt>
          <dd>
            {engine ? `${engine.submittedCount} / ${engine.expectedCount}` : '—'}
          </dd>
        </dl>
      </section>

      <section className="host__panel">
        <h2>Host actions</h2>
        {engine?.phase === 'GAME_SELECT' && engine.games.length > 0 && (
          <div className="host__games">
            {engine.games.map((game) => (
              <button
                key={game.id}
                type="button"
                className="button"
                onClick={() => hostAction('START_GAME', game.id)}
              >
                Start: {game.label}
              </button>
            ))}
          </div>
        )}
        {actions.length === 0 ? (
          <p className="host__hint">No actions available in this state.</p>
        ) : (
          <div className="host__actions">
            {actions
              .filter((action) => !(action.action === 'START_GAME' && engine?.games.length))
              .map((action) => (
                <button
                  key={action.action}
                  type="button"
                  className={`button${action.danger ? ' button--danger' : ''}`}
                  onClick={() => hostAction(action.action)}
                >
                  {action.label}
                </button>
              ))}
          </div>
        )}
        {notice && <p className="host__warning">{notice}</p>}
      </section>

      <section className="host__panel">
        <h2>Scores</h2>
        {leaderboard.length === 0 ? (
          <p className="host__hint">No players yet.</p>
        ) : (
          <>
            <Leaderboard rows={leaderboard} compact />
            <p className="host__hint">Manual awards, for anything the rules miss:</p>
            <div className="host__awards">
              {leaderboard.map((row) => (
                <div key={row.playerId} className="award">
                  <span className="award__name">{row.playerName}</span>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => awardPoints(row.playerId, -AWARD_STEP)}
                  >
                    −{AWARD_STEP}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => awardPoints(row.playerId, AWARD_STEP)}
                  >
                    +{AWARD_STEP}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="host__panel">
        <h2>Lobby</h2>
        <div className="host__counts">
          <Count label="Players" value={players.length} />
          <Count label="Online" value={connected} />
          <Count label="Displays" value={session?.connections.display ?? 0} />
        </div>
        <p className="host__hint">
          {special
            ? `${special.name} has joined as the special player.`
            : `Waiting for ${session?.specialPlayerName ?? 'the special player'} to join.`}
        </p>
        {players.length > 0 && (
          <ul className="roster roster--host">
            {players.map((player) => (
              <li
                key={player.id}
                className={`roster__item${player.connected ? '' : ' roster__item--offline'}`}
              >
                <span className="roster__name">{player.name}</span>
                {player.role === 'SPECIAL' && <span className="roster__tag">special</span>}
                {!player.connected && (
                  <span className="roster__tag roster__tag--offline">offline</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="host__panel">
        <h2>Connection</h2>
        <dl className="host__facts">
          <dt>Party</dt>
          <dd>{data?.partyName ?? '…'}</dd>
          <dt>Join URL</dt>
          <dd>{data?.joinUrl ?? '…'}</dd>
          <dt>TV display</dt>
          <dd>{data ? `${data.joinUrl}display` : '…'}</dd>
        </dl>
        {serverRestarts > 0 && (
          <p className="host__warning">
            Server restarted since this page was opened. Players will need to rejoin.
          </p>
        )}
        {data && data.contentWarnings.length > 0 && (
          <div className="host__warning">
            <strong>Content warnings:</strong>
            <ul>
              {data.contentWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

function Count({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="count">
      <span className="count__value">{value}</span>
      <span className="count__label">{label}</span>
    </div>
  );
}
