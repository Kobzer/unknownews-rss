import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId, isYouTubeHost, safeLog } from './youtube-url.mjs';

const ID = 'wKczvgwwFRA';

test('recognizes common link formats', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=120s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=30`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  https://www.YouTube.com/watch?v=${ID}  `,
    `https://www.youtube.com/watch?v=${ID}&list=PL123`,
  ]) {
    assert.equal(extractVideoId(url), ID, url);
  }
});

test('rejects links that are not a single video', () => {
  for (const url of [
    'https://www.youtube.com/playlist?list=PLxyz',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/channel/UC1234567890',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=too_short',
    'https://www.youtube.com/watch?v=wKczvgwwFRA%22%3E',
    'https://youtu.be/',
  ]) {
    assert.equal(extractVideoId(url), null, url);
  }
});

test('rejects foreign hosts and unexpected schemes', () => {
  for (const url of [
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/?u=https://youtube.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtu.be.evil.example/${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    `ftp://youtube.com/watch?v=${ID}`,
    '',
    null,
    'not a link',
  ]) {
    assert.equal(extractVideoId(url), null, String(url));
  }
});

test('isYouTubeHost', () => {
  assert.equal(isYouTubeHost('https://www.youtube.com/playlist?list=PL1'), true);
  assert.equal(isYouTubeHost('https://youtube.com.evil.example/'), false);
  assert.equal(isYouTubeHost('bad link'), false);
});

test('safeLog blocks workflow-command injection', () => {
  const out = safeLog('Nice video\n::add-mask::x\r\n::error::pwned');
  assert.ok(!/[\r\n]/.test(out));
  assert.ok(!out.includes('::'));
  assert.equal(safeLog('a'.repeat(500)).length, 120);
  assert.equal(safeLog(null), '');
});
