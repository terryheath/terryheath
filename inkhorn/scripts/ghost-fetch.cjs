#!/usr/bin/env node
// Authenticated GET against the Inkhorn Ghost Admin API. Usage: node ghost-fetch.cjs <path> <outfile>
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const getKey = (s) => execSync(`security find-generic-password -s "${s}" -w`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
const url = getKey('ghost-url-inkhorn');
const [id, secret] = getKey('ghost-admin-inkhorn').split(':');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const input = `${b64({ alg: 'HS256', kid: id, typ: 'JWT' })}.${b64({ iat: now, exp: now + 300, aud: '/admin/' })}`;
const jwt = `${input}.${crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(input).digest('base64url')}`;
fetch(url + process.argv[2], { headers: { Authorization: `Ghost ${jwt}` } }).then(async (r) => {
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(r.status, buf.length);
  if (r.ok) fs.writeFileSync(process.argv[3], buf);
});
