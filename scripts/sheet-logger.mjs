/**
 * Lightweight Google Sheets append — no googleapis package, just REST + JWT.
 * Usage: await appendRow(sheetId, tabName, [col1, col2, ...])
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const KEY_FILE = process.env.GOOGLE_SA_KEY_FILE || path.resolve(process.cwd(), 'credentials/google-service-account.json');
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let cachedToken = null;
let cachedTokenExp = 0;
let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  cachedKey = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  return cachedKey;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExp - 60 > now) return cachedToken;

  const key = loadKey();
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const signInput = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = base64url(signer.sign(key.private_key));
  const assertion = `${signInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`token fail: ${JSON.stringify(j)}`);
  cachedToken = j.access_token;
  cachedTokenExp = now + (j.expires_in || 3600);
  return cachedToken;
}

export async function appendRow(sheetId, tabName, row) {
  const token = await getAccessToken();
  const range = `${tabName}!A:Z`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`append HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function ensureHeader(sheetId, tabName, header) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName + '!A1:Z1')}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`read HTTP ${res.status}`);
  const j = await res.json();
  const existing = j.values?.[0] || [];
  if (existing.length === 0) {
    await appendRow(sheetId, tabName, header);
  }
}
