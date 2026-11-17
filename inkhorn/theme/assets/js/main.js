// main.js — Inkhorn Review theme JS
// Hamburger nav toggle for the phone overlay.
(function () {
    'use strict';

    function initNav() {
        var btn = document.querySelector('.ih-menu-btn');
        var overlay = document.getElementById('ih-nav-overlay');
        if (!btn || !overlay) return;

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = overlay.classList.toggle('open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        document.addEventListener('click', function (e) {
            if (!overlay.classList.contains('open')) return;
            if (!overlay.contains(e.target) && !btn.contains(e.target)) {
                overlay.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            }
        });

        overlay.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', function () {
                overlay.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNav);
    } else {
        initNav();
    }
}());

// Inkhorn Press: shared header menu + live status strip (dates computed, never typed in).
(function () {
    'use strict';
    var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var SEASON = {2:'Spring',5:'Summer',8:'Autumn',11:'Winter'};
    var DAY = 86400000;
    function fmt(d) { return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + (', ' + d.getUTCFullYear()); }
    function nextRelease(now) {
        var y = now.getUTCFullYear(), m, i;
        for (i = 0; i < 6; i++) {
            m = [2,5,8,11][i % 4]; if (i >= 4) y = now.getUTCFullYear() + 1;
            var d = new Date(Date.UTC(y, m, 1, 12));
            if (d > now) return d;
        }
    }
    // Free reading periods: every Feb, May, Aug and Nov (the whole month).
    function reading(now) {
        var m = now.getUTCMonth(), y = now.getUTCFullYear();
        if (m % 3 === 1) return { open: true, until: new Date(Date.UTC(y, m + 1, 0)) };
        var nm = m + ((1 - m % 3) + 3) % 3, ny = y + (nm > 11 ? 1 : 0);
        return { open: false, from: new Date(Date.UTC(ny, nm % 12, 1)) };
    }
    function friday13(now) {
        var first = Date.UTC(2027, 7, 13); // White Rabbit No. 1
        var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 13));
        for (var i = 0; i < 60; i++) {
            if (d.getUTCDay() === 5 && d.getTime() >= first && d.getTime() + DAY > now.getTime()) return d;
            d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 13));
        }
    }
    window.ipStatus = function (now) {
        now = now || new Date();
        var r = reading(now), rel = nextRelease(now), f = friday13(now);
        var days = Math.ceil((f.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY);
        return {
            now: r.open ? 'Free reading period open through ' + MONTHS[r.until.getUTCMonth()] + ' ' + r.until.getUTCDate()
                        : 'Free reading period opens ' + MONTHS[r.from.getUTCMonth()] + ' 1',
            readingOpen: r.open,
            readingbadge: r.open ? 'Free period open \u00b7 through ' + MONTHS[r.until.getUTCMonth()] + ' ' + r.until.getUTCDate() : 'Paid call open \u00b7 free period opens ' + MONTHS[r.from.getUTCMonth()] + ' 1',
            next: 'Inkhorn Review ' + SEASON[rel.getUTCMonth()] + ' ' + rel.getUTCFullYear() + ' — ' + MONTHS[rel.getUTCMonth()] + ' 1',
            f13: fmt(f) + ' — ' + days + (days === 1 ? ' day' : ' days'),
            wrdays: days + (days === 1 ? ' day' : ' days')
        };
    };
    function fill() {
        var s = window.ipStatus();
        document.querySelectorAll('[data-ip-status]').forEach(function (el) {
            var k = el.getAttribute('data-ip-status'); if (s[k] != null) el.textContent = s[k];
        });
        var btn = document.querySelector('.ip-menu-btn'), nav = document.getElementById('ip-nav');
        if (btn && nav) btn.addEventListener('click', function () {
            var o = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', o ? 'true' : 'false');
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill); else fill();
}());

// Newsletter form: signs the reader up through Ghost's member integrity + members API.
(function () {
    'use strict';
    function init() {
        document.querySelectorAll('[data-ip-newsletters]').forEach(function (f) {
            f.addEventListener('submit', function (e) {
                e.preventDefault();
                var msg = f.querySelector('.msg'), email = f.email.value.trim();
                var slugs = Array.prototype.map.call(f.querySelectorAll('input[name=n]:checked'), function (i) { return i.value; });
                if (!email) { msg.textContent = 'Enter your email address.'; return; }
                if (!slugs.length) { msg.textContent = 'Choose at least one newsletter.'; return; }
                msg.textContent = 'Subscribing…';
                fetch('/members/api/integrity-token/').then(function (r) { return r.text(); }).then(function (token) {
                    return fetch('/members/api/send-magic-link/', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: email, emailType: 'signup', integrityToken: token,
                            newsletters: slugs.map(function (s) { return { slug: s }; }) })
                    });
                }).then(function (r) {
                    msg.textContent = r.ok ? 'Check your email for a link to confirm.' : 'Something went wrong. Please try again, or write hello@inkhorn.press.';
                }).catch(function () { msg.textContent = 'Something went wrong. Please try again, or write hello@inkhorn.press.'; });
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
