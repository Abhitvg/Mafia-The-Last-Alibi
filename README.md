# Mafia: The Last Alibi

A mobile-first, 4–8 player social deduction game. The static frontend is vanilla HTML/CSS/JS; the production API is a Netlify Function at `/.netlify/functions/game` backed by a strongly consistent Netlify Blobs store.

## Features in v1

- Private six-character rooms; 4–8 players.
- Server-generated secret roles and role-specific private views.
- Mafia night kill, Detective investigation, Doctor protection.
- 60-second discussion, public town chat, private Mafia chat.
- 30-second vote, one 20-second revote after a tie, then no elimination on a second tie.
- Role reveal after elimination; server-side win checks.
- Session-token reconnect, server-authoritative deadlines, stale-host transfer.
- Responsive desktop and mobile UI.

## Local development

Requires Node.js 20+.

```sh
npm install
npm test
npm run build
npm run dev
```

Open `http://localhost:4173`. The local development server uses an in-memory store for quick multi-tab testing; rooms reset when the server restarts. Open a normal and private/incognito window to simulate separate players.

## Netlify deployment

The function is `netlify/functions/game.ts`; the frontend calls `/.netlify/functions/game` directly. `netlify.toml` configures the build, publish directory, function directory, and response headers. Netlify supplies the Blobs site context to the deployed function; no API key or manual database provisioning is required for this prototype.

Deploy through a Netlify project build (Git-connected deploy or Netlify CLI). Netlify Drop is intended for prebuilt static assets and should not be assumed to build/deploy the TypeScript function from a source archive.

## Important production note

The game stores a whole room document and uses strongly consistent reads plus conditional ETag writes (`onlyIfMatch` / `onlyIfNew`) with bounded retries. This rejects stale writes, but Netlify Blobs is optimized for frequent reads and infrequent writes; Netlify's documentation recommends a database for more complex concurrency control. Treat this build as a private playtest / MVP until simultaneous-action load testing is completed. For a public competitive release, move room transitions to a transactional database (for example Netlify Database/Postgres) or a dedicated realtime backend, then run race-condition tests under concurrent requests.

## Test coverage

`npm test` covers role distribution, role privacy, protection, detective results, tie/revote handling, win conditions, a three-round five-player game, and API room creation/join/start authorization.
