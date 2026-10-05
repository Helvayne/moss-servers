import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { cacheControl, checkAll } from '../../lib/status';

export const prerender = false;

const TIMEOUT_MS = 3000;

export const GET: APIRoute = async () => {
  const servers = (await getCollection('servers')).filter((s) => s.data.status === 'live' && s.data.address);
  const statuses = await checkAll(servers.map((s) => ({ id: s.id, address: s.data.address! })), TIMEOUT_MS);
  return new Response(JSON.stringify(statuses), {
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheControl(statuses),
    },
  });
};
