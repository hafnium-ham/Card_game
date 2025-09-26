export class Game {
  constructor(io, roomId, settings = { numDecks: 1, direction: "cw" }) {
    this.io = io;
    this.roomId = roomId;
    this.settings = { numDecks: Math.max(1, Math.min(33, settings.numDecks || 1)), direction: settings.direction === 'ccw' ? 'ccw' : 'cw' };
    this.players = {}; // id -> { id, name, hand: [] }
    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.draw = [];
    this.discard = [];
      this.attempts = [];
    this.hostId = null;
    this.started = false;
    this.chat = [];
    this.seq = 0; // sequence number for state updates to help clients debug ordering
  }

  /*
    Server/Game responsibilities (authoritative):
    - Maintain canonical game state for a room: players, draw/discard piles,
      current turn, and per-player hands.
    - Validate plays (suit/rank matching and turn-order) and apply penalties
      for invalid plays. The server is the single source of truth for hands.
    - Expose two kinds of state messages:
      * `game_state` (public): aggregate info suitable for all clients, does
        not include private hands. It includes `visibleTop` and `discardTop`.
      * `private_state` (per-player): authoritative hand array for that player.

    Notes on optimistic display and validation:
    - The server intentionally emits `played_attempt` so clients can show a
      transient visual when a player attempts a play. The server then briefly
      waits (VALIDATE_DELAY) before performing authoritative validation.
      This improves UX across jittery networks by making played cards visible
      to everyone momentarily.
    - The server does not rely on client-side state; it removes cards from the
      player's hand when attempting a play, and will `undo` (return the card)
      plus issue a penalty if the play is invalid. After any change the server
      calls `sync(true)` to emit an authoritative `private_state`.
  */

  addChat(from, message) {
    const entry = { from, message, time: Date.now() };
    this.chat.push(entry);
    return entry;
  }

  clearChat() {
    this.chat = [];
  }

  addPlayer(socket, name) {
    if (this.players[socket.id]) return;
    this.players[socket.id] = { id: socket.id, name: name || 'Player', hand: [] };
    this.turnOrder.push(socket.id);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.roomId);
    this.sync();
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

  start() {
    if (this.started) return;
    this.started = true;
    this.buildDrawPile();
    this.dealHands(5);
    // Move top card to discard to start
    if (this.draw.length > 0) this.discard.push(this.draw.shift());
    console.log(`[${this.roomId}] start: discard top ->`, this.discard[this.discard.length - 1] || null);
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
    console.log(`[${this.roomId}] built draw pile (${this.draw.length}) decks=${this.settings.numDecks}`);
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
    console.log(`[${this.roomId}] dealt ${count} to ${this.turnOrder.length} players, draw left=${this.draw.length}`);
  }

  parseCard(card) {
    if (!card || typeof card !== 'string') return { rank: null, suit: null };
    const suit = card.slice(-1);
    const rank = card.slice(0, -1);
    return { rank, suit };
  }

  canPlayCard(playerId, card) {
    const top = this.discard[this.discard.length - 1];
    if (!top) return true; // any card if no top
    const { rank: cRank, suit: cSuit } = this.parseCard(card);
    const { rank: tRank, suit: tSuit } = this.parseCard(top);
    return cRank === tRank || cSuit === tSuit;
  }

  playCard(playerId, card, cb, socket) {
    try {
      if (!this.started) return cb && cb('Game not started');
      // Broadcast that a player attempted to play (so clients can show the card temporarily)
      console.log(`[${this.roomId}] play attempt by ${playerId}: ${card}`);
      this.io.to(this.roomId).emit('played_attempt', { playerId, card });
      const player = this.players[playerId];
      if (!player) return cb && cb('Player not found');
      const idx = player.hand.indexOf(card);
      if (idx === -1) return cb && cb('Card not in hand');
      // We must display the played card to everyone immediately: remove it from the player's hand and place it on discard.
      // Save previous top to validate the play after the fact.
      const prevTop = this.discard[this.discard.length - 1] || null;
      // remove from player's hand now
      player.hand.splice(idx, 1);
      this.discard.push(card);
  // immediately sync public state so everyone sees the played card as soon as possible
  console.log(`[${this.roomId}] placed ${card} on discard, syncing public state`);
  this.sync(false);
      // notify accepted visually so clients show the card (we will undo if invalid)
      this.io.to(this.roomId).emit('play_accepted', { playerId, card, playerName: player.name });

      // small delay before authoritative validation so clients have time to render the played card
      const VALIDATE_DELAY = 400; // ms
      setTimeout(() => {
        try {
          // validate against previous top and turn
          const isTurnNow = (this.turnOrder[this.currentTurnIndex] === playerId);
          let validMatch = true;
          if (prevTop) {
            const { rank: cRank, suit: cSuit } = this.parseCard(card);
            const { rank: tRank, suit: tSuit } = this.parseCard(prevTop);
            validMatch = (cRank === tRank || cSuit === tSuit);
          }
          if (!validMatch || !isTurnNow) {
            // invalid: undo the play (remove from discard and return to player's hand)
            const last = this.discard[this.discard.length - 1];
            if (last === card) this.discard.pop();
            else {
              for (let i = this.discard.length - 1; i >= 0; i--) {
                if (this.discard[i] === card) { this.discard.splice(i, 1); break; }
              }
            }
            if (this.players[playerId]) this.players[playerId].hand.push(card);
            try { this.drawOneToPlayer(playerId); } catch (e) { /* ignore */ }
            console.log(`[${this.roomId}] play invalid for ${playerId}: ${card}, undoing`);
            this.io.to(this.roomId).emit('play_rejected', { playerId, card });
            try {
              const sock = this.io.sockets.sockets.get(playerId);
              if (sock && typeof sock.emit === 'function') sock.emit('play_return', { card });
              else this.io.to(playerId).emit('play_return', { card });
            } catch (e) { console.warn('failed to emit play_return to', playerId, e); }
            this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `GAVE PENALTY TO ${player.name}` });
            this.sync(true);
            if (cb) cb('Card does not match suit or value or not your turn');
            return;
          }
          // valid: proceed with win check and advance
          if (player.hand.length === 0) {
            this.io.to(this.roomId).emit('game_over', { winnerId: playerId });
            this.started = false;
            this.sync(true);
            if (cb) cb(null);
            return;
          }
          this.advanceTurn();
          this.sync(true);
          if (cb) cb(null);
          return;
        } catch (err) {
          if (cb) cb(String(err));
          return;
        }
      }, VALIDATE_DELAY);
      // callback will be invoked after validation
      return;
    } catch (err) {
      return cb && cb(String(err));
    }
  }

  drawCardAction(playerId, cb, socket) {
    try {
      if (!this.started) return cb && cb('Game not started');
      const isTurn = (this.turnOrder[this.currentTurnIndex] === playerId);
      if (!isTurn) {
        // off-turn draw -> penalty: give one card but do not advance turn
        if (this.draw.length === 0) {
          if (this.discard.length <= 1) return cb && cb('No cards to draw');
          const top = this.discard.pop();
          this.draw = this.discard.splice(0);
          this.discard = [top];
          for (let i = this.draw.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.draw[i], this.draw[j]] = [this.draw[j], this.draw[i]];
          }
        }
        // give the drawn card
        const card = this.draw.shift();
        this.players[playerId].hand.push(card);
    console.log(`[${this.roomId}] gave off-turn draw penalty ${card} to ${playerId} drawleft=${this.draw.length}`);
        // then give an additional penalty card if possible
        try {
          this.drawOneToPlayer(playerId);
        } catch (err) {
          // ignore if cannot draw penalty
        }
        this.sync(true);
        const player = this.players[playerId];
        this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `GAVE PENALTY TO ${player.name}` });
        return cb && cb(null);
      }
      // player's turn: draw one and advance
      if (this.draw.length === 0) {
        // reshuffle discard (leave top)
        if (this.discard.length <= 1) return cb && cb('No cards to draw');
        const top = this.discard.pop();
        this.draw = this.discard.splice(0);
        this.discard = [top];
        for (let i = this.draw.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.draw[i], this.draw[j]] = [this.draw[j], this.draw[i]];
        }
      }
      const card = this.draw.shift();
      this.players[playerId].hand.push(card);
  console.log(`[${this.roomId}] ${playerId} drew ${card} on-turn drawleft=${this.draw.length}`);
      this.advanceTurn();
      this.sync(true);
      return cb && cb(null);
    } catch (err) {
      return cb && cb(String(err));
    }
  }

  // Draw a single card to player's hand without advancing turn (for optimistic revert replacement)
  drawOneToPlayer(playerId) {
    if (this.draw.length === 0) {
      if (this.discard.length <= 1) throw new Error('No cards to draw');
      const top = this.discard.pop();
      this.draw = this.discard.splice(0);
      this.discard = [top];
      for (let i = this.draw.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.draw[i], this.draw[j]] = [this.draw[j], this.draw[i]];
      }
    }
    const card = this.draw.shift();
    this.players[playerId].hand.push(card);
    this.sync(true);
  }

  advanceTurn() {
    if (this.turnOrder.length === 0) return;
    const dir = this.settings.direction === 'cw' ? 1 : -1;
    this.currentTurnIndex = (this.currentTurnIndex + dir + this.turnOrder.length) % this.turnOrder.length;
  }

  sync(sendPrivate = false) {
    const publicPlayers = {};
    for (const [id, p] of Object.entries(this.players)) {
      publicPlayers[id] = { id: p.id, name: p.name, handCount: p.hand.length };
    }

    const publicState = {
      roomId: this.roomId,
      players: publicPlayers,
      turnOrder: this.turnOrder,
      currentTurn: this.turnOrder[this.currentTurnIndex] || null,
      // visibleTop: if there is a transient attempt show that, otherwise show canonical discard top
      visibleTop: (this.attempts && this.attempts.length > 0) ? this.attempts[this.attempts.length - 1].card : (this.discard[this.discard.length - 1] || null),
      discardTop: this.discard[this.discard.length - 1] || null,
      drawCount: this.draw.length,
      settings: this.settings,
      hostId: this.hostId,
      started: this.started
    };
    // sequence to help clients detect out-of-order updates
    publicState.seq = ++this.seq;
  console.log(`[${this.roomId}] sync: seq=${publicState.seq} visibleTop=${publicState.visibleTop} discardTop=${publicState.discardTop} drawCount=${publicState.drawCount}`);
  this.io.to(this.roomId).emit('game_state', publicState);

    if (sendPrivate) {
      for (const pid of this.turnOrder) {
        const sock = this.io.sockets.sockets.get(pid);
        if (sock) {
          sock.emit('private_state', { hand: this.players[pid].hand.slice() });
        }
      }
    }
  }
}
