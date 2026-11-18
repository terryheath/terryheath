#!/usr/bin/env node
/** Points listmonk at SES (us-east-2) and sets the sender, unsubscribe headers and root URL. Keychain: inkhorn-mail-smtp-user / -pass. */
const { execSync } = require('child_process');
const LM = require('../listmonk.cjs');
const kc = (s) => execSync(`security find-generic-password -s ${s} -w`).toString().trim();
(async () => {
  const s = await LM.api('GET', '/settings');
  s['app.from_email'] = 'Inkhorn Press <hello@inkhorn.press>';
  s['app.root_url'] = process.env.LISTMONK_URL || 'https://listmonk-production-b3fcccbe.up.railway.app';
  s['app.batch_size'] = 100; s['app.concurrency'] = 2; s['app.message_rate'] = 5;
  s['privacy.unsubscribe_header'] = true; s['privacy.allow_blocklist'] = false; s['privacy.allow_preferences'] = false; s['privacy.allow_export'] = false; s['privacy.allow_wipe'] = false; s['privacy.individual_tracking'] = true;
  s.smtp = [{ uuid: (s.smtp && s.smtp[0] && s.smtp[0].uuid) || undefined, enabled: true, host: 'email-smtp.us-east-2.amazonaws.com', port: 587, auth_protocol: 'login', username: kc('inkhorn-mail-smtp-user'), password: kc('inkhorn-mail-smtp-pass'), hello_hostname: '', max_conns: 5, idle_timeout: '15s', wait_timeout: '5s', max_msg_retries: 2, tls_type: 'STARTTLS', tls_skip_verify: false, email_headers: [] }];
  await LM.api('PUT', '/settings', s);
  console.log('listmonk settings saved (it restarts for a few seconds)');
})().catch((e) => { console.error(e.message); process.exit(1); });
