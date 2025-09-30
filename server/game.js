import { RuleEngine } from './rules/engine.js';
import { defaultRules } from './rules/defaultRules.js';

export class Game {
  constructor(io, roomId, settings = { numDecks: 1, direction: 'cw', singWindowMs: 10000 }) {
    this.io = io;
    this.roomId = roomId;
    this.settings = {
      numDecks: Math.max(1, Math.min(33, (settings && settings.numDecks) || 1)),
      direction: settings && settings.direction === 'ccw' ? 'ccw' : 'cw',
      singWindowMs: (settings && settings.singWindowMs) || 10000,
    };

    // Core state
    this.players = {}; // id -> { id, name, hand: [] }
    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.draw = [];
    this.discard = [];

    // Room/meta
    this.hostId = null;
    this.started = false;
    this.chat = [];
    this.seq = 0; // monotonically increasing sequence for public state

    // Gameplay flags
    this.lastPlay = null; // { playerId, card }
    this.suitSelection = null; // { playerId, suit }
    this.singPending = null; // Set of playerIds
    this.singTimer = null;
    this.evilPending = false; // requires 'evil' phrase after certain plays
    this.awaitingSpade = {}; // playerId -> expected card code (e.g., '9S')

    // History helpers
    this.recentPlays = []; // [{ playerId, card, rank, suit }]

    // Content moderation
    this.curseList = ['shit', 'fuck', 'bitch', 'asshole'];

    // Initialize rule engine with default rules
    this.ruleEngine = new RuleEngine(this);
    for (const r of defaultRules) this.ruleEngine.use(r);
  }

  // ---------- Utility helpers ----------

