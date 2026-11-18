// Vercel Serverless Function — in-memory room store.
// Rooms live in a global Map that persists across warm invocations on the
// same isolate.  Cold starts wipe it, which is acceptable for a playtest /
// party game.  For durable multi-region state, swap this Map for Vercel KV
// or any Redis-compatible store.

import { createApi } from '../src/api-core.mjs';

const data = new Map();
let version = 0;

const store = {
  async getWithMetadata(key) {
    const entry = data.get(key);
    return entry
      ? { data: structuredClone(entry.data), etag: entry.etag }
      : null;
  },
  async setJSON(key, value, opts = {}) {
    const old = data.get(key);
    if (opts.onlyIfNew && old) return { modified: false };
    if (opts.onlyIfMatch && (!old || old.etag !== opts.onlyIfMatch))
      return { modified: false };
    const etag = `"v-${++version}"`;
    data.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  },
};

const handler = createApi({ store });

export default async function (req) {
  return handler(req);
}
