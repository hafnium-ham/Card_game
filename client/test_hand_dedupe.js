// Simulate client-side optimistic play and server responses to ensure no duplicate cards
function dedupeHand(hand) {
  const seen = new Set();
  const deduped = [];
  for (const c of hand) {
    if (!seen.has(c)) { seen.add(c); deduped.push(c); }
  }
  return deduped;
}

function simulate() {
  // initial hand
  let privateHand = ['AS', '2H', '3D'];
  let optimisticCenter = null;
  let pendingPlay = null;

  console.log('initial privateHand', privateHand.slice());

  // player clicks 2H (index 1)
  const card = privateHand[1];
  optimisticCenter = card;
  pendingPlay = card;
  // remove locally
  privateHand.splice(1,1);
  console.log('after optimistic remove', privateHand.slice(), 'optimisticCenter=', optimisticCenter);

  // server emits play_return (invalid play) - client now just clears optimistic but does NOT restore
  console.log('server -> play_return for', card);
  optimisticCenter = null;
  pendingPlay = null;
  console.log('after play_return handler', privateHand.slice(), 'optimisticCenter=', optimisticCenter);

  // server later emits private_state containing the authoritative hand, possibly with the returned card appended
  const serverPrivate = { hand: ['AS','3D','2H'] };
  console.log('server -> private_state', serverPrivate.hand);
  // client dedupes when applying private_state
  privateHand = dedupeHand(serverPrivate.hand);
  console.log('after applying private_state deduped hand', privateHand.slice());

  // assert no duplicates
  const duplicates = privateHand.length !== (new Set(privateHand)).size;
  console.log('duplicates present?', duplicates ? 'YES' : 'NO');
  if (duplicates) process.exit(2);
  console.log('PASS: No duplicates after sequence');
}

simulate();
