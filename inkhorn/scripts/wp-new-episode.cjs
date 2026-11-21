#!/usr/bin/env node
/** Publishes the newest Life on Words episode on the new site from the podcast host's feed (audio, notes, timestamps, transcript). Not added to Ghost. Idempotent. */
const { execSync } = require('child_process');
const WP = (process.env.WP_URL || 'https://inkhorn.press').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const FEED = 'https://api.riverside.com/hosting/V48At7Hk.rss';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&');
(async () => {
  const xml = await (await fetch(FEED)).text();
  const it = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]).find((x) => /<itunes:episode>12<\/itunes:episode>/.test(x));
  if (!it) throw new Error('episode 12 not in the feed');
  const g = (tag) => ((it.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)) || [])[1] || '').trim();
  const title = unesc(g('title')), desc = g('description'), guid = g('guid'), pub = g('pubDate'), dur = g('itunes:duration');
  const audio = (it.match(/<enclosure url="([^"]+)"/) || [])[1];
  const tUrl = (it.match(/<podcast:transcript url="([^"]+)"/) || [])[1];
  const paras = [...desc.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  const ti = paras.findIndex((p) => /Topics (&amp;|&) Timestamps/.test(p));
  const notes = paras.slice(0, ti), toc = paras.slice(ti + 1);
  const raw = await (await fetch(tUrl)).text();
  const transcript = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => { const m = b.match(/^([^:\n]{2,40}):\s*([\s\S]*)$/); return m ? `<p><strong>${esc(m[1])}:</strong> ${esc(m[2].replace(/\s*\n\s*/g, ' '))}</p>` : `<p>${esc(b)}</p>`; });
  const [h, m, s] = dur.split(':').map(Number); const mins = h * 60 + m + (s >= 30 ? 1 : 0);
  const content = `<figure class="kg-card kg-audio-card">\n<audio src="${audio}" controls="" preload="metadata" style="width:100%"></audio><br />\n</figure>\n${notes.map((p) => `<p>${p}</p>`).join('\n')}\n<details class="lw-toc">\n<summary>Topics &amp; Timestamps</summary>\n${toc.map((p) => `<p>${p}</p>`).join('\n')}\n</details>\n<details class="lw-transcript">\n<summary>Transcript</summary>\n${transcript.join('\n')}\n</details>\n`;
  const body = { site: 'lifeonwords', type: 'ih_episode', slug: 'draconianly-picky-agent-adria-goetz-on-the-other-side-of-the-query', title, content, status: 'publish', date: new Date(pub).toISOString(), guest_name: 'Adria Goetz',
    meta: { ih_number: 12, ih_guid: guid, ih_duration: `${mins} min`, ih_audio_url: audio } };
  const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify(body) });
  console.log(r.status, (await r.text()).slice(0, 200), '| notes', notes.length, 'timestamps', toc.length, 'transcript paragraphs', transcript.length, 'minutes', mins);
})();
