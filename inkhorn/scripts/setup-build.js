#!/usr/bin/env node
// inkhorn/scripts/setup-build.js
// One-time setup script for the print-first build.
// Run ONCE. Idempotent where possible.
//
// Does:
//  1. Rewrites existing Patron tier → Print ($59/year)
//  2. Creates Digital tier ($20/year)
//  3. Bulk-adds #archive to all autumn-2026 and micro posts
//  4. Creates draft announcement post tagged #this-week
//  5. Creates draft "patrons" page
//  6. Creates draft "ebooks" page (visibility: paid)
//  7. Creates draft "print-edition" page

import { createHmac } from 'crypto';

const GHOST_URL   = process.env.GHOST_URL;
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY;

if (!GHOST_URL || !GHOST_ADMIN_KEY) {
  console.error('GHOST_URL and GHOST_ADMIN_KEY are required');
  process.exit(1);
}

function buildJWT() {
  const [kid, secret] = GHOST_ADMIN_KEY.split(':');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 300;
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, iat, aud: '/admin/' })).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function api(method, path, body) {
  const resp = await fetch(`${GHOST_URL}/ghost/api/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Ghost ${buildJWT()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${method} ${path} → ${resp.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── 1. Tiers ──────────────────────────────────────────────────────────────────
async function setupTiers() {
  console.log('\n── Tiers ──');
  const { tiers } = await api('GET', '/tiers/?limit=all&include=benefits');

  // Find patron tier to rename → Print
  const patron = tiers.find(t =>
    t.name.toLowerCase().includes('patron') ||
    (t.type === 'paid' && t.monthly_price >= 1)
  );

  const printBenefits = [
    'Five issues of Inkhorn Review a year',
    'The annual Inkhorn Awards edition',
    'Physical copies mailed to any US address. Ebooks internationally',
    'Full internet-archive access',
  ];
  const digitalBenefits = [
    'Full archive access',
    'Every issue as an ebook',
  ];

  if (patron) {
    console.log(`Renaming tier "${patron.name}" (${patron.id}) → Print`);
    await api('PUT', `/tiers/${patron.id}/`, {
      tiers: [{
        name:              'Print',
        slug:              'print',
        description:       'Six books a year: five issues and the Awards edition, mailed to any U.S. address. Includes the full archive.',
        welcome_page_url:  '/address/',
        monthly_price:     5900,  // Ghost requires a monthly price; set equal to yearly
        yearly_price:      5900,
        currency:          'usd',
        visibility:        'public',
        benefits:          printBenefits,
      }],
    });
    console.log('  Print tier updated.');
  } else {
    console.log('No existing paid tier found — creating Print tier.');
    await api('POST', '/tiers/', {
      tiers: [{
        name:            'Print',
        slug:            'print',
        description:     'Six books a year: five issues and the Awards edition, mailed to any U.S. address. Includes the full archive.',
        welcome_page_url: '/address/',
        monthly_price:   5900,
        yearly_price:    5900,
        currency:        'usd',
        visibility:      'public',
        benefits:        printBenefits.map(name => ({ name })),
      }],
    });
    console.log('  Print tier created.');
  }

  // Digital tier — create if not exists
  const digital = tiers.find(t => t.name.toLowerCase() === 'digital' || t.slug === 'digital');
  if (digital) {
    console.log(`Digital tier already exists (${digital.id}), updating.`);
    await api('PUT', `/tiers/${digital.id}/`, {
      tiers: [{
        name:          'Digital',
        slug:          'digital',
        description:   'The full archive and every title as an ebook.',
        monthly_price: 2000,
        yearly_price:  2000,
        currency:      'usd',
        visibility:    'public',
        benefits:      digitalBenefits,
      }],
    });
  } else {
    console.log('Creating Digital tier.');
    await api('POST', '/tiers/', {
      tiers: [{
        name:          'Digital',
        slug:          'digital',
        description:   'The full archive and every title as an ebook.',
        monthly_price: 2000,
        yearly_price:  2000,
        currency:      'usd',
        visibility:    'public',
        benefits:      digitalBenefits,
      }],
    });
  }
  console.log('  Digital tier done.');
}

// ── 2. Bulk-add #archive tag ──────────────────────────────────────────────────
async function addArchiveTag() {
  console.log('\n── Adding #archive to autumn-2026 and micro posts ──');

  // Fetch all autumn-2026 posts
  let page = 1;
  let allPosts = [];
  while (true) {
    const data = await api('GET',
      `/posts/?filter=${encodeURIComponent('primary_tag:[autumn-2026,micro]')}&include=tags&limit=250&page=${page}&fields=id,title,updated_at`
    );
    const posts = data.posts || [];
    allPosts.push(...posts);
    if (posts.length < 250) break;
    page++;
  }
  console.log(`  Found ${allPosts.length} posts to tag.`);

  let updated = 0;
  let skipped = 0;
  for (const post of allPosts) {
    const hasArchive = (post.tags || []).some(t => t.slug === 'hash-archive');
    if (hasArchive) { skipped++; continue; }

    const tags = [...(post.tags || []).map(t => ({ name: t.name })), { name: '#archive' }];
    await api('PUT', `/posts/${post.id}/`, {
      posts: [{ tags, updated_at: post.updated_at }],
    });
    updated++;
  }
  console.log(`  Tagged: ${updated}, already tagged: ${skipped}`);
}

// ── 3. #this-week announcement post ──────────────────────────────────────────
async function createThisWeekPost() {
  console.log('\n── Creating #this-week announcement draft ──');
  const existing = await api('GET',
    `/posts/?filter=${encodeURIComponent('tag:hash-this-week')}&limit=5&fields=id,title,status`
  );
  if ((existing.posts || []).length > 0) {
    console.log('  #this-week post already exists — skipping.');
    return;
  }

  const html = `<!--kg-card-begin: html-->
<p>Starting in January, the <em>Winter 2027</em> issue arrives one piece a week — exclusively for subscribers.</p>
<p>Each week, a new poem or story from the issue lands here. Subscribers read it immediately; the full issue publishes later in the season.</p>
<p><a href="https://inkhornreview.com/#/portal/signup">Subscribe to get every piece as it arrives →</a></p>
<!--kg-card-end: html-->`;

  await api('POST', '/posts/', {
    posts: [{
      title:          '[Edit before publishing] The Winter Issue Starts in January — One Piece a Week',
      html,
      status:         'draft',
      visibility:     'public',
      tags:           [{ name: '#this-week' }],
      custom_excerpt: 'Starting in January, the Winter 2027 issue arrives one piece a week — for subscribers.',
    }],
  }, { source: 'html' });
  console.log('  #this-week announcement draft created.');
}

// ── 4. Patrons page ───────────────────────────────────────────────────────────
async function createPatronsPage() {
  console.log('\n── Creating patrons page ──');
  const existing = await api('GET', `/pages/?filter=slug:patrons&limit=1&fields=id`);
  if ((existing.pages || []).length > 0) {
    console.log('  patrons page already exists — skipping.');
    return;
  }
  await api('POST', '/pages/', {
    pages: [{
      title:          'Patrons',
      slug:           'patrons',
      status:         'draft',
      visibility:     'public',
      custom_excerpt: '[Edit: paste patron names here, comma-separated]',
      html:           '<!-- Patron names go in the custom excerpt field (Post Settings → Excerpt). The home page reads from there. -->',
    }],
  });
  console.log('  patrons page created as draft.');
}

// ── 5. Ebooks page ────────────────────────────────────────────────────────────
async function createEbooksPage() {
  console.log('\n── Creating ebooks page ──');
  const existing = await api('GET', `/pages/?filter=slug:ebooks&limit=1&fields=id`);
  if ((existing.pages || []).length > 0) {
    console.log('  ebooks page already exists — skipping.');
    return;
  }

  const html = `<!--kg-card-begin: html-->
<div style="max-width:700px;margin:0 auto;padding:40px 24px">
  <h1 style="font-size:2rem;font-weight:500;margin-bottom:8px">Subscriber Ebooks</h1>
  <p style="color:#5b544a;margin-bottom:40px">Download your copies below. Links are provided by BookFunnel and expire after a set time — re-visit this page to get a fresh link.</p>

  <div style="display:flex;flex-direction:column;gap:32px">
    <div style="display:flex;gap:24px;align-items:flex-start;padding-bottom:32px;border-bottom:1px solid #d6cdbd">
      <img src="/content/images/2026/09/inkhorn-cover.jpg" alt="Autumn 2026 cover" style="width:120px;height:auto;flex-shrink:0">
      <div>
        <div style="font-size:1.2rem;font-weight:500;margin-bottom:4px">Inkhorn Review — Autumn 2026</div>
        <div style="color:#5b544a;font-size:0.95rem;margin-bottom:16px">EPUB · PDF</div>
        <a href="#" style="background:#8f1d1d;color:#fff;padding:10px 20px;font-family:sans-serif;font-size:14px;font-weight:600;text-decoration:none;display:inline-block">[Paste BookFunnel link] Download →</a>
      </div>
    </div>
  </div>
</div>
<!--kg-card-end: html-->`;

  await api('POST', '/pages/', {
    pages: [{
      title:      'Subscriber Ebooks',
      slug:       'ebooks',
      status:     'draft',
      visibility: 'paid',
      html,
    }],
  });
  console.log('  ebooks page created as draft (visibility: paid).');
}

// ── 6. Print Edition page ─────────────────────────────────────────────────────
async function createPrintEditionPage() {
  console.log('\n── Creating print-edition page ──');
  const existing = await api('GET', `/pages/?filter=slug:print-edition&limit=1&fields=id`);
  if ((existing.pages || []).length > 0) {
    console.log('  print-edition page already exists — skipping.');
    return;
  }
  // Minimal page — the injection script renders the hero from PRINT_META
  await api('POST', '/pages/', {
    pages: [{
      title:      'Print Edition',
      slug:       'print-edition',
      status:     'draft',
      visibility: 'public',
      html:       '<p><!-- The print edition hero is rendered by the site injection script from PRINT_META. --></p>',
    }],
  });
  console.log('  print-edition page created as draft.');
}

async function main() {
  console.log('Running print-first setup…');
  await setupTiers();
  await addArchiveTag();
  await createThisWeekPost();
  await createPatronsPage();
  await createEbooksPage();
  await createPrintEditionPage();
  console.log('\nDone. Check Ghost Admin to review and publish draft pages/posts.');
  console.log('Remember to:');
  console.log('  - Set up Stripe in Ghost Settings → Membership');
  console.log('  - Configure Portal (yearly only, show Free/Print/Digital)');
  console.log('  - Archive the Weekly Microfiction newsletter');
  console.log('  - Update the submissions page to link to Duosuma');
  console.log('  - Edit and publish the patrons page and #this-week announcement');
  console.log('  - Paste Stripe Payment Link into PRINT_META.buyUrl in ghost-footer-injection.html');
}

main().catch(err => { console.error(err); process.exit(1); });
