import { Game } from '../../Card_game/server/game.js';

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
  const g = new Game(rec, 'tflow', { numDecks:1 });
  const s1 = makeFakeSocket('p1', rec);
  const s2 = makeFakeSocket('p2', rec);
  g.addPlayer(s1, 'Alice');
  g.addPlayer(s2, 'Bob');
  g.start();
  // show initial top
  console.log('initial top', g.discard[g.discard.length-1]);
  // have p2 try to play out-of-turn: should put card then return with penalty
  // ensure p2 has a card to play
  const p2card = g.players['p2'].hand[0];
  console.log('p2 attempts out-of-turn', p2card);
  g.playCard('p2', p2card, (err)=>{ console.log('p2 play callback err', err); });
  console.log('events after p2 attempt', rec.events.slice(-6));
  // now have p1 play a card (their turn)
  const p1card = g.players['p1'].hand.find(c => true);
  console.log('p1 plays', p1card);
  g.playCard('p1', p1card, (err)=>{ console.log('p1 play callback err', err); });
  console.log('events after p1 play', rec.events.slice(-8));
  console.log('final top', g.discard[g.discard.length-1]);
}

run();
