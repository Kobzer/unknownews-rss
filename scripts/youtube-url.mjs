// Extracts a YouTube video ID from a link. Data from archiwum.json is treated as
// untrusted: only known hosts and strictly formatted IDs are accepted.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const PATH_PREFIXES = ['shorts', 'live', 'embed', 'v', 'e'];

/** @returns {string|null} 11-character video ID, or null */
export function extractVideoId(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();

  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (YT_HOSTS.has(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') {
      id = u.searchParams.get('v');
    } else if (PATH_PREFIXES.includes(parts[0])) {
      id = parts[1];
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Whether the link points to YouTube at all (used to log skipped playlists/channels). */
export function isYouTubeHost(raw) {
  try {
    const host = new URL(String(raw || '').trim()).hostname.toLowerCase();
    return host === 'youtu.be' || YT_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Makes untrusted text safe to print in a public GitHub Actions log:
 * a single line with no control characters, so it cannot start a new line
 * with a "::workflow-command::".
 */
export function safeLog(raw, maxLen = 120) {
  let out = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.codePointAt(0);
    const isControl = c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
    out += isControl ? ' ' : ch;
  }
  return out.replace(/::/g, ': :').slice(0, maxLen);
}
