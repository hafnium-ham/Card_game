import { Game } from "./game.js";

export class Room {
  constructor(id, io) {
    this.id = id;
    this.io = io;
    this.players = {};
    this.game = new Game(this);
  }

  broadcast(event, data) {
    this.io.to(this.id).emit(event, data);
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom() {
    const id = Math.random().toString(36).substr(2, 6);
    const room = new Room(id, global.io);
    this.rooms.set(id, room);
    return room;
  }

  joinRoom(id, socket, playerName) {
    const room = this.rooms.get(id);
    if (!room) return null;
    socket.join(id);
    room.players[socket.id] = { name: playerName };
    room.game.addPlayer(socket.id);
    return room;
  }

  removePlayer(socketId) {
    for (const [id, room] of this.rooms.entries()) {
      if (room.players[socketId]) {
        delete room.players[socketId];
        room.game.removePlayer(socketId);
      }
    }
  }

  getRoom(id) {
    return this.rooms.get(id);
  }
}
