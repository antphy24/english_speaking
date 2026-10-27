// Research Test mode API. Teachers, students and scorers each have their own
// login session, so every call says which Supabase client's token to send.
import { parseError } from './api';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
export const SCORER_DOMAIN = 'scorers.hrefspeak.com';
export const scorerEmail = (username) => `scorer_${String(username || '').trim().toLowerCase()}@${SCORER_DOMAIN}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token(authClient) {
  const { data: { session } } = await authClient.auth.getSession();
  if (!session?.access_token) throw new Error('Your login session has expired. Please sign in again.');
  return session.access_token;
}

/**
 * JSON request with a few quiet retries for network blips and a waking-up server.
 * body: object (sent as JSON) or FormData.
 */
export async function researchRequest(authClient, path, { method = 'GET', body, retries = 3, raw = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const headers = { Authorization: `Bearer ${await token(authClient)}` };
      let payload = body;
      if (body && !(body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${API_BASE}/research${path}`, { method, headers, body: payload });
      if (res.ok) return raw ? res : res.json();
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const err = new Error(await parseError(res, 'Something went wrong.'));
      err.status = res.status;
      throw err;
    } catch (err) {
      lastErr = err;
      if (err.status || attempt >= retries) throw err;
      await sleep(1500 * (attempt + 1)); // network error
    }
  }
  throw lastErr;
}

/** Download a file (Excel / ZIP) from the research API. */
export async function researchDownload(authClient, path, fallbackName) {
  const res = await researchRequest(authClient, path, { raw: true, retries: 1 });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return res;
}

export const ASPECTS = ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'comprehension'];
export const ASPECT_SHORT = {
  pronunciation: 'Pron.', fluency: 'Flu.', vocabulary: 'Voc.', grammar: 'Gram.', comprehension: 'Comp.',
};

export function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
