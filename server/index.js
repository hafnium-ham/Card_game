import { Server } from "socket.io";
import http from "http";
import express from "express";
import { createGame } from "./game.js";
import { RoomManager } from "./rooms.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new RoomManager();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("create_room", ({ playerName }, cb) => {
    const room = rooms.createRoom();
    rooms.joinRoom(room.id, socket, playerName);
    cb({ roomId: room.id });
  });

  socket.on("join_room", ({ roomId, playerName }, cb) => {
    const room = rooms.getRoom(roomId);
    if (!room) return cb({ error: "Room not found" });
    rooms.joinRoom(roomId, socket, playerName);
    cb({ success: true });
  });

  socket.on("play_card", ({ roomId, card }) => {
    const room = rooms.getRoom(roomId);
    if (room) room.game.playCard(socket.id, card);
  });

  socket.on("disconnect", () => {
    rooms.removePlayer(socket.id);
  });
});

server.listen(3001, () => console.log("Server running on port 3001"));
