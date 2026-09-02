import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WS_PATH,
  type ClientToServerMessage,
  type ConnectionRole,
  type DisplayView,
  type EngineSnapshot,
  type HostAction,
  type JoinRejectionCode,
  type LeaderboardRow,
  type PlayerStanding,
  type PlayerView,
  type PublicPlayer,
  type ServerToClientMessage,
  type SessionSnapshot,
} from '@judybox/shared';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export interface JoinError {
  code: JoinRejectionCode;
  message: string;
}

export interface JudyBoxState {
  status: ConnectionStatus;
  connectionId: string | null;
  /** The player this device is, once joined. */
  self: PublicPlayer | null;
  session: SessionSnapshot | null;
  engine: EngineSnapshot | null;
  displayView: DisplayView | null;
  playerView: PlayerView | null;
  /** This device's own score and rank, when it is a player. */
  standing: PlayerStanding | null;
  /** Full standings; populated for the host surface. */
  leaderboard: LeaderboardRow[];
  joinError: JoinError | null;
  /** Last rejected host action or submission, for host/player feedback. */
  notice: string | null;
  /** Increments whenever the server hands out a new session, i.e. it restarted. */
  serverRestarts: number;
  join: (name: string) => void;
  submit: (value: string) => void;
  hostAction: (action: HostAction, gameId?: string) => void;
  awardPoints: (playerId: string, points: number) => void;
  setSpecialNote: (text: string) => void;
  setSpecialPick: (targetPlayerId: string) => void;
  clearJoinError: () => void;
  clearNotice: () => void;
}

const MAX_BACKOFF_MS = 5_000;
/** Survives tab close, unlike the per-tab connection id. */
const TOKEN_KEY = 'judybox:playerToken';

interface StoredToken {
  token: string;
  sessionId: string;
}

function readStoredToken(): StoredToken | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof parsed.token !== 'string' || typeof parsed.sessionId !== 'string') return null;
    return { token: parsed.token, sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}

