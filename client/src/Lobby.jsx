import { useState } from "react";
import { socket } from "./api";

export default function Lobby({ onJoin }) {
  const [name, setName] = useState("");

  function createRoom() {
    socket.emit("create_room", { playerName: name }, ({ roomId }) => {
      onJoin(roomId);
    });
  }

  return (
    <div>
      <h1>Lobby</h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
      />
      <button onClick={createRoom}>Create Room</button>
    </div>
  );
}
