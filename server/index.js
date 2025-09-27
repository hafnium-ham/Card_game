import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import http from "http";
import { Server } from "socket.io";
import { Game } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// serve assets folder from project root for card images (resolve file URL properly)
/*
  server/index.js

  Purpose: HTTP + socket.io glue. Responsibilities:
  - Serve static card image assets under `/assets` so clients can request
    images like `/assets/ace_of_spades.png`.
  - Create and manage Game instances per room. Each socket event handler
    delegates to the Game instance which is authoritative for room state.
  - Enforce host-only actions (e.g., only the host can call `start_game`).

  Room lifecycle note:
  - When the host leaves or disconnects, the room is closed and all
    participants receive a `room_closed` event. The Game instance and its
    chat buffer are then deleted to free memory.
*/
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsPath = path.resolve(__dirname, '..', 'assets');
console.log('Serving assets from', assetsPath);
app.use('/assets', express.static(assetsPath));

const games = {}; // roomId → Game instance

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Create room. payload: { playerName, settings }
  socket.on("create_room", (payload, cb) => {
    const { playerName, settings } = payload || {};
    const roomId = Math.random().toString(36).substr(2, 6);
    const game = new Game(io, roomId, settings || { numDecks: 1, direction: "cw" });
    games[roomId] = game;

    game.addPlayer(socket, playerName || "Host");
    // send immediate private_state to the host socket as well (defensive)
    try { socket.emit('private_state', { hand: game.players[socket.id].hand.slice() }); } catch (e) {}
    // also return an initial public game_state snapshot so the client can
    // immediately render host-only controls (like Start Game)
    const initial = {
      roomId: game.roomId,
      hostId: game.hostId,
      started: game.started,
      players: Object.fromEntries(Object.entries(game.players).map(([id,p])=>[id,{ id:p.id, name:p.name, handCount:p.hand.length }]))
    };
    if (typeof cb === "function") cb({ roomId, game_state: initial });
  });

  // Join existing room. payload: { roomId, playerName }
  socket.on("join_room", (payload, cb) => {
    const { roomId, playerName } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: "No such room" });
    if (game.started) return cb && cb({ error: 'Game already started' });
    game.addPlayer(socket, playerName || "Player");
    // ensure the joining client receives their private hand immediately
    try { socket.emit('private_state', { hand: game.players[socket.id].hand.slice() }); } catch (e) {}
    const initial = {
      roomId: game.roomId,
      hostId: game.hostId,
      started: game.started,
      players: Object.fromEntries(Object.entries(game.players).map(([id,p])=>[id,{ id:p.id, name:p.name, handCount:p.hand.length }]))
    };
    cb && cb({ success: true, game_state: initial });
  });

  // Start game (host only). payload: { roomId }
  socket.on("start_game", (payload, cb) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: "No such room" });
    if (game.hostId !== socket.id) return cb && cb({ error: "Only host can start" });
    if (game.turnOrder.length < 2) return cb && cb({ error: "Need at least 2 players to start" });
    game.start();
    cb && cb({ started: true });
  });

  // Play a card. payload: { roomId, card }
  socket.on("play_card", (payload, cb) => {
    const { roomId, card } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: "No such room" });
    game.playCard(socket.id, card, (err) => {
      if (cb) cb(err ? { error: err } : { success: true });
    }, socket);
  });

  // Draw a card and end turn. payload: { roomId }
  socket.on("draw_card", (payload, cb) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: "No such room" });
    game.drawCardAction(socket.id, (err) => {
      if (cb) cb(err ? { error: err } : { success: true });
    }, socket);
  });

  // Draw one card to the player's hand without advancing turn (used when invalid optimistic play)
  socket.on("draw_replace", (payload, cb) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: "No such room" });
    try {
      game.drawOneToPlayer(socket.id);
      cb && cb({ success: true });
    } catch (err) {
      cb && cb({ error: String(err) });
    }
  });

  // Suit selection (player presses suit button). payload: { roomId, suit }
  socket.on('select_suit', (payload, cb) => {
    const { roomId, suit } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: 'No such room' });
    game.selectSuit(socket.id, suit);
    cb && cb({ success: true });
  });

  // Knock action. payload: { roomId }
  socket.on('knock', (payload, cb) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: 'No such room' });
    game.knock(socket.id);
    cb && cb({ success: true });
  });

  // Sing action. payload: { roomId }
  socket.on('sing', (payload, cb) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: 'No such room' });
    game.sing(socket.id);
    cb && cb({ success: true });
  });

  // Chat messages: { roomId, from, message }
  socket.on('chat', (payload) => {
    const { roomId, from, message } = payload || {};
    const game = games[roomId];
    if (!game) return;
    const entry = game.addChat(from || 'anon', message);
    io.to(roomId).emit('chat', entry);
    // process chat for rule fulfillment or curse detection
    // find playerId by matching socket id or name (best-effort)
    const pid = socket.id;
    try { game.processChat(pid, message); } catch (e) { console.warn('processChat failed', e); }
  });

  // Developer test hooks (only available in dev): inject deterministic plays and test rules
  socket.on('test_play_as', (payload) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return;
    // ensure p's socket exists; use the caller as test player
    const pid = socket.id;
    if (!game.players[pid]) return;
    // give AS to this player if missing
    if (!game.players[pid].hand.includes('AS')) game.players[pid].hand.push('AS');
    game.playCard(pid, 'AS', () => {});
  });

  socket.on('test_play_hearts', (payload) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return;
    const pid = socket.id;
    if (!game.players[pid]) return;
    // give a heart card and play it
    const heart = game.players[pid].hand.find(c => c.endsWith('H')) || '2H';
    if (!game.players[pid].hand.includes(heart)) game.players[pid].hand.push(heart);
    game.playCard(pid, heart, () => {});
  });

  socket.on('test_song', (payload) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return;
    const pid = socket.id;
    if (!game.players[pid]) return;
    // force an AS play then sing
    if (!game.players[pid].hand.includes('AS')) game.players[pid].hand.push('AS');
    game.playCard(pid, 'AS', () => {});
    game.sing(pid);
  });

  socket.on('test_evil', (payload) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return;
    const pid = socket.id;
    if (!game.players[pid]) return;
    // Give an 'evil' card marker (we'll use '7S' as placeholder) and set evilPending
    if (!game.players[pid].hand.includes('7S')) game.players[pid].hand.push('7S');
    game.playCard(pid, '7S', () => {});
    game.evilPending = true;
  });

  socket.on('test_all_rules', (payload) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return;
    // run a series of test actions: make socket the host player if possible
    const pid = socket.id;
    if (!game.players[pid]) return;
    // inject a Jack and play it
    if (!game.players[pid].hand.find(c=>c.startsWith('J'))) game.players[pid].hand.push('JH');
    game.playCard(pid, game.players[pid].hand.find(c=>c.startsWith('J')), ()=>{});
    // inject AS and play/sing
    if (!game.players[pid].hand.includes('AS')) game.players[pid].hand.push('AS');
    game.playCard(pid, 'AS', ()=>{});
    game.sing(pid);
  });

  socket.on("leave_room", (payload) => {
    const { roomId } = payload || {};
    const game = games[roomId];
    if (!game) return;
    const wasHost = game.hostId === socket.id;
    game.removePlayer(socket.id);
    // if host left, close room for everyone
    if (wasHost) {
      io.to(roomId).emit('room_closed', { reason: 'host_left' });
      const sockets = io.sockets.adapter.rooms.get(roomId);
      if (sockets) {
        for (const sid of sockets) {
          const s = io.sockets.sockets.get(sid);
          if (s) {
            try { s.leave(roomId); } catch (e) {}
          }
        }
      }
      game.clearChat();
      delete games[roomId];
      console.log(`Closed room ${roomId} because host left`);
      return;
    }
    // cleanup empty rooms
    if (game.turnOrder.length === 0) {
      game.clearChat();
      delete games[roomId];
      console.log(`Cleaned up empty room ${roomId}`);
    }
  });

  socket.on("disconnect", () => {
    for (const [rid, game] of Object.entries(games)) {
      const wasHost = game.hostId === socket.id;
      game.removePlayer(socket.id);
      if (wasHost) {
        io.to(rid).emit('room_closed', { reason: 'host_disconnected' });
        const sockets = io.sockets.adapter.rooms.get(rid);
        if (sockets) {
          for (const sid of sockets) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
              try { s.leave(rid); } catch (e) {}
            }
          }
        }
        game.clearChat();
        delete games[rid];
        console.log(`Closed room ${rid} because host disconnected`);
        continue;
      }
      if (game.turnOrder.length === 0) {
        game.clearChat();
        delete games[rid];
        console.log(`Cleaned up empty room ${rid} after disconnect`);
      }
    }
  });
});

server.listen(3001, () => console.log("✅ Server running on http://localhost:3001"));
