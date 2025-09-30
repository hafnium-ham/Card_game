// server/rules/engine.js
// A minimal rule engine with lifecycle hooks used by the Game.
// Rules can tap into: onChat, onPlayValidated, onSing, onKnock and return effects.

export class RuleEngine {
  constructor(game) {
    this.game = game;
    this.rules = [];
  }

  use(rule) {
    if (rule && typeof rule === 'object') this.rules.push(rule);
  }

  // Utilities exposed to rules
  ctx(extra = {}) {
    const g = this.game;
    return Object.freeze({
      game: g,
      io: g.io,
      roomId: g.roomId,
      players: g.players,
      settings: g.settings,
      // convenience wrappers
      emitSystem: (msg) => g.io.to(g.roomId).emit('chat', { from: 'SYSTEM', message: msg }),
      formatPenalty: (pid, phrase) => g.formatPenalty(pid, phrase),
      drawOne: (pid) => g.drawOneToPlayer(pid),
      drawMany: (pid, n) => g.drawManyToPlayer(pid, n),
      parseCard: (c) => g.parseCard(c),
      levenshtein: (a, b) => g.levenshtein(a, b),
      topDiscard: () => g.discard[g.discard.length - 1] || null,
      awaitingSpade: g.awaitingSpade,
      setEvilPending: (v) => { g.evilPending = !!v; },
      getEvilPending: () => g.evilPending,
      recentPlays: g.recentPlays,
      advanceTurn: () => g.advanceTurn(),
      ...extra,
    });
  }

  // Called when chat message is received
  onChat(playerId, message) {
    const context = this.ctx({ playerId, message });
    for (const r of this.rules) {
      if (typeof r.onChat === 'function') r.onChat(context);
    }
  }

  // Called after a play has been validated and applied to discard
  // Should return an effects object such as { skipNext: boolean }
  onPlayValidated(playerId, card, prevTop) {
    const context = this.ctx({ playerId, card, prevTop, parsed: this.game.parseCard(card) });
    const effects = { skipNext: false };
    for (const r of this.rules) {
      if (typeof r.onPlayValidated === 'function') {
        const res = r.onPlayValidated(context);
        if (res && typeof res === 'object') Object.assign(effects, res);
      }
    }
    return effects;
  }

  // Called when a player presses Sing
  onSing(playerId) {
    const context = this.ctx({ playerId });
    for (const r of this.rules) {
      if (typeof r.onSing === 'function') r.onSing(context);
    }
  }

  // Called when a player knocks
  onKnock(playerId) {
    const context = this.ctx({ playerId });
    for (const r of this.rules) {
      if (typeof r.onKnock === 'function') r.onKnock(context);
    }
  }
}
