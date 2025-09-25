import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Game } from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const games = {}; // roomId → Game instance

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on("create_room", (playerName, cb) => {
    const roomId = Math.random().toString(36).substr(2, 6);
    const game = new Game(io, roomId);
    games[roomId] = game;

    game.addPlayer(socket, playerName);
    cb(roomId);
  });

  socket.on("join_room", ({ roomId, playerName }, cb) => {
    const game = games[roomId];
    if (!game) return cb({ error: "No such room" });
    game.addPlayer(socket, playerName);
    cb({ success: true });
  });

  socket.on("disconnect", () => {
    for (const game of Object.values(games)) {
      game.removePlayer(socket.id);
    }
  });
});

server.listen(3001, () => console.log("✅ Server running on http://localhost:3001"));
