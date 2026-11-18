// Vercel Serverless Function for Mafia: The Last Alibi
//
// Storage strategy:
//   1. If KV_REST_API_URL is set → Vercel KV (Upstash Redis) for reliable
//      cross-isolate persistence.  Rooms expire after 2 hours.
//   2. Otherwise → in-memory Map.  Works for local dev; on Vercel this only
//      survives within a single warm isolate, so multiplayer will break if
//      requests land on different instances.  Fine for `npm run dev`.

import { createApi } from '../src/api-core.mjs';

// ─────────────────────────────────────────────
// In-memory store  (local dev fallback)
// ─────────────────────────────────────────────
const mem = new Map();
let ver = 0;
const TTL_MS = 2 * 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [k, v] of mem) if (now - v.ts > TTL_MS) mem.delete(k);
}

const memoryStore = {
  async getWithMetadata(key) {
    gc();
    const e = mem.get(key);
    return e ? { data: structuredClone(e.data), etag: e.etag } : null;
  },
  async setJSON(key, value, opts = {}) {
    gc();
    const old = mem.get(key);
    if (opts.onlyIfNew && old) return { modified: false };
    if (opts.onlyIfMatch && (!old || old.etag !== opts.onlyIfMatch))
      return { modified: false };
    const etag = `"m${++ver}"`;
    mem.set(key, { data: structuredClone(value), etag, ts: Date.now() });
    return { modified: true, etag };
  },
};

// ─────────────────────────────────────────────
// Vercel KV (Upstash Redis) store
// ─────────────────────────────────────────────
const ROOM_TTL_SEC = 7200; // 2 hours

function createKvStore(kv) {
  return {
    async getWithMetadata(key) {
      let raw = await kv.get(`room:${key}`);
      if (!raw) return null;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch {}
      }
      return (raw && raw.d) ? { data: raw.d, etag: raw.e } : null;
    },
    async setJSON(key, value, opts = {}) {
      const rk = `room:${key}`;
      const ne = `"${Date.now().toString(36)}-${(++ver).toString(36)}"`;

      if (opts.onlyIfNew) {
        // Redis SET NX — atomic "only if not exists"
        const ok = await kv.set(rk, { d: value, e: ne }, { nx: true, ex: ROOM_TTL_SEC });
        return ok === 'OK' || ok === true
          ? { modified: true, etag: ne }
          : { modified: false };
      }

      if (opts.onlyIfMatch) {
        let cur = await kv.get(rk);
        if (!cur) return { modified: false };
        if (typeof cur === 'string') {
          try { cur = JSON.parse(cur); } catch {}
        }
        if (cur.e !== opts.onlyIfMatch) return { modified: false };
        await kv.set(rk, { d: value, e: ne }, { ex: ROOM_TTL_SEC });
        return { modified: true, etag: ne };
      }

      // Unconditional write
      await kv.set(rk, { d: value, e: ne }, { ex: ROOM_TTL_SEC });
      return { modified: true, etag: ne };
    },
  };
}

// ─────────────────────────────────────────────
// Resolve the right store once, then reuse
// ─────────────────────────────────────────────
let resolvedStore = null;

async function resolveStore() {
  if (resolvedStore) return resolvedStore;

  const restUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (restUrl && restToken) {
    try {
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({ url: restUrl, token: restToken });
      resolvedStore = createKvStore(redis);
      console.log('[mafia] Upstash Redis connected via REST credentials');
      return resolvedStore;
    } catch (e) {
      console.warn('[mafia] @upstash/redis failed, trying @vercel/kv:', e.message);
      try {
        const { kv } = await import('@vercel/kv');
        resolvedStore = createKvStore(kv);
        console.log('[mafia] Vercel KV connected');
        return resolvedStore;
      } catch (err) {
        console.warn('[mafia] KV import failed, falling back to memory:', err.message);
      }
    }
  }

  resolvedStore = memoryStore;
  console.log('[mafia] Using in-memory store (rooms reset on cold start)');
  return resolvedStore;
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────
let handler = null;

export default async function (req) {
  if (!handler) {
    handler = createApi({ store: await resolveStore() });
  }
  return handler(req);
}
