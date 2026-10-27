#!/usr/bin/env node
// Wraps a plain-text poem file in a Ghost HTML card that preserves indentation.
//
// Usage:
//   node inkhorn/poem-wrap.js poem.txt
//
// The output goes into a Ghost HTML block:
//   1. In the Ghost editor, type /html to insert an HTML block
//   2. Paste the output
//   3. Delete the old paragraph blocks for the same poem
//
// The .inkhorn-poem class is styled in ghost-footer-injection.html with
// white-space: pre-wrap, which preserves all leading spaces and blank lines.

const fs = require('fs');
const file = process.argv[2];

if (!file) {
  console.error('Usage: node inkhorn/poem-wrap.js <poem.txt>');
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8')
  .replace(/\r\n/g, '\n')  // normalize Windows line endings
  .trimEnd();

const escaped = text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

console.log('<!--kg-card-begin: html-->');
console.log('<div class="inkhorn-poem">');
console.log(escaped);
console.log('</div>');
console.log('<!--kg-card-end: html-->');
