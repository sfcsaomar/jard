// Claude (Anthropic) spend for the provider dashboard.
// Anthropic's Cost API gives daily spend in USD but not the remaining credit, so the provider enters
// the balance once after each top-up (amount + date) and the panel subtracts the spend since then.
// Needs ANTHROPIC_ADMIN_KEY (an Admin API key, sk-ant-admin...) in Netlify; without it only our own
// per-company request counts are shown.
import { db } from './db.mjs';

const API = () => (process.env.ANTHROPIC_ADMIN_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
const KEY = () => process.env.ANTHROPIC_ADMIN_KEY || '';
export const claudeConfigured = () => KEY().length > 20;

const CACHE_MINUTES = 15;
const DAY = 86400000;
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

let _fetch = (...a) => fetch(...a);
export function _setClaudeFetchForTests(f) { _fetch = f; }

// Daily USD spend from `fromDay` (YYYY-MM-DD, UTC) to now. The API returns at most 31 days per page.
async function fetchDaily(fromDay) {
  const out = new Map();
  let page = null;
  for (let i = 0; i < 15; i++) {
    const q = new URLSearchParams({ starting_at: fromDay + 'T00:00:00Z', ending_at: new Date(Date.now() + DAY).toISOString().slice(0, 10) + 'T00:00:00Z', bucket_width: '1d', limit: '31' });
    if (page) q.set('page', page);
    const r = await _fetch(`${API()}/v1/organizations/cost_report?${q}`, {
      headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'User-Agent': 'AMAN-Field/2.5' }
    });
    if (!r.ok) {
      const e = new Error(`Anthropic cost report ${r.status}`);
      e.status = r.status;
      throw e;
    }
    const body = await r.json();
    for (const b of body.data || []) {
      const day = String(b.starting_at || b.bucket || '').slice(0, 10);
      // Amounts are decimal strings in cents.
      const cents = (b.results || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      if (day) out.set(day, (out.get(day) || 0) + cents / 100);
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, usd]) => ({ day, usd: Math.round(usd * 100) / 100 }));
}

export async function getBalance() {
  return (await db.metaGet('claude_balance')) || null;
}

export async function setBalance({ usd, date, warnUsd }) {
  const amount = Math.round(Number(usd) * 100) / 100;
  if (!(amount >= 0) || amount > 1e7) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : isoDay(Date.now());
  const warn = Math.max(0, Math.round(Number(warnUsd ?? 20) * 100) / 100);
  const v = { usd: amount, date: day, warnUsd: warn, setAt: new Date().toISOString() };
  await db.metaSet('claude_balance', v);
  await db.metaSet('claude_cost_cache', null);
  return v;
}

// Spend this month and since the balance date, with the estimated remaining credit.
export async function claudeSummary({ fresh = false } = {}) {
  const balance = await getBalance();
  const base = { configured: claudeConfigured(), balance };
  if (!base.configured) return base;
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const last30 = isoDay(Date.now() - 29 * DAY);
  let from = monthStart < last30 ? monthStart : last30;
  if (balance?.date && balance.date < from) from = balance.date;

  const cache = await db.metaGet('claude_cost_cache');
  let daily;
  if (!fresh && cache && cache.from === from && Date.now() - Date.parse(cache.at) < CACHE_MINUTES * 60000) {
    daily = cache.daily;
  } else {
    try {
      daily = await fetchDaily(from);
      await db.metaSet('claude_cost_cache', { from, at: new Date().toISOString(), daily });
    } catch (e) {
      return { ...base, error: e.status === 401 || e.status === 403 ? 'bad_key' : 'unreachable', daily: cache?.daily || [] };
    }
  }
  const sum = (rows) => Math.round(rows.reduce((s, r) => s + r.usd, 0) * 100) / 100;
  const monthUsd = sum(daily.filter((r) => r.day >= monthStart));
  const out = { ...base, daily: daily.filter((r) => r.day >= last30), monthUsd, updatedAt: (cache && !fresh && cache.from === from) ? cache.at : new Date().toISOString() };
  if (balance) {
    const spent = sum(daily.filter((r) => r.day >= balance.date));
    out.sinceBalanceUsd = spent;
    out.remainingUsd = Math.round((balance.usd - spent) * 100) / 100;
    out.low = out.remainingUsd <= balance.warnUsd;
  }
  return out;
}
