Project progress summary
=======================

Date: 2025-09-26

Summary:
- Implemented authoritative server logic and expanded rule enforcement in `server/game.js`.
- Added/updated client UI to rely on server `private_state` and `game_state` and created a collapsible test panel.
- Standardized penalty formatting and chat announcements.
- Added developer test harness `server/test_rules.js` (expanded to cover three-in-a-row, evil phrase, spade naming, skip, reverse) and validated tests locally.

Next steps:
- Add CI to run `server/test_rules.js` on push.
- Optionally implement reconnect/spectator flow for late joiners.
- Improve client-side reconnection and private_state request fallback.

Files changed (high level):
- server/game.js (emit private_state on join, robust private emits, new rule flags)
- server/index.js (create/join callbacks return initial game_state; dev test hooks)
- server/test_rules.js (expanded tests, async to allow validation delays)
- client/src/App.js (use returned game_state on create/join, test panel, chat placement)

Verification:
- Ran `node server/test_rules.js` locally; all checks passed.
