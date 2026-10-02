/**
 * shop.js — Inkhorn Review storefront
 * Cart in localStorage (key: ih-cart)
 * Format: [{sku, format, quantity, title, preorder}]
 */
(function () {
  'use strict';

  var SHOP_SERVICE_URL = 'https://inkhorn-shop-service-production.up.railway.app';
  var CART_KEY = 'ih-cart';

  // ── HELPERS ──────────────────────────────────────────────────────────────────
  function e(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (_) { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount(cart);
  }

  function updateCartCount(cart) {
    cart = cart || getCart();
    var count = cart.reduce(function (sum, item) { return sum + (item.quantity || 0); }, 0);
    document.querySelectorAll('.ih-cart-link').forEach(function (el) {
      el.textContent = 'Cart (' + count + ')';
    });
  }

  function formatCents(cents) {
    var dollars = (cents / 100).toFixed(2);
    return '$' + dollars;
  }

  // Module-level products cache (per page load)
  var _products = null;

  function fetchProducts() {
    if (_products) return Promise.resolve(_products);
    return fetch(SHOP_SERVICE_URL + '/products')
      .then(function (r) { return r.json(); })
      .then(function (data) { _products = data; return data; });
  }

  // ── ON EVERY PAGE: update cart count ─────────────────────────────────────────
  updateCartCount();

  // ── DETECT PAGE TYPE ─────────────────────────────────────────────────────────
  var bookJsonEl = document.getElementById('ih-book');
  var isBookPage = !!bookJsonEl;
  var isCartPage = !!document.getElementById('ih-cart-items');
  var isOrderComplete = !!document.getElementById('ih-order-complete');
  var isGridPage = !!document.querySelector('.ih-print-grid');

  // ── BOOKS GRID PAGE (/print/) ─────────────────────────────────────────────────
  if (isGridPage) {
    fetchProducts().then(function (products) {
      document.querySelectorAll('.ih-print-card[data-sku]').forEach(function (card) {
        var sku = card.getAttribute('data-sku');
        var prod = products[sku];
        var pricesEl = card.querySelector('.ih-print-card-prices');
        if (!pricesEl) return;
        if (!prod || !prod.formats || !prod.formats.length) return;
        var parts = prod.formats.map(function (fmt) {
          var label = fmt.format === 'print' ? 'Print' : 'Ebook';
          return label + ' ' + formatCents(fmt.price_cents);
        });
        pricesEl.textContent = parts.join(' \u00b7 ');
      });
    }).catch(function () {
      // prices simply stay empty if the service is unreachable
    });
  }

  // ── BOOK PAGE ─────────────────────────────────────────────────────────────────
  if (isBookPage) {
    var bookData = null;
    try { bookData = JSON.parse(bookJsonEl.textContent); } catch (_) {}
    if (!bookData) return;

    var sku = bookData.sku;
    var isPreorder = !!bookData.preorder;
    var bookTitle = document.querySelector('.ih-book-title');
    var titleText = bookTitle ? bookTitle.textContent : '';
    var isbn = bookData.isbn || '';
    var contents = bookData.contents || null;

    // Status label in hero
    var statusLabel = bookData.statusLabel || '';
    var statusEl = document.getElementById('ih-book-status');
    if (statusEl && statusLabel) statusEl.textContent = statusLabel;

    // Render contents + details into #ih-book-contents
    renderBookContents(bookData, titleText, isbn, contents);

    // Load products and render format picker
    if (sku) {
      var formatsDone = false;
      var formatsTimeout = setTimeout(function () {
        if (!formatsDone) {
          var el = document.getElementById('ih-book-formats');
          if (el) el.innerHTML = '<p class="ih-book-not-available">Not yet available</p>';
        }
      }, 6000);
      fetchProducts().then(function (products) {
        formatsDone = true;
        clearTimeout(formatsTimeout);
        var prod = products[sku];
        if (!prod) {
          document.getElementById('ih-book-formats').innerHTML =
            '<p class="ih-book-not-available">Not yet available</p>';
          return;
        }
        renderFormatPicker(prod, titleText, isPreorder);
      }).catch(function () {
        formatsDone = true;
        clearTimeout(formatsTimeout);
        document.getElementById('ih-book-formats').innerHTML =
          '<p class="ih-book-not-available">Not yet available</p>';
      });
    } else {
      document.getElementById('ih-book-formats').innerHTML = '';
    }
  }

  function renderBookContents(bookData, titleText, isbn, contents) {
    var el = document.getElementById('ih-book-contents');
    if (!el) return;
    var html = '';

    if (contents) {
      var genreNames = { poetry: 'Poetry', fiction: 'Fiction', nonfiction: 'Nonfiction' };
      html += '<div class="ih-book-contents-inner">';
      html += '<h2 class="ih-book-section-head">In This Issue</h2>';
      html += '<div class="ih-contents">';
      for (var genre in contents) {
        var pieces = contents[genre];
        html += '<div>';
        html += '<div class="ih-contents-genre-head">' + e(genreNames[genre] || genre) + '</div>';
        for (var i = 0; i < pieces.length; i++) {
          html += '<div class="ih-contents-item">' + e(pieces[i][0]) + ', <em>' + e(pieces[i][1]) + '</em></div>';
        }
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';
    }

    if (isbn) {
      html += '<div class="ih-book-details">';
      html += '<h2 class="ih-book-section-head">Details</h2>';
      html += '<dl class="ih-book-detail-list">';
      html += '<dt>ISBN</dt><dd>' + e(isbn) + ' (print)</dd>';
      html += '</dl>';
      html += '</div>';
    }

    el.innerHTML = html;
  }

  function renderFormatPicker(prod, titleText, isPreorder) {
    var container = document.getElementById('ih-book-formats');
    if (!container) return;

    var selectedFormat = prod.formats[0] ? prod.formats[0].format : 'print';

    function render(selected) {
      var html = '<div class="ih-book-format-picker">';

      // Format radio rows
      html += '<div class="ih-book-format-options">';
      for (var i = 0; i < prod.formats.length; i++) {
        var fmt = prod.formats[i];
        var checked = fmt.format === selected ? ' checked' : '';
        html += '<label class="ih-book-format-option' + (fmt.format === selected ? ' selected' : '') + '">';
        html += '<input type="radio" name="ih-format" value="' + e(fmt.format) + '"' + checked + '>';
        html += '<span class="ih-book-format-name">' + (fmt.format === 'print' ? 'Print' : 'Ebook') + '</span>';
        html += '<span class="ih-book-format-price">' + formatCents(fmt.price_cents) + '</span>';
        html += '</label>';
      }
      html += '</div>';

      // Quantity (print only)
      if (selected === 'print') {
        html += '<div class="ih-book-qty-row">';
        html += '<label class="ih-book-qty-label" for="ih-book-qty">Qty</label>';
        html += '<div class="ih-book-qty">';
        html += '<button class="ih-qty-btn" id="ih-qty-dec" aria-label="Decrease">−</button>';
        html += '<input class="ih-qty-input" type="number" id="ih-book-qty" min="1" value="1">';
        html += '<button class="ih-qty-btn" id="ih-qty-inc" aria-label="Increase">+</button>';
        html += '</div>';
        html += '</div>';
      }

      // Add to cart button — use per-format preorder flag
      var selectedFmt = prod.formats.filter(function(f) { return f.format === selected; })[0];
      var fmtIsPreorder = selectedFmt ? !!selectedFmt.preorder : false;
      var btnLabel = fmtIsPreorder ? 'Preorder' : 'Add to Cart';
      html += '<button class="ih-add-to-cart-btn' + (selected === 'print' ? ' ih-sub-btn-print' : ' ih-btn-ebook') + '" id="ih-add-to-cart">';
      html += e(btnLabel) + '</button>';

      // Format note
      if (selected === 'print') {
        html += '<p class="ih-book-print-note">Ships to U.S. addresses. $4 for the first book, $1 for each additional.</p>';
      } else if (selected === 'ebook') {
        if (fmtIsPreorder) {
          html += '<p class="ih-book-ebook-note">Preorder. Emailed to you on release day. Available in any country.</p>';
        } else {
          html += '<p class="ih-book-ebook-note">Delivered by email. Available in any country.</p>';
        }
      }

      html += '</div>';
      container.innerHTML = html;
      attachFormatPickerEvents(prod, titleText, isPreorder);
    }

    render(selectedFormat);

    function attachFormatPickerEvents(prod, titleText, isPreorder) {
      // Format radio change
      container.querySelectorAll('input[name="ih-format"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          render(this.value);
        });
      });

      // Qty controls
      var qtyInput = container.querySelector('#ih-book-qty');
      var decBtn = container.querySelector('#ih-qty-dec');
      var incBtn = container.querySelector('#ih-qty-inc');
      if (qtyInput) {
        if (decBtn) decBtn.addEventListener('click', function () {
          var v = parseInt(qtyInput.value, 10) || 1;
          if (v > 1) qtyInput.value = v - 1;
        });
        if (incBtn) incBtn.addEventListener('click', function () {
          var v = parseInt(qtyInput.value, 10) || 1;
          qtyInput.value = v + 1;
        });
      }

      // Add to cart
      var addBtn = container.querySelector('#ih-add-to-cart');
      if (addBtn) {
        addBtn.addEventListener('click', function () {
          var selectedRadio = container.querySelector('input[name="ih-format"]:checked');
          if (!selectedRadio) return;
          var fmt = selectedRadio.value;
          var qty = fmt === 'print' ? (parseInt((container.querySelector('#ih-book-qty') || {}).value, 10) || 1) : 1;

          var cart = getCart();
          var existing = null;
          for (var i = 0; i < cart.length; i++) {
            if (cart[i].sku === prod.sku && cart[i].format === fmt) {
              existing = cart[i];
              break;
            }
          }
          if (existing) {
            existing.quantity += qty;
          } else {
            var addedFmt = prod.formats.filter(function(f) { return f.format === fmt; })[0];
            var addedPreorder = addedFmt ? !!addedFmt.preorder : false;
            cart.push({ sku: prod.sku, format: fmt, quantity: qty, title: titleText, preorder: addedPreorder });
          }
          saveCart(cart);

          // Show persistent "Added. View cart" confirmation below the button
          var picker = container.querySelector('.ih-book-format-picker');
          if (picker) {
            var existing_conf = picker.querySelector('.ih-add-confirm');
            if (!existing_conf) {
              var conf = document.createElement('div');
              conf.className = 'ih-add-confirm';
              conf.innerHTML = 'Added. <a href="/cart/" class="ih-add-confirm-link">View cart</a>';
              picker.appendChild(conf);
            }
          }
        });
      }
    }
  }

  // ── CART PAGE ─────────────────────────────────────────────────────────────────
  if (isCartPage) {
    renderCart();
  }

  function renderCart() {
    var cart = getCart();
    var itemsEl = document.getElementById('ih-cart-items');
    var summaryEl = document.getElementById('ih-cart-summary');

    if (!itemsEl || !summaryEl) return;

    if (!cart.length) {
      itemsEl.innerHTML = '<p class="ih-cart-empty">Your cart is empty. <a href="/print/">Browse the shop</a>.</p>';
      summaryEl.innerHTML = '';
      return;
    }

    fetchProducts().then(function (products) {
      var html = '';
      var subtotal = 0;
      var printQty = 0;
      var hasPrint = false;

      for (var i = 0; i < cart.length; i++) {
        var item = cart[i];
        var prod = products[item.sku];
        var fmt = prod && prod.formats.find(function (f) { return f.format === item.format; });
        var price = fmt ? fmt.price_cents : 0;
        var lineTotal = price * item.quantity;
        subtotal += lineTotal;

        if (item.format === 'print') {
          hasPrint = true;
          printQty += item.quantity;
        }

        html += '<div class="ih-cart-item" data-sku="' + e(item.sku) + '" data-format="' + e(item.format) + '">';
        html += '<div class="ih-cart-item-title">' + e(item.title || item.sku) + '</div>';
        html += '<div class="ih-cart-item-detail">';
        html += '<span class="ih-cart-item-format">' + e(item.format === 'print' ? 'Print' : 'Ebook') + '</span>';
        if (item.preorder) html += ' <span class="ih-cart-item-preorder">' + (item.format === 'ebook' ? 'Preorder — emailed on release day' : 'Preorder — ships on release') + '</span>';
        html += '</div>';

        if (item.format === 'print') {
          html += '<div class="ih-cart-qty-ctrl">';
          html += '<button class="ih-cart-qty-btn ih-cart-qty-dec" aria-label="Decrease">−</button>';
          html += '<span class="ih-cart-qty-val">' + item.quantity + '</span>';
          html += '<button class="ih-cart-qty-btn ih-cart-qty-inc" aria-label="Increase">+</button>';
          html += '</div>';
        } else {
          html += '<div class="ih-cart-qty-ctrl"><span class="ih-cart-qty-val">1</span></div>';
        }

        html += '<div class="ih-cart-line-price">' + formatCents(lineTotal) + '</div>';
        html += '<button class="ih-cart-remove" aria-label="Remove">Remove</button>';
        html += '</div>';
      }

      itemsEl.innerHTML = html;

      // Shipping calc
      var shippingCents = hasPrint ? (400 + (printQty - 1) * 100) : 0;
      var shippingText = hasPrint ? formatCents(shippingCents) : 'Free';

      var sumHtml = '';
      sumHtml += '<div class="ih-cart-subtotal">Subtotal: ' + formatCents(subtotal) + '</div>';
      sumHtml += '<div class="ih-cart-shipping">Shipping: ' + shippingText + '</div>';
      if (hasPrint) {
        sumHtml += '<p class="ih-cart-note">Ships to U.S. addresses only. $4 for the first book, $1 for each additional.</p>';
      }
      sumHtml += '<button class="ih-cart-checkout-btn ih-sub-btn-print" id="ih-checkout-btn">Checkout</button>';
      summaryEl.innerHTML = sumHtml;

      // Attach events
      attachCartEvents(cart, products);

      document.getElementById('ih-checkout-btn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Loading\u2026';

        var items = cart.map(function (item) {
          return { sku: item.sku, format: item.format, quantity: item.quantity };
        });

        fetch(SHOP_SERVICE_URL + '/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: items }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.url) {
              window.location.href = data.url;
            } else {
              btn.disabled = false;
              btn.textContent = 'Checkout';
              alert('Checkout error: ' + (data.error || 'Please try again.'));
            }
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = 'Checkout';
            alert('Unable to connect to shop. Please try again.');
          });
      });
    }).catch(function () {
      itemsEl.innerHTML = '<p>Unable to load product prices. Please refresh.</p>';
    });
  }

  function attachCartEvents(cart, products) {
    var itemsEl = document.getElementById('ih-cart-items');
    if (!itemsEl) return;

    itemsEl.addEventListener('click', function (evt) {
      var target = evt.target;
      var itemEl = target.closest('.ih-cart-item');
      if (!itemEl) return;
      var sku = itemEl.getAttribute('data-sku');
      var format = itemEl.getAttribute('data-format');

      if (target.classList.contains('ih-cart-remove')) {
        cart = cart.filter(function (i) { return !(i.sku === sku && i.format === format); });
        saveCart(cart);
        renderCart();
        return;
      }

      if (target.classList.contains('ih-cart-qty-dec') || target.classList.contains('ih-cart-qty-inc')) {
        var delta = target.classList.contains('ih-cart-qty-inc') ? 1 : -1;
        for (var i = 0; i < cart.length; i++) {
          if (cart[i].sku === sku && cart[i].format === format) {
            cart[i].quantity = Math.max(1, cart[i].quantity + delta);
            break;
          }
        }
        saveCart(cart);
        renderCart();
      }
    });
  }

  // ── ORDER COMPLETE PAGE ────────────────────────────────────────────────────────
  if (isOrderComplete) {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('session_id');
    var orderEl = document.getElementById('ih-order-complete');

    if (!sessionId) {
      orderEl.innerHTML = '<p class="ih-order-complete-intro">No order found. <a href="/print/">Browse our books \u2192</a></p>';
    } else {
      orderEl.innerHTML = '<h1 class="ih-order-complete-heading">Order Complete</h1><p>Loading your order&hellip;</p>';

      fetch(SHOP_SERVICE_URL + '/order?session_id=' + encodeURIComponent(sessionId))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) {
            orderEl.innerHTML = '<h1 class="ih-order-complete-heading">Order Complete</h1>' +
              '<p>Thank you for your order! Check your email for confirmation.</p>';
            saveCart([]);
            return;
          }

          var html = '<h1 class="ih-order-complete-heading">Thank you!</h1>';
          html += '<p class="ih-order-complete-intro">Your order has been placed. A confirmation has been sent to your email.</p>';
          html += '<div class="ih-order-items">';

          for (var i = 0; i < (data.items || []).length; i++) {
            var item = data.items[i];
            html += '<div class="ih-order-item">';
            html += '<div class="ih-order-item-name">' + e(item.name) + ' (' + e(item.format) + ')';
            if (item.preorder) {
              var preorderMsg = item.format === 'ebook' ? 'Preorder — your ebook will be emailed to you on release day' : 'Preorder — ships on release';
              html += ' <span class="ih-order-preorder">' + preorderMsg + '</span>';
            }
            html += '</div>';
            if (item.quantity > 1) html += '<div class="ih-order-item-qty">Qty: ' + item.quantity + '</div>';
            if (item.download_url && !item.preorder) {
              html += '<div class="ih-download-link-wrap">';
              html += '<a class="ih-download-link" href="' + e(item.download_url) + '" target="_blank" rel="noopener">Download Ebook &rarr;</a>';
              html += '</div>';
            }
            html += '</div>';
          }

          html += '</div>';

          if (data.total_cents) {
            html += '<div class="ih-order-total">Total: ' + formatCents(data.total_cents) + '</div>';
          }

          html += '<p class="ih-order-continue"><a href="/">Continue reading &rarr;</a></p>';

          orderEl.innerHTML = html;
          saveCart([]);
        })
        .catch(function () {
          orderEl.innerHTML = '<h1 class="ih-order-complete-heading">Order Complete</h1>' +
            '<p>Thank you for your order! A confirmation email is on its way.</p>';
          saveCart([]);
        });
    }
  }

})();
