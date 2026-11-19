#!/usr/bin/env node
// Checks who gets what when a signed agreement takes a subscription in place of payment. Uses the shop service's database code in a temp folder.
const path = require('path'), os = require('os'), fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'comp-'));
process.env.LINK_SECRET = 'x';
const S = require('../shop-service/lib/subscriptions.js');
const ent = (e) => JSON.stringify(S.status(e).entitlements);
// Review contributor: Review Print only
S.grantComp({ email: 'review@x.org', publication: 'review', kind: 'print', ref: 'r1' });
// White Rabbit contributor: White Rabbit Print only
S.grantComp({ email: 'wr@x.org', publication: 'whiterabbit', kind: 'print', ref: 'w1' });
const a = JSON.parse(ent('review@x.org')), b = JSON.parse(ent('wr@x.org'));
const ok = a.review_print && !a.whiterabbit_print && b.whiterabbit_print && !b.review_print;
console.log('review contributor:', ent('review@x.org')); console.log('white rabbit contributor:', ent('wr@x.org'));
console.log(ok ? 'OK: each contributor gets only their own publication\'s Print' : 'FAIL');
process.exit(ok ? 0 : 1);
