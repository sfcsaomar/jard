// Runs once a day so the database never sits idle long enough for the free plan to pause it.
import { rpc, syncEnabled } from '../lib/supa.mjs';

export default async () => {
  if (!syncEnabled()) return new Response('skip');
  try { await rpc('meta_get', { p_key: 'legacy_import' }); }
  catch (e) { console.error('Keep-alive failed', e?.status || e?.message); }
  return new Response('ok');
};

export const config = { schedule: '@daily' };
