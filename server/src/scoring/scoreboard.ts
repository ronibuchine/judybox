import type { LeaderboardRow, PlayerStanding, PublicPlayer } from '@judybox/shared';

export interface ScoringEvent {
  playerId: string;
  reason: string;
  points: number;
}

/**
 * Session-wide score accounting.
 *
 * Games decide *who* earned points and why; this decides nothing about
 * gameplay. Events are applied in named batches so a round can be scored
 * exactly once and cleanly undone when the host restarts it.
 *
 * Held in memory only: restarting the server clears every score.
 */
export class Scoreboard {
  private readonly totals = new Map<string, number>();
  private readonly batches = new Map<string, ScoringEvent[]>();
  /** Batch whose points count as the current round delta. */
  private lastBatchKey: string | null = null;

  /** Applies a batch once. Returns false if `key` was already scored. */
  apply(key: string, events: readonly ScoringEvent[]): boolean {
    if (this.batches.has(key)) return false;

    this.batches.set(key, [...events]);
    for (const event of events) {
      this.totals.set(event.playerId, this.scoreFor(event.playerId) + event.points);
    }
    this.lastBatchKey = key;
    return true;
  }

  /** Undoes a batch, e.g. when the host restarts an already-scored round. */
  revert(key: string): boolean {
    const events = this.batches.get(key);
    if (!events) return false;

    for (const event of events) {
      this.totals.set(event.playerId, this.scoreFor(event.playerId) - event.points);
    }
    this.batches.delete(key);
    if (this.lastBatchKey === key) this.lastBatchKey = null;
    return true;
  }

  /** Undoes every batch whose key starts with `prefix`, e.g. one game's rounds. */
  revertMatching(prefix: string): number {
    const keys = [...this.batches.keys()].filter((key) => key.startsWith(prefix));
    for (const key of keys) this.revert(key);
    return keys.length;
  }

  hasScored(key: string): boolean {
    return this.batches.has(key);
  }

  scoreFor(playerId: string): number {
    return this.totals.get(playerId) ?? 0;
  }

  /** Points this player gained in the most recently scored batch. */
  deltaFor(playerId: string): number {
    if (this.lastBatchKey === null) return 0;
    const events = this.batches.get(this.lastBatchKey) ?? [];
    return events
      .filter((event) => event.playerId === playerId)
      .reduce((sum, event) => sum + event.points, 0);
  }

  /** Ordered standings. Equal scores share a rank and the next rank skips. */
  standings(players: readonly PublicPlayer[]): LeaderboardRow[] {
    const rows = players
      .map((player) => ({
        playerId: player.id,
        playerName: player.name,
        score: this.scoreFor(player.id),
        delta: this.deltaFor(player.id),
        rank: 0,
      }))
      .sort((a, b) => b.score - a.score || a.playerName.localeCompare(b.playerName));

    let rank = 0;
    let previousScore: number | null = null;
    rows.forEach((row, index) => {
      if (previousScore === null || row.score !== previousScore) {
        rank = index + 1;
        previousScore = row.score;
      }
      row.rank = rank;
    });
    return rows;
  }

  standingFor(playerId: string, players: readonly PublicPlayer[]): PlayerStanding | null {
    const rows = this.standings(players);
    const row = rows.find((candidate) => candidate.playerId === playerId);
    if (!row) return null;
    return {
      score: row.score,
      rank: row.rank,
      delta: row.delta,
      totalPlayers: rows.length,
    };
  }

  reset(): void {
    this.totals.clear();
    this.batches.clear();
    this.lastBatchKey = null;
  }
}
