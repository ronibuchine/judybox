import type { ConnectionInfo } from '@judybox/shared';
import { StatusBadge } from '../components/StatusBadge';
import { DisplayViewPanel } from '../components/DisplayViewPanel';
import { useApi, useJudyBox } from '../net/useJudyBox';

/** The TV surface. Optimised for reading from across a room. */
export function DisplayScreen(): JSX.Element {
  const { status, session, displayView } = useJudyBox('display');
  const { data, error } = useApi<ConnectionInfo>('/api/connection-info');

  const players = session?.players ?? [];
  const inLobby = !displayView || displayView.kind === 'lobby';

  return (
    <main className="screen screen--tv">
      <header className="tv__header">
        <h1 className="tv__title">JudyBox</h1>
        <StatusBadge status={status} />
      </header>

      {inLobby ? (
        <section className="tv__lobby">
          <div className="tv__join">
            <p className="tv__step">Scan to join</p>
            <div className="tv__qr">
              {data ? (
                <img src={data.qrDataUrl} alt={`QR code linking to ${data.joinUrl}`} />
              ) : (
                <div className="tv__qr-placeholder">{error ?? 'Generating QR…'}</div>
              )}
            </div>
            <p className="tv__url">{data?.joinUrl ?? '…'}</p>
            <p className="tv__hint">Same Wi-Fi. No app to install.</p>
          </div>

          <div className="tv__roster">
            <p className="tv__roster-title">
              Players joined: <span className="tv__count">{players.length}</span>
            </p>
            {players.length === 0 ? (
              <p className="tv__empty">Waiting for the first player…</p>
            ) : (
              <ul className="roster">
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
          </div>
        </section>
      ) : (
        <DisplayViewPanel view={displayView} />
      )}
    </main>
  );
}
