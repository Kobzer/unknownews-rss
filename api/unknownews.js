export default async function handler(req, res) {
  try {
    const jsonUrl = 'https://unknow.news/archiwum.json';
    const r = await fetch(jsonUrl);
    if (!r.ok) {
      res.status(502).send('Upstream fetch failed');
      return;
    }
    const data = await r.json();
    const items = Array.isArray(data) ? data.slice(0, 50) : [];
    const now = new Date();
    const chTitle = 'UnknowNews (archiwum.json) RSS';
    const chLink = 'https://unknow.news/';
    const chDesc = 'Automatycznie wygenerowany RSS z archiwum.json';

    const itemXml = items.map(item => {
        const title = esc(item.title || '');
        const link = esc(item.url || '');
        const desc = item.info || '';
        const pub = toRfc2822(item.date || '');
      return `<item>
  <title>${title}</title>
  <link>${link}</link>
  <guid isPermaLink="false">${link}</guid>
  <description><![CDATA[${desc}]]></description>
  <pubDate>${pub}</pubDate>
</item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(chTitle)}</title>
    <link>${esc(chLink)}</link>
    <description>${esc(chDesc)}</description>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
    ${itemXml}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    // cache on Vercel edge / CDN for 5 minutes, allow stale while revalidate
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).send(xml);
  } catch (e) {
    console.error(e);
    res.status(500).send('Internal server error');
  }
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function toRfc2822(d) {
  if (!d) return new Date().toUTCString();
  const dd = new Date(d);
  if (isNaN(dd)) return new Date().toUTCString();
  return dd.toUTCString();
}
