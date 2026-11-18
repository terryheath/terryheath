#!/usr/bin/env node
/**
 * Creates the IAM user that lets listmonk and WordPress send mail through SES (us-east-2) from the inkhorn.press and terryheath.com identities,
 * and prints its SMTP credentials as JSON {username,password}. Needs an AWS CLI session (aws login --profile ftr).
 *   node inkhorn/scripts/ses-smtp-user.cjs [username]
 * SMTP password = SigV4 derivation of the secret key (AWS documents the algorithm).
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const REGION = 'us-east-2', ACCT = '888671692472', NAME = process.argv[2] || 'inkhorn-mail-smtp';
const aws = (a) => execSync(`aws --profile ftr --region ${REGION} ${a}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const hmac = (k, m) => crypto.createHmac('sha256', k).update(m).digest();
function smtpPassword(secret) {
  let sig = hmac('AWS4' + secret, '11111111'); sig = hmac(sig, REGION); sig = hmac(sig, 'ses'); sig = hmac(sig, 'aws4_request'); sig = hmac(sig, 'SendRawEmail');
  return Buffer.concat([Buffer.from([0x04]), sig]).toString('base64');
}
try { aws(`iam get-user --user-name ${NAME}`); } catch { aws(`iam create-user --user-name ${NAME}`); }
const policy = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['ses:SendRawEmail', 'ses:SendEmail'], Resource: [`arn:aws:ses:${REGION}:${ACCT}:identity/inkhorn.press`, `arn:aws:ses:${REGION}:${ACCT}:identity/terryheath.com`] }] };
aws(`iam put-user-policy --user-name ${NAME} --policy-name ses-send-inkhorn-and-terryheath --policy-document '${JSON.stringify(policy)}'`);
const k = JSON.parse(aws(`iam create-access-key --user-name ${NAME}`)).AccessKey;
console.log(JSON.stringify({ username: k.AccessKeyId, password: smtpPassword(k.SecretAccessKey) }));
