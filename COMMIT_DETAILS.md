Detailed changes added in this branch

Background:
Previously this repository only had a minimal server that created/joined rooms and emitted JSON state.
This commit adds a number of non-functional comments and significant runtime behavior to make the server authoritative
for a simple card game, plus matching client-side handling and tests. No existing functionality was removed; this
commit only adds behavior, comments and a few small client changes to avoid a visual duplicate bug.

High-level summary of new additions (files changed/added):

1) server/game.js (major runtime & comments)
- Implemented the authoritative `Game` class that manages per-room state:
  - players, turnOrder, currentTurnIndex
  - draw pile and discard pile construction and shuffle (supports multiple decks)
  - dealing hands to players (deal 5 by default)
  - play validation logic (must match suit or rank) and turn enforcement
  - draw logic including reshuffle of the discard pile when the draw pile is empty
  - penalty handling for invalid plays and off-turn draws
- Optimistic/UX helper behavior:
  - Emits `played_attempt` for transient client display, waits a short VALIDATE_DELAY,
    then performs authoritative validation and either commits the play or undoes it.
  - When undoing (invalid play) the server returns the card to the player's hand, issues
    a penalty draw and emits `play_rejected` and `play_return` events plus authoritative
    `private_state` and `game_state` updates.
- Added `seq` sequence numbers to `game_state` to help clients detect and ignore
  out-of-order updates.
- Added comments to explain authoritative responsibilities and the optimistic display flow.
- Added debug logs in `start()` and `sync()` to help diagnose starting-discard and state flow.

2) server/index.js
- Serve static assets from the repository `assets/` folder under `/assets` (so clients can
  request the card image files directly).
- Router: create/join/start/play/draw/leave/disconnect handlers that delegate to the Game
  instance for authoritative behavior.
- Room lifecycle: when the host leaves/disconnects the server now emits `room_closed` and
  performs cleanup of sockets and the Game instance.
- Added explanatory comments about responsibilities and lifecycle.
- Added a console log to show the resolved filesystem `assets` path at server startup.

3) client/src/App.js
- Adjusted client optimistic behavior to avoid a visual duplicate bug observed when:
  1) client removed the card optimistically on click,
  2) server rejected the play and sent both `play_return` and `private_state`, and
  3) the client re-added the card locally while also applying the server's authoritative hand,
     resulting in two visible copies of the same card.
- Fix implemented (client-only, no server-side behavior change):
  - Do not restore the returned card locally in the `play_card` callback or `play_return` handler.
  - Clear optimistic UI on `play_return` and wait for the server's authoritative `private_state` to
    set `privateHand`. The server is the single source of truth for the hand contents.
- Render logic notes:
  - The center/top card display prefers `game.visibleTop` (transient attempt if present),
    then shows `latestAttempt` or the client's optimistic center, and finally falls back to the
    card back image.
  - The client still shows transient `played_attempt` and `play_accepted` UI cues so players see
    immediate feedback, but the canonical hand state is taken only from `private_state`.
- Added in-file comments clarifying the design and why the client defers to authoritative
  `private_state` to avoid duplicate visuals. No functional change beyond removing the local restore.

4) client/test_hand_dedupe.js (new)
- A small simulation script that reproduces the optimistic play -> play_return -> private_state
  sequence to assert the final applied hand matches authoritative server hand (no duplicates).
  This is a fast node script for local validation of the client-side fix.

5) server/test_play_flow.js
- Used to validate server play attempt / accept / undo sequences in a simulated environment.
- Server logs from this script were used to confirm the transient attempt and authoritative undo flow.

Why these additions were made (motivation):
- Improve UX: showing a transient play attempt to everyone makes the game feel responsive even under
  network jitter.
- Keep server authoritative: who actually holds which cards must be decided by the server to avoid
  divergence across clients and cheating.
- Fix a purely visual bug where an invalid returned card was re-added locally on the client in addition
  to being present in the authoritative `private_state`.
- Increase observability: `seq` values and additional debug logs help diagnose stale/out-of-order
  updates and confirm the starting discard and transitions.

No functional removals / regressions:
- This commit intentionally avoids removing existing functionality. The code changes only add
  server-side authoritative behavior, client-side safer handling of invalid plays, developer
  comments, and tests. The game rules and socket API remain the same externally.

