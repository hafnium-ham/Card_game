export class Game {
  constructor(io, roomId, settings = { numDecks: 1, direction: "cw" }) {
    this.io = io;
    this.roomId = roomId;
    this.settings = { numDecks: Math.max(1, Math.min(33, settings.numDecks || 1)), direction: settings.direction === 'ccw' ? 'ccw' : 'cw', singWindowMs: (settings.singWindowMs || 10000) };
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
    this.lastPlay = null; // { playerId, card }
    this.suitSelection = null; // { playerId, suit }
    this.singPending = null; // Set of playerIds who must sing after AS
    this.singTimer = null;
    this.sevenChain = 0; // count consecutive 7s
    this.evilPending = false; // require Evil card phrase on certain sequences
    this.awaitingSpade = {}; // playerId -> expected name/code
    this.recentPlays = []; // keep recent plays as {playerId, card}
    this.curseList = ['shit','fuck','bitch','asshole'];
  }

  formatPenalty(playerId, phrase) {
    const p = this.players[playerId];
    const name = p ? p.name : playerId;
    const msg = `(${name}) -> ${phrase} (+1 penalty card)`;
    this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: msg });
  }

  // Lightweight Levenshtein distance for fuzzy matching
  levenshtein(a, b) {
    a = (a||'').toLowerCase().replace(/[^a-z]/g,'');
    b = (b||'').toLowerCase().replace(/[^a-z]/g,'');
    const m = a.length, n = b.length;
    const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
      }
    }
    return dp[m][n];
  }

  processChat(playerId, message) {
    // check curse words
    const lower = (message||'').toLowerCase();
    for (const w of this.curseList) {
      if (lower.includes(w)) {
        this.formatPenalty(playerId, 'Cursing');
        try { this.drawOneToPlayer(playerId); } catch (e) {}
      }
    }

    // Beatles check for tens: accept fuzzy match to Beatles members
    const beatles = ['john lennon','paul mccartney','george harrison','ringo starr','john','paul','george','ringo'];
    if (this.lastPlay && this.lastPlay.card && this.lastPlay.card.startsWith('10')) {
      // message should contain a fuzzy beatles name
      let ok=false;
      for (const b of beatles) {
        if (this.levenshtein(message, b) <= 3 || message.toLowerCase().includes(b.split(' ')[0])) { ok=true; break; }
      }
      if (!ok) { this.formatPenalty(playerId, 'Failure to name a Beatle'); try{ this.drawOneToPlayer(playerId);}catch(e){} }
    }

    // Sevens: message should be close to 'have a nice day', and chain requires additional 'very'
    if (this.lastPlay && this.lastPlay.card && this.lastPlay.card.startsWith('7')) {
      const target = 'have a nice day';
      const dist = this.levenshtein(message, target);
      const requiredVerys = Math.max(0, this.sevenChain-1);
      // check if message contains required number of 'very'
      const veryCount = (message.match(/very/gi) || []).length;
      if (dist > 6 || veryCount < requiredVerys) { this.formatPenalty(playerId, 'Failure to say have a nice day'); try{ this.drawOneToPlayer(playerId);}catch(e){} }
    }

    // Evil card and naming spades etc handled via flags elsewhere -- chat can fulfill them
    // Evil card: if server has an evilPending flag, accept 'evil' phrase to clear it, otherwise penalize
    if (this.evilPending) {
      const low = (message||'').toLowerCase();
      if (low.includes('evil') || low.includes('i am evil')) {
        this.evilPending = false;
      } else {
        this.formatPenalty(playerId, 'Failure to say evil phrase');
        try { this.drawOneToPlayer(playerId); } catch (e) {}
      }
    }

    // Naming spades: if awaiting name for a spade played by player, accept chat containing the card code or rank
    if (this.awaitingSpade && this.awaitingSpade[playerId]) {
      const expected = this.awaitingSpade[playerId];
      if (message.toLowerCase().includes(expected.toLowerCase()) || message.toLowerCase().includes(expected.slice(0,1).toLowerCase())) {
        delete this.awaitingSpade[playerId];
      } else {
        this.formatPenalty(playerId, 'Failure to name your spade'); try{ this.drawOneToPlayer(playerId);}catch(e){}
      }
    }
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
    // send immediate private_state to the joining socket so the client can
    // render their (possibly empty) hand without waiting for a later sync(true)
    try {
      socket.emit('private_state', { hand: this.players[socket.id].hand.slice() });
    } catch (e) {
      console.warn('failed to emit private_state to', socket.id, e);
    }
    // send authoritative private_state to all players immediately so clients
    // (including non-hosts) receive their hands without waiting for later updates
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
  // record last play (used by knock/sing handlers)
  this.lastPlay = { playerId, card };
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
            this.formatPenalty(playerId, 'Penalty – Stupidity');
            this.sync(true);
            if (cb) cb('Card does not match suit or value or not your turn');
            return;
          }
          // valid: record recent play and apply special rules (skip, reverse, throw-at, spade naming, evil)
          const parsed = this.parseCard(card);
          this.recentPlays.push({ playerId, card, rank: parsed.rank, suit: parsed.suit });
          if (this.recentPlays.length > 10) this.recentPlays.shift();

          // Evil card special: if card is 7 of spades, require evil phrase
          if (parsed.rank === '7' && parsed.suit === 'S') {
            this.evilPending = true;
            this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: 'Evil card played — name the evil phrase now' });
          }

          // Spade naming: require the spiller to name the spade they just played
          if (parsed.suit === 'S') {
            // expect the player to name the rank/identifier in chat
            this.awaitingSpade[playerId] = card;
            // set a short timeout to penalize if not named
            setTimeout(() => {
              if (this.awaitingSpade && this.awaitingSpade[playerId]) {
                this.formatPenalty(playerId, 'Failure to name your spade');
                try { this.drawOneToPlayer(playerId); } catch (e) {}
                delete this.awaitingSpade[playerId];
              }
            }, 7000);
          }

          // Three-in-a-row throw-at: if last 3 plays were same rank, force next player to draw 3
          if (this.recentPlays.length >= 3) {
            const last3 = this.recentPlays.slice(-3);
            if (last3[0].rank === last3[1].rank && last3[1].rank === last3[2].rank) {
              // compute next player index
              const dir = this.settings.direction === 'cw' ? 1 : -1;
              const nextIdx = (this.currentTurnIndex + dir + this.turnOrder.length) % this.turnOrder.length;
              const nextPid = this.turnOrder[nextIdx];
              try {
                this.drawManyToPlayer(nextPid, 3);
                this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `(System) ${this.players[nextPid].name} was hit by three-in-a-row and drew 3` });
              } catch (e) {}
            }
          }

          // If rank is 5, skip the next player (we will advance normally once below, so advance one extra time)
          const willSkipNext = (parsed.rank === '5');

          // If rank is Ace, reverse play direction
          if (parsed.rank === 'A') {
            this.settings.direction = this.settings.direction === 'cw' ? 'ccw' : 'cw';
            this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `Direction reversed to ${this.settings.direction}` });
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
          if (willSkipNext) {
            // advance one extra to skip
            this.advanceTurn();
            this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `${this.players[playerId].name} played a 5 — next player skipped` });
          }
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
            this.formatPenalty(playerId, 'Penalty – Stupidity');
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

  // Draw multiple cards to a player (used by throw-at mechanic)
  drawManyToPlayer(playerId, count) {
    for (let i = 0; i < count; i++) {
      this.drawOneToPlayer(playerId);
    }
  }

  // Player selects a suit (e.g., presses a suit button). If a Jack was not the last play,
  // selection is invalid and penalized. If a Jack was played and this selection beats others,
  // the first selector wins. Announce selection in chat.
  selectSuit(playerId, suit) {
    const p = this.players[playerId];
    if (!p) return;
  this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `${p.name} has selected ${suit}` });
    // if last play isn't a Jack, penalize
    if (!this.lastPlay || !this.lastPlay.card || !this.lastPlay.card.startsWith('J')) {
  this.formatPenalty(playerId, 'Illegal play');
  try { this.drawOneToPlayer(playerId); } catch (e) {}
  this.sync(true);
      return;
    }
    // record first selector only
    if (!this.suitSelection) this.suitSelection = { playerId, suit };
    // publish who pressed first
  this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `${p.name} pressed ${suit}${this.suitSelection.playerId===playerId ? ' (first)' : ''}` });
    this.sync(true);
  }

  // Player knocks — valid only immediately after playing a Heart (not Jack)
  knock(playerId) {
    const p = this.players[playerId];
    if (!p) return;
  this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `${p.name} knocked` });
    // verify prior play was by this player and was a Heart (not Jack)
    if (!this.lastPlay || this.lastPlay.playerId !== playerId || !this.lastPlay.card.endsWith('H') || this.lastPlay.card.startsWith('J')) {
  this.formatPenalty(playerId, 'Failure to knock');
  try { this.drawOneToPlayer(playerId); } catch (e) {}
  this.sync(true);
      return;
    }
    this.sync(true);
  }

  // Player presses Sing — used for Ace of Spades chorus
  sing(playerId) {
    const p = this.players[playerId];
    if (!p) return;
  this.io.to(this.roomId).emit('chat', { from: 'SYSTEM', message: `${p.name} sings` });
    // if last play was Ace of Spades, require all players to sing
    const last = this.lastPlay && this.lastPlay.card;
    if (last && last === 'AS') {
      if (!this.singPending) {
        // initialize pending set; require everyone except maybe the spiller?
        this.singPending = new Set(Object.keys(this.players));
        // give 10 seconds for everyone to sing
        if (this.singTimer) clearTimeout(this.singTimer);
  this.singTimer = setTimeout(() => {
          // apply penalties for those who didn't sing
          for (const pid of (this.singPending || [])) {
            const pl = this.players[pid];
            if (!pl) continue;
            this.formatPenalty(pid, 'Failure to sing');
            try { this.drawOneToPlayer(pid); } catch (e) {}
          }
          this.singPending = null;
          this.sync(true);
  }, this.settings.singWindowMs || 10000);
      }
      // mark this player as having sung
      if (this.singPending && this.singPending.has(playerId)) this.singPending.delete(playerId);
      // if everyone sung, clear timer
      if (this.singPending && this.singPending.size === 0) {
        if (this.singTimer) clearTimeout(this.singTimer);
        this.singPending = null;
        this.sync(true);
      }
    } else {
      // no AS active; pressing sing is invalid
  this.formatPenalty(playerId, 'Flat note');
  try { this.drawOneToPlayer(playerId); } catch (e) {}
  this.sync(true);
    }
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
        try {
          // emit to socket id channel so it reaches the specific client
          this.io.to(pid).emit('private_state', { hand: this.players[pid].hand.slice() });
        } catch (e) {
          // best-effort
          try {
            const sock = this.io.sockets.sockets.get(pid);
            if (sock) sock.emit('private_state', { hand: this.players[pid].hand.slice() });
          } catch (err) {}
        }
      }
    }
  }
}
