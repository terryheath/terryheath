'use strict';

const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const cfg = require('./config');

let s3;

// Returns { stream, size } for a file key, or null if it does not exist.
// Production reads a private S3 bucket; STORAGE_DIR (a local folder) is for development.
async function openFile(key) {
  if (!key || key.includes('..') || key.startsWith('/')) return null;

  if (cfg.storageDir) {
    const file = path.join(cfg.storageDir, key);
    if (!fs.existsSync(file)) return null;
    return { stream: fs.createReadStream(file), size: fs.statSync(file).size };
  }

  if (!cfg.s3Bucket) throw new Error('S3_BUCKET is not set');
  s3 = s3 || new S3Client({ region: cfg.awsRegion });
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: key }));
    return { stream: out.Body, size: out.ContentLength };
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// Checks that a file exists and is readable, without downloading it: { size, modified } or null.
async function headFile(key) {
  if (!key || key.includes('..') || key.startsWith('/')) return null;

  if (cfg.storageDir) {
    const file = path.join(cfg.storageDir, key);
    if (!fs.existsSync(file)) return null;
    const st = fs.statSync(file);
    return { size: st.size, modified: st.mtime };
  }

  if (!cfg.s3Bucket) throw new Error('S3_BUCKET is not set');
  s3 = s3 || new S3Client({ region: cfg.awsRegion });
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: cfg.s3Bucket, Key: key }));
    return { size: out.ContentLength, modified: out.LastModified };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

module.exports = { openFile, headFile };
