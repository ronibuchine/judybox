import type { PublicPlayer } from '@judybox/shared';

/** The joined-player list. Same markup on the TV and in the host panel. */
export function Roster({
  players,
  variant = 'default',
}: {
  players: readonly PublicPlayer[];
  variant?: 'tv' | 'compact' | 'default';
}): JSX.Element {
  return (
    <ul className={`roster${variant === 'default' ? '' : ` roster--${variant}`}`}>
      {players.map((player) => {
        const special = player.role === 'SPECIAL';
        return (
          <li
            key={player.id}
            className={[
              'roster__item',
              special ? 'roster__item--special' : '',
              player.connected ? '' : 'roster__item--offline',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="roster__name">{player.name}</span>
            {!player.connected ? (
              <span className="roster__mark roster__mark--offline">offline</span>
            ) : (
              special && <span className="roster__mark">guest of honour</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
