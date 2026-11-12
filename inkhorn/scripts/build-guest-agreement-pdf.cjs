#!/usr/bin/env node
// Builds the Life on Words guest agreement PDF and its field map (same method as build-agreement-pdfs.cjs: DocuSeal's free edition cannot
// create templates through the API, so the PDF is uploaded in the browser and the fields are applied through the editor's save call).
// Output: inkhorn/agreements/guest.pdf and guest.fields.json
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'agreements');
const W = 612, H = 792, L = 64;
const doc = new PDFDocument({ size: 'LETTER', margins: { top: 44, bottom: 44, left: L, right: L } });
doc.pipe(fs.createWriteStream(path.join(out, 'guest.pdf')));
const fields = [];
let page = 0;
doc.on('pageAdded', () => { page++; });
const h = (t) => doc.moveDown(0.35).font("Helvetica-Bold").fontSize(11).text(t).moveDown(0.15).font('Helvetica').fontSize(10);
const p = (t) => doc.font('Helvetica').fontSize(10).text(t, { lineGap: 1.2 }).moveDown(0.4);
const box = (name, type, x, y, w, hh, o = {}) => { doc.save().lineWidth(0.5).strokeColor('#999999').rect(x, y, w, hh).stroke().restore(); fields.push({ name, type, page, x: x / W, y: y / H, w: w / W, h: hh / H, ...o }); };
const line = (label, name, type, w, o = {}) => { const y = doc.y; doc.font('Helvetica').fontSize(10).text(label, L, y, { lineBreak: false }); const x = L + doc.widthOfString(label) + 6; box(name, type, x, y - 3, w, o.h || 17, o); doc.y = y + (o.h || 17) + 8; doc.x = L; };

doc.font('Helvetica-Bold').fontSize(18).text('Life on Words: Guest Agreement').moveDown(0.3);
p('Life on Words is a podcast produced by Follow the Rabbit LLC (the "Producer"), a column of Inkhorn Review. This agreement is between the Producer and the guest named below ("Guest").');
h('1. The recording');
p('Guest agrees to be recorded, in audio and video, in a conversation with the host, Terry Heath, for Life on Words.');
h('2. What the Producer may do');
p('Guest grants the Producer a non-exclusive, worldwide, perpetual, royalty-free license to record, edit, publish, distribute and promote the recording as a Life on Words episode, in whole or in part: (a) as audio and video on podcast and video platforms, including the Riverside feed, YouTube, Apple Podcasts, Spotify and the Producer\'s own websites; (b) as clips, excerpts, transcripts and posts that promote the episode; and (c) as an edited transcript of the conversation in Inkhorn Review, in print and online. Any other use, including any other publication, book or anthology, or licensing to another publisher, requires Guest\'s written permission.');
h('3. Name, likeness and bio');
p('The Producer may use Guest\'s name, voice, likeness and short bio to present and promote the episode.');
h('4. Guest keeps their own work');
p('These rights are non-exclusive. Guest keeps all rights to Guest\'s own work and to anything Guest owns. If Guest reads or quotes their own creative work (a poem, for example), the Producer may include it in the episode and its promotion, and will credit the work and the writer, but will not print it, publish it separately as text, or license it to anyone without Guest\'s written permission. Guest confirms that Guest owns, or has the right to read, anything Guest reads.');
h('5. No payment');
p('Guest is not paid for taking part, and the Producer is not paid by Guest.');
h('6. Editing and publication');
p('The Producer may edit for length and clarity and is not required to publish the episode. If an episode will not be published, the Producer will tell Guest. The Producer will not license the recording to anyone to train AI models.');
h('7. Removal');
p('Within 30 days of the episode\'s release Guest may ask in writing for the online versions to be taken down for a serious reason (for example a factual error or a safety concern). The Producer will consider the request in good faith. Copies already downloaded or in directories may remain for a time.');
h('8. General');
p('The Producer may assign this agreement only to a successor that takes over Life on Words; Guest may not. Washington law governs. This is the whole agreement; changes must be in writing.');
h('Guest');
line('Full name:', 'Full name', 'text', 300);
line('Email:', 'Email', 'text', 300);
line('Short bio (optional):', 'Bio', 'text', 380, { required: false });
line('Website (optional):', 'Website', 'text', 380, { required: false });
{ const y = doc.y + 6; doc.font('Helvetica').fontSize(10).text('Signature:', L, y + 14, { lineBreak: false });
  const x1 = L + doc.widthOfString('Signature:') + 6; box('Signature', 'signature', x1, y, 220, 44);
  const lx = x1 + 236; doc.text('Date:', lx, y + 14, { lineBreak: false }); box('Date', 'date', lx + doc.widthOfString('Date:') + 6, y + 10, 110, 18); }
doc.end();
fs.writeFileSync(path.join(out, 'guest.fields.json'), JSON.stringify(fields, null, 1));
console.log('pages', page + 1, 'fields', fields.length);
