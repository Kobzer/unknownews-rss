# unknownews-rss

1. **RSS** – `api/unknownews.js` (Vercel) turns `https://unknow.news/archiwum.json` into an RSS feed: https://unknownews-rss.vercel.app/api/unknownews
2. **YouTube playlist** – a GitHub Actions workflow adds YouTube videos from new unknowNews issues to a playlist every day.

## YouTube playlist – how it works

- `.github/workflows/yt-playlist.yml` runs automatically every day at 16:00 Polish time on GitHub's servers (or manually: **Actions → Run workflow**).
- `scripts/yt-sync.mjs` fetches the archive, takes entries dated `>= START_DATE`, extracts YouTube video IDs, compares them with the playlist and adds the missing ones. It keeps no state, so re-running never creates duplicates.
- Links to playlists and channels are skipped; only single videos are added.
- A `MAX_INSERTS` safety limit (default 60) stops the run if a suspiciously large number of videos would be added.

## Setup (one time)

1. **Account and playlist.** A separate Google account or Brand Account just for this playlist is recommended (see *Security*). Create the playlist as *Unlisted* and copy its ID from the URL (`...?list=PL...`).
2. **Google Cloud** (https://console.cloud.google.com), ideally in a new, dedicated project:
   - *APIs & Services → Library* → enable **YouTube Data API v3** (nothing else).
   - *OAuth consent screen* → type **External**, add the `.../auth/youtube` scope, then **Publish app** (status **In production**). In *Testing* mode the refresh token expires after 7 days. Google verification is not needed for personal use; when signing in click *Advanced → Go to … (unsafe)*.
   - *Credentials → Create credentials → OAuth client ID* → type **Desktop app**.
3. **Refresh token** – run locally in the repo directory:
   ```bash
   node scripts/get-refresh-token.mjs
   ```
   It asks for the Client ID and secret, opens the browser and, after sign-in, prints the channel name, your playlists (with IDs) and the refresh token.
4. **GitHub → Settings → Secrets and variables → Actions**
   - *Secrets*: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`
   - *Variables*: `YT_PLAYLIST_ID`, optionally `START_DATE` (YYYY-MM-DD, default `2026-11-13`)
5. **Actions → unknowNews → YouTube playlist → Run workflow** – first with *dry run* checked, then without.

## Security

- Google has no "playlist only" permission. The `youtube` scope can manage the whole YouTube channel of that account, which is why a separate account is recommended. It does not grant access to Gmail, Drive or other Google services.
- Secrets live only in GitHub Secrets – not in the code and not on Vercel; GitHub masks them in logs. The workflow does not run on pull requests, so code from forks never sees the secrets.
- Actions logs of a public repo are public. The scripts never print secrets or the playlist ID, and upstream text is sanitized before logging (no workflow-command injection).
- No npm dependencies; GitHub Actions are pinned to commit SHAs; `GITHUB_TOKEN` has minimal permissions.
- Archive data is treated as untrusted: only YouTube hosts and IDs matching `[A-Za-z0-9_-]{11}` are accepted.
- Enable 2FA on GitHub and on the Google account.
- **Revoking access:** https://myaccount.google.com/permissions → remove the app, or delete the OAuth client in Google Cloud. Then delete the secrets from GitHub.

## Troubleshooting

- `invalid_grant` in the logs means the token expired or was revoked (e.g. the app was in *Testing* mode, the account password was changed, or the token was unused for 6 months). Run `get-refresh-token.mjs` again and update the secret. GitHub emails you on every failed run.
- GitHub disables schedules in public repos after 60 days without activity. The `keepalive` job re-enables the workflow once a month; if it still gets disabled, re-enable it in the Actions tab.
- Scheduled runs can start a few minutes late when GitHub is under load.
