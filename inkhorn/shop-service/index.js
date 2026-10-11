'use strict';

const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const cfg = require('./lib/config');
const catalog = require('./lib/catalog');
const orders = require('./lib/orders');
const downloads = require('./lib/downloads');
const adminRouter = require('./lib/admin');
const { startReleaseJob } = require('./lib/release');

const app = express();
app.set('trust proxy', true);

// ── STRIPE ──────────────────────────────────────────────────────────────────
// STRIPE_API_HOST/PORT/PROTOCOL point the client at a local stripe-mock (development only)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_API_HOST ? {
  host: process.env.STRIPE_API_HOST,
  port: process.env.STRIPE_API_PORT || 12111,
  protocol: process.env.STRIPE_API_PROTOCOL || 'http',
} : undefined);

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: cfg.corsOrigin }));

// ── BODY PARSING ─────────────────────────────────────────────────────────────
// Raw body for Stripe webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
// JSON body for all other routes
app.use(express.json());

// ── DOWNLOADS AND ADMIN ──────────────────────────────────────────────────────
app.use('/d', downloads);
app.use('/admin', adminRouter({
  stripe,
  // every active ebook product with its file key, for the admin file check
  listEbookProducts: async () => {
    const list = await stripe.products.list({ active: true, limit: 100 });
    return list.data.filter(p => (p.metadata || {}).format === 'ebook').map(p => ({ name: p.name, file_epub: (p.metadata || {}).file_epub }));
  },
}));

// ── PRODUCT CACHE ─────────────────────────────────────────────────────────────
let productCache = null;
let productCacheTime = 0;
const CACHE_TTL = cfg.cacheMs; // 5 minutes by default

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
    const meta = prod.metadata || {};
    const { sku, format, file_epub } = meta;
    if (!sku || !format) continue;

    const preorder = await catalog.isPreorder(sku, meta);
    // An ebook is offered once its file is in place, or while it is a preorder
    if (format === 'ebook' && !file_epub && !preorder) continue;

    if (!result[sku]) result[sku] = { sku, formats: [] };

    const price = prod.default_price;
    if (!price || !price.unit_amount) continue;

    result[sku].formats.push({
      format,
      product_id: prod.id,
      price_id: price.id,
      price_cents: price.unit_amount,
      currency: price.currency,
      preorder,
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
      if (format === 'ebook' && quantity > 1) {
        return res.status(400).json({ error: 'Ebooks are limited to one copy per order.' });
      }

      const prod = products[sku];
      if (!prod) return res.status(400).json({ error: `Unknown sku: ${sku}` });

      const fmt = prod.formats.find(f => f.format === format);
      if (!fmt) return res.status(400).json({ error: `Format ${format} not available for ${sku}` });

      if (format === 'print') {
        hasPrint = true;
        printQty += quantity;
      }

      lineItems.push({ price: fmt.price_id, quantity });
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
      billing_address_collection: 'auto',
      success_url: `${cfg.siteUrl}/order-complete/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cfg.siteUrl}/cart/`,
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
    if (cfg.automaticTax) sessionParams.automatic_tax = { enabled: true };

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
// Shown on the order-complete page. Never returns a download link: those are only emailed.
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
    for (const line of orders.productLines(session)) {
      const meta = line.product.metadata || {};
      const item = {
        name: line.name,
        format: line.format,
        quantity: line.quantity,
        preorder: await catalog.isPreorder(line.sku, meta),
      };
      if (line.format === 'ebook') {
        const releaseAt = await catalog.releaseAt(line.sku, meta.release_at);
        item.delivery = releaseAt ? 'on_release' : 'emailed';
        if (releaseAt) item.release_label = catalog.formatDate(releaseAt);
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
// Answers 200 only once the order is recorded and its emails are handled.
// On any failure it answers 500 so Stripe retries; repeats are harmless.
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const fullSession = await stripe.checkout.sessions.retrieve(event.data.object.id, {
        expand: ['line_items', 'line_items.data.price.product'],
      });
      await orders.handleCompletedSession(fullSession);
    } catch (err) {
      console.error('checkout.session.completed handling failed:', err.message);
      return res.status(500).json({ error: 'processing failed, please retry' });
    }
  }

  res.json({ received: true });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(cfg.port, () => {
  console.log(`inkhorn-shop-service listening on port ${cfg.port}`);
  startReleaseJob();
});
