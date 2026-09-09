import { useState } from 'react';
import type { ConnectionInfo, DisplayView, HostAction, PublicPlayer } from '@judybox/shared';
import { StatusBadge } from '../components/StatusBadge';
import { Leaderboard } from '../components/Leaderboard';
import { Button, Meter, Panel, Roster } from '../components/ui';
import { useApi, useJudyBox } from '../net/useJudyBox';

/** Manual award step. Matches the default in scoring config. */
const AWARD_STEP = 100;

/** The laptop control surface. Every button comes from the server. */
export function HostScreen(): JSX.Element {
  const {
    status,
    session,
    engine,
    displayView,
    leaderboard,
    notice,
    serverRestarts,
    hostAction,
    awardPoints,
  } = useJudyBox('host');
  const { data } = useApi<ConnectionInfo>('/api/connection-info');
  const [confirming, setConfirming] = useState<HostAction | null>(null);

  const players = session?.players ?? [];
  const connected = players.filter((player) => player.connected).length;
  const special = players.find((player) => player.role === 'SPECIAL');
  const specialName = special?.name ?? session?.specialPlayerName ?? 'Guest of honour';
  const specialState = describeSpecial(special, displayView);
  const actions = engine?.availableActions ?? [];
  const showGameButtons = engine?.phase === 'GAME_SELECT' && engine.games.length > 0;
  const usable = actions.filter(
    (action) => !(action.action === 'START_GAME' && showGameButtons),
  );
  const progression = usable.filter((action) => !action.danger);
  const dangerous = usable.filter((action) => action.danger);
  const [next, ...alternatives] = progression;

  const run = (action: HostAction, gameId?: string): void => {
    setConfirming(null);
    hostAction(action, gameId);
  };

  return (
    <main className="screen screen--host">
      <header className="host__bar">
        <p className="wordmark">
          JudyBox<span className="wordmark__dot">.</span> <span className="host__bar-tag">Host</span>
        </p>
        <StatusBadge status={status} />
      </header>

      <div className="host__stats">
        <Stat label="Game" value={engine?.gameName ?? 'None'} />
        <Stat
          label="Round"
          numeric
          value={
            engine && engine.roundCount > 0 ? `${engine.roundNumber} / ${engine.roundCount}` : '—'
          }
        />
        <Stat label="State" value={engine?.phase ?? '…'} phase />
        <Stat
          label="Answered"
          numeric
          value={engine ? `${engine.submittedCount} / ${engine.expectedCount}` : '—'}
        />
        <Stat label="Players" numeric value={`${connected} / ${players.length}`} />
        <Stat label={specialName} value={specialState.text} tone={specialState.tone} />
      </div>

      {engine && engine.expectedCount > 0 && (
        <Meter
          value={engine.submittedCount}
          max={engine.expectedCount}
          label={`${engine.submittedCount} of ${engine.expectedCount} submitted`}
          aside={engine.submittedCount >= engine.expectedCount ? 'Everyone is in' : undefined}
        />
      )}

      <div className="host__grid">
        <div className="host__col">
          <Panel title="Controls">
            {showGameButtons && engine && (
              <div className="host__games">
                {engine.games.map((game) => (
                  <Button
                    key={game.id}
                    variant="primary"
                    onClick={() => run('START_GAME', game.id)}
                  >
                    {game.label}
                  </Button>
                ))}
              </div>
            )}

            {usable.length === 0 && !showGameButtons ? (
              <p className="host__hint">No actions available in this state.</p>
            ) : (
              <>
                {next && (
                  <div className="host__actions host__actions--primary">
                    <Button variant="primary" size="lg" onClick={() => run(next.action)}>
                      {next.label}
                    </Button>
                  </div>
                )}
                {alternatives.length > 0 && (
                  <div className="host__actions" style={{ marginTop: 'var(--s-3)' }}>
                    {alternatives.map((action) => (
                      <Button key={action.action} onClick={() => run(action.action)}>
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
                {dangerous.length > 0 && (
                  <>
                    <p className="host__divider">Careful</p>
                    <div className="host__actions">
                      {dangerous.map((action) =>
                        confirming === action.action ? (
                          <div key={action.action} className="confirm">
                            <span className="confirm__text">{action.label}?</span>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => run(action.action)}
                            >
                              Yes
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                              No
                            </Button>
                          </div>
                        ) : (
                          <Button
                            key={action.action}
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirming(action.action)}
                          >
                            {action.label}
                          </Button>
                        ),
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            {notice && <p className="host__alert">{notice}</p>}
          </Panel>

          <Panel title="Scores">
            {leaderboard.length === 0 ? (
              <p className="host__hint">No players yet.</p>
            ) : (
              <>
                <Leaderboard rows={leaderboard} variant="compact" />
                <p className="host__divider">Manual awards</p>
                <div className="host__awards">
                  {leaderboard.map((row) => (
                    <div key={row.playerId} className="award">
                      <span className="award__name">{row.playerName}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => awardPoints(row.playerId, -AWARD_STEP)}
                      >
                        −{AWARD_STEP}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => awardPoints(row.playerId, AWARD_STEP)}
                      >
                        +{AWARD_STEP}
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="host__col">
          <Panel title="Lobby">
            <p className="host__hint">
              {special
                ? `${special.name} has joined as the guest of honour.`
                : `Waiting for ${session?.specialPlayerName ?? 'the guest of honour'} to join.`}
            </p>
            {players.length > 0 && (
              <div style={{ marginTop: 'var(--s-3)' }}>
                <Roster players={players} variant="compact" />
              </div>
            )}
          </Panel>

          <Panel title="Connection">
            <dl className="host__facts">
              <dt>Party</dt>
              <dd>{data?.partyName ?? '…'}</dd>
              <dt>Join URL</dt>
              <dd>{data?.joinUrl ?? '…'}</dd>
              <dt>TV display</dt>
              <dd>{data ? `${data.joinUrl}display` : '…'}</dd>
              <dt>Displays</dt>
              <dd>{session?.connections.display ?? 0}</dd>
            </dl>
            {serverRestarts > 0 && (
              <p className="host__alert">
                Server restarted since this page was opened. Players will need to rejoin.
              </p>
            )}
            {data && data.contentWarnings.length > 0 && (
              <div className="host__alert">
                <strong>Content warnings</strong>
                <ul>
                  {data.contentWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

/** Turns whatever the TV is showing into one word about the guest of honour. */
function describeSpecial(
  special: PublicPlayer | undefined,
  view: DisplayView | null,
): { text: string; tone: 'ok' | 'wait' | 'muted' } {
  if (!special) return { text: 'Not joined', tone: 'muted' };
  if (!special.connected) return { text: 'Offline', tone: 'muted' };
  if (view?.kind === 'question' && view.specialStatus) {
    return view.specialStatus.answered
      ? { text: 'Answered', tone: 'ok' }
      : { text: 'Deciding…', tone: 'wait' };
  }
  if (view?.kind === 'caption_gallery' || view?.kind === 'drawing_gallery') {
    return view.judyDeciding
      ? { text: 'Choosing…', tone: 'wait' }
      : { text: 'Picked', tone: 'ok' };
  }
  return { text: 'Ready', tone: 'ok' };
}

function Stat({
  label,
  value,
  numeric = false,
  phase = false,
  tone,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  phase?: boolean;
  tone?: 'ok' | 'wait' | 'muted';
}): JSX.Element {
  const classes = [
    'stat__value',
    numeric ? 'stat__value--numeric' : '',
    phase ? 'stat__value--phase' : '',
    tone ? `stat__value--${tone}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={classes}>{value}</span>
    </div>
  );
}
