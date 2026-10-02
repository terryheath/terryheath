'use strict';

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const app = express();
const PORT = process.env.PORT || 3000;

// ── STRIPE ──────────────────────────────────────────────────────────────────
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── SES ─────────────────────────────────────────────────────────────────────
const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-2' });

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: 'https://inkhornreview.com' }));

// ── BODY PARSING ─────────────────────────────────────────────────────────────
// Raw body for Stripe webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
// JSON body for all other routes
app.use(express.json());

// ── PRODUCT CACHE ─────────────────────────────────────────────────────────────
let productCache = null;
let productCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getProducts() {
  const now = Date.now();
  if (productCache && now - productCacheTime < CACHE_TTL) {
    return productCache;
  }

  // Fetch all active products with their default prices
  const products = await stripe.products.list({
    active: true,
    limit: 100,
    expand: ['data.default_price'],
  });

  const result = {};
  for (const prod of products.data) {
    const { sku, format, download_url } = prod.metadata || {};
    if (!sku || !format) continue;
    if (format === 'ebook' && !download_url) continue; // only offer ebook if download_url is set

    if (!result[sku]) result[sku] = { sku, formats: [] };

    const price = prod.default_price;
    if (!price || !price.unit_amount) continue;

    result[sku].formats.push({
      format,
      product_id: prod.id,
      price_id: price.id,
      price_cents: price.unit_amount,
      currency: price.currency,
      preorder: prod.metadata.preorder === 'true',
    });
  }

  // Sort: print first, then ebook
  for (const sku in result) {
    result[sku].formats.sort((a, b) => {
      const order = { print: 0, ebook: 1 };
      return (order[a.format] ?? 99) - (order[b.format] ?? 99);
    });
  }

  productCache = result;
  productCacheTime = now;
  return result;
}

// ── GET /products ─────────────────────────────────────────────────────────────
app.get('/products', async (req, res) => {
  try {
    const products = await getProducts();
    // Strip internal product_id, keep only public fields
    const response = {};
    for (const sku in products) {
      response[sku] = {
        sku,
        formats: products[sku].formats.map(f => ({
          format: f.format,
          price_cents: f.price_cents,
          currency: f.currency,
          preorder: f.preorder,
        })),
      };
    }
    res.json(response);
  } catch (err) {
    console.error('GET /products error:', err.message);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// ── POST /checkout ─────────────────────────────────────────────────────────────
app.post('/checkout', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }

    const products = await getProducts();

    const lineItems = [];
    let printQty = 0;
    let hasPrint = false;

    for (const item of items) {
      const { sku, format, quantity } = item;
      if (!sku || !format || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Each item requires sku, format, quantity' });
      }

      const prod = products[sku];
      if (!prod) return res.status(400).json({ error: `Unknown sku: ${sku}` });

      const fmt = prod.formats.find(f => f.format === format);
      if (!fmt) return res.status(400).json({ error: `Format ${format} not available for ${sku}` });

      if (format === 'print') {
        hasPrint = true;
        printQty += quantity;
      }

      const lineItem = {
        price: fmt.price_id,
        quantity,
      };

      if (fmt.preorder) {
        lineItem.price_data = undefined; // use price_id
        // Add preorder note via adjustable_quantity or description — we'll use the description approach
        // Stripe Checkout doesn't support custom descriptions per line item directly
        // We pass preorder via metadata on the session instead
      }

      lineItems.push(lineItem);
    }

    // Shipping line item
    if (hasPrint) {
      const shippingCents = 400 + (printQty - 1) * 100;
      lineItems.push({
        price_data: {
          currency: 'usd',
          unit_amount: shippingCents,
          product_data: {
            name: 'Shipping (U.S.)',
            tax_code: 'txcd_92010001',
          },
        },
        quantity: 1,
      });
    }

    // Build session params
    const sessionParams = {
      mode: 'payment',
      line_items: lineItems,
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      success_url: 'https://inkhornreview.com/order-complete/?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://inkhornreview.com/cart/',
      metadata: {
        items: JSON.stringify(items.map(i => ({
          sku: i.sku,
          format: i.format,
          quantity: i.quantity,
        }))),
        has_preorder: items.some(i => {
          const prod = products[i.sku];
          const fmt = prod && prod.formats.find(f => f.format === i.format);
          return fmt && fmt.preorder;
        }) ? 'true' : 'false',
      },
    };

    if (hasPrint) {
      sessionParams.shipping_address_collection = { allowed_countries: ['US'] };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('POST /checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

// ── GET /order ─────────────────────────────────────────────────────────────────
app.get('/order', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'line_items.data.price.product'],
    });

    if (session.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const items = [];
    for (const li of session.line_items.data) {
      const price = li.price;
      const product = price && price.product;
      if (!product || typeof product === 'string') continue;

      const { sku, format, download_url } = product.metadata || {};
      if (!sku || !format) continue; // skip shipping line item

      const item = {
        name: product.name,
        format,
        quantity: li.quantity,
        preorder: product.metadata.preorder === 'true',
      };

      if (format === 'ebook' && download_url) {
        item.download_url = download_url;
      }

      items.push(item);
    }

    res.json({
      items,
      total_cents: session.amount_total,
      currency: session.currency,
    });
  } catch (err) {
    console.error('GET /order error:', err.message);
    res.status(500).json({ error: 'Order retrieval failed' });
  }
});

// ── POST /webhook ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      // Retrieve with line items expanded
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items', 'line_items.data.price.product'],
      });

      await handleOrderCompleted(fullSession);
    } catch (err) {
      console.error('handleOrderCompleted error:', err.message);
    }
  }

  res.json({ received: true });
});

