import { getStore } from '@netlify/blobs';
import { createApi } from '../../src/api-core.mjs';

const rooms = getStore('mafia-last-alibi-rooms', { consistency: 'strong' });
const handler = createApi({ store: rooms });

export default async (request: Request) => handler(request);
