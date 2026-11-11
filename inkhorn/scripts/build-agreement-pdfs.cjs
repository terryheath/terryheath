#!/usr/bin/env node
// Builds the two Inkhorn contributor agreement PDFs plus a fields JSON (box positions, normalized 0-1)
// that docuseal-setup.cjs applies to the uploaded DocuSeal templates.
// Output: inkhorn/agreements/{paid,unpaid}.pdf and {paid,unpaid}.fields.json
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'agreements');
const W = 612, H = 792;

function build(paid, published) {
  const key = published ? 'published-paid' : paid ? 'paid' : 'unpaid';
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 60, left: 64, right: 64 } });
  doc.pipe(fs.createWriteStream(path.join(out, key + '.pdf')));
  const fields = [];
  let page = 0;
  doc.on('pageAdded', () => { page++; });
  const L = 64;
  const h = (t) => doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(t).moveDown(0.2).font('Helvetica').fontSize(10.5);
  const p = (t) => doc.font('Helvetica').fontSize(10.5).text(t, { lineGap: 2 }).moveDown(0.5);
  const box = (name, type, x, y, w, h2, o = {}) => {
    doc.save().lineWidth(0.5).strokeColor('#999999').rect(x, y, w, h2).stroke().restore();
    fields.push({ name, type, page, x: x / W, y: y / H, w: w / W, h: h2 / H, ...o });
  };
  // label then inline box on the same line
  const line = (label, name, type, w, o = {}) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10.5).text(label, L, y, { lineBreak: false });
    const x = L + doc.widthOfString(label) + 6;
    box(name, type, x, y - 3, w, o.h || 17, o);
    doc.y = y + (o.h || 17) + 8; doc.x = L;
  };
  // label on its own line, tall box below
  const block = (label, name, w, hh, o = {}) => {
    doc.font('Helvetica').fontSize(10.5).text(label, L, doc.y, { lineGap: 2 });
    const y = doc.y + 3;
    box(name, 'text', L, y, w, hh, o);
    doc.y = y + hh + 10; doc.x = L;
  };
  doc.font('Helvetica-Bold').fontSize(18).text('Inkhorn Review Contributor Agreement').moveDown(0.3);
  p('Inkhorn Review, published by Follow the Rabbit LLC (the "Publisher"), and the contributor named below agree as follows.');
  h('The work');
  line('Contributor (legal name):', 'Legal name', 'text', 300, { readonly: true });
  line('Piece(s):', 'Piece titles', 'text', 380, { readonly: true });
  { const y = doc.y; doc.font('Helvetica').fontSize(10.5).text('Issue:', L, y, { lineBreak: false });
    const x1 = L + doc.widthOfString('Issue:') + 6; box('Issue', 'text', x1, y - 3, 150, 17, { readonly: true });
    const lx = x1 + 150 + 16; doc.text('Release date:', lx, y, { lineBreak: false });
    box('Issue release date', 'text', lx + doc.widthOfString('Release date:') + 6, y - 3, 150, 17, { readonly: true });
    doc.y = y + 25; doc.x = L; }
  if (paid) {
    h('Payment');
    p("Inkhorn Review pays $25 per poem, micro or flash piece, and per prose piece of 1,000 words or fewer, and $40 per prose piece over 1,000 words. Artwork is not paid. Payment is sent on the issue's release day by Zelle or PayPal (U.S.) or Wise (elsewhere). Payment on initial publication covers all uses described in this agreement.");
    line('Amount due for this piece:', 'Amount', 'text', 100, { readonly: true });
    p('Choose one (required):');
    doc.font('Helvetica').fontSize(10.5);
    const opts = ['Cash payment of the amount above', 'One-year Print subscription to Inkhorn Review (four quarterly issues mailed, plus the ebook of each) instead of cash'];
    // radio boxes: two stacked options, each with its own small box
    const y0 = doc.y;
    const o1 = y0; doc.text(opts[0], L + 22, o1, { width: 470 });
    const o2 = doc.y + 6; doc.text(opts[1], L + 22, o2, { width: 470 });
    box('Payment choice', 'radio', L, o1 - 1, 14, 14, { option: opts[0], required: true });
    box('Payment choice', 'radio', L, o2 - 1, 14, 14, { option: opts[1], required: true });
    doc.y = doc.y + 10; doc.x = L;
    line('If you chose cash, payment method:', 'Payment method', 'select', 110, { options: ['Zelle', 'PayPal', 'Wise'], required: false });
    block('Payment details (Zelle or PayPal email or phone; or Wise email), if you chose cash:', 'Payment details', 400, 17, { required: false });
  }
  h('Rights');
  p("You grant Inkhorn Review, published by Follow the Rabbit LLC, and its successors and assigns first serial rights; the right to keep the work in our online archive; the right to reprint it in anthologies drawn from Inkhorn's own archive; and the right to read it aloud on our podcast, Life on Words. For artwork, this also includes the non-exclusive right to use the image in promotion of the issue in which it appears. Payment upon initial publication covers all uses.");
  p('We will not use your work to train AI models, and we will not license it to anyone who does.');
  p('All other rights remain with you, and all rights revert to you on publication. You may reprint your work wherever you like; we only ask that Inkhorn Review be credited as the first publisher.');
  p('You confirm the work is yours and has not been previously published. A personal blog, newsletter, or public social media post counts as published; work shared only in a workshop or private group is fine.');
  h('Deadline');
  doc.font('Helvetica').fontSize(10.5).text(published
    ? 'Your piece has already been published and will stay published. Please sign by the date below. If you have not chosen between cash and the Print subscription by then, you will be paid the cash.'
    : 'Inkhorn Review cannot publish a piece without this signed agreement. It must be signed by the date below, or the piece will be withdrawn from the issue.', { lineGap: 2 }).moveDown(0.4);
  line('Signing deadline:', 'Signing deadline', 'text', 130, { readonly: true });
  h('For the print edition');
  line('Name as it should appear in print:', 'Name in print', 'text', 280);
  block('Bio (50 words or fewer):', 'Bio', 480, 64);
  block('Mailing address (or write "outside the U.S."):', 'Mailing address', 480, 44);
  h('Signature');
  { const y = doc.y; doc.font('Helvetica').fontSize(10.5).text('Signature:', L, y + 14, { lineBreak: false });
    const x1 = L + doc.widthOfString('Signature:') + 6; box('Signature', 'signature', x1, y, 220, 44);
    const lx = x1 + 236; doc.text('Date:', lx, y + 14, { lineBreak: false });
    box('Date', 'date', lx + doc.widthOfString('Date:') + 6, y + 10, 110, 18); }
  doc.end();
  fs.writeFileSync(path.join(out, key + '.fields.json'), JSON.stringify(fields, null, 1));
}
fs.mkdirSync(out, { recursive: true });
build(true, false);
build(false, false);
build(true, true);
console.log('built');
