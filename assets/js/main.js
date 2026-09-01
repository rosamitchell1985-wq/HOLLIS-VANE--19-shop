/* ==========================================================================
   HOLLIS & VANE / shared behaviour
   Vanilla JS, no dependencies. Everything degrades gracefully without JS:
   content is visible by default, links are real links, forms post normally.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function on(el, type, fn, opts) { if (el) el.addEventListener(type, fn, opts); }

  function readStore(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage blocked */ }
  }

  /* =====================================================================
     1. Mobile navigation
     ===================================================================== */
  function initNav() {
    var toggle = $('[data-menu-toggle]');
    var panel = $('[data-mobile-nav]');
    if (!toggle || !panel) return;

    var closeBtn = $('[data-menu-close]', panel);
    var lastFocused = null;

    function setOpen(open) {
      panel.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.setAttribute('data-nav-open', open ? 'true' : 'false');
      if (open) {
        lastFocused = document.activeElement;
        var first = $('a, button', panel);
        if (first) first.focus();
      } else if (lastFocused) {
        lastFocused.focus();
      }
    }

    on(toggle, 'click', function () {
      setOpen(panel.getAttribute('data-open') !== 'true');
    });
    on(closeBtn, 'click', function () { setOpen(false); });

    on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && panel.getAttribute('data-open') === 'true') setOpen(false);
    });

    // Keep focus inside the panel while it is open.
    on(panel, 'keydown', function (e) {
      if (e.key !== 'Tab') return;
      var focusables = $$('a[href], button:not([disabled])', panel);
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* =====================================================================
     2. Cursor dot (fine pointers only, disabled under reduced motion)
     ===================================================================== */
  function initCursor() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (reduceMotion.matches) return;

    var dot = document.createElement('div');
    dot.className = 'cursor-dot';
    dot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(dot);
    root.classList.add('cursor-on');

    var x = 0, y = 0, raf = null;

    function paint() {
      raf = null;
      dot.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) translate(-50%,-50%)';
    }

    on(document, 'pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY;
      dot.setAttribute('data-active', 'true');
      if (!raf) raf = window.requestAnimationFrame(paint);
    }, { passive: true });

    on(document, 'pointerleave', function () { dot.setAttribute('data-active', 'false'); });

    // Grow over anything clickable so the target is never ambiguous.
    on(document, 'pointerover', function (e) {
      var t = e.target.closest ? e.target.closest('a, button, input, select, textarea, [role="button"]') : null;
      dot.setAttribute('data-hover', t ? 'true' : 'false');
    });
  }

  /* =====================================================================
     3. Scroll reveal / enhances an already visible default
     ===================================================================== */
  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    if (reduceMotion.matches || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    items.forEach(function (el) { io.observe(el); });

    // Safety net: if the observer never fires (hidden tab, headless render),
    // show everything after 2.5s so no section can ship blank.
    window.setTimeout(function () {
      items.forEach(function (el) { el.classList.add('is-in'); });
    }, 2500);
  }

  /* =====================================================================
     4. Bag
     Stored in localStorage on the visitor's own device, never in a cookie,
     so it needs no consent. Every page reads it for the header count; the
     bag page reads it for the full line-item view.
     ===================================================================== */
  var BAG_KEY = 'hv_bag_v1';
  var FREE_SHIPPING_FROM = 250;   // USD, matches Shipping and Delivery
  var FLAT_SHIPPING = 9;          // USD below the threshold

  function getBag() {
    var bag = readStore(BAG_KEY, []);
    if (!Array.isArray(bag)) return [];
    // Tolerate lines written by an earlier version that had no numeric value.
    return bag.map(function (l) {
      if (typeof l.value !== 'number' || isNaN(l.value)) {
        l.value = parseFloat(String(l.price || '0').replace(/[^0-9.]/g, '')) || 0;
      }
      l.qty = Math.max(1, parseInt(l.qty, 10) || 1);
      return l;
    });
  }

  function setBag(bag) {
    writeStore(BAG_KEY, bag);
    renderBagCount();
    renderBagPage();
  }

  function usd(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function lineKey(l) { return l.name + '||' + l.size; }

  function bagCount() {
    return getBag().reduce(function (sum, l) { return sum + l.qty; }, 0);
  }

  function renderBagCount() {
    var count = bagCount();
    $$('[data-bag-count]').forEach(function (el) {
      el.textContent = String(count);
      var link = el.closest('a');
      if (link) {
        link.setAttribute('aria-label', count === 0
          ? 'Bag, empty'
          : 'Bag, ' + count + (count === 1 ? ' item' : ' items'));
      }
    });
  }

  /* ---- adding, from any product surface ---- */
  function initAddToBag() {
    $$('[data-add-to-bag]').forEach(function (btn) {
      on(btn, 'click', function () {
        var scope = btn.closest('[data-product-scope]') || document;
        var status = $('[data-bag-status]', scope);
        var sizeButtons = $$('.size-btn', scope);
        var chosen = $('.size-btn[aria-pressed="true"]', scope);

        if (sizeButtons.length && !chosen) {
          if (status) status.textContent = 'Choose a size first.';
          sizeButtons[0].focus();
          return;
        }

        var line = {
          name: btn.getAttribute('data-name') || 'Item',
          size: chosen ? chosen.getAttribute('data-size') : 'One size',
          price: btn.getAttribute('data-price') || '',
          value: parseFloat((btn.getAttribute('data-value') || btn.getAttribute('data-price') || '0').replace(/[^0-9.]/g, '')) || 0,
          href: btn.getAttribute('data-href') || '',
          img: btn.getAttribute('data-img') || '',
          qty: 1
        };

        var bag = getBag();
        var existing = bag.filter(function (l) { return lineKey(l) === lineKey(line); })[0];
        if (existing) { existing.qty += 1; } else { bag.push(line); }
        setBag(bag);

        if (status) {
          var n = bagCount();
          status.textContent = line.name + ', size ' + line.size + ', added to your bag. '
            + n + (n === 1 ? ' item' : ' items') + ' in the bag.';
        }
      });
    });
  }

  /* ---- size selection ---- */
  function initSizes() {
    $$('.size-row').forEach(function (row) {
      var buttons = $$('.size-btn', row);
      // A one-size piece has nothing to choose, so choose it for the visitor.
      if (buttons.length === 1) buttons[0].setAttribute('aria-pressed', 'true');

      buttons.forEach(function (btn) {
        on(btn, 'click', function () {
          buttons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
          btn.setAttribute('aria-pressed', 'true');
          var scope = row.closest('[data-product-scope]') || document;
          var status = $('[data-bag-status]', scope);
          if (status) status.textContent = '';
        });
      });
    });
  }

  /* ---- the bag page itself ---- */
  function renderBagPage() {
    var list = $('[data-bag-list]');
    if (!list) return;

    var empty = $('[data-bag-empty]');
    var summary = $('[data-bag-summary]');
    var bag = getBag();

    if (!bag.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      if (summary) summary.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (summary) summary.hidden = false;

    list.innerHTML = bag.map(function (l, i) {
      var media = l.img
        ? '<a class="bag-media" href="' + l.href + '" tabindex="-1" aria-hidden="true"><img src="' + l.img
          + '" alt="" width="400" height="500" loading="lazy" decoding="async"></a>'
        : '';
      var title = l.href ? '<a href="' + l.href + '">' + l.name + '</a>' : l.name;
      return '<article class="bag-line">'
        + media
        + '<div class="bag-body">'
        +   '<h2 class="bag-name">' + title + '</h2>'
        +   '<p class="meta">Size ' + l.size + ' / ' + usd(l.value) + ' each</p>'
        +   '<div class="bag-qty">'
        +     '<button class="qty-btn" type="button" data-qty="-1" data-i="' + i + '" aria-label="Reduce quantity of ' + l.name + '">Less</button>'
        +     '<span class="qty-value">' + l.qty + '</span>'
        +     '<button class="qty-btn" type="button" data-qty="1" data-i="' + i + '" aria-label="Increase quantity of ' + l.name + '">More</button>'
        +   '</div>'
        +   '<button class="text-link text-link-quiet" type="button" data-remove="' + i + '">Remove</button>'
        + '</div>'
        + '<p class="bag-line-total">' + usd(l.value * l.qty) + '</p>'
        + '</article>';
    }).join('');

    var subtotal = bag.reduce(function (sum, l) { return sum + l.value * l.qty; }, 0);
    var shipping = subtotal >= FREE_SHIPPING_FROM ? 0 : FLAT_SHIPPING;
    var shortfall = Math.max(0, FREE_SHIPPING_FROM - subtotal);

    function set(sel, text) { var el = $(sel); if (el) el.textContent = text; }
    set('[data-subtotal]', usd(subtotal));
    set('[data-shipping]', shipping === 0 ? 'Free' : usd(shipping));
    set('[data-total]', usd(subtotal + shipping));
    set('[data-threshold]', shortfall > 0
      ? 'Add ' + usd(shortfall) + ' to qualify for free US ground shipping.'
      : 'This order qualifies for free US ground shipping.');

    // Rebind the controls we just wrote.
    $$('[data-qty]', list).forEach(function (btn) {
      on(btn, 'click', function () {
        var b = getBag();
        var idx = parseInt(btn.getAttribute('data-i'), 10);
        var delta = parseInt(btn.getAttribute('data-qty'), 10);
        if (!b[idx]) return;
        b[idx].qty += delta;
        if (b[idx].qty < 1) b.splice(idx, 1);
        setBag(b);
      });
    });

    $$('[data-remove]', list).forEach(function (btn) {
      on(btn, 'click', function () {
        var b = getBag();
        var idx = parseInt(btn.getAttribute('data-remove'), 10);
        var removed = b[idx] ? b[idx].name : 'Item';
        b.splice(idx, 1);
        setBag(b);
        var note = $('[data-bag-note]');
        if (note) note.textContent = removed + ' removed from your bag.';
      });
    });
  }

  function initBagPage() {
    if (!$('[data-bag-list]')) return;
    renderBagPage();

    on($('[data-bag-clear]'), 'click', function () {
      setBag([]);
      var note = $('[data-bag-note]');
      if (note) note.textContent = 'Your bag has been emptied.';
    });

    on($('[data-checkout]'), 'click', function () {
      var note = $('[data-checkout-note]');
      if (!note) return;
      if (!getBag().length) { note.textContent = 'Your bag is empty.'; return; }
      note.textContent = 'Card checkout is not connected in this build. To place this order now, '
        + 'call +1 (212) 555-0148 between 9:00 and 18:00 ET, or email clientcare@hollisandvane.com '
        + 'with the summary above and we will send a payment link.';
    });
  }

  function initBag() {
    renderBagCount();
    initAddToBag();
    initSizes();
    initBagPage();
  }

  /* =====================================================================
     5. Product detail gallery
     ===================================================================== */
  function initGallery() {
    var stage = $('[data-gallery-stage]');
    if (!stage) return;
    var frames = $$('img', stage);
    var thumbs = $$('[data-gallery-thumb]');

    function show(index) {
      frames.forEach(function (img, i) { img.classList.toggle('is-active', i === index); });
      thumbs.forEach(function (t, i) { t.setAttribute('aria-pressed', i === index ? 'true' : 'false'); });
    }

    thumbs.forEach(function (thumb, i) {
      on(thumb, 'click', function () { show(i); });
    });

    show(0);
  }

  /* =====================================================================
     6. Shop filters
     ===================================================================== */
  function initFilters() {
    var grid = $('[data-product-grid]');
    if (!grid) return;

    var cards = $$('[data-product]', grid);
    var status = $('[data-filter-status]');
    var empty = $('[data-empty-state]');
    var state = { category: 'all', size: 'all', price: 'all' };

    function matches(card) {
      var cat = card.getAttribute('data-category') || '';
      var sizes = (card.getAttribute('data-sizes') || '').split(' ');
      var price = parseFloat(card.getAttribute('data-price') || '0');

      if (state.category !== 'all' && cat !== state.category) return false;
      if (state.size !== 'all' && sizes.indexOf(state.size) === -1) return false;
      if (state.price === 'under-300' && price >= 300) return false;
      if (state.price === '300-700' && (price < 300 || price > 700)) return false;
      if (state.price === 'over-700' && price <= 700) return false;
      return true;
    }

    function apply() {
      var shown = 0;
      cards.forEach(function (card) {
        var ok = matches(card);
        card.hidden = !ok;
        if (ok) shown += 1;
      });
      if (status) {
        status.textContent = shown === cards.length
          ? 'Showing all ' + cards.length + ' pieces'
          : 'Showing ' + shown + ' of ' + cards.length + ' pieces';
      }
      if (empty) empty.hidden = shown !== 0;
    }

    $$('[data-filter]').forEach(function (btn) {
      on(btn, 'click', function () {
        var group = btn.getAttribute('data-filter');
        var value = btn.getAttribute('data-value');
        state[group] = value;
        $$('[data-filter="' + group + '"]').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        apply();
      });
    });

    var reset = $('[data-filter-reset]');
    on(reset, 'click', function () {
      state = { category: 'all', size: 'all', price: 'all' };
      $$('[data-filter]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-value') === 'all' ? 'true' : 'false');
      });
      apply();
    });

    apply();
  }

  /* =====================================================================
     7. Accordions
     ===================================================================== */
  function initAccordions() {
    $$('.acc-trigger').forEach(function (trigger) {
      var item = trigger.closest('.acc-item');
      var panel = $('.acc-panel', item);
      if (!panel) return;
      var mark = $('.acc-mark', trigger);

      on(trigger, 'click', function () {
        var open = item.getAttribute('data-open') === 'true';
        item.setAttribute('data-open', open ? 'false' : 'true');
        trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (mark) mark.textContent = open ? '+' : '−';
      });
    });
  }

  /* =====================================================================
     8. Form validation with inline messages
     ===================================================================== */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function validateField(field) {
    var input = $('input, select, textarea', field);
    var errorEl = $('.field-error', field);
    if (!input || !errorEl) return true;

    var value = (input.value || '').trim();
    var label = field.getAttribute('data-label') || 'This field';
    var message = '';

    if (input.hasAttribute('required') && input.type === 'checkbox' && !input.checked) {
      message = 'Please tick this box to continue.';
    } else if (input.hasAttribute('required') && !value && input.type !== 'checkbox') {
      message = label + ' is required.';
    } else if (value && input.type === 'email' && !EMAIL_RE.test(value)) {
      message = 'Enter a valid email address, for example name@example.com.';
    } else if (value && input.type === 'tel' && value.replace(/[^\d]/g, '').length < 10) {
      message = 'Enter a 10-digit US phone number.';
    } else if (value && input.hasAttribute('minlength') && value.length < parseInt(input.getAttribute('minlength'), 10)) {
      message = label + ' needs at least ' + input.getAttribute('minlength') + ' characters.';
    }

    errorEl.textContent = message;
    field.setAttribute('data-invalid', message ? 'true' : 'false');
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  }

  function initForms() {
    $$('[data-validate]').forEach(function (form) {
      var fields = $$('.field, .checkbox-field', form);
      var status = $('[data-form-status]', form);

      fields.forEach(function (field) {
        var input = $('input, select, textarea', field);
        if (!input) return;
        on(input, 'blur', function () { validateField(field); });
        on(input, 'input', function () {
          if (field.getAttribute('data-invalid') === 'true') validateField(field);
        });
      });

      on(form, 'submit', function (e) {
        e.preventDefault();
        var ok = true;
        var firstBad = null;
        fields.forEach(function (field) {
          var valid = validateField(field);
          if (!valid && !firstBad) firstBad = field;
          ok = ok && valid;
        });

        if (!ok) {
          if (status) status.textContent = 'Please correct the highlighted fields.';
          var input = firstBad ? $('input, select, textarea', firstBad) : null;
          if (input) input.focus();
          return;
        }

        if (status) status.textContent = form.getAttribute('data-success')
          || 'Thank you. Your message has been received and we reply within one business day.';
        form.reset();
        fields.forEach(function (field) {
          field.setAttribute('data-invalid', 'false');
          var err = $('.field-error', field);
          if (err) err.textContent = '';
        });
      });
    });
  }

  /* =====================================================================
     9. Cookie consent
     No non-essential storage is written until an explicit choice is made.
     ===================================================================== */
  var CONSENT_KEY = 'hv_consent_v1';

  function applyConsent(consent) {
    // Hook point for real vendors. Analytics and advertising tags are only
    // ever loaded from inside these branches, after consent is granted.
    if (consent.analytics) {
      // e.g. load measurement script here
    }
    if (consent.advertising) {
      // e.g. load Google AdSense / ad manager script here
    }
  }

  function initCookies() {
    var banner = $('[data-cookie-banner]');
    if (!banner) return;

    var stored = readStore(CONSENT_KEY, null);
    if (stored && typeof stored === 'object') {
      applyConsent(stored);
      wireManageLinks();
      return;
    }

    banner.setAttribute('data-visible', 'true');
    window.setTimeout(function () { banner.setAttribute('data-shown', 'true'); }, 60);

    var prefs = $('[data-cookie-prefs]', banner);

    // Reopening the banner must not stack a second set of listeners on it.
    if (banner.getAttribute('data-wired') === 'true') { wireManageLinks(); return; }
    banner.setAttribute('data-wired', 'true');

    on($('[data-cookie-manage]', banner), 'click', function () {
      var open = prefs.getAttribute('data-open') === 'true';
      prefs.setAttribute('data-open', open ? 'false' : 'true');
    });

    function save(consent) {
      consent.essential = true;
      consent.timestamp = new Date().toISOString();
      writeStore(CONSENT_KEY, consent);
      applyConsent(consent);
      banner.setAttribute('data-shown', 'false');
      window.setTimeout(function () { banner.setAttribute('data-visible', 'false'); }, 420);
    }

    on($('[data-cookie-accept]', banner), 'click', function () {
      save({ analytics: true, advertising: true });
    });
    on($('[data-cookie-reject]', banner), 'click', function () {
      save({ analytics: false, advertising: false });
    });
    on($('[data-cookie-save]', banner), 'click', function () {
      save({
        analytics: !!($('#cookie-analytics') && $('#cookie-analytics').checked),
        advertising: !!($('#cookie-ads') && $('#cookie-ads').checked)
      });
    });

    wireManageLinks();
  }

  // Any page can offer "change your cookie choices" via [data-cookie-reopen].
  function wireManageLinks() {
    $$('[data-cookie-reopen]').forEach(function (link) {
      if (link.getAttribute('data-wired') === 'true') return;
      link.setAttribute('data-wired', 'true');
      on(link, 'click', function (e) {
        e.preventDefault();
        try { window.localStorage.removeItem(CONSENT_KEY); } catch (err) { /* noop */ }
        var banner = $('[data-cookie-banner]');
        if (!banner) { window.location.href = link.getAttribute('href') || '#'; return; }
        banner.setAttribute('data-visible', 'true');
        window.setTimeout(function () { banner.setAttribute('data-shown', 'true'); }, 60);
        initCookies();
      });
    });
  }

  /* =====================================================================
     10. Back to top (sentinel based, no scroll listener)
     ===================================================================== */
  function initBackToTop() {
    var btn = $('[data-to-top]');
    if (!btn) return;

    on(btn, 'click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      var skip = $('.skip-link');
      if (skip) skip.focus();
    });

    if (!('IntersectionObserver' in window)) { btn.setAttribute('data-visible', 'true'); return; }

    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:70vh;left:0;width:1px;height:1px;pointer-events:none;';
    document.body.appendChild(sentinel);

    new IntersectionObserver(function (entries) {
      btn.setAttribute('data-visible', entries[0].isIntersecting ? 'false' : 'true');
    }).observe(sentinel);
  }

  /* =====================================================================
     11. Current year in footers
     ===================================================================== */
  function initYear() {
    var year = String(new Date().getFullYear());
    $$('[data-year]').forEach(function (el) { el.textContent = year; });
  }

  /* =====================================================================
     Boot
     ===================================================================== */
  function boot() {
    initNav();
    initCursor();
    initReveal();
    initBag();
    initGallery();
    initFilters();
    initAccordions();
    initForms();
    initCookies();
    initBackToTop();
    initYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
