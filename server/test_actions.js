import { Game } from './game.js';

// Fake IO that records emitted events for assertions
class RecorderIo {
  constructor(){
    this.events = [];
    this.sockets = { sockets: new Map() };
  }
  to(roomId){
    return { emit: (...args)=>{ this.events.push(['to', roomId, ...args]); } };
  }
  emit(...args){ this.events.push(['emit', ...args]); }
}

function makeFakeSocket(id, rec){
  const sock = {
    id,
    join: (room) => rec.events.push(['join', id, room]),
    leave: (room) => rec.events.push(['leave', id, room]),
    emit: (...args) => rec.events.push(['sock_emit', id, ...args])
  };
  rec.sockets.sockets.set(id, sock);
  return sock;
}

function run(){
  const rec = new RecorderIo();
  const g = new Game(rec, 'room1', { numDecks:1 });
  const s1 = makeFakeSocket('p1', rec);
  const s2 = makeFakeSocket('p2', rec);
  g.addPlayer(s1, 'Alice');
  g.addPlayer(s2, 'Bob');
  g.start();

  // ensure top is set
  console.log('initial discardTop=', g.discard[g.discard.length-1]);

  // Ensure p1 has a Jack for the Jack->suit selection test
  let j1 = g.players['p1'].hand.find(c => c.startsWith('J'));
  if (!j1) {
    // move a Jack from p2 to p1 if available, otherwise push one
    const jFromP2 = g.players['p2'].hand.find(c => c.startsWith('J'));
    if (jFromP2) {
      // remove from p2
      const idx = g.players['p2'].hand.indexOf(jFromP2);
      if (idx !== -1) g.players['p2'].hand.splice(idx,1);
      g.players['p1'].hand.push(jFromP2);
      j1 = jFromP2;
    } else {
      g.players['p1'].hand.push('JH');
      j1 = 'JH';
    }
  }
  console.log('p1 plays', j1);
  g.playCard('p1', j1, (err)=>{ console.log('p1 callback err', err); });
  // p2 selects suit (valid because last play was Jack)
  g.selectSuit('p2', 'Hearts');
  // p2 should not be penalized; check events
  console.log('events after selectSuit', rec.events.slice(-6));

  // p2 presses knock without having played a heart -> penalty expected
  g.knock('p2');
  console.log('events after bad knock', rec.events.slice(-6));

  // Simulate Ace of Spades play and sing responses
  // ensure someone has AS in hand (deterministic)
  let asCard = null;
  for (const pid of Object.keys(g.players)) {
    const found = g.players[pid].hand.find(c => c === 'AS');
    if (found) { asCard = { pid, card: found }; break; }
  }
  if (!asCard) {
    // push AS into p1 for test
    g.players['p1'].hand.push('AS');
    asCard = { pid: 'p1', card: 'AS' };
  }
  g.playCard(asCard.pid, asCard.card, (err)=>{ console.log('as play cb', err); });
  // p1 sang
  g.sing('p1');
  // p2 did not sing; force sing expiration using game's configured window
  if (g.singTimer) { clearTimeout(g.singTimer); g.singTimer = null; }
  if (g.singPending) {
    for (const pid of g.singPending) {
      console.log('penalize missing sing for', pid);
      g.drawOneToPlayer(pid);
    }
    g.singPending = null;
  }
  console.log('final events', rec.events.slice(-12));
}

run();
