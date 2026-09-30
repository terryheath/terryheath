#!/usr/bin/env node
// inkhorn/scripts/export-mailing-list.js
// Exports active Print members for physical mailing.
//
// Output:
//   mailing-list.csv      — Print members WITH a SHIP block (name, address, email)
//   mailing-list-naddr.csv — Print members WITHOUT an address on file
//
// Usage:
//   GHOST_API_URL=... GHOST_ADMIN_KEY=... node inkhorn/scripts/export-mailing-list.js
//
// Credentials (macOS):
//   GHOST_API_URL=$(security find-generic-password -s "ghost-url-inkhorn" -w)
//   GHOST_ADMIN_KEY=$(security find-generic-password -s "ghost-admin-inkhorn" -w)

import GhostAdminAPI from '@tryghost/admin-api';
import { writeFileSync } from 'fs';

const GHOST_API_URL   = process.env.GHOST_API_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;

if (!GHOST_API_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_API_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

const api = new GhostAdminAPI({
  url:     GHOST_API_URL,
  key:     GHOST_ADMIN_KEY,
  version: 'v5.0',
});

// Parses the SHIP block written by the address service.
// Format: SHIP:{"name":"...","addr1":"...","addr2":"...","city":"...","state":"...","zip":"...","country":"..."}
function parseShipBlock(note) {
  if (!note) return null;
  const m = note.match(/SHIP:(\{[^}]+\})/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function csvRow(values) {
  return values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}

async function main() {
  console.log('Fetching active Print members…');

  // Fetch all members with the Print tier — paginate
  const allMembers = [];
  let page = 1;
  while (true) {
    const batch = await api.members.browse({
      filter: 'subscriptions.tier.slug:print+subscriptions.status:active',
      limit:  250,
      page,
      fields: 'id,name,email,note,labels',
    });
    allMembers.push(...batch);
    if (batch.length < 250) break;
    page++;
  }

  console.log(`Found ${allMembers.length} active Print members.`);

  const withAddr    = [];
  const withoutAddr = [];

  for (const m of allMembers) {
    const ship = parseShipBlock(m.note);
    if (ship) {
      withAddr.push({ name: ship.name || m.name, email: m.email, ...ship });
    } else {
      withoutAddr.push({ name: m.name, email: m.email });
    }
  }

  // Write mailing list (with addresses)
  const addrHeader = csvRow(['name', 'addr1', 'addr2', 'city', 'state', 'zip', 'country', 'email']);
  const addrRows = withAddr.map(r =>
    csvRow([r.name, r.addr1, r.addr2, r.city, r.state, r.zip, r.country, r.email])
  );
  writeFileSync('mailing-list.csv', [addrHeader, ...addrRows].join('\n') + '\n');
  console.log(`\nmailing-list.csv: ${withAddr.length} members with addresses`);

  // Write no-address list
  const naddrHeader = csvRow(['name', 'email']);
  const naddrRows = withoutAddr.map(r => csvRow([r.name, r.email]));
  writeFileSync('mailing-list-naddr.csv', [naddrHeader, ...naddrRows].join('\n') + '\n');
  console.log(`mailing-list-naddr.csv: ${withoutAddr.length} members without addresses`);
}

main().catch(err => { console.error(err); process.exit(1); });
