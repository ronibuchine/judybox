import type { ConnectionStatus } from '../net/useJudyBox';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
};

export function StatusBadge({ status }: { status: ConnectionStatus }): JSX.Element {
  return (
    <span className={`status status--${status}`}>
      <span className="status__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
