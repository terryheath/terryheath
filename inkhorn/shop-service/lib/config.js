'use strict';

const path = require('path');
const env = process.env;

module.exports = {
  port: env.PORT || 3000,
  siteUrl: (env.SITE_URL || 'https://inkhorn.press').replace(/\/$/, ''),
  corsOrigin: env.CORS_ORIGIN || 'https://inkhorn.press',
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

  // How long product and catalog lookups are cached (milliseconds)
  cacheMs: Number(env.CATALOG_TTL_MS) || 5 * 60 * 1000,

  linkDays: 30,
  maxDownloads: 5,

  // ONE sender for everything a buyer receives (order confirmation and ebook links). SES allows this IAM user to send only from the inkhornreview.com
  // identity; to move to hello@inkhorn.press, widen that policy in AWS and set SHOP_FROM='Inkhorn Press <hello@inkhorn.press>' in Railway.
  fromOrders: env.SHOP_FROM || 'Inkhorn Review <hello@inkhornreview.com>',
  fromDelivery: env.SHOP_FROM || 'Inkhorn Review <hello@inkhornreview.com>',
  replyTo: env.SHOP_REPLY_TO || 'hello@inkhorn.press', // replies go to the address on the site, which reaches Terry
  staffTo: env.SHOP_STAFF_TO || 'hello@terryheath.com',
};
