// Notices to Terry (unsigned-agreement lists, "no pieces left", stuck sends, Life on Words notices) go through SES SMTP with a clear sender and a subject label,
// so they never look like Ghost test emails. Needs SMTP_USERNAME / SMTP_PASSWORD (the same SES SMTP user the podcast service uses); callers fall back to
// Ghost's email preview when those are not set.
const available = () => !!(process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD);
let transport = null;
async function sendNotice({ to = process.env.NOTICE_EMAIL || 'hello@terryheath.com', subject, html, text, label = 'Inkhorn alert', from = 'Inkhorn alerts <hello@terryheath.com>' }) {
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'email-smtp.us-east-2.amazonaws.com', port: 587, secure: false, auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } });
  }
  await transport.sendMail({ from, replyTo: 'hello@terryheath.com', to, subject: `[${label}] ${subject}`, html, text });
}
module.exports = { available, sendNotice };