  emitSystem(message) {
    this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message });
  }

  formatPenalty(playerId, phrase) {
    const p = this.players[playerId];
    const name = p ? p.name : playerId;
    const msg = `(${name}) -> ${phrase} (+1 penalty card)`;
    this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: msg });
  }

  topDiscard() {
    return this.discard[this.discard.length - 1] || null;
  }

  parseCard(card) {
    if (!card || typeof card !== 'string') return { rank: null, suit: null };
    const suit = card.slice(-1);
    const rank = card.slice(0, -1);
    return { rank, suit };
  }

  canPlayCard(_playerId, card) {
    const top = this.topDiscard();
    if (!top) return true;
    const { rank: cRank, suit: cSuit } = this.parseCard(card);
    const { rank: tRank, suit: tSuit } = this.parseCard(top);
    return cRank === tRank || cSuit === tSuit;
  }

  isPlayersTurn(playerId) {
    return this.turnOrder[this.currentTurnIndex] === playerId;
  }

  reshuffleIfNeeded() {
    if (this.draw.length > 0) return;
    if (this.discard.length <= 1) throw new Error('No cards to draw');
    const top = this.discard.pop();
    this.draw = this.discard.splice(0);
    this.discard = [top];
    // Fisher-Yates shuffle
    for (let i = this.draw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.draw[i], this.draw[j]] = [this.draw[j], this.draw[i]];
    }
  }

  drawOneToPlayer(playerId) {
    this.reshuffleIfNeeded();
    const card = this.draw.shift();
    this.players[playerId].hand.push(card);
    this.sync(true);
    return card;
  }

  drawManyToPlayer(playerId, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      this.reshuffleIfNeeded();
      if (this.draw.length === 0) break; // defensive
      const card = this.draw.shift();
      this.players[playerId].hand.push(card);
      drawn.push(card);
    }
    this.sync(true);
    return drawn;
  }

  advanceTurn() {
    if (this.turnOrder.length === 0) return;
    const dir = this.settings.direction === 'cw' ? 1 : -1;
    this.currentTurnIndex = (this.currentTurnIndex + dir + this.turnOrder.length) % this.turnOrder.length;
  }

  // ---------- Chat/rules processing ----------

  // Lightweight Levenshtein distance for fuzzy matching
  levenshtein(a, b) {
    a = (a || '').toLowerCase().replace(/[^a-z]/g, '');
    b = (b || '').toLowerCase().replace(/[^a-z]/g, '');
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  }

  processChat(playerId, message) {
    // Delegate chat-based rule handling to the rules engine
    try { this.ruleEngine.onChat(playerId, message); } catch (e) { /* ignore */ }
  }

  addChat(from, message) {
    const entry = { from, message, time: Date.now() };
    this.chat.push(entry);
    return entry;
  }

  clearChat() { this.chat = []; }

  // ---------- Player/room management ----------

  addPlayer(socket, name) {
    if (this.players[socket.id]) return;
    this.players[socket.id] = { id: socket.id, name: name || 'Player', hand: [] };
    this.turnOrder.push(socket.id);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.roomId);

    // Immediate private hand to joining socket
    try { socket.emit('private_state', { hand: this.players[socket.id].hand.slice() }); } catch (e) { /* ignore */ }

    // Sync everyone (private too) so all clients have authoritative hands
    this.sync(true);
  }

  removePlayer(id) {
    delete this.players[id];
    this.turnOrder = this.turnOrder.filter(pid => pid !== id);
    if (this.hostId === id) this.hostId = this.turnOrder[0] || null;
    if (this.currentTurnIndex >= this.turnOrder.length) this.currentTurnIndex = 0;
    this.sync();
  }

  removeAllPlayers() {
    for (const pid of Object.keys(this.players)) this.removePlayer(pid);
  }

  // ---------- Game lifecycle ----------

  start() {
    if (this.started) return;
    this.started = true;
    this.buildDrawPile();
    this.dealHands(5);
    if (this.draw.length > 0) this.discard.push(this.draw.shift());
    // set current turn to host
    const hostIndex = this.turnOrder.indexOf(this.hostId);
    this.currentTurnIndex = hostIndex >= 0 ? hostIndex : 0;
    this.sync(true);
  }

  buildDrawPile() {
    const suits = ['C', 'D', 'H', 'S'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck = [];
    for (let d = 0; d < this.settings.numDecks; d++) {
      for (const s of suits) for (const r of ranks) deck.push(`${r}${s}`);
    }
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.draw = deck;
    this.discard = [];
  }

  dealHands(count) {
    for (const pid of this.turnOrder) {
      const player = this.players[pid];
      player.hand = [];
      for (let i = 0; i < count; i++) {
        if (this.draw.length === 0) break;
        player.hand.push(this.draw.shift());
      }
    }
  }

  // ---------- Actions ----------
  // TODO (Rule 1a: Jack): Enforce next play must match called suit and penalize if no suit called in time.
  // TODO (Rule 2: Slowplay): Add per-turn slowplay timer with deterministic penalty.
  // TODO (Rule 3: Knock): Start a knock window on playing hearts; auto-penalize if missed.
  // TODO (Rule 5: Ten): Add short timer to penalize silent failure to name a Beatle.
  // TODO (Rule 10: Seven chain): Track sevenChain and validate "very" count.
  // TODO (Rule 12: Last card): Add one-card announcement requirement.
  // TODO (Rule 13: Mao): Require "Mao" before awarding win.
  // TODO (Rule 8/9: Queen/King): Implement extra turn and attack mechanics.

  playCard(playerId, card, cb) {
    try {
      if (!this.started) return cb && cb('Game not started');

      // Inform clients of an attempted play for optimistic UI
      this.io.to(this.roomId).emit('played_attempt', { playerId, card });

      const player = this.players[playerId];
      if (!player) return cb && cb('Player not found');
      const idx = player.hand.indexOf(card);
      if (idx === -1) return cb && cb('Card not in hand');

      // Remove from hand and tentatively place on discard (optimistic)
      const prevTop = this.topDiscard();
      player.hand.splice(idx, 1);
      this.discard.push(card);

      // Record last play and sync public so everyone sees it immediately
      this.lastPlay = { playerId, card };
      this.sync(false);
      this.io.to(this.roomId).emit('play_accepted', { playerId, card, playerName: player.name });

      // Validate after a short delay to let clients render the attempt
      const VALIDATE_DELAY = 400;
      setTimeout(() => {
        try {
          const isTurnNow = this.isPlayersTurn(playerId);
          let validMatch = true;
          if (prevTop) {
            const { rank: cRank, suit: cSuit } = this.parseCard(card);
            const { rank: tRank, suit: tSuit } = this.parseCard(prevTop);
            validMatch = cRank === tRank || cSuit === tSuit;
          }

          if (!validMatch || !isTurnNow) {
            // Undo: remove from discard and return to player's hand
            const last = this.topDiscard();
            if (last === card) this.discard.pop();
            else {
              for (let i = this.discard.length - 1; i >= 0; i--) {
                if (this.discard[i] === card) { this.discard.splice(i, 1); break; }
              }
            }
            if (this.players[playerId]) this.players[playerId].hand.push(card);
            try { this.drawOneToPlayer(playerId); } catch (e) { /* ignore */ }
            this.io.to(this.roomId).emit('play_rejected', { playerId, card });
            try {
              const sock = this.io.sockets.sockets.get(playerId);
              if (sock && typeof sock.emit === 'function') sock.emit('play_return', { card });
              else this.io.to(playerId).emit('play_return', { card });
            } catch (e) { /* ignore */ }
            this.formatPenalty(playerId, 'Penalty – Stupidity');
            this.sync(true);
            if (cb) cb('Card does not match suit or value or not your turn');
            return;
          }

          // Valid play: record and apply special rules via rule engine
          const parsed = this.parseCard(card);
          this.recentPlays.push({ playerId, card, rank: parsed.rank, suit: parsed.suit });
          if (this.recentPlays.length > 10) this.recentPlays.shift();
          const effects = this.ruleEngine.onPlayValidated(playerId, card, prevTop);
          const willSkipNext = !!(effects && effects.skipNext);

          // Win check
          if (player.hand.length === 0) {
            this.io.to(this.roomId).emit('game_over', { winnerId: playerId });
            this.started = false;
            this.sync(true);
            if (cb) cb(null);
            return;
          }

          // Advance turn (and possibly skip one)
          this.advanceTurn();
          if (willSkipNext) {
            this.advanceTurn();
            this.emitSystem(`${this.players[playerId].name} played a 5 — next player skipped`);
          }

          this.sync(true);
          if (cb) cb(null);
        } catch (err) {
          if (cb) cb(String(err));
        }
      }, VALIDATE_DELAY);

      // callback deferred until validation completes
      return;
    } catch (err) {
      return cb && cb(String(err));
    }
  }

  drawCardAction(playerId, cb) {
    try {
      if (!this.started) return cb && cb('Game not started');

      if (!this.isPlayersTurn(playerId)) {
        // Off-turn: draw one, then penalty draw one more
        try {
          this.reshuffleIfNeeded();
          const card = this.draw.shift();
          this.players[playerId].hand.push(card);
          try { this.drawOneToPlayer(playerId); } catch (err) { /* ignore */ }
          this.sync(true);
          this.formatPenalty(playerId, 'Penalty – Stupidity');
          return cb && cb(null);
        } catch (e) {
          return cb && cb(String(e.message || e));
        }
      }

      // On-turn draw one and end turn
      try {
        this.reshuffleIfNeeded();
        const card = this.draw.shift();
        this.players[playerId].hand.push(card);
        this.advanceTurn();
        this.sync(true);
        return cb && cb(null);
      } catch (e) {
        return cb && cb(String(e.message || e));
      }
    } catch (err) {
      return cb && cb(String(err));
    }
  }

  // ---------- Special actions ----------

  selectSuit(playerId, suit) {
    const p = this.players[playerId];
    if (!p) return;
    this.emitSystem(`${p.name} has selected ${suit}`);

    // If last play isn't a Jack, penalize
    if (!this.lastPlay || !this.lastPlay.card || !this.lastPlay.card.startsWith('J')) {
      this.formatPenalty(playerId, 'Illegal play');
      try { this.drawOneToPlayer(playerId); } catch (e) { /* ignore */ }
      this.sync(true);
      return;
    }

    // Record first selector only and announce winner of the press
    if (!this.suitSelection) this.suitSelection = { playerId, suit };
    this.emitSystem(`${p.name} pressed ${suit}${this.suitSelection.playerId === playerId ? ' (first)' : ''}`);
    this.sync(true);
  }

  knock(playerId) {
    const p = this.players[playerId];
    if (!p) return;
    this.emitSystem(`${p.name} knocked`);
    try { this.ruleEngine.onKnock(playerId); } catch (e) { /* ignore */ }

    // Verify last play by this player and was a Heart (not Jack)
    if (!this.lastPlay || this.lastPlay.playerId !== playerId || !this.lastPlay.card.endsWith('H') || this.lastPlay.card.startsWith('J')) {
      this.formatPenalty(playerId, 'Failure to knock');
      try { this.drawOneToPlayer(playerId); } catch (e) { /* ignore */ }
      this.sync(true);
      return;
    }

    this.sync(true);
  }

  sing(playerId) {
    const p = this.players[playerId];
    if (!p) return;
    this.emitSystem(`${p.name} sings`);

    const last = this.lastPlay && this.lastPlay.card;
    if (last && last === 'AS') {
      // Ensure sing window is initialized immediately (even before validation completes)
      if (!this.singPending) {
        this.singPending = new Set(Object.keys(this.players));
        if (this.singTimer) clearTimeout(this.singTimer);
        this.singTimer = setTimeout(() => {
          for (const pid of (this.singPending || [])) {
            const pl = this.players[pid];
            if (!pl) continue;
            this.formatPenalty(pid, 'Failure to sing');
            try { this.drawOneToPlayer(pid); } catch (e) { /* ignore */ }
          }
          this.singPending = null;
          this.sync(true);
        }, this.settings.singWindowMs || 10000);
      }
      // Delegate to rules to allow them to update the window as needed
      try { this.ruleEngine.onSing(playerId); } catch (e) { /* ignore */ }
      this.sync(true);
    } else {
      // No AS active; pressing sing is invalid
      this.formatPenalty(playerId, 'Flat note');
      try { this.drawOneToPlayer(playerId); } catch (e) { /* ignore */ }
      this.sync(true);
    }
  }

  // ---------- State sync ----------

  sync(sendPrivate = false) {
    const publicPlayers = {};
    for (const [id, p] of Object.entries(this.players)) {
      publicPlayers[id] = { id: p.id, name: p.name, handCount: p.hand.length };
    }

    const top = this.topDiscard();
    const publicState = {
      roomId: this.roomId,
      players: publicPlayers,
      turnOrder: this.turnOrder,
      currentTurn: this.turnOrder[this.currentTurnIndex] || null,
      visibleTop: top,
      discardTop: top,
      drawCount: this.draw.length,
      settings: this.settings,
      hostId: this.hostId,
      started: this.started,
      seq: ++this.seq,
    };

    this.io.to(this.roomId).emit('game_state', publicState);

    if (sendPrivate) {
      for (const pid of this.turnOrder) {
        try {
          this.io.to(pid).emit('private_state', { hand: this.players[pid].hand.slice() });
        } catch (e) {
          try {
            const sock = this.io.sockets.sockets.get(pid);
            if (sock) sock.emit('private_state', { hand: this.players[pid].hand.slice() });
          } catch (err) { /* ignore */ }
        }
      }
    }
  }
}
