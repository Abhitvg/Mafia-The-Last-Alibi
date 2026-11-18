# Mafia: The Last Alibi

A mobile-first, 4–8 player social deduction game. The static frontend is vanilla HTML/CSS/JS; the API is a serverless function backed by Vercel KV (Upstash Redis) for reliable cross-device state sync.

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

## Vercel deployment

### 1. Connect the repository

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and import the repository.
3. Vercel reads `vercel.json`, runs `npm run build`, publishes `dist/`, and deploys the serverless function at `/api/game`.

### 2. Add Vercel KV (required for multiplayer)

Without KV, the serverless function falls back to an in-memory store that **does not persist across function instances** — multiplayer will not work reliably.

1. In your Vercel project dashboard, go to **Storage** → **Create Database** → **KV (Upstash)**.
2. Select the **Free** tier and your preferred region.
3. Click **Create & Connect**. Vercel automatically sets the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.
4. **Redeploy** the project (Deployments → latest → Redeploy) so the function picks up the new env vars.

That's it. No API keys to manage manually. Rooms auto-expire after 2 hours.

### 3. Test the deployment

Open the deployed URL in two separate browsers/devices, create a room, share the code, and play with 4+ players.

## Netlify deployment (alternative)

The project also ships with `netlify.toml` and `netlify/functions/game.ts` for Netlify deployment using Netlify Blobs. See `DEPLOYMENT.md` for Netlify-specific instructions.

## Important production note

The game stores a whole room document and uses optimistic concurrency with ETag-style version checks and bounded retries. This rejects stale writes, but a tiny race window exists in the KV conditional-update path. For a private playtest / party game this is perfectly adequate. For a public competitive release, move room transitions to a transactional database or a dedicated realtime backend, then run race-condition tests under concurrent load.

## Test coverage

`npm test` covers role distribution, role privacy, protection, detective results, tie/revote handling, win conditions, a three-round five-player game, and API room creation/join/start authorization.
