// address-form.js — Shipping address form for Print members at /address/
// Runs only on the page with id="ih-address-form". No-ops on every other page.
(function () {
    'use strict';

    var ADDRESS_SERVICE = 'https://address.inkhornreview.com';

    var form = document.getElementById('ih-address-form');
    if (!form) return;

    var wrap    = document.getElementById('ih-address-form-wrap');
    var desc    = document.getElementById('ih-address-page-desc');
    var errorEl = document.getElementById('ih-address-error');
    var successEl = document.getElementById('ih-address-success');
    var submitBtn = document.getElementById('ih-address-submit');

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }
    function clearError() {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }

    // On load: fetch session, verify Print tier, pre-fill if address exists.
    fetch('/members/api/session')
        .then(function (r) { if (!r.ok) throw new Error('no session'); return r.json(); })
        .then(function (session) {
            var tiers = (session.subscriptions || []).map(function (s) { return s.tier && s.tier.slug; });
            if (tiers.indexOf('print') === -1) {
                // Signed in but not a Print member
                if (wrap) {
                    wrap.innerHTML = '<h1 class="ih-address-page-title">Mailing Address</h1>' +
                        '<p>This page is for Print subscribers. Your current plan doesn\'t include print. ' +
                        '<a href="#/portal/signup" data-portal="signup">Upgrade to Print</a> to add your address.</p>';
                }
                return;
            }

            var token = session.identity || '';

            // Check for existing address to pre-fill
            return fetch(ADDRESS_SERVICE + '/address/status', {
                headers: { Authorization: 'Bearer ' + token }
            }).then(function (r) { return r.json(); }).then(function (status) {
                if (status.hasAddress && desc) {
                    desc.textContent = 'Update your mailing address below. U.S. addresses only.';
                }
            }).catch(function () {})
            .then(function () {
                // Attach submit handler now that we know the member is Print
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    clearError();
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Saving\u2026';

                    var payload = {
                        name:    form.elements['name'].value.trim(),
                        addr1:   form.elements['addr1'].value.trim(),
                        addr2:   form.elements['addr2'].value.trim(),
                        city:    form.elements['city'].value.trim(),
                        state:   form.elements['state'].value.trim().toUpperCase(),
                        zip:     form.elements['zip'].value.trim(),
                        country: 'US'
                    };

                    if (!payload.name || !payload.addr1 || !payload.city || !payload.state || !payload.zip) {
                        showError('Please fill in all required fields.');
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Save address';
                        return;
                    }

                    fetch(ADDRESS_SERVICE + '/address', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: 'Bearer ' + token
                        },
                        body: JSON.stringify(payload)
                    }).then(function (r) {
                        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Server error'); });
                        return r.json();
                    }).then(function () {
                        form.style.display = 'none';
                        if (successEl) successEl.style.display = 'block';
                    }).catch(function (err) {
                        showError(err.message || 'Something went wrong. Please try again.');
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Save address';
                    });
                });
            });
        })
        .catch(function () {
            // Not signed in — template already shows the sign-in prompt via {{#if @member}}
        });
}());
