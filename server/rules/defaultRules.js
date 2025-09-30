// server/rules/defaultRules.js
// Built-in evolving ruleset demonstrating how to target card aspects, gameplay, and players.

export const defaultRules = [
  // 10 -> Beatles name required in chat (fuzzy)
  {
    id: 'beatles-10',
    description: 'When a 10 is on top, next chat by spiller must name a Beatle',
    onChat: ({ game, playerId, message, levenshtein, formatPenalty, drawOne }) => {
      const last = game.lastPlay?.card;
      if (!last || !last.startsWith('10')) return;
      const text = (message || '').toLowerCase();
      const beatles = ['john lennon', 'paul mccartney', 'george harrison', 'ringo starr', 'john', 'paul', 'george', 'ringo'];
      let ok = false;
      for (const b of beatles) {
        if (levenshtein(message, b) <= 3 || text.includes(b.split(' ')[0])) { ok = true; break; }
      }
      if (!ok) {
        formatPenalty(playerId, 'Failure to name a Beatle');
        try { drawOne(playerId); } catch (e) {}
      }
    }
  },

  // 7 -> say have a nice day
  {
    id: 'seven-nice-day',
    description: 'When a 7 is on top, spiller must say have a nice day',
    onChat: ({ game, playerId, message, levenshtein, formatPenalty, drawOne }) => {
      const last = game.lastPlay?.card;
      if (!last || !last.startsWith('7')) return;
      const dist = levenshtein(message, 'have a nice day');
      if (dist > 6) {
        formatPenalty(playerId, 'Failure to say have a nice day');
        try { drawOne(playerId); } catch (e) {}
      }
    }
  },

  // 7 of Spades -> evil phrase pending; accept on chat
  {
    id: 'evil-7S',
    description: 'If 7S is played, spiller must say evil phrase',
    onPlayValidated: ({ parsed, setEvilPending, emitSystem }) => {
      if (parsed.rank === '7' && parsed.suit === 'S') {
        setEvilPending(true);
        emitSystem('Evil card played — name the evil phrase now');
      }
    },
    onChat: ({ game, playerId, message, formatPenalty, drawOne, getEvilPending, setEvilPending }) => {
      if (!getEvilPending()) return;
      const text = (message || '').toLowerCase();
      if (text.includes('evil') || text.includes('i am evil')) setEvilPending(false);
      else {
        formatPenalty(playerId, 'Failure to say evil phrase');
        try { drawOne(playerId); } catch (e) {}
      }
    }
  },

  // Spade naming
  {
    id: 'name-spade',
    description: 'When a spade is played, spiller must name it',
    onPlayValidated: ({ game, playerId, card }) => {
      const parsed = game.parseCard(card);
      if (parsed.suit === 'S') {
        game.awaitingSpade[playerId] = card;
        setTimeout(() => {
          if (game.awaitingSpade && game.awaitingSpade[playerId]) {
            game.formatPenalty(playerId, 'Failure to name your spade');
            try { game.drawOneToPlayer(playerId); } catch (e) {}
            delete game.awaitingSpade[playerId];
          }
        }, 7000);
      }
    },
    onChat: ({ game, playerId, message, formatPenalty, drawOne }) => {
      if (!game.awaitingSpade[playerId]) return;
      const expected = game.awaitingSpade[playerId];
      const text = (message || '').toLowerCase();
      if (text.includes(expected.toLowerCase()) || text.includes(expected.slice(0, 1).toLowerCase()))
        delete game.awaitingSpade[playerId];
      else {
        formatPenalty(playerId, 'Failure to name your spade');
        try { drawOne(playerId); } catch (e) {}
      }
    }
  },

  // Three-in-a-row throw-at: next player draws 3
  {
    id: 'three-in-a-row',
    description: 'If the last 3 plays share rank, next player draws 3',
    onPlayValidated: ({ game, drawMany, emitSystem }) => {
      if (game.recentPlays.length < 3) return;
      const [a, b, c] = game.recentPlays.slice(-3);
      if (a.rank === b.rank && b.rank === c.rank) {
        const dir = game.settings.direction === 'cw' ? 1 : -1;
        const nextIdx = (game.currentTurnIndex + dir + game.turnOrder.length) % game.turnOrder.length;
        const nextPid = game.turnOrder[nextIdx];
        try {
          drawMany(nextPid, 3);
          emitSystem(`(System) ${game.players[nextPid].name} was hit by three-in-a-row and drew 3`);
        } catch (e) {}
      }
    }
  },

  // 5 -> skip next
  {
    id: 'skip-5',
    description: 'Playing a 5 skips next player',
    onPlayValidated: ({ parsed }) => {
      if (parsed.rank === '5') return { skipNext: true };
    }
  },

  // Ace -> reverse direction
  {
    id: 'reverse-ace',
    description: 'Ace reverses play direction',
    onPlayValidated: ({ game, parsed, emitSystem }) => {
      if (parsed.rank === 'A') {
        game.settings.direction = game.settings.direction === 'cw' ? 'ccw' : 'cw';
        emitSystem(`Direction reversed to ${game.settings.direction}`);
      }
    }
  },

  // Ace of Spades -> sing window
  {
    id: 'sing-AS',
    description: 'Ace of Spades triggers a sing window for all players',
    onPlayValidated: ({ game, card }) => {
      if (card !== 'AS') return;
      if (!game.singPending) {
        game.singPending = new Set(Object.keys(game.players));
        if (game.singTimer) clearTimeout(game.singTimer);
        game.singTimer = setTimeout(() => {
          for (const pid of (game.singPending || [])) {
            const pl = game.players[pid];
            if (!pl) continue;
            game.formatPenalty(pid, 'Failure to sing');
            try { game.drawOneToPlayer(pid); } catch (e) {}
          }
          game.singPending = null;
          game.sync(true);
        }, game.settings.singWindowMs || 10000);
      }
    },
    onSing: ({ game, playerId }) => {
      if (game.singPending && game.singPending.has(playerId)) {
        game.singPending.delete(playerId);
        if (game.singPending.size === 0) {
          if (game.singTimer) clearTimeout(game.singTimer);
          game.singPending = null;
          game.sync(true);
        }
      }
    }
  },

  // Cursing -> penalty
  {
    id: 'curse-penalty',
    description: 'Curse words cause a penalty card',
    onChat: ({ message, playerId, formatPenalty, drawOne }) => {
      const text = (message || '').toLowerCase();
      const curses = ['shit', 'fuck', 'bitch', 'asshole'];
      if (curses.some((w) => text.includes(w))) {
        formatPenalty(playerId, 'Cursing');
        try { drawOne(playerId); } catch (e) {}
      }
    }
  },
];
