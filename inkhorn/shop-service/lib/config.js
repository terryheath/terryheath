'use strict';

const path = require('path');
const env = process.env;

module.exports = {
  port: env.PORT || 3000,
  siteUrl: (env.SITE_URL || 'https://inkhornreview.com').replace(/\/$/, ''),
  corsOrigin: env.CORS_ORIGIN || 'https://inkhornreview.com',
  // Public base URL of the download links (custom domain in production)
  downloadBaseUrl: (env.DOWNLOAD_BASE_URL || 'https://download.inkhornreview.com').replace(/\/$/, ''),

  // SQLite lives on the Railway volume (mounted at DATA_DIR)
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // Signs download links. Required.
  linkSecret: env.LINK_SECRET,
  // Basic-auth password for /admin. /admin is disabled when unset.
  adminPassword: env.ADMIN_PASSWORD,

  // Ebook files: S3 bucket in production; STORAGE_DIR (local folder) for development
  s3Bucket: env.S3_BUCKET,
  storageDir: env.STORAGE_DIR,

  // Mail: SES in production; MAIL_OUTBOX_DIR writes messages to files instead (development)
  mailOutboxDir: env.MAIL_OUTBOX_DIR,
  awsRegion: env.AWS_REGION || 'us-east-2',

  // Ghost Admin API (reads catalog pages for release times)
  ghostUrl: (env.GHOST_URL || '').replace(/\/$/, ''),
  ghostAdminKey: env.GHOST_ADMIN_KEY,

  automaticTax: env.STRIPE_AUTOMATIC_TAX !== 'off',

  linkDays: 30,
  maxDownloads: 5,

  fromOrders: 'Inkhorn Review <orders@inkhornreview.com>',
  fromDelivery: 'Inkhorn Review <hello@inkhornreview.com>',
  replyTo: 'hello@inkhornreview.com',
  staffTo: 'hello@inkhornreview.com',
};
