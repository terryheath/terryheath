/**
 * shop.js — Inkhorn Review storefront
 * Cart in localStorage (key: ih-cart)
 * Format: [{sku, format, quantity, title, preorder}]
 */
(function () {
  'use strict';

  var SHOP_SERVICE_URL = 'https://inkhorn-shop-service.up.railway.app'; // update after Railway deploy
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

  function formatCents(cents, currency) {
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

    // Render contents + details into #ih-book-contents
    renderBookContents(bookData, titleText, isbn, contents);

    // Load products and render format picker
    if (sku) {
      fetchProducts().then(function (products) {
        var prod = products[sku];
        if (!prod) {
          document.getElementById('ih-book-formats').innerHTML =
            '<p style="color:#5b544a;font-size:17px">Available soon</p>';
          return;
        }
        renderFormatPicker(prod, titleText, isPreorder);
      }).catch(function () {
        document.getElementById('ih-book-formats').innerHTML =
          '<p style="color:#5b544a;font-size:17px">Shop unavailable — please try again later.</p>';
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
      html += '<dt>ISBN</dt><dd>' + e(isbn) + '</dd>';
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

      // Add to cart button
      var btnLabel = isPreorder ? 'Preorder' : 'Add to Cart';
      html += '<button class="ih-add-to-cart-btn' + (selected === 'print' ? ' ih-sub-btn-print' : ' ih-btn-ebook') + '" id="ih-add-to-cart">';
      html += e(btnLabel) + '</button>';

      // US-only note for print
      if (selected === 'print') {
        html += '<p class="ih-book-print-note">Print ships to U.S. addresses only.</p>';
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
            cart.push({ sku: prod.sku, format: fmt, quantity: qty, title: titleText, preorder: isPreorder });
          }
          saveCart(cart);

          // Flash confirmation
          addBtn.textContent = 'Added!';
          setTimeout(function () {
            addBtn.textContent = isPreorder ? 'Preorder' : 'Add to Cart';
          }, 1500);
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
        if (item.preorder) html += ' <span class="ih-cart-item-preorder">Preorder — ships on release</span>';
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
        sumHtml += '<p class="ih-cart-note">Print ships to U.S. addresses only. One shipping address per order.</p>';
      }
      sumHtml += '<button class="ih-cart-checkout-btn ih-sub-btn-print" id="ih-checkout-btn">Checkout</button>';
      summaryEl.innerHTML = sumHtml;

      // Attach events
      attachCartEvents(cart, products);

      document.getElementById('ih-checkout-btn').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Loading…';

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
      orderEl.innerHTML = '<h1 class="ih-order-complete-heading">Order Complete</h1><p>Thank you for your order!</p>';
    } else {
      orderEl.innerHTML = '<h1 class="ih-order-complete-heading">Order Complete</h1><p>Loading your order&hellip;</p>';

      fetch(SHOP_SERVICE_URL + '/order?session_id=' + encodeURIComponent(sessionId))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) {
            orderEl.innerHTML = '<h1 class="ih-order-complete-heading">Order Complete</h1>' +
              '<p>Thank you for your order! Check your email for confirmation.</p>';
            return;
          }

          var html = '<h1 class="ih-order-complete-heading">Thank you!</h1>';
          html += '<p class="ih-order-complete-intro">Your order has been placed. A confirmation has been sent to your email.</p>';
          html += '<div class="ih-order-items">';

          for (var i = 0; i < (data.items || []).length; i++) {
            var item = data.items[i];
            html += '<div class="ih-order-item">';
            html += '<div class="ih-order-item-name">' + e(item.name) + ' (' + e(item.format) + ')';
            if (item.preorder) html += ' <span class="ih-order-preorder">Preorder — ships on release</span>';
            html += '</div>';
            if (item.quantity > 1) html += '<div class="ih-order-item-qty">Qty: ' + item.quantity + '</div>';
            if (item.download_url) {
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

          // Clear cart
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
