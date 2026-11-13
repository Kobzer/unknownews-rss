// One-time Google sign-in to obtain a refresh token for GitHub Actions.
// Run locally:  node scripts/get-refresh-token.mjs
//
// - Uses an OAuth client of type "Desktop app" (Google Cloud Console → Credentials).
// - Redirects to http://127.0.0.1:<random port>, with PKCE and a state parameter.
// - Nothing is written to disk. The token is printed once – paste it into
//   GitHub → Settings → Secrets and variables → Actions → YT_REFRESH_TOKEN
//   and do not store it anywhere else.

import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const SCOPE = 'https://www.googleapis.com/auth/youtube';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const LOGIN_TIMEOUT_MS = 5 * 60_000;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Do not echo typed characters.
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // no opener available – the user opens the link manually
    child.unref();
  } catch {
    /* the user opens the link manually */
  }
}

// Starts a local server bound to 127.0.0.1 only and waits for a single redirect from Google.
async function startCallbackServer(state) {
  let resolveCode, rejectCode;
  const code = new Promise((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }
    const finish = (msg, err, value) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg);
      clearTimeout(timer);
      server.close();
      err ? rejectCode(err) : resolveCode(value);
    };
    if (u.searchParams.get('state') !== state) return finish('Invalid state.', new Error('State mismatch – aborting.'));
    if (u.searchParams.get('error')) return finish('Sign-in cancelled.', new Error('Google returned an error; sign-in was not completed.'));
    const value = u.searchParams.get('code');
    if (!value) return finish('Missing code.', new Error('Missing authorization code.'));
    finish('Done – you can close this tab and return to the terminal.', null, value);
  });

  const timer = setTimeout(() => {
    server.close();
    rejectCode(new Error('Sign-in timed out (5 min).'));
  }, LOGIN_TIMEOUT_MS);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { code, redirectUri: `http://127.0.0.1:${server.address().port}` };
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  return { res, body: await res.json().catch(() => null) };
}

async function apiGet(path, token) {
  const res = await fetch(`${API}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok ? res.json() : null;
}

async function main() {
  console.log('Paste the credentials of your "Desktop app" OAuth client from Google Cloud Console.\n');
  const clientId = process.env.YT_CLIENT_ID || (await ask('Client ID: '));
  const clientSecret = process.env.YT_CLIENT_SECRET || (await ask('Client secret (hidden): ', { hidden: true }));
  if (!clientId.endsWith('.apps.googleusercontent.com') || !clientSecret) {
    throw new Error('The Client ID should end with .apps.googleusercontent.com and the secret must not be empty.');
  }

  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

  const { code: codePromise, redirectUri } = await startCallbackServer(state);

  const authUrl = `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })}`;

  console.log('\nOpening the browser. Sign in with the account that owns the playlist.');
  console.log('If the browser did not open, visit this URL manually:\n' + authUrl + '\n');
  openBrowser(authUrl);

  const code = await codePromise;
  const { res, body } = await postForm(TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!res.ok || !body?.refresh_token) {
    throw new Error(`No refresh token received (HTTP ${res.status}, ${body?.error || 'missing refresh_token'}).`);
  }

  const channel = await apiGet('channels?part=snippet&mine=true', body.access_token);
  const playlists = await apiGet('playlists?part=snippet,status&mine=true&maxResults=50', body.access_token);

  console.log(`\nSigned in as channel: ${channel?.items?.[0]?.snippet?.title ?? '(this account has no YouTube channel!)'}`);
  if (playlists?.items?.length) {
    console.log('\nYour playlists (ID → title, visibility):');
    for (const p of playlists.items) console.log(`  ${p.id}  →  ${p.snippet.title}  (${p.status?.privacyStatus})`);
  } else {
    console.log('\nThis account has no playlists yet – create one on YouTube and copy its ID from the URL (?list=...).');
  }

  console.log('\n=== YT_REFRESH_TOKEN (paste into GitHub Secrets, do not store it anywhere else) ===');
  console.log(body.refresh_token);
  console.log('===================================================================================\n');
  console.log('After pasting it, clear the terminal (Cmd+K) so the token does not stay in the scrollback.');
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exitCode = 1;
});
