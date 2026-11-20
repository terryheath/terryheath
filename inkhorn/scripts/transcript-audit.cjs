#!/usr/bin/env node
/**
 * Life on Words transcripts: (1) where the new site's transcript differs from the one on the current Ghost site, use Ghost's (--apply);
 * (2) check each against the final audio as far as it can be checked without listening: the host's own transcript of the published audio
 * (the feed's podcast:transcript), the audio length, and the Topics & Timestamps. Reports; never edits a transcript by hand.
 *   node inkhorn/scripts/transcript-audit.cjs [--apply]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const WP = (process.env.WP_URL || 'https://wordpress-production-754b3e08.up.railway.app').replace(/\/$/, '');
const TOKEN = process.env.INKHORN_IMPORT_TOKEN || execSync('security find-generic-password -s inkhorn-wp-import-token -w').toString().trim();
const APPLY = process.argv.includes('--apply');
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } };
const dec = (s) => s.replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&#8230;/g, '…').replace(/&#038;|&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
const plain = (h) => dec(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const blockOf = (html) => { const m = html.match(/<details class="lw-transcript">([\s\S]*?)<\/details>/); return m ? m[1] : ''; };
const words = (s) => norm(s).split(' ').filter(Boolean);
(async () => {
  const eps = await (await fetch(WP + '/lifeonwords/wp-json/wp/v2/ih_episode?per_page=100&_fields=slug,title,content,meta')).json();
  const feed = await (await fetch('https://api.riverside.com/hosting/V48At7Hk.rss')).text();
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const rows = [];
  for (const ep of eps.sort((a, b) => (a.meta.ih_number || 0) - (b.meta.ih_number || 0))) {
    const row = { n: ep.meta.ih_number, slug: ep.slug, title: plain(ep.title.rendered) };
    const wpT = blockOf(ep.content.rendered); const wpText = plain(wpT.replace(/<summary>[\s\S]*?<\/summary>/, ''));
    row.wpWords = words(wpText).length;
    // current Ghost
    let ghostHtml = '', ghostText = '';
    const g = await fetch(`https://terryheath.com/podcast/${ep.slug}/`, UA);
    if (g.ok) { const t = await g.text(); const b = blockOf(t); ghostHtml = b; ghostText = plain(b.replace(/<summary>[\s\S]*?<\/summary>/, '')); }
    row.ghostWords = ghostText ? words(ghostText).length : null;
    row.differsFromGhost = ghostText ? norm(ghostText) !== norm(wpText) : 'no Ghost page';
    if (APPLY && ghostText && row.differsFromGhost === true) {
      const r = await fetch(WP + '/wp-json/inkhorn/v1/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': TOKEN }, body: JSON.stringify({ site: 'lifeonwords', action: 'set_transcript', slug: ep.slug, html: `<details class="lw-transcript">${ghostHtml}</details>` }) });
      row.applied = r.status;
    }
    // final audio: the host's transcript of the published audio
    const item = items.find((x) => new RegExp(`<itunes:episode>${ep.meta.ih_number}</itunes:episode>`).test(x));
    if (item) {
      const dur = (item.match(/<itunes:duration>([\d:]+)</) || [])[1]; const [h, m, s] = dur.split(':').map(Number); row.audioMin = +(h * 60 + m + s / 60).toFixed(1);
      const turl = (item.match(/<podcast:transcript url="([^"]+)"/) || [])[1];
      if (turl) {
        const raw = await (await fetch(turl)).text(); const rw = words(raw); row.audioTranscriptWords = rw.length;
        const use = ghostText || wpText; const uw = words(use);
        const set = new Set(); for (let i = 0; i + 6 <= rw.length; i++) set.add(rw.slice(i, i + 6).join(' '));
        // runs of the site transcript that the audio's transcript does not contain
        let miss = [], run = 0, start = 0;
        for (let i = 0; i + 6 <= uw.length; i++) { const hit = set.has(uw.slice(i, i + 6).join(' ')); if (!hit) { if (!run) start = i; run++; } else { if (run >= 30) miss.push([start, start + run + 5]); run = 0; } }
        if (run >= 30) miss.push([start, start + run + 5]);
        row.notInAudio = miss.map(([a, b]) => ({ words: b - a, at: Math.round((a / uw.length) * 100) + '%', sample: uw.slice(a, a + 14).join(' ') }));
        const set2 = new Set(); for (let i = 0; i + 6 <= uw.length; i++) set2.add(uw.slice(i, i + 6).join(' '));
        let miss2 = [], r2 = 0, s2 = 0;
        for (let i = 0; i + 6 <= rw.length; i++) { const hit = set2.has(rw.slice(i, i + 6).join(' ')); if (!hit) { if (!r2) s2 = i; r2++; } else { if (r2 >= 30) miss2.push([s2, s2 + r2 + 5]); r2 = 0; } }
        if (r2 >= 30) miss2.push([s2, s2 + r2 + 5]);
        row.inAudioNotInSite = miss2.map(([a, b]) => ({ words: b - a, at: Math.round((a / rw.length) * 100) + '%', sample: rw.slice(a, a + 14).join(' ') }));
        row.wordsPerMin = Math.round(uw.length / row.audioMin);
      }
      // timestamps past the audio
      const stamps = [...ep.content.rendered.matchAll(/<p>\((\d{1,2}):(\d{2})(?::(\d{2}))?\)/g)].map((x) => (x[3] ? +x[1] * 60 + +x[2] + x[3] / 60 : +x[1] + x[2] / 60));
      row.lastStamp = stamps.length ? +Math.max(...stamps).toFixed(1) : null;
      row.stampPastAudio = row.lastStamp !== null && row.lastStamp > row.audioMin;
    }
    rows.push(row);
  }
  fs.writeFileSync(process.argv.find((a) => a.endsWith('.json')) || '/dev/stdout', JSON.stringify(rows, null, 1));
})();