// ── EMAIL HELPERS ─────────────────────────────────────────────────────────────
async function handleOrderCompleted(session) {
  const buyerEmail = session.customer_details && session.customer_details.email;
  if (!buyerEmail) {
    console.warn('No buyer email on session', session.id);
    return;
  }

  const orderLines = [];
  let hasEbook = false;
  const shipping = session.shipping_details;

  for (const li of (session.line_items && session.line_items.data) || []) {
    const price = li.price;
    const product = price && price.product;
    if (!product || typeof product === 'string') continue;

    const { sku, format, download_url } = product.metadata || {};
    if (!sku || !format) continue; // skip shipping

    const isPreorder = product.metadata.preorder === 'true';
    const line = {
      name: product.name,
      format,
      quantity: li.quantity,
      preorder: isPreorder,
      download_url: format === 'ebook' && download_url ? download_url : null,
    };
    orderLines.push(line);
    if (format === 'ebook') hasEbook = true;
  }

  const totalFormatted = ((session.amount_total || 0) / 100).toFixed(2);

  // ── Buyer email ──────────────────────────────────────────────────────────
  let buyerBody = `Thank you for your order from Inkhorn Review!\n\n`;
  buyerBody += `Order summary:\n`;
  for (const line of orderLines) {
    buyerBody += `  - ${line.name} (${line.format})${line.preorder ? ' [Preorder — ships on release]' : ''} x${line.quantity}\n`;
    if (line.download_url) {
      buyerBody += `    Download: ${line.download_url}\n`;
    }
  }
  buyerBody += `\nTotal: $${totalFormatted}\n`;

  if (orderLines.some(l => l.format === 'print')) {
    buyerBody += `\nYour print order ships to U.S. addresses only. `;
    if (orderLines.some(l => l.preorder && l.format === 'print')) {
      buyerBody += `Preordered items ship on the release date.\n`;
    }
  }

  buyerBody += `\nThank you for supporting independent literary publishing.\n\nInkhorn Review\nhttps://inkhornreview.com`;

  await sendEmail({
    to: buyerEmail,
    subject: 'Your Inkhorn Review order',
    body: buyerBody,
  });

  // ── Staff email ──────────────────────────────────────────────────────────
  let staffBody = `New order on Inkhorn Review\n\nSession: ${session.id}\n\n`;
  staffBody += `Items:\n`;
  for (const line of orderLines) {
    staffBody += `  - ${line.name} (${line.format})${line.preorder ? ' [PREORDER]' : ''} x${line.quantity}\n`;
  }

  staffBody += `\nTotal: $${totalFormatted} ${(session.currency || '').toUpperCase()}\n`;

  if (shipping && shipping.name) {
    staffBody += `\nShipping to:\n`;
    staffBody += `  ${shipping.name}\n`;
    if (shipping.address) {
      const a = shipping.address;
      staffBody += `  ${a.line1}${a.line2 ? ', ' + a.line2 : ''}\n`;
      staffBody += `  ${a.city}, ${a.state} ${a.postal_code}\n`;
      staffBody += `  ${a.country}\n`;
    }
  }

  staffBody += `\nBuyer: ${buyerEmail}\n`;
  staffBody += `\nhttps://dashboard.stripe.com/payments/${session.payment_intent}`;

  await sendEmail({
    to: 'hello@inkhornreview.com',
    subject: `New order — ${orderLines.map(l => l.name).join(', ')}`,
    body: staffBody,
  });
}

async function sendEmail({ to, subject, body }) {
  const command = new SendEmailCommand({
    Source: 'Inkhorn Review <orders@inkhornreview.com>',
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Text: { Data: body, Charset: 'UTF-8' } },
    },
  });
  await ses.send(command);
}

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`inkhorn-shop-service listening on port ${PORT}`);
});
