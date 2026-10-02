// address-banner.js — Shows a banner for Print members without a mailing address on file.
// Deferred so it does not block page render.
(function () {
    'use strict';

    var ADDRESS_SERVICE = 'https://address.inkhornreview.com';

    function showBanner() {
        var banner = document.createElement('div');
        banner.className = 'ih-address-banner';
        banner.innerHTML =
            '<span>Your Print subscription needs a mailing address. ' +
            '<a href="/address/" class="ih-address-banner-link">Add your address \u2192</a></span>' +
            '<button class="ih-address-banner-close" aria-label="Dismiss">&times;</button>';
        banner.querySelector('.ih-address-banner-close').addEventListener('click', function () {
            banner.remove();
        });
        document.body.appendChild(banner);
    }

    function check() {
        fetch('/members/api/session')
            .then(function (r) { if (!r.ok) throw new Error('no session'); return r.json(); })
            .then(function (session) {
                var tiers = (session.subscriptions || []).map(function (s) {
                    return s.tier && s.tier.slug;
                });
                if (tiers.indexOf('print') === -1) return;
                return fetch(ADDRESS_SERVICE + '/address/status', {
                    headers: { Authorization: 'Bearer ' + (session.identity || '') }
                }).then(function (r) { return r.json(); }).then(function (status) {
                    if (!status.hasAddress) showBanner();
                });
            })
            .catch(function () {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 600); });
    } else {
        setTimeout(check, 600);
    }
}());
