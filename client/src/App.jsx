import { useState } from "react";
import Lobby from "./Lobby";
import Game from "./Game";

export default function App() {
  const [roomId, setRoomId] = useState(null);

  return roomId ? (
    <Game roomId={roomId} />
  ) : (
    <Lobby onJoin={(id) => setRoomId(id)} />
  );
}
