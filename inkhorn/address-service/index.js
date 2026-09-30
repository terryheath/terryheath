// inkhorn/address-service/index.js
// Railway service: shipping address capture for Print members.
//
// Routes:
//   POST /address        — save or update shipping address for the signed-in member
//   GET  /address/status — return whether the signed-in member has an address on file
//
// Authentication: Ghost member identity token (JWT) from /members/api/session.
// The client sends the token in Authorization: Bearer <token>.
// This service verifies it against Ghost's JWKS and takes the email ONLY from
// the verified token — never trusts an email sent by the client.
//
// Environment variables (Railway):
//   GHOST_URL        — https://inkhornreview.com
//   GHOST_ADMIN_KEY  — kid:hex  (Admin API key, kept server-side only)
//   PORT             — set by Railway automatically
//
// Address is stored in the member's Ghost note field as:
//   SHIP:{"name":"...","addr1":"...","addr2":"...","city":"...","state":"...","zip":"...","country":"US"}
// Any other note content before/after the SHIP block is preserved.
// The label "address-on-file" is added to the member when an address is saved.

import { createServer } from 'http';
import { createHmac } from 'crypto';
import { importJWK, jwtVerify } from 'jose';

const GHOST_URL       = process.env.GHOST_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;
const PORT            = parseInt(process.env.PORT || '3000');
const JWKS_URL        = `${GHOST_URL}/members/.well-known/jwks.json`;
const ADMIN_URL       = `${GHOST_URL}/ghost/api/admin`;

if (!GHOST_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

// ── Ghost Admin JWT ───────────────────────────────────────────────────────────

function buildAdminJWT() {
  const [kid, secret] = GHOST_ADMIN_KEY.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 300;
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, iat, aud: '/admin/' })).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function adminFetch(path, opts = {}) {
  const resp = await fetch(`${ADMIN_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Ghost ${buildAdminJWT()}`,
      ...(opts.headers || {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Admin API ${path} → ${resp.status}: ${body}`);
  }
  return resp.json();
}

// ── Ghost member JWKS verification ───────────────────────────────────────────

let jwksCache = null;
let jwksCachedAt = 0;

async function getJwks() {
  if (jwksCache && Date.now() - jwksCachedAt < 3600000) return jwksCache;
  const resp = await fetch(JWKS_URL);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  jwksCache = await resp.json();
  jwksCachedAt = Date.now();
  return jwksCache;
}

async function verifyMemberToken(token) {
  const jwks = await getJwks();
  // Try each key in the JWKS until one verifies
  for (const keyData of (jwks.keys || [])) {
    try {
      const key = await importJWK(keyData);
      const { payload } = await jwtVerify(token, key, { audience: GHOST_URL });
      if (!payload.sub) throw new Error('No sub in token');
      return payload.sub; // email address
    } catch {
      // Try next key
    }
  }
  throw new Error('Token verification failed');
}

// ── Member lookup / update ────────────────────────────────────────────────────

async function getMember(email) {
  const data = await adminFetch(`/members/?filter=${encodeURIComponent('email:' + email)}&limit=1&fields=id,name,email,note,labels`);
  const member = data.members?.[0];
  if (!member) throw new Error(`Member not found: ${email}`);
  return member;
}

function buildNote(existingNote, ship) {
  const shipJson = JSON.stringify(ship);
  const shipBlock = `SHIP:${shipJson}`;
  if (!existingNote) return shipBlock;
  // Replace existing SHIP block, or append
  if (/SHIP:\{[^}]+\}/.test(existingNote)) {
    return existingNote.replace(/SHIP:\{[^}]+\}/, shipBlock);
  }
  return existingNote.trimEnd() + '\n' + shipBlock;
}

async function saveMemberAddress(member, ship) {
  const note = buildNote(member.note || '', ship);
  const existingLabels = (member.labels || []).map(l => ({ name: l.name }));
  const hasLabel = existingLabels.some(l => l.name === 'address-on-file');
  const labels = hasLabel ? existingLabels : [...existingLabels, { name: 'address-on-file' }];
  await adminFetch(`/members/${member.id}/`, {
    method: 'PUT',
    body: JSON.stringify({ members: [{ note, labels }] }),
  });
}

function hasShipBlock(note) {
  return /SHIP:\{[^}]+\}/.test(note || '');
}

// ── Request handling ──────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 8192) reject(new Error('Body too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function cors(res, req) {
  const origin = req.headers.origin || '';
  // Allow inkhornreview.com only
  if (/^https?:\/\/(www\.)?inkhornreview\.com$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

const server = createServer(async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost`);

  try {
    // Verify token on every request
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return json(res, 401, { error: 'Missing token' });

    const email = await verifyMemberToken(token);

    // GET /address/status
    if (req.method === 'GET' && url.pathname === '/address/status') {
      const member = await getMember(email);
      return json(res, 200, { hasAddress: hasShipBlock(member.note) });
    }

    // POST /address
    if (req.method === 'POST' && url.pathname === '/address') {
      const body = await readBody(req);
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

      const { name, addr1, addr2, city, state, zip, country } = data;
      if (!name || !addr1 || !city || !state || !zip) {
        return json(res, 400, { error: 'Missing required fields: name, addr1, city, state, zip' });
      }
      if ((country || 'US') !== 'US') {
        return json(res, 400, { error: 'U.S. addresses only' });
      }

      const ship = { name, addr1, addr2: addr2 || '', city, state, zip, country: 'US' };
      const member = await getMember(email);
      await saveMemberAddress(member, ship);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    if (err.message?.includes('Token verification')) return json(res, 401, { error: 'Invalid token' });
    return json(res, 500, { error: 'Internal error' });
  }
});

server.listen(PORT, () => console.log(`Address service listening on port ${PORT}`));
