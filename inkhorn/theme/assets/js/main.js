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
