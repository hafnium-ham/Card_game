export function createDeck(numDecks = 1) {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  let deck = [];
  for (let i = 0; i < numDecks; i++) {
    for (let s of suits) {
      for (let r of ranks) {
        deck.push({ suit: s, rank: r });
      }
    }
  }
  return shuffle(deck);
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

export class Game {
  constructor(room, numDecks = 1) {
    this.room = room;
    this.deck = createDeck(numDecks);
    this.hands = {};
    this.turnOrder = [];
    this.currentTurn = 0;
  }

  addPlayer(playerId) {
    this.hands[playerId] = this.deck.splice(0, 5);
    this.turnOrder.push(playerId);
    this.sync();
  }

  removePlayer(playerId) {
    delete this.hands[playerId];
    this.turnOrder = this.turnOrder.filter(id => id !== playerId);
    this.sync();
  }

  playCard(playerId, card) {
    if (this.turnOrder[this.currentTurn] !== playerId) return;
    this.hands[playerId] = this.hands[playerId].filter(
      c => !(c.rank === card.rank && c.suit === card.suit)
    );
    this.currentTurn = (this.currentTurn + 1) % this.turnOrder.length;
    this.sync();
  }

  sync() {
    this.room.broadcast("game_state", {
      hands: Object.fromEntries(
        Object.entries(this.hands).map(([pid, cards]) => [
          pid,
          cards.length // don’t leak opponents’ cards
        ])
      ),
      currentTurn: this.turnOrder[this.currentTurn],
    });
  }
}
