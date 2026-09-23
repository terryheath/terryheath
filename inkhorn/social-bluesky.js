// inkhorn/social-bluesky.js — post the weekly digest to Bluesky
//
// Required env vars (set in GitHub Actions secrets):
//   BSKY_HANDLE       e.g. inkhornreview.bsky.social
//   BSKY_APP_PASSWORD  app password generated in Bluesky settings

const BSKY_API = 'https://bsky.social/xrpc';

async function bskyFetch(endpoint, { method = 'POST', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BSKY_API}/${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bluesky ${endpoint} failed ${res.status}: ${text}`);
  }

  return res.json();
}

// Byte length of a UTF-8 string (for facet offsets)
function byteLength(str) {
  return Buffer.byteLength(str, 'utf8');
}

// Byte offset of a substring within a string, starting from byteStart
// Returns { start, end } in bytes, or null if not found
function byteOffsets(fullText, searchStr) {
  const idx = fullText.indexOf(searchStr);
  if (idx === -1) return null;
  const before = fullText.slice(0, idx);
  const start  = byteLength(before);
  return { start, end: start + byteLength(searchStr) };
}

export async function postToBluesky({ title, sectionNames, url, featureImageUrl }) {
  const handle   = process.env.BSKY_HANDLE;
  const appPass  = process.env.BSKY_APP_PASSWORD;

  if (!handle || !appPass) {
    throw new Error('BSKY_HANDLE and BSKY_APP_PASSWORD must be set');
  }

  // 1. Auth
  const session = await bskyFetch('com.atproto.server.createSession', {
    body: { identifier: handle, password: appPass },
  });
  const token = session.accessJwt;
  const did   = session.did;

  // 2. Build post text
  // Format: "<title>\n<sections line>\n<url>"
  // Keep under 300 graphemes; truncate the section line first if needed.

  const sectionsLine = sectionNames.join(' · ');
  let text = `${title}\n${sectionsLine}\n${url}`;

  // Grapheme count (Bluesky counts by Unicode grapheme clusters)
  const graphemeCount = (s) => [...new Intl.Segmenter().segment(s)].length;

  const MAX_GRAPHEMES = 300;
  if (graphemeCount(text) > MAX_GRAPHEMES) {
    // Trim the section line
    const fixed    = `${title}\n`;
    const suffix   = `\n${url}`;
    const budget   = MAX_GRAPHEMES - graphemeCount(fixed) - graphemeCount(suffix) - 1; // -1 for ellipsis
    const segs     = [...new Intl.Segmenter().segment(sectionsLine)];
    const trimmed  = segs.slice(0, Math.max(0, budget)).map(s => s.segment).join('');
    text = `${fixed}${trimmed}…${suffix}`;
  }

  // 3. URL facet (byte offsets, not character offsets)
  const offsets = byteOffsets(text, url);
  const facets  = offsets
    ? [
        {
          index:    { byteStart: offsets.start, byteEnd: offsets.end },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
        },
      ]
    : [];

  // 4. Embed (link card with optional thumb)
  let embed = null;
  const externalBase = {
    uri:         url,
    title:       title,
    description: sectionNames.join(' · '),
  };

  if (featureImageUrl) {
    try {
      const imgRes = await fetch(featureImageUrl);
      if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
      const imgBuf  = Buffer.from(await imgRes.arrayBuffer());
      const mime    = imgRes.headers.get('content-type') || 'image/jpeg';

      // Cap at 1 MB (Bluesky limit)
      const blob = imgBuf.length <= 1_000_000 ? imgBuf : imgBuf.slice(0, 1_000_000);

      const uploadRes = await fetch(`${BSKY_API}/com.atproto.repo.uploadBlob`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': mime,
        },
        body: blob,
      });
      if (!uploadRes.ok) {
        const t = await uploadRes.text();
        throw new Error(`uploadBlob failed ${uploadRes.status}: ${t}`);
      }
      const { blob: blobRef } = await uploadRes.json();

      embed = {
        $type:    'app.bsky.embed.external',
        external: { ...externalBase, thumb: blobRef },
      };
    } catch (imgErr) {
      console.warn('Bluesky: could not upload thumbnail, posting without it:', imgErr.message);
      embed = { $type: 'app.bsky.embed.external', external: externalBase };
    }
  } else {
    embed = { $type: 'app.bsky.embed.external', external: externalBase };
  }

  // 5. Create record
  const record = {
    $type:     'app.bsky.feed.post',
    text,
    facets,
    embed,
    createdAt: new Date().toISOString(),
    langs:     ['en'],
  };

  const result = await bskyFetch('com.atproto.repo.createRecord', {
    token,
    body: {
      repo:       did,
      collection: 'app.bsky.feed.post',
      record,
    },
  });

  console.log(`Bluesky post created: ${result.uri} (cid: ${result.cid})`);
  return result;
}
