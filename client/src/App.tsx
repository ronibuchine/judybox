import { DisplayScreen } from './screens/DisplayScreen';
import { HostScreen } from './screens/HostScreen';
import { PlayerScreen } from './screens/PlayerScreen';

/**
 * Deliberately not using a router: there are exactly three entry points and
 * navigation between them is a full page load. Fewer moving parts on party day.
 */
export function App(): JSX.Element {
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();

  switch (path) {
    case '/display':
      return <DisplayScreen />;
    case '/host':
      return <HostScreen />;
    default:
      return <PlayerScreen />;
  }
}
