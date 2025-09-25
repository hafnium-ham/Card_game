export class Game {
  constructor(io, roomId) {
    this.io = io;
    this.roomId = roomId;
    this.players = {};
    this.turnOrder = [];
    this.currentTurn = 0;
  }

  addPlayer(socket, name) {
    this.players[socket.id] = { name };
    this.turnOrder.push(socket.id);
    socket.join(this.roomId);
    this.sync();
  }

  removePlayer(id) {
    delete this.players[id];
    this.turnOrder = this.turnOrder.filter(pid => pid !== id);
    this.sync();
  }

  nextTurn() {
    if (this.turnOrder.length > 0) {
      this.currentTurn = (this.currentTurn + 1) % this.turnOrder.length;
      this.sync();
    }
  }

  sync() {
    this.io.to(this.roomId).emit("game_state", {
      players: this.players,
      currentTurn: this.turnOrder[this.currentTurn]
    });
  }
}
