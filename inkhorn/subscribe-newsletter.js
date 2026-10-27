#!/usr/bin/env node
/**
 * Subscribe all members with a given label to a newsletter.
 *
 * Usage:
 *   node inkhorn/subscribe-newsletter.js <member-label> <newsletter-slug>
 *
 * Example:
 *   node inkhorn/subscribe-newsletter.js "heath-on-words" "heath-on-words"
 *
 * Credentials come from macOS Keychain automatically.
 * Safe to re-run: members already subscribed are skipped.
 */

const crypto = require('crypto');
const { execSync } = require('child_process');

const [memberLabel, newsletterSlug] = process.argv.slice(2);
if (!memberLabel || !newsletterSlug) {
  console.error('Usage: node inkhorn/subscribe-newsletter.js <member-label> <newsletter-slug>');
  process.exit(1);
}

function getKey(service) {
  return execSync(`security find-generic-password -s "${service}" -w`,
    { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
}

const ADMIN_KEY = getKey('ghost-admin-inkhorn');
const GHOST_URL = getKey('ghost-url-inkhorn').replace(/\/$/, '');
const [kid, hex] = ADMIN_KEY.split(':');

function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
  const s = crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function headers() {
  return { Authorization: `Ghost ${makeToken()}`, 'Content-Type': 'application/json' };
}

async function main() {
  // 1. Find the newsletter by slug
  console.log(`Looking up newsletter: ${newsletterSlug}...`);
  const nr = await fetch(`${GHOST_URL}/ghost/api/admin/newsletters/?limit=all`, { headers: headers() });
  if (!nr.ok) throw new Error(`Failed to fetch newsletters: ${nr.status}`);
  const nd = await nr.json();
  const newsletter = (nd.newsletters || []).find(n => n.slug === newsletterSlug);
  if (!newsletter) {
    const names = (nd.newsletters || []).map(n => `  ${n.name} (${n.slug})`).join('\n');
    throw new Error(`Newsletter "${newsletterSlug}" not found. Available:\n${names}`);
  }
  console.log(`Newsletter: "${newsletter.name}" (id: ${newsletter.id})\n`);

  // 2. Fetch all members with the label, paginated
  let page = 1;
  let total = 0, subscribed = 0, skipped = 0, errors = 0;

  while (true) {
    const params = new URLSearchParams({
      filter: `label:${memberLabel}`,
      fields: 'id,email,name,updated_at',
      include: 'newsletters',
      limit: '100',
      page: String(page),
    });
    const mr = await fetch(`${GHOST_URL}/ghost/api/admin/members/?${params}`, { headers: headers() });
    if (!mr.ok) throw new Error(`Failed to fetch members (page ${page}): ${mr.status} ${await mr.text()}`);
    const md = await mr.json();
    const members = md.members || [];
    if (page === 1) {
      total = md.meta?.pagination?.total ?? members.length;
      console.log(`Found ${total} members with label "${memberLabel}"\n`);
    }
    if (members.length === 0) break;

    // 3. Subscribe each member
    for (const member of members) {
      const already = (member.newsletters || []).some(n => n.id === newsletter.id);
      if (already) {
        console.log(`  SKIP (already subscribed): ${member.email}`);
        skipped++;
        continue;
      }

      const newNewsletters = [...(member.newsletters || []).map(n => ({ id: n.id })), { id: newsletter.id }];
      const ur = await fetch(`${GHOST_URL}/ghost/api/admin/members/${member.id}/`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ members: [{ newsletters: newNewsletters, updated_at: member.updated_at }] }),
      });
      if (!ur.ok) {
        console.log(`  ERROR: ${member.email} — ${ur.status} ${await ur.text()}`);
        errors++;
        continue;
      }
      console.log(`  OK: ${member.email}`);
      subscribed++;
    }

    if (!md.meta?.pagination?.next) break;
    page++;
  }

  console.log(`\nDone. ${subscribed} subscribed, ${skipped} already subscribed, ${errors} errors.`);
  if (errors > 0) process.exit(1);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
