import type { ConnectionInfo } from '@judybox/shared';
import { StatusBadge } from '../components/StatusBadge';
import { DisplayViewPanel } from '../components/DisplayViewPanel';
import { QrJoinPanel, Roster } from '../components/ui';
import { useApi, useJudyBox } from '../net/useJudyBox';

/** The TV surface. Optimised for reading from across a room. */
export function DisplayScreen(): JSX.Element {
  const { status, session, engine, displayView } = useJudyBox('display');
  const { data, error } = useApi<ConnectionInfo>('/api/connection-info');

  const players = session?.players ?? [];
  const inLobby = !displayView || displayView.kind === 'lobby';
  const showRound = Boolean(engine && engine.roundCount > 0 && engine.roundNumber > 0);
  // Re-keying replays the entrance animation when the server moves everyone on.
  const viewKey = [
    displayView?.kind ?? 'lobby',
    engine?.gameId ?? '',
    engine?.roundNumber ?? 0,
    engine?.phase ?? '',
  ].join(':');

  return (
    <main className="screen screen--tv">
      <header className="tv__bar">
        <div className="tv__brand">
          <p className="wordmark">
            JudyBox<span className="wordmark__dot">.</span>
          </p>
          {!inLobby && data?.partyName && <p className="tv__party">{data.partyName}</p>}
        </div>
        <div className="tv__now">
          {engine?.gameName && <span className="tv__now-game">{engine.gameName}</span>}
          {showRound && engine && (
            <span className="tv__now-round">
              Round {engine.roundNumber} / {engine.roundCount}
            </span>
          )}
          <StatusBadge status={status} />
        </div>
      </header>

      <div className="tv__main">
        {inLobby ? (
          <section className="lobby">
            <QrJoinPanel
              qrDataUrl={data?.qrDataUrl ?? null}
              joinUrl={data?.joinUrl ?? null}
              error={error}
            />

            <div className="lobby__side">
              <p className="eyebrow">Welcome</p>
              <h2 className="lobby__title">{data?.partyName ?? 'The party is open'}</h2>
              <div className="lobby__count">
                <span className="lobby__count-value numeral">{players.length}</span>
                <span className="lobby__count-label">
                  {players.length === 1 ? 'player in' : 'players in'}
                </span>
              </div>
              {players.length === 0 ? (
                <p className="lobby__empty">Waiting for the first player…</p>
              ) : (
                <div className="lobby__roster">
                  <Roster players={players} variant="tv" />
                </div>
              )}
            </div>
          </section>
        ) : (
          <DisplayViewPanel key={viewKey} view={displayView} />
        )}
      </div>
    </main>
  );
}
