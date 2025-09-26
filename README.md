# Card Game Project Roadmap

## Overview & Goals
- **Turn-based, 2–10 players** using 52-card decks (support multiple decks)
- **3D visuals** for card movement and a separate 3D lobby/avatars area
- **Authoritative multiplayer:** server enforces rules, clients render and animate
- **Features:** lobby, chat, bots, cosmetic items (card skins, hats), matchmaking, persistent accounts
- **Platforms:** web first, packaged to desktop/mobile later (Electron/Capacitor/Tauri or native ports)

## High-Level Roadmap
1. **Design & rules** — decide exact rule set, edge cases, customization options
2. **MVP** (single room, server authoritative, basic UI) — test game loop with real players
3. **Add real card handling & turn rules** — deal, draw, play, multiple decks
4. **Add basic 3D rendering** — cards move/flip in 3D; avatars are placeholders
5. **Add lobby/world & cosmetics** — avatar movement, skins, item previews
6. **Enhance UX & resiliency** — reconnection, persistent accounts, matchmaking
7. **Scale & monetize** — analytics, store, payment flow, load balancing
8. **Polish & release** — platform packaging, testing, marketing materials

> Each step is modular — you can stop and iterate at any point.

---

## Step 1 — Design & Rules (Foundation)
- Write precise rules: turn progression, cards dealt, allowed plays, tie breakers, multiple-deck rules, customizable toggles
- Enumerate edge cases: player leaves mid-turn, simultaneous actions, out-of-cards, rule conflicts
- Define customization scope: hand size, deck count, special rules, timed turns
- Decide deterministic vs. random: how shuffling is done and audited
- **Why:** Precise rules prevent desyncs and cheating; server/UX logic stays stable

## Step 2 — Architecture (Roles & Boundaries)
**Server (authoritative):**
- Enforces rules, validates moves
- Holds canonical game state: decks, hands (private), discard, turn order, timers
- Manages rooms, players, matchmaking, bots, persistence
- Emits state diffs/patches to clients

**Client (renderer + input):**
- Local rendering (3D card animations, avatars)
- Sends intents (e.g., “play card X”) to server; optimistic UI, but final state from server
- Handles UI: chat, menus, cosmetics, local settings

**Data storage:**
- Persistent: accounts, cosmetics, purchases, match history
- Transient: active rooms, matchmaking queue (in-memory/cache)

**Assets service:**
- Stores textures, 3D models, audio, thumbnails (consider CDN)

**Why:** Clear separation avoids cheating and simplifies scaling

## Step 3 — Game State Model (Conceptual)
- Room ID + metadata (name, privacy, owner)
- Player list: id, displayName, socket info, avatar/cosmetics, client version
- Turn state: turnOrder, currentTurnIndex, turnTimer
- Deck state: remaining deck (private), discard pile (public), number of decks
- Hands: playerId → list of cards (private)
- Match settings: maxPlayers, custom rule flags, time control
- Chat/history: last N messages
- Match outcome: winner(s), stats
- **Keep all state serializable and authoritative. Clients only see what they’re allowed.**

## Step 4 — Networking & Synchronization
- Authoritative server: clients send “intent”, server validates, updates, broadcasts
- Delta updates: send only changed fields
- Optimistic client UI: animate immediately, reconcile/rollback on server response
- Reconnection & catch-up: client requests latest state or diff; server supports snapshots/replay
- Sequence numbers/ticks: tag updates for ordering and missing detection
- Anti-cheat: never trust client for card contents or randomness

## Step 5 — Lobby, Matchmaking, Rooms & Social
- Lobby: persistent hub (3D or 2D) for avatars, chat, friends, shop
- Matchmaking: join-by-room or quick-match queue; public/private, custom rules, table size
- Room lifecycle: create → join → ready → start → play → finish → stats/save
- Chat & moderation: profanity filter, report/block, moderation tools
- Bots: server-side agents for vacant seats/testing

## Step 6 — Rendering & 3D Concepts
**Cards:**
- Each card = quad with front/back texture (use atlases/texture arrays)
- Instancing for performance
- Animations: draw, throw, flip, highlight

**Lobby/avatars:**
- Simple avatars (capsule + head + hat slot)
- Simple movement/idle animations, low-poly
- Cosmetic slots: hat, card back, emote

**Camera & UI:**
- In-game: fixed camera with orbit/zoom
- Lobby: free camera
- HUD overlays for chat, player list, hand view

## Step 7 — Security, Cheating Prevention & Fairness
- Server is sole source of truth (shuffle, deals, validation)
- Never trust client to hide card content
- Validate all client actions; reject invalid with reasons
- Rate limits & anti-spam
- Logging & audit for disputes/fraud
- Cheat detection heuristics

## Step 8 — Persistence & Accounts
- Accounts: username/password or 3rd party OAuth
- Inventory: cosmetics tied to accounts
- Match history & stats: minimal records for leaderboards
- Privacy & compliance: store only necessary data, consider regulations
