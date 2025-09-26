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
    if (typeof cb === "function") cb({ roomId });
  });

  // Join existing room. payload: { roomId, playerName }
  socket.on("join_room", (payload, cb) => {
    const { roomId, playerName } = payload || {};
    const game = games[roomId];
    if (!game) return cb && cb({ error: "No such room" });
    game.addPlayer(socket, playerName || "Player");
    cb && cb({ success: true });
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

  // Chat messages: { roomId, from, message }
  socket.on('chat', (payload) => {
    const { roomId, from, message } = payload || {};
    const game = games[roomId];
    if (!game) return;
    const entry = game.addChat(from || 'anon', message);
    io.to(roomId).emit('chat', entry);
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
