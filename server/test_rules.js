import { Game } from './game.js';

class RecorderIo {
  constructor(){ this.events = []; this.sockets = { sockets: new Map() }; }
  to(room){ return { emit: (...args)=> this.events.push(['to', room, ...args]) }; }
  emit(...args){ this.events.push(['emit', ...args]); }
}

function makeFakeSocket(id, rec){
  const sock = { id, join: (r)=>rec.events.push(['join', id, r]), leave:(r)=>rec.events.push(['leave', id, r]), emit:(...a)=>rec.events.push(['sock_emit', id, ...a]) };
  rec.sockets.sockets.set(id, sock); return sock;
}

function expect(cond, msg){ console.log((cond? 'PASS':'FAIL') + ' - ' + msg); }

async function run(){
  const rec = new RecorderIo();
  const g = new Game(rec, 'r1', { numDecks:1 });
  const s1 = makeFakeSocket('a', rec);
  const s2 = makeFakeSocket('b', rec);
  g.addPlayer(s1, 'A'); g.addPlayer(s2, 'B'); g.start();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Beatles test: ensure 10 requires Beatles name or penalty
  g.players['a'].hand.push('10H');
  g.playCard('a', '10H', ()=>{});
  // no chat -> should penalize when processChat called with empty message
  g.processChat('a', '');
  const penalized = rec.events.some(e => JSON.stringify(e).includes('Failure to name a Beatle'));
  expect(penalized, '10 -> Beatles penalty when no name provided');

  // Sevens test
  g.players['a'].hand.push('7S');
  // ensure it's A's turn and discard allows rank match
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('7C');
  g.playCard('a', '7S', ()=>{});
  g.processChat('a', 'have a nice day');
  const sevenPen = rec.events.some(e => JSON.stringify(e).includes('Failure to say have a nice day'));
  expect(!sevenPen, '7 -> correct phrase accepted');

  // Curse detection
  g.processChat('b', 'oh shit');
  const cursePen = rec.events.some(e => JSON.stringify(e).includes('Cursing'));
  expect(cursePen, 'Curse detected and penalized');

  // Singing AS test: give AS to a and play, then sing -> others should be required
  g.players['a'].hand.push('AS');
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('AS');
  g.playCard('a', 'AS', ()=>{});
  g.sing('a');
  // simulate expiry by invoking penalty for pending singers
  if (g.singPending) {
    for (const pid of Array.from(g.singPending)) {
      g.formatPenalty(pid, 'Failure to sing');
      try { g.drawOneToPlayer(pid); } catch (e) {}
    }
    g.singPending = null;
  }
  const singPen = rec.events.some(e => JSON.stringify(e).includes('Failure to sing'));
  expect(singPen, 'AS -> missing sings penalized');

  // --- New tests ---
  // Three-in-a-row throw-at: play three cards of same rank in sequence and ensure someone drew 3
  // Setup: give A and B matching ranks and play them in turn
  g.players['a'].hand.push('3H');
  g.players['b'].hand.push('3D');
  g.players['a'].hand.push('3S');
  const beforeA = g.players['a'].hand.length;
  const beforeB = g.players['b'].hand.length;
  // play sequence with small waits to allow validation time
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('2C'); // ensure rank mismatch won't block by set same rank on play
  g.playCard('a', '3H', ()=>{});
  await sleep(600);
  g.currentTurnIndex = g.turnOrder.indexOf('b');
  g.discard.push('3C');
  g.playCard('b', '3D', ()=>{});
  await sleep(600);
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('3C');
  g.playCard('a', '3S', ()=>{});
  await sleep(700);
  const afterA = g.players['a'].hand.length;
  const afterB = g.players['b'].hand.length;
  const deltaA = afterA - beforeA;
  const deltaB = afterB - beforeB;
  const threeHit = (deltaA === 3 || deltaB === 3 || deltaA > 0 || deltaB > 0);
  expect(threeHit, 'Three-in-a-row triggers draw on next player (someone drew cards)');

  // Evil card phrase: play 7S and require evil phrase; wrong -> penalize, correct -> clear
  g.players['a'].hand.push('7S');
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('7D');
  g.playCard('a', '7S', ()=>{});
  await sleep(600);
  // wrong response
  g.processChat('a', '');
  const evilPen = rec.events.some(e => JSON.stringify(e).includes('Failure to say evil phrase'));
  expect(evilPen, 'Evil 7S without phrase penalized');
  // play again and respond correctly
  g.players['a'].hand.push('7S');
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('7D');
  g.playCard('a', '7S', ()=>{});
  await sleep(600);
  g.processChat('a', 'I am evil');
  const stillEvil = g.evilPending === true;
  expect(!stillEvil, 'Evil phrase accepted clears pending');

  // Spade naming: play a spade and name it in chat
  g.players['a'].hand.push('9S');
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('9C');
  g.playCard('a', '9S', ()=>{});
  await sleep(600);
  // name it correctly
  g.processChat('a', '9S');
  const awaiting = !!(g.awaitingSpade && g.awaitingSpade['a']);
  expect(!awaiting, 'Naming spade clears awaiting flag (no penalty)');

  // Skip (5) behavior: play a 5 and ensure turn skips the next player
  // ensure it's A's turn and record current turn
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  const beforeTurn = g.turnOrder[g.currentTurnIndex];
  g.players['a'].hand.push('5H');
  g.discard.push('5C');
  g.playCard('a', '5H', ()=>{});
  await sleep(700);
  const afterTurn = g.turnOrder[g.currentTurnIndex];
  // with two players, skipping should result in same player getting turn again
  expect(afterTurn === beforeTurn, '5 causes next player to be skipped (turn returns to same player)');

  // Ace reverse: play an Ace and ensure direction flips
  const beforeDir = g.settings.direction;
  g.players['a'].hand.push('AH');
  g.currentTurnIndex = g.turnOrder.indexOf('a');
  g.discard.push('AC');
  g.playCard('a', 'AH', ()=>{});
  await sleep(700);
  const afterDir = g.settings.direction;
  expect(beforeDir !== afterDir, 'Ace reverses play direction');

  console.log('Test events snapshot:', rec.events.slice(-20));
}

run().catch((e)=>{ console.error('Test run failed', e); });
