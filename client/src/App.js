import { useState, useEffect } from "react";
import { socket } from "./api";

export default function App() {
  const [roomId, setRoomId] = useState(null);
  const [game, setGame] = useState(null);
  const [name, setName] = useState("");

  useEffect(() => {
    socket.on("game_state", (data) => {
      setGame(data);
    });
    return () => socket.off("game_state");
  }, []);

  function createRoom() {
    socket.emit("create_room", name, (id) => {
      setRoomId(id);
    });
  }

  function joinRoom() {
    const id = prompt("Enter room ID:");
    socket.emit("join_room", { roomId: id, playerName: name }, (res) => {
      if (!res.error) setRoomId(id);
    });
  }

  function nextTurn() {
    socket.emit("next_turn", { roomId });
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
          <button onClick={createRoom}>Create Room</button>
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div>
          <h1>Room: {roomId}</h1>
          <pre>{JSON.stringify(game, null, 2)}</pre>
          <button onClick={nextTurn}>End Turn</button>
        </div>
      )}
    </div>
  );
}
