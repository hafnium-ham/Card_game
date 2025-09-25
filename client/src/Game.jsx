import { useEffect, useState } from "react";
import { socket } from "./api";

export default function Game({ roomId }) {
  const [state, setState] = useState({ hands: {}, currentTurn: null });

  useEffect(() => {
    socket.on("game_state", setState);
    return () => socket.off("game_state");
  }, []);

  return (
    <div>
      <h2>Room {roomId}</h2>
      <pre>{JSON.stringify(state, null, 2)}</pre>
    </div>
  );
}