function writeStoredToken(value: StoredToken | null): void {
  try {
    if (value === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
  } catch {
    // Private browsing can reject writes; the player just re-enters their name.
  }
}

export function useJudyBox(role: ConnectionRole): JudyBoxState {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [self, setSelf] = useState<PublicPlayer | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [engine, setEngine] = useState<EngineSnapshot | null>(null);
  const [displayView, setDisplayView] = useState<DisplayView | null>(null);
  const [playerView, setPlayerView] = useState<PlayerView | null>(null);
  const [standing, setStanding] = useState<PlayerStanding | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [joinError, setJoinError] = useState<JoinError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverRestarts, setServerRestarts] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const lastSessionRef = useRef<string | null>(null);

  const send = useCallback((message: ClientToServerMessage): void => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const join = useCallback(
    (name: string) => {
      setJoinError(null);
      send({ type: 'join', name });
    },
    [send],
  );

  const clearJoinError = useCallback(() => setJoinError(null), []);

  const submit = useCallback(
    (value: string) => {
      setNotice(null);
      send({ type: 'submit', value });
    },
    [send],
  );

  const hostAction = useCallback(
    (action: HostAction, gameId?: string) => {
      setNotice(null);
      send({ type: 'host_action', action, ...(gameId ? { gameId } : {}) });
    },
    [send],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  const awardPoints = useCallback(
    (playerId: string, points: number) => {
      send({ type: 'host_award', playerId, points });
    },
    [send],
  );

  const setSpecialNote = useCallback(
    (text: string) => {
      setNotice(null);
      send({ type: 'special_note', text });
    },
    [send],
  );

  const setSpecialPick = useCallback(
    (targetPlayerId: string) => {
      setNotice(null);
      send({ type: 'special_pick', targetPlayerId });
    },
    [send],
  );

  useEffect(() => {
    disposedRef.current = false;
    const connectionKey = `judybox:connection:${role}`;

    const readConnectionIdentity = (): { connectionId: string; sessionId: string } | null => {
      try {
        const raw = window.sessionStorage.getItem(connectionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { connectionId?: unknown; sessionId?: unknown };
        if (typeof parsed.connectionId !== 'string' || typeof parsed.sessionId !== 'string') {
          return null;
        }
        return { connectionId: parsed.connectionId, sessionId: parsed.sessionId };
      } catch {
        return null;
      }
    };

    const connect = (): void => {
      if (disposedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}${WS_PATH}`);
      socketRef.current = socket;
      setStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

      socket.onopen = () => {
        const identity = readConnectionIdentity();
        // The token identifies a player; host and TV tabs share an origin, so
        // sending it from them would hand this device's player to the wrong surface.
        const stored = role === 'player' ? readStoredToken() : null;
        socket.send(
          JSON.stringify({
            type: 'hello',
            role,
            ...(identity
              ? { connectionId: identity.connectionId, sessionId: identity.sessionId }
              : {}),
            ...(stored ? { playerToken: stored.token } : {}),
          } satisfies ClientToServerMessage),
        );
      };

      socket.onmessage = (event) => {
        let message: ServerToClientMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerToClientMessage;
        } catch {
          return;
        }

        switch (message.type) {
          case 'welcome': {
            attemptRef.current = 0;
            if (lastSessionRef.current && lastSessionRef.current !== message.sessionId) {
              setServerRestarts((count) => count + 1);
            }
            lastSessionRef.current = message.sessionId;
            try {
              window.sessionStorage.setItem(
                connectionKey,
                JSON.stringify({
                  connectionId: message.connectionId,
                  sessionId: message.sessionId,
                }),
              );
            } catch {
              // Non-fatal; the device just gets a new connection id next time.
            }
            setConnectionId(message.connectionId);
            setSession(message.session);
            setSelf(message.self);
            // A token the server no longer recognises means it restarted.
            if (!message.self) writeStoredToken(null);
            setStatus('connected');
            break;
          }
          case 'session':
            setSession(message.session);
            setSelf((current) =>
              current
                ? (message.session.players.find((player) => player.id === current.id) ?? current)
                : current,
            );
            break;
          case 'join_accepted':
            writeStoredToken({ token: message.playerToken, sessionId: message.session.sessionId });
            setSelf(message.self);
            setSession(message.session);
            setJoinError(null);
            break;
          case 'join_rejected':
            setJoinError({ code: message.code, message: message.message });
            break;
          case 'view':
            setEngine(message.engine);
            if (message.display !== null) setDisplayView(message.display);
            if (message.player !== null) setPlayerView(message.player);
            setStanding(message.standing);
            setLeaderboard(message.leaderboard);
            break;
          case 'action_rejected':
          case 'submission_rejected':
            setNotice(message.message);
            break;
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' } satisfies ClientToServerMessage));
            break;
          case 'error':
            console.warn('[ws] server error:', message.code, message.message);
            break;
        }
      };

      socket.onerror = () => socket.close();

      socket.onclose = () => {
        socketRef.current = null;
        if (disposedRef.current) return;
        setStatus('reconnecting');
        const attempt = attemptRef.current++;
        const delay = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS) + Math.random() * 250;
        retryTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    /** Used when the phone wakes or Wi-Fi returns: skip the remaining backoff. */
    const reconnectNow = (): void => {
      if (disposedRef.current) return;
      const socket = socketRef.current;
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      attemptRef.current = 0;
      connect();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') reconnectNow();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', reconnectNow);
    window.addEventListener('pageshow', reconnectNow);

    connect();

    return () => {
      disposedRef.current = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', reconnectNow);
      window.removeEventListener('pageshow', reconnectNow);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [role]);

  return {
    status,
    connectionId,
    self,
    session,
    engine,
    displayView,
    playerView,
    standing,
    leaderboard,
    joinError,
    notice,
    serverRestarts,
    join,
    submit,
    hostAction,
    awardPoints,
    setSpecialNote,
    setSpecialPick,
    clearJoinError,
    clearNotice,
  };
}

/** Reads a JSON API endpoint once. */
export function useApi<T>(path: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Request failed');
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, error };
}
