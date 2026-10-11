'use strict';

const fs = require('fs');
const path = require('path');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const cfg = require('./config');

const ses = new SESClient({ region: cfg.awsRegion });

// Every shop email carries Reply-To hello@inkhornreview.com.
async function sendEmail({ from, to, subject, body }) {
  if (cfg.mailOutboxDir) {
    fs.mkdirSync(cfg.mailOutboxDir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
    fs.writeFileSync(path.join(cfg.mailOutboxDir, name), JSON.stringify({ from, to, replyTo: cfg.replyTo, subject, body }, null, 2));
    return;
  }
  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: [cfg.replyTo],
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Text: { Data: body, Charset: 'UTF-8' } },
    },
  }));
}

module.exports = { sendEmail };
