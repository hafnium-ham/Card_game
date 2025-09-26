import { Game } from './game.js';

// Minimal fake io with rooms support for testing
class FakeIo {
  constructor(){ this.sockets = { sockets: new Map() }; }
  to(roomId){ return { emit: (...args)=>{ console.log('[io.to]', roomId, ...args); } }; }
}

function testDeck(numDecks=1){
  const io = new FakeIo();
  const g = new Game(io, 'testroom', { numDecks });
  g.buildDrawPile();
  console.log('draw count', g.draw.length);
  const counts = {};
  for (const c of g.draw){ counts[c] = (counts[c]||0) + 1; }
  const dups = Object.entries(counts).filter(([k,v]) => v>numDecks);
  if (dups.length) {
    console.error('Found unexpected duplicates:', dups.slice(0,10));
  } else {
    console.log('No unexpected duplicates. Sample:', Object.keys(counts).slice(0,8));
  }
}

function testDeal(){
  const io = new FakeIo();
  const g = new Game(io, 'testroom', { numDecks:1 });
  g.turnOrder = ['p1','p2','p3'];
  g.players = { p1:{id:'p1',name:'p1',hand:[]}, p2:{id:'p2',name:'p2',hand:[]}, p3:{id:'p3',name:'p3',hand:[]} };
  g.buildDrawPile();
  g.dealHands(5);
  console.log('hands lengths', g.players.p1.hand.length, g.players.p2.hand.length, g.players.p3.hand.length);
}

console.log('TEST deck 1'); testDeck(1);
console.log('TEST deck 3'); testDeck(3);
console.log('TEST deal'); testDeal();

console.log('OK');
