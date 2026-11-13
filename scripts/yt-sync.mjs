// Adds YouTube videos from new unknowNews issues to a YouTube playlist.
// Run by GitHub Actions (.github/workflows/yt-playlist.yml).
// Stateless: every run compares the archive with the current playlist contents
// and adds only what is missing.
//
// Environment variables:
//   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN  – OAuth secrets
//   YT_PLAYLIST_ID  – playlist ID (from the URL ...?list=XXXX)
//   START_DATE      – YYYY-MM-DD, older issues are ignored (default 2026-11-13)
//   DRY_RUN=1       – only show what would be added
//   MAX_INSERTS     – safety limit per run (default 60)
//
// NOTE: in a public repository the Actions logs are public. Never print
// secrets, the playlist ID or raw upstream text here – use safeLog().

import { extractVideoId, isYouTubeHost, safeLog } from './youtube-url.mjs';

const ARCHIVE_URL = 'https://unknow.news/archiwum.json';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 20_000;

const env = process.env;
const DRY_RUN = env.DRY_RUN === '1' || env.DRY_RUN === 'true';
const START_DATE = (env.START_DATE || '2026-11-13').trim();
const PLAYLIST_ID = (env.YT_PLAYLIST_ID || '').trim();
const MAX_INSERTS = Number.parseInt(env.MAX_INSERTS || '60', 10);

class FatalError extends Error {}

function fail(msg) {
  throw new FatalError(msg);
}

async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { res, body };
}

function googleReason(body) {
  const e = body?.error;
  if (!e) return 'unknown';
  if (typeof e === 'string') return safeLog(e, 60); // token endpoint: {"error":"invalid_grant"}
  return safeLog(e.errors?.[0]?.reason || e.status || String(e.code || 'unknown'), 60);
}

// --- 1. Archive ------------------------------------------------------------

async function loadCandidates() {
  const { res, body } = await http(ARCHIVE_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok || !Array.isArray(body)) fail(`Could not fetch the archive (HTTP ${res.status}).`);

  const fresh = body
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => typeof item?.date === 'string' && item.date >= START_DATE)
    // Oldest issue first; within an issue keep the newsletter order.
    .sort((a, b) => a.item.date.localeCompare(b.item.date) || a.idx - b.idx);

  const seen = new Set();
  const candidates = [];
  for (const { item } of fresh) {
    const id = extractVideoId(item.url);
    if (!id) {
      if (isYouTubeHost(item.url)) console.log(`Skipping (not a single video): ${safeLog(item.url, 200)}`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, date: safeLog(item.date, 10), title: safeLog(item.title) });
  }
  return candidates;
}

// --- 2. OAuth --------------------------------------------------------------

async function getAccessToken() {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    fail('Missing secrets YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN.');
  }
  const { res, body } = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: YT_CLIENT_ID,
      client_secret: YT_CLIENT_SECRET,
      refresh_token: YT_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok || !body?.access_token) {
    const reason = googleReason(body);
    if (reason === 'invalid_grant') {
      fail(
        'The refresh token has expired or was revoked (invalid_grant). ' +
          'Generate a new one with `node scripts/get-refresh-token.mjs` and update the YT_REFRESH_TOKEN secret. ' +
          'Make sure the OAuth consent screen is "In production", not "Testing".',
      );
    }
    fail(`Could not refresh the access token (HTTP ${res.status}, ${reason}).`);
  }
  return body.access_token;
}

// --- 3. Playlist -----------------------------------------------------------

async function listPlaylistVideoIds(token) {
  const ids = new Set();
  let pageToken = '';
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({
      part: 'contentDetails',
      playlistId: PLAYLIST_ID,
      maxResults: '50',
      fields: 'nextPageToken,items/contentDetails/videoId',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const { res, body } = await http(`${API}/playlistItems?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) fail(`Could not read the playlist (HTTP ${res.status}, ${googleReason(body)}).`);
    for (const it of body?.items || []) {
      const v = it?.contentDetails?.videoId;
      if (v) ids.add(v);
    }
    pageToken = body?.nextPageToken || '';
    if (!pageToken) return ids;
  }
  fail('The playlist has a suspicious number of pages – aborting.');
}

async function insertVideo(token, videoId) {
  const { res, body } = await http(`${API}/playlistItems?part=snippet`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snippet: { playlistId: PLAYLIST_ID, resourceId: { kind: 'youtube#video', videoId } },
    }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, reason: googleReason(body) };
}

// --- main ------------------------------------------------------------------

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(START_DATE)) fail('Invalid START_DATE (expected YYYY-MM-DD).');
  if (!Number.isInteger(MAX_INSERTS) || MAX_INSERTS < 1) fail('MAX_INSERTS must be a positive integer.');

  const candidates = await loadCandidates();
  console.log(`YouTube videos in issues since ${START_DATE}: ${candidates.length}`);

  const hasCreds = env.YT_CLIENT_ID && env.YT_CLIENT_SECRET && env.YT_REFRESH_TOKEN && PLAYLIST_ID;
  if (DRY_RUN && !hasCreds) {
    for (const c of candidates) console.log(`  [dry-run] ${c.date} ${c.id}  ${c.title}`);
    console.log('DRY_RUN without secrets: not checking the playlist, nothing added.');
    return;
  }

  if (!/^[A-Za-z0-9_-]{10,64}$/.test(PLAYLIST_ID)) fail('YT_PLAYLIST_ID is missing or has an invalid format.');
  if (candidates.length === 0) return;

  const token = await getAccessToken();
  const existing = await listPlaylistVideoIds(token);
  const missing = candidates.filter((c) => !existing.has(c.id));
  console.log(`Already on the playlist: ${candidates.length - missing.length}, to add: ${missing.length}`);

  if (missing.length > MAX_INSERTS) {
    fail(
      `${missing.length} videos to add, more than MAX_INSERTS=${MAX_INSERTS}. ` +
        'Check START_DATE, or raise the limit if this is intended.',
    );
  }

  let added = 0;
  let skipped = 0;
  for (const c of missing) {
    if (DRY_RUN) {
      console.log(`  [dry-run] would add ${c.date} ${c.id}  ${c.title}`);
      continue;
    }
    const r = await insertVideo(token, c.id);
    if (r.ok) {
      added++;
      console.log(`  + ${c.date} ${c.id}  ${c.title}`);
    } else if (r.reason === 'quotaExceeded' || r.status === 401) {
      fail(`YouTube API refused (${r.status}, ${r.reason}). Added ${added}; the rest will be added on the next run.`);
    } else {
      // e.g. videoNotFound (deleted) or forbidden (private) – don't block the rest.
      skipped++;
      console.warn(`  ! skipping ${c.id} (${r.status}, ${r.reason})  ${c.title}`);
    }
  }
  console.log(`Done. Added: ${added}, skipped: ${skipped}.`);
}

main().catch((e) => {
  console.error(e instanceof FatalError ? `ERROR: ${e.message}` : `ERROR: ${safeLog(e?.message || e, 300)}`);
  process.exitCode = 1;
});
