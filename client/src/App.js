import { useState, useEffect, useRef } from "react";
import { socket } from "./api";
import './App.css';

/*
  client/src/App.js

  Purpose: React-based client UI for the card game. This file manages the
  lobby and in-room UI, optimistic play interactions, chat, and rendering of
  card images. The client is intentionally thin: the server is authoritative
  for game state and each client's hand (`private_state`). The client may show
  a transient optimistic visual when a player attempts a play, but it does
  not modify authoritative hand state except when applying server-provided
  `private_state` messages.

  Important design notes (do NOT change behavior):
  - `optimisticCenter` and `pendingPlayRef` are UI-only controls that let a
    player see a card briefly when they click to play. They are NOT the
    source of truth for the hand.
  - When the server rejects a play, the client clears optimistic UI and
    relies on the server's `private_state` to restore the player's hand.
    This avoids accidental visual duplicates caused by re-adding cards
    locally while the server is also going to send an authoritative hand.
  - The `game_state` message is public and contains only aggregate info
    (players + hand counts, drawCount, visibleTop/discardTop, seq). The
    `private_state` message is the per-player authoritative hand array.
*/

export default function App() {
  const [roomId, setRoomId] = useState(null);
  const [game, setGame] = useState(null);
  const [name, setName] = useState("");
  const [numDecks, setNumDecks] = useState(1);
  const [direction, setDirection] = useState("cw");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [privateHand, setPrivateHand] = useState([]);
  const [optimisticCenter, setOptimisticCenter] = useState(null);
  const [latestAttempt, setLatestAttempt] = useState(null); // show any player's attempted play
  const pendingPlayRef = useRef(null);

  useEffect(() => {
    const lastSeqRef = { current: 0 };
    const onGameState = (data) => {
      try {
        // debug seq
        console.debug('game_state seq=', data.seq, 'room=', data.roomId);
        if (typeof data.seq === 'number' && data.seq <= (lastSeqRef.current || 0)) {
          // ignore out-of-order older state
          return;
        }
        lastSeqRef.current = data.seq || lastSeqRef.current;
      } catch (e) {}
      setGame(data);
    };
    const onPrivate = (data) => {
      // Trust authoritative private_state from server. Do NOT locally mutate or
      // attempt to re-add cards here — that caused visual duplicates when the
      // client had also re-added a card optimistically. The server's hand array
      // is canonical and may contain duplicate codes when multiple decks are used,
      // so we must not collapse duplicates here.
      setPrivateHand(data.hand || []);
    };
    const onOver = (data) => alert(`Game over! Winner: ${data.winnerId}`);
    socket.on("game_state", onGameState);
    socket.on('private_state', onPrivate);
    socket.on('game_over', onOver);
    socket.on('played_attempt', ({ playerId, card }) => {
      // still keep a transient in case server update is slightly delayed
      setLatestAttempt({ playerId, card });
      setTimeout(() => setLatestAttempt(null), 2500);
    });
    socket.on('play_rejected', ({ playerId, card }) => {
      // if the rejected play was by us and we have an optimistic center, revert it
      if (pendingPlayRef.current === card) {
        setTimeout(() => {
          setOptimisticCenter(null);
        }, 800);
      }
      // show the rejected attempt for a short time for everyone, then clear
      setTimeout(() => setLatestAttempt(null), 2200);
    });
    // server may explicitly instruct the client to restore a played card
    socket.on('play_return', ({ card }) => {
      // server instructs to restore the played card; we will clear optimistic UI and
      // rely on the authoritative `private_state` update to set the actual hand.
      // Keep this handler idempotent and avoid mutating hand directly to prevent duplicates.
      setOptimisticCenter(null);
      pendingPlayRef.current = null;
    });
    socket.on('play_accepted', ({ playerId, card, playerName }) => {
      // ensure the accepted play stays visible for a moment so players can see it
      setLatestAttempt({ playerId, card, playerName });
      // if this was our optimistic play, clear our optimistic UI
      if (pendingPlayRef.current === card) {
        // delay clearing our optimistic center slightly so the player sees the card as well
        setTimeout(() => {
          setOptimisticCenter(null);
          pendingPlayRef.current = null;
        }, 1200);
      }
      setTimeout(() => setLatestAttempt(null), 1800);
    });
    socket.on('room_closed', (info) => {
      // clear client state when room closes
      setChat([]);
      setGame(null);
      setPrivateHand([]);
      setRoomId(null);
      alert('Room closed: ' + (info?.reason || 'closed'));
    });
    socket.on('chat', (msg) => {
      setChat((c) => [...c, msg]);
    });
    return () => {
      socket.off('game_state', onGameState);
      socket.off('private_state', onPrivate);
      socket.off('game_over', onOver);
      socket.off('played_attempt');
      socket.off('play_rejected');
      socket.off('play_return');
      socket.off('chat');
    };
  }, []);

  const ASSET_BASE = 'http://localhost:3001/assets';
  const [chat, setChat] = useState([]);
  const [chatText, setChatText] = useState('');

  function beginCreateRoom() {
    setCreatingRoom(true);
  }

  function confirmCreateRoom() {
    const payload = { playerName: name || "Host", settings: { numDecks: Number(numDecks) || 1, direction } };
    socket.emit("create_room", payload, (res) => {
      if (res && res.roomId) setRoomId(res.roomId);
      else {
        console.error("Failed to create room", res);
        alert("Failed to create room");
      }
    });
    setCreatingRoom(false);
  }

  function cancelCreateRoom() {
    setCreatingRoom(false);
  }

  function joinRoom() {
    const id = prompt("Enter room ID:");
    if (!id) return;
    socket.emit("join_room", { roomId: id, playerName: name || "Player" }, (res) => {
      if (!res || res.error) return alert(res?.error || "Failed to join");
      setRoomId(id);
    });
  }

  function startGame() {
    socket.emit("start_game", { roomId }, (res) => {
      if (res && res.error) alert(res.error);
    });
  }

  function playCardOptimistic(cardIndex) {
    const card = privateHand[cardIndex];
    // show card in center optimistically and remove from hand locally
    setOptimisticCenter(card);
    pendingPlayRef.current = card;
    setPrivateHand((h) => {
      const copy = [...h];
      copy.splice(cardIndex, 1);
      return copy;
    });
    socket.emit('play_card', { roomId, card }, (res) => {
      if (res && res.error) {
        // invalid play: server will return the card via `play_return` and then emit
        // an authoritative `private_state`. Avoid locally restoring the card here to
        // prevent accidental double-adds. Just clear optimistic UI.
        setTimeout(() => {
          setOptimisticCenter(null);
        }, 700);
      } else {
        // accepted: clear optimistic center (server will push new private_state)
        setOptimisticCenter(null);
        pendingPlayRef.current = null;
      }
    });
  }

  function drawFromDeck() {
    socket.emit('draw_card', { roomId }, (res) => {
      if (res && res.error) alert(res.error);
    });
  }

  function sendChat() {
    if (!chatText.trim()) return;
    socket.emit('chat', { roomId, from: name || 'Player', message: chatText });
    setChatText('');
  }

  function onChatKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  }

  function leaveRoom() {
    socket.emit('leave_room', { roomId });
    setRoomId(null);
    setGame(null);
    setPrivateHand([]);
  }

  return (
    <div>
      {!roomId ? (
        <div>
          <h1>Lobby</h1>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />

          {!creatingRoom ? (
            <div style={{ marginTop: 12 }}>
              <button onClick={beginCreateRoom}>Create Room</button>
              <button onClick={joinRoom} style={{ marginLeft: 8 }}>
                Join Room
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div>
                <label>
                  Number of decks (1-33):
                  <input
                    type="number"
                    min={1}
                    max={33}
                    value={numDecks}
                    onChange={(e) => setNumDecks(e.target.value)}
                    style={{ width: 60, marginLeft: 8 }}
                  />
                </label>
              </div>

              <div style={{ marginTop: 8 }}>
                <label>
                  <input
                    type="radio"
                    name="dir"
                    checked={direction === "cw"}
                    onChange={() => setDirection("cw")}
                  />
                  Clockwise
                </label>
                <label style={{ marginLeft: 12 }}>
                  <input
                    type="radio"
                    name="dir"
                    checked={direction === "ccw"}
                    onChange={() => setDirection("ccw")}
                  />
                  Counterclockwise
                </label>
              </div>

              <div style={{ marginTop: 12 }}>
                <button onClick={confirmCreateRoom}>Confirm</button>
                <button onClick={cancelCreateRoom} style={{ marginLeft: 8 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <h1>Room: {String(roomId)}</h1>

          <div className="center-area">
            <div className="discard">
                {/* show server visibleTop first (most authoritative for display), fallback to transient/latestAttempt, then private optimistic */}
                {game?.visibleTop ? (
                  <img src={`${ASSET_BASE}/${cardFilename(game.visibleTop)}`} alt={game.visibleTop} className={latestAttempt ? 'attempt-card' : ''} />
                ) : latestAttempt ? (
                  <img src={`${ASSET_BASE}/${cardFilename(latestAttempt.card)}`} alt={latestAttempt.card} className="attempt-card" />
                ) : optimisticCenter ? (
                  <img src={`${ASSET_BASE}/${cardFilename(optimisticCenter)}`} alt={optimisticCenter} />
                ) : (
                  <img src={`${ASSET_BASE}/card_back.png`} alt={'back'} />
                )}
                <div style={{ position:'absolute', left: -8, top: -16, color:'#fff', fontSize:12 }}>{game?.seq ? `seq:${game.seq}` : ''}</div>
            </div>

            <div className="draw-pile" onClick={drawFromDeck} title="Draw from deck">
              <img src={`${ASSET_BASE}/card_back.png`} alt="draw pile" />
              <div className="draw-count">{game?.drawCount ?? 0}</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button onClick={() => setShowJson(s => !s)}>{showJson ? 'Hide' : 'Show'} JSON</button>
            {game && socket.id === game.hostId && !game.started && (
              <button onClick={startGame} style={{ marginLeft: 8 }}>Start Game (host)</button>
            )}
          </div>

          {showJson && <pre className="json-panel">{JSON.stringify(game, null, 2)}</pre>}

          <div style={{ marginTop: 12 }}>
            <button onClick={leaveRoom}>Exit / Quit Game</button>
          </div>

          <div className="chat-box" style={{ position: 'fixed', left: 16, bottom: 16, width: 320 }}>
            <div style={{ maxHeight: 200, overflow: 'auto', background: '#fff', color:'#222', padding:8, borderRadius:6 }}>
              {chat.map((m, i) => (
                <div key={i} style={{ padding: 4, borderBottom: '1px solid #eee' }}><strong>{m.from}:</strong> {m.message}</div>
              ))}
            </div>
            <div style={{ display:'flex', marginTop:6 }}>
              <input style={{ flex:1 }} value={chatText} onChange={(e) => setChatText(e.target.value)} onKeyDown={onChatKey} placeholder="Type a message and press Enter" />
              <button onClick={sendChat} style={{ marginLeft:6 }}>Send</button>
            </div>
          </div>

          <div className="players-circle">
            {/* render player name boxes around the center */}
            {game && (() => {
              const players = Object.values(game.players || {});
              const total = players.length || 1;
              return players.map((p, idx) => {
                // compute angle around circle
                const angle = (idx / total) * Math.PI * 2 - Math.PI / 2; // start at top
                const radiusX = 180;
                const radiusY = 120;
                const x = Math.round(Math.cos(angle) * radiusX);
                const y = Math.round(Math.sin(angle) * radiusY);
                const style = { transform: `translate(${x}px, ${y}px)` };
                return (
                  <div key={p.id} className={`player-node ${game.currentTurn === p.id ? 'active' : ''}`} style={style}>
                    <div className="player-ring" />
                    <div className="player-name">{p.name}</div>
                  </div>
                );
              });
            })()}
          </div>

          <div className="hand-row">
            {privateHand.map((c, i) => (
              <img key={`${c}_${i}`} className="card" src={`${ASSET_BASE}/${cardFilename(c)}`} alt={c} onClick={() => playCardOptimistic(i)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function cardFilename(code) {
  if (!code) return 'card_back.png';
  // code like '10H' or 'AS' -> map to asset names
  const suitMap = { 'C': 'clubs', 'D': 'diamonds', 'H': 'hearts', 'S': 'spades' };
  let rank = code.slice(0, -1);
  const suit = suitMap[code.slice(-1)] || 'clubs';
  if (rank === 'A') rank = 'ace';
  if (rank === 'J') rank = 'jack';
  if (rank === 'Q') rank = 'queen';
  if (rank === 'K') rank = 'king';
  if (rank === '10') rank = '10';
  return `${rank}_of_${suit}.png`;
}
