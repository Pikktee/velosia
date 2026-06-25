/*
 * Velosia Autofill Engine — shared single source of truth
 * ---------------------------------------------------------
 * Pure DOM JavaScript (no chrome.* APIs, no platform globals) so the exact same
 * file can run in two very different hosts:
 *
 *   1. Chrome/Firefox extension  -> loaded as a content script before content.js.
 *   2. Android WebView shell      -> bundled as an asset and injected via
 *                                    WebView.evaluateJavascript().
 *
 * The host is responsible for authentication, fetching the draft JSON and (for the
 * extension) handing over the resolved image URLs / backend base url. The engine
 * only touches the DOM of the target page (Vinted / Kleinanzeigen).
 *
 * Public API:
 *   window.__velosia.autofill(draft, options) -> Promise<result>
 *
 *   options = {
 *     platform:   "vinted" | "kleinanzeigen" | null  (null = auto-detect)
 *     autoSubmit: boolean   (default false -> user reviews & clicks publish himself)
 *     userZip:    string    (Kleinanzeigen postcode, optional)
 *     userCity:   string    (optional)
 *     backendUrl: string    (used to resolve relative image paths, extension only)
 *     imageMode:  "datatransfer" | "native"  (datatransfer = engine fetches & injects
 *                  the files itself; native = engine only clicks the <input type=file>
 *                  so the Android host can supply the photo via onShowFileChooser)
 *     showOverlay: boolean  (default true -> visible "what was filled" panel)
 *   }
 *
 *   result = { platform, phase, filled:[], manual:[], photos:Number, submitted:Bool }
 */
(function () {
  "use strict";

  // Re-injection guard. On Android the script may be injected on every page load,
  // and in the extension it is a persistent content script — never redefine.
  if (window.__velosia && window.__velosia.__loaded) return;

  var VERSION = "2.6.0";

  // ----------------------------------------------------------------------------
  // Low level helpers
  // ----------------------------------------------------------------------------

  function norm(s) {
    return (s == null ? "" : String(s))
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, " ")
      .trim();
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function isInteractable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.type === "hidden") return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    var style = window.getComputedStyle(el);
    if (!style) return true;
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  }

  /*
   * React/Vue store the "real" value in their own state and overwrite the input's
   * value setter. A plain `el.value = x` updates the visible DOM node but is wiped
   * on the next render / lost on submit. We must call the *native* prototype setter
   * and then dispatch a bubbling input event so the framework picks the change up.
   * This is THE fix that makes Vinted (a React SPA) actually work.
   */
  function setNativeValue(el, value) {
    var ownDesc = Object.getOwnPropertyDescriptor(el, "value");
    var proto = Object.getPrototypeOf(el);
    var protoDesc = Object.getOwnPropertyDescriptor(proto, "value");
    var ownSetter = ownDesc && ownDesc.set;
    var protoSetter = protoDesc && protoDesc.set;

    if (protoSetter && ownSetter !== protoSetter) {
      protoSetter.call(el, value);
    } else if (ownSetter) {
      ownSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fillField(el, value) {
    if (!el) return false;
    if (value === undefined || value === null || value === "") return false;
    try { el.focus(); } catch (e) {}
    setNativeValue(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try { el.setAttribute("data-velosia-filled", "1"); } catch (e) {}
    return true;
  }

  // ----------------------------------------------------------------------------
  // Field discovery — try multiple strategies, prefer interactable elements
  // ----------------------------------------------------------------------------

  function pickFromSelector(selector) {
    var els;
    try { els = document.querySelectorAll(selector); } catch (e) { return null; }
    for (var i = 0; i < els.length; i++) {
      if (isInteractable(els[i])) return els[i];
    }
    return null;
  }

  function firstBySelectors(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = pickFromSelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  // Collect label-ish text describing a control (label[for], wrapping label/legend,
  // aria-label, name, placeholder). Used both for fallback matching and attributes.
  function labelTextFor(el) {
    var txt = "";
    if (el.id) {
      var lab = document.querySelector("label[for='" + el.id + "']");
      if (lab) txt += " " + lab.textContent;
    }
    txt += " " + (el.getAttribute("aria-label") || "");
    txt += " " + (el.getAttribute("name") || "");
    txt += " " + (el.getAttribute("placeholder") || "");
    var node = el.parentElement, depth = 0;
    while (node && depth < 4) {
      if (node.tagName === "LABEL" || node.tagName === "LEGEND") txt += " " + node.textContent;
      var inner = node.querySelector ? node.querySelector("label, legend") : null;
      if (inner) txt += " " + inner.textContent;
      node = node.parentElement; depth++;
    }
    return norm(txt);
  }

  // Fallback: scan all controls of the given tags and match their label text.
  function findByLabel(needles, tags) {
    var sel = tags.join(",");
    var fields = document.querySelectorAll(sel);
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!isInteractable(el)) continue;
      var txt = labelTextFor(el);
      for (var j = 0; j < needles.length; j++) {
        if (txt.indexOf(needles[j]) !== -1) return el;
      }
    }
    return null;
  }

  function findField(spec) {
    return firstBySelectors(spec.selectors) ||
           (spec.labels ? findByLabel(spec.labels, spec.tags || ["input", "textarea"]) : null);
  }

  // ----------------------------------------------------------------------------
  // Platform / phase detection
  // ----------------------------------------------------------------------------

  function detectPlatform() {
    var h = window.location.hostname || "";
    if (h.indexOf("kleinanzeigen") !== -1) return "kleinanzeigen";
    if (h.indexOf("vinted") !== -1) return "vinted";
    return null;
  }

  // Kleinanzeigen is a two-step flow: step 1 picks a category from a hierarchical
  // tree (hash-routed), step 2 is the real form. Vinted has a single form page.
  function detectPhase(platform) {
    var p = window.location.pathname || "";
    if (platform === "kleinanzeigen") {
      if (p.indexOf("p-anzeige-aufgeben-schritt2") !== -1) return "form";
      if (p.indexOf("p-anzeige-aufgeben") !== -1) return "category";
      return "form";
    }
    return "form";
  }

  // ----------------------------------------------------------------------------
  // Field maps per platform. Order matters: most reliable selector first, then
  // looser fallbacks, then label-text matching.
  // ----------------------------------------------------------------------------

  var FIELD_MAP = {
    vinted: {
      // Verified against the live vinted.de "items/new" form (data-testid is the
      // most stable handle; #id and name are equivalent fallbacks).
      title: {
        selectors: ["input[data-testid='title--input']", "#title", "input[name='title']", "input[placeholder*='verkaufst']"],
        labels: ["titel", "title"], tags: ["input"]
      },
      description: {
        selectors: ["textarea[data-testid='description--input']", "#description", "textarea[name='description']", "textarea[placeholder*='darüber']"],
        labels: ["beschreib", "description"], tags: ["textarea"]
      },
      price: {
        selectors: ["input[data-testid='price-input--input']", "#price", "input[name='price']", "input[placeholder*='0,00']"],
        labels: ["preis", "price"], tags: ["input"]
      }
    },
    kleinanzeigen: {
      // Verified against the live p-anzeige-aufgeben-schritt2 form. The form now
      // uses #ad-* ids and name="priceAmount"/"zipCode"; the old #postad-*/#pstad-*
      // ids are kept only as trailing fallbacks for older layouts.
      title: {
        selectors: ["#ad-title", "input[name='title']", "#postad-title", "input[id*='title']"],
        labels: ["titel", "überschrift", "uberschrift"], tags: ["input"]
      },
      description: {
        selectors: ["#ad-description", "textarea[name='description']", "#pstad-descrptn", "textarea[id*='descr']"],
        labels: ["beschreib"], tags: ["textarea"]
      },
      price: {
        selectors: ["#ad-price-amount", "input[name='priceAmount']", "#pstad-price", "input[id*='price']"],
        labels: ["preis"], tags: ["input"]
      }
    }
  };

  // ----------------------------------------------------------------------------
  // Images
  // ----------------------------------------------------------------------------

  function resolveImageUrls(draft, backendUrl) {
    var paths = [];
    if (draft.image_paths) {
      var raw = draft.image_paths;
      if (typeof raw === "string") {
        try { raw = JSON.parse(raw); }
        catch (e) {
          // Backend may have stored a Python list repr with single quotes.
          try { raw = JSON.parse(raw.replace(/'/g, '"')); } catch (e2) { raw = null; }
        }
      }
      if (Array.isArray(raw)) paths = raw.filter(Boolean);
    }
    if (paths.length === 0 && draft.image_path) paths = [draft.image_path];
    var base = backendUrl || "";
    return paths.map(function (p) {
      return /^https?:\/\//.test(p) ? p : base + p;
    });
  }

  function findFileInput() {
    var inputs = document.querySelectorAll("input[type='file']");
    for (var i = 0; i < inputs.length; i++) {
      var accept = (inputs[i].accept || "").toLowerCase();
      if (accept === "" || accept.indexOf("image") !== -1) return inputs[i];
    }
    return inputs[0] || null;
  }

  // Poll for the file input — both forms may render it slightly after the core
  // fields. We deliberately do NOT click any "add photo" control to reveal it: on
  // these sites that control opens the native file chooser, which would pop over our
  // backdrop. If no input ever appears we simply leave the photos for a manual add.
  async function waitForFileInput() {
    var input = findFileInput();
    for (var i = 0; i < 8 && !input; i++) {
      await sleep(300);
      input = findFileInput();
    }
    return input;
  }

  // Fetch each photo and inject ALL of them into the file input via a DataTransfer
  // so the host page's normal upload handler runs. Used by the extension AND by the
  // Android WebView (CORS is "*" on the backend, so the cross-origin fetch of
  // /uploads works) — this uploads every draft photo and needs no user gesture,
  // unlike a programmatic file-chooser click which the WebView blocks.
  async function uploadPhotosDataTransfer(urls) {
    if (urls.length === 0) return 0;
    var input = await waitForFileInput();
    if (!input) return 0;
    var dt = new DataTransfer();
    var count = 0;
    for (var i = 0; i < urls.length; i++) {
      try {
        var resp = await fetch(urls[i]);
        if (!resp.ok) continue;
        var blob = await resp.blob();
        var type = blob.type || "image/jpeg";
        var ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        var file = new File([blob], "velosia_" + (i + 1) + "." + ext, { type: type });
        dt.items.add(file);
        count++;
      } catch (e) { /* skip individual image failures */ }
    }
    if (count === 0) return 0;
    try {
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return 0; }
    return count;
  }

  // Convert a data: URL (base64 or url-encoded) to a File, without any network.
  function dataUrlToFile(dataUrl, baseName) {
    var m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl || "");
    if (!m) return null;
    var type = m[1] || "image/jpeg";
    var isB64 = !!m[2];
    var raw = isB64 ? atob(m[3]) : decodeURIComponent(m[3]);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    return new File([bytes], baseName + "." + ext, { type: type });
  }

  // Android path: the native shell fetches every draft photo with okhttp (no browser
  // CORS) and hands them over as data: URLs through the VelosiaBridge. We build Files
  // from them and inject ALL of them via a DataTransfer — fully CORS-immune.
  async function uploadPhotosFromBridge() {
    var b = (typeof window !== "undefined") ? window.VelosiaBridge : null;
    if (!b || typeof b.getDraftImageCount !== "function") return -1; // bridge not available
    var n = 0;
    try { n = b.getDraftImageCount(); } catch (e) { return -1; }
    if (!n) return 0;
    var input = await waitForFileInput();
    if (!input || typeof DataTransfer === "undefined") return 0;
    var dt = new DataTransfer();
    var count = 0;
    for (var i = 0; i < n; i++) {
      try {
        var du = b.getDraftImageDataUrl(i);
        var f = du ? dataUrlToFile(du, "velosia_" + (i + 1)) : null;
        if (f) { dt.items.add(f); count++; }
      } catch (e) { /* skip individual failures */ }
    }
    if (count === 0) return 0;
    try {
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return 0; }
    return count;
  }

  // Native fallback (Android, only if DataTransfer is unavailable): trigger the
  // file chooser; the WebView host intercepts onShowFileChooser and supplies the
  // prepared photo URI. Kept for completeness — the datatransfer path is preferred.
  function triggerNativeFileChooser() {
    var input = findFileInput();
    if (input) { try { input.click(); return 1; } catch (e) {} }
    return 0;
  }

  // ----------------------------------------------------------------------------
  // Kleinanzeigen category picker (step 1: hierarchical category tree)
  // ----------------------------------------------------------------------------
  //
  // The category page (p-anzeige-aufgeben.html) is NOT a keyword search box — it
  // is a hash-routed tree. Each category is encoded in the URL hash, e.g.
  //   #?path=161/176/staubsauger&isParent=undefined
  // Navigating to a valid (leaf) path enables the green "Weiter" button which
  // proceeds to the schritt2 form with the category already filled in.
  //
  // The canonical path comes from the backend catalog via draft.category_path
  // (looked up from the chosen category name). When it is missing we fall back to
  // matching the visible link text; and if even that fails the listing simply
  // stays on the category page for one manual tap — the rest of the form is then
  // filled by the pending-autofill that survives the reload to schritt2.

  function getCategoryPath(draft) {
    var p = draft.category_path || draft.categoryPath || draft.ka_path;
    return (p && String(p).trim()) ? String(p).trim() : null;
  }

  // The primary step button on the category page ("Weiter"). It is disabled until
  // a valid category is selected, so isInteractable() doubles as a readiness gate.
  function findWeiterButton() {
    var cands = document.querySelectorAll(
      "button, a[role='button'], input[type='submit'], a[class*='utton'], a[class*='Button']"
    );
    for (var i = 0; i < cands.length; i++) {
      if (!isInteractable(cands[i])) continue;
      var t = norm(cands[i].innerText || cands[i].value || cands[i].textContent || "");
      if (!t) continue;
      if (t === "weiter" || (t.indexOf("weiter") !== -1 && t.length < 25)) return cands[i];
    }
    return null;
  }

  // Fuzzy text match against the visible category-tree links (fallback only).
  function findCategoryLinkByText(name) {
    var nn = norm(name);
    if (!nn) return null;
    var links = document.querySelectorAll(
      "a.category-selection-list-item-link, .category-selection-list-item a, a[href*='path=']"
    );
    var fuzzy = null;
    for (var i = 0; i < links.length; i++) {
      if (!isInteractable(links[i])) continue;
      var lt = norm(links[i].textContent || "");
      if (!lt) continue;
      if (lt === nn) return links[i];
      if (!fuzzy && (lt.indexOf(nn) !== -1 || nn.indexOf(lt) !== -1)) fuzzy = links[i];
    }
    return fuzzy;
  }

  // Poll for the (now enabled) "Weiter" button and click it to reach schritt2.
  async function proceedFromCategoryPage() {
    for (var i = 0; i < 14; i++) {
      var btn = findWeiterButton();
      if (btn) { try { console.log("Velosia: 'Weiter' gefunden, klicke ->", btn.textContent); btn.click(); return true; } catch (e) {} }
      await sleep(500);
    }
    console.warn("Velosia: kein aktiver 'Weiter'-Button gefunden (Kategorie evtl. nicht gesetzt)");
    return false;
  }

  async function autoSelectCategory(draft) {
    var path = getCategoryPath(draft);

    if (path) {
      // Robust path: jump straight to the category via the hash route, then click
      // "Weiter". A real click on the matching tree link (if rendered) is even more
      // reliable than the bare hash change, so we try that as a reinforcement.
      try { window.location.hash = "?path=" + path + "&isParent=undefined"; } catch (e) {}
      await sleep(900);
      var link = document.querySelector("a.category-selection-list-item-link[href*='path=" + path + "']") ||
                 document.querySelector("a[href*='path=" + path + "']");
      if (link) { try { link.click(); await sleep(700); } catch (e) {} }
      return await proceedFromCategoryPage();
    }

    // Fallback: no known path — match the category name against the visible tree.
    var name = (draft.category || "").trim();
    if (!name) return false;
    for (var t = 0; t < 4; t++) {
      var hit = findCategoryLinkByText(name);
      if (hit) {
        var li = hit.closest ? hit.closest("li") : null;
        var isLeaf = !!(li && li.className && li.className.indexOf("is-leaf") !== -1);
        try { hit.click(); } catch (e) {}
        await sleep(900);
        if (isLeaf) return await proceedFromCategoryPage();
        // Parent expanded — next round may surface the leaf (best effort).
      } else {
        await sleep(600);
      }
    }
    // Maybe a leaf is selected already; try to proceed, else leave it manual.
    return await proceedFromCategoryPage();
  }

  // ----------------------------------------------------------------------------
  // Kleinanzeigen category-specific attributes ("Zusatzfelder")
  // ----------------------------------------------------------------------------

  function parseAttributes(draft) {
    var a = draft.attributes;
    if (!a) return {};
    if (typeof a === "string") {
      try { a = JSON.parse(a); }
      catch (e) { try { a = JSON.parse(a.replace(/'/g, '"')); } catch (e2) { return {}; } }
    }
    return (a && typeof a === "object") ? a : {};
  }

  function pickOption(sel, value) {
    var nv = norm(value);
    if (!nv) return null;
    var i;
    for (i = 0; i < sel.options.length; i++) {
      if (norm(sel.options[i].textContent) === nv) return sel.options[i];
    }
    for (i = 0; i < sel.options.length; i++) {
      var ot = norm(sel.options[i].textContent);
      if (ot && sel.options[i].value && (ot.indexOf(nv) !== -1 || nv.indexOf(ot) !== -1)) return sel.options[i];
    }
    return null;
  }

  function fillAttributes(draft) {
    var attrs = parseAttributes(draft);
    var keys = Object.keys(attrs);
    if (keys.length === 0) return [];

    var filledLabels = [];
    var selects = Array.prototype.slice.call(document.querySelectorAll("select"));
    var texts = Array.prototype.slice.call(document.querySelectorAll("input[type='text'], input:not([type])"));

    keys.forEach(function (key) {
      var label = norm(key);
      var value = attrs[key] == null ? "" : String(attrs[key]);
      if (!label || !value) return;

      // Shipping is usually a checkbox/radio on Kleinanzeigen, not a select.
      if (label.indexOf("versand") !== -1) {
        var wantsShip = norm(value).indexOf("moglich") !== -1 || norm(value).indexOf("versand") !== -1;
        var boxes = document.querySelectorAll("input[type='checkbox'], input[type='radio']");
        var toggled = false;
        for (var b = 0; b < boxes.length; b++) {
          if (labelTextFor(boxes[b]).indexOf("versand") !== -1) {
            if (boxes[b].checked !== wantsShip) boxes[b].click();
            toggled = true;
          }
        }
        if (toggled) { filledLabels.push(key); return; }
      }

      // Try <select> dropdowns first.
      for (var i = 0; i < selects.length; i++) {
        if (selects[i].__velosiaKnown) continue;
        if (labelTextFor(selects[i]).indexOf(label) === -1) continue;
        var opt = pickOption(selects[i], value);
        if (opt) {
          selects[i].value = opt.value;
          selects[i].__velosiaKnown = true;
          selects[i].dispatchEvent(new Event("change", { bubbles: true }));
          filledLabels.push(key);
          return;
        }
      }
      // Then free-text inputs.
      for (var t = 0; t < texts.length; t++) {
        if (texts[t].__velosiaKnown) continue;
        if (labelTextFor(texts[t]).indexOf(label) === -1) continue;
        fillField(texts[t], value);
        texts[t].__velosiaKnown = true;
        filledLabels.push(key);
        return;
      }
    });
    return filledLabels;
  }

  // Make sure the listing is an offer ("Ich biete"), not a want ad ("Ich suche").
  function selectKleinanzeigenOffer() {
    var offer = document.querySelector("#ad-type-OFFER") ||
                document.querySelector("input[name='adType'][value='OFFER']");
    if (offer && !offer.checked) {
      offer.click();
    }
  }

  function setKleinanzeigenFixedPrice() {
    var radios = document.querySelectorAll("input[name='priceType']");
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      if (r.value === "FIXED" || (r.id && (r.id.indexOf("fixed") !== -1 || r.id.indexOf("fest") !== -1))) {
        r.checked = true;
        r.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }

  // ----------------------------------------------------------------------------
  // Vinted category picker (in-DOM dropdown, drilled level by level)
  // ----------------------------------------------------------------------------
  //
  // Vinted's picker is an always-in-DOM dropdown:
  //   [data-testid="catalog-select-dropdown-input"]    -> opens it
  //   [data-testid="catalog-select-dropdown-content"]  -> the option list
  // The top 1-2 levels render each option with [data-testid="catalog-icon-<ID>"];
  // deeper levels render plain web_ui__Cell rows carrying only the category NAME.
  // So we drill by catalog ID where available and fall back to the level's name
  // (taken from the breadcrumb). The draft provides:
  //   vinted_path      -> "1904/4/183/1839" (chain of catalog IDs to the leaf)
  //   vinted_category  -> "Damen > Kleidung > Jeans > Boyfriend Jeans" (names)

  // The picker exists in two layouts: the DESKTOP dropdown
  // ([data-testid='catalog-select-dropdown-content']) and the MOBILE full-screen
  // modal (a dialog with a "Finde eine Kategorie" search box and plain rows). In
  // the WebView shell Vinted serves the mobile modal, so we detect both.
  function vintedCategorySearchInput() {
    var inputs = document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])");
    for (var i = 0; i < inputs.length; i++) {
      if (!isInteractable(inputs[i])) continue;
      var ph = norm(inputs[i].placeholder || "");
      var al = norm(inputs[i].getAttribute("aria-label") || "");
      if (ph.indexOf("kategorie") !== -1 || ph.indexOf("category") !== -1 ||
          al.indexOf("kategorie") !== -1 || al.indexOf("category") !== -1) return inputs[i];
    }
    return null;
  }

  // The picker modal scoped as tightly as possible. We must NOT fall back to
  // document.body: the page BEHIND the open modal still holds catalog browse links
  // (<a href="/catalog/4833-…">) with the exact same category text, and clicking one
  // navigates away from items/new (observed live). So we scope to the dialog/sheet
  // ancestor of the search box, or the highest non-body ancestor of it.
  function vintedPickerContainer() {
    var d = document.querySelector("[data-testid='catalog-select-dropdown-content']");
    if (d) return d;
    var search = vintedCategorySearchInput();
    if (!search) return null;
    var explicit = search.closest("[role='dialog'], [aria-modal='true'], [class*='odal'], [class*='ialog'], [class*='heet'], [class*='rawer']");
    if (explicit) return explicit;
    // Walk up to the highest ancestor that is still below <body> (the modal root).
    var el = search, best = search.parentElement || search;
    while (el && el.parentElement && el.parentElement !== document.body) {
      best = el.parentElement;
      el = el.parentElement;
    }
    return best;
  }

  // Resolve the actual clickable element — but NEVER an <a href> (navigation).
  function vintedClickable(el) {
    return (el.closest && el.closest("button, li, [role='button'], [role='option'], [role='menuitem'], div[tabindex]")) || el;
  }

  // Robust, layout-agnostic match for a category row by its visible label. Works for
  // the desktop web_ui rows AND the mobile React rows (often a plain <div> with an
  // onClick and NO role/tabindex). Returns the DEEPEST element whose normalized own
  // text equals the name. CRITICAL: it never returns a navigating link or anything in
  // the page nav/header — only true in-picker option rows — so we never leave the form.
  function vintedRowMatch(root, name) {
    var target = norm(name);
    if (!target) return null;
    var nodes = root.querySelectorAll("button, li, div, span, p, [role='button'], [role='option'], [role='menuitem']");
    var exact = [], partial = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isInteractable(el)) continue;
      if (el.closest("#velosia-backdrop, #velosia-overlay, #velosia-arrow")) continue;
      if (el.closest("a[href]")) continue; // never a catalog browse link
      if (el.closest("header, nav, footer, [role='navigation'], [role='tablist'], [role='tab'], [data-testid^='catalog-navigation']")) continue;
      if (el.querySelector("input, textarea, a[href]")) continue; // skip wrappers holding the search box / links
      var t = norm(el.textContent || "");
      if (!t) continue;
      if (t === target) exact.push(el);
      else if (!partial && t.indexOf(target) !== -1 && t.length <= target.length + 16) partial = el;
    }
    if (exact.length) {
      exact.sort(function (a, b) { return a.getElementsByTagName("*").length - b.getElementsByTagName("*").length; });
      return exact[0];
    }
    return partial;
  }

  async function vintedClickLevel(id, name) {
    for (var t = 0; t < 16; t++) {
      var c = vintedPickerContainer();
      if (c && id) {
        var icon = c.querySelector("[data-testid='catalog-icon-" + id + "']");
        if (icon && isInteractable(icon)) { vintedClickable(icon).click(); return true; }
      }
      // Match option rows. The picker container often holds only the search box (the
      // option list lives in a sibling subtree), so we also search the whole document
      // — safe because vintedRowMatch excludes navigating links, so a document-wide
      // search can never drift onto a catalog browse link.
      var row = (c && vintedRowMatch(c, name)) || vintedRowMatch(document.body, name);
      if (row) { vintedClickable(row).click(); return true; }
      await sleep(350);
    }
    return false;
  }

  function vintedSetSearch(search, value) {
    try {
      setNativeValue(search, value);
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.dispatchEvent(new Event("keyup", { bubbles: true }));
    } catch (e) {}
  }

  // Diagnostic: log every element whose visible text equals the level name, with the
  // attributes that decide whether vintedRowMatch picks/excludes it. Reveals what the
  // real mobile picker rows look like (anchor? href? role?) so we can target them.
  function vintedDiag(name) {
    try {
      var target = norm(name);
      var nodes = document.querySelectorAll("a, button, li, div, span, p, [role]");
      var hits = [];
      for (var i = 0; i < nodes.length && hits.length < 8; i++) {
        var el = nodes[i];
        if (norm(el.textContent || "") !== target) continue;
        var a = el.closest("a[href]");
        var inNav = el.closest("header, nav, footer, [role='navigation'], [role='tablist'], [role='tab'], [data-testid^='catalog-navigation']");
        hits.push(el.tagName +
          (el.getAttribute && el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : "") +
          " href=" + (a ? a.getAttribute("href") : "-") +
          " interact=" + isInteractable(el) +
          " inNav=" + !!inNav +
          " kids=" + el.getElementsByTagName("*").length +
          " cls=" + ((el.className || "").toString().slice(0, 50)));
      }
      console.log("Velosia Vinted DIAG '" + name + "' [" + hits.length + "]: " + (hits.length ? hits.join("  ||  ") : "keine exakten Text-Treffer"));
    } catch (e) {}
  }

  async function selectVintedCategory(draft) {
    var ids = String(draft.vinted_path || draft.vintedPath || "").split("/").filter(Boolean);
    var names = String(draft.vinted_category || draft.vintedCategory || "")
      .split(">").map(function (s) { return s.trim(); }).filter(Boolean);
    if (names.length === 0 && ids.length === 0) return false;
    console.log("Velosia Vinted: Kategorie '" + names.join(" > ") + "' (ids " + ids.join("/") + ")");

    // Open the picker if it is not already open. Desktop exposes a dropdown input;
    // the mobile form opens a modal when its "Kategorie" row is tapped.
    if (!vintedPickerContainer()) {
      var opener = firstBySelectors([
        "[data-testid='catalog-select-dropdown-input']",
        "[data-testid='catalog-select-dropdown-chevron']"
      ]);
      if (!opener) {
        var cands = document.querySelectorAll("[role='button'], button, a, div[tabindex], li");
        for (var k = 0; k < cands.length; k++) {
          if (!isInteractable(cands[k])) continue;
          var lt = norm(cands[k].textContent || "");
          if (lt === "kategorie" || (lt.indexOf("kategorie") !== -1 && lt.length < 22)) { opener = cands[k]; break; }
        }
      }
      if (opener) {
        for (var o = 0; o < 12 && !vintedPickerContainer(); o++) {
          try {
            opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            opener.click();
            if (opener.focus) opener.focus();
          } catch (e) {}
          await sleep(300);
        }
      }
    }
    var hasSearch = !!vintedCategorySearchInput();
    console.log("Velosia Vinted: Picker offen=" + !!vintedPickerContainer() + ", Suchfeld=" + hasSearch);
    vintedDiag(names[0] || "");

    // Strategy A — drill level by level (catalog-id icon first, then robust name
    // match). This is the most deterministic: each level only shows its own children.
    var onForm = function () { return location.pathname.indexOf("/items/new") !== -1; };
    var levels = Math.max(names.length, ids.length);
    var drilled = true;
    for (var i = 0; i < levels; i++) {
      // Safety: if a click ever navigated us off the form (e.g. a stray browse link),
      // stop immediately instead of drilling on the wrong page.
      if (!onForm()) { console.warn("Velosia Vinted: Formular verlassen (" + location.pathname + ") — Abbruch"); return false; }
      var ok = await vintedClickLevel(ids[i] || null, names[i] || "");
      console.log("Velosia Vinted: Ebene " + i + " '" + (names[i] || "") + "' (id " + (ids[i] || "-") + ") -> " + (ok ? "geklickt" : "NICHT gefunden"));
      if (!ok) { vintedDiag(names[i] || ""); drilled = false; break; }
      await sleep(450);
    }
    if (drilled) {
      for (var v = 0; v < 12; v++) {
        if (!vintedPickerContainer()) { console.log("Velosia Vinted: per Durchklicken gewählt"); return true; }
        await sleep(300);
      }
    }

    // Strategy B (rescue) — mobile search box: type the leaf, click the matching
    // result. Used when drilling stalled (e.g. a level rendered differently).
    var leaf = names.length ? names[names.length - 1] : "";
    var search = vintedCategorySearchInput();
    if (search && leaf) {
      vintedSetSearch(search, leaf);
      var clicked = false;
      for (var s = 0; s < 12; s++) {
        await sleep(300);
        var res = vintedRowMatch(vintedPickerContainer() || document.body, leaf);
        if (res) { try { vintedClickable(res).click(); clicked = true; } catch (e) {} break; }
      }
      console.log("Velosia Vinted: Suche nach '" + leaf + "' -> " + (clicked ? "Treffer geklickt" : "kein Treffer"));
      for (var c2 = 0; c2 < 12; c2++) {
        if (!vintedPickerContainer()) { console.log("Velosia Vinted: per Suche gewählt"); return true; }
        await sleep(300);
      }
    }

    console.warn("Velosia Vinted: Picker blieb offen — Kategorie nicht gesetzt");
    return false;
  }

  // ----------------------------------------------------------------------------
  // Submit handling
  // ----------------------------------------------------------------------------

  function findButtonByText(needles) {
    var btns = document.querySelectorAll("button, input[type='submit'], a[role='button']");
    for (var i = 0; i < btns.length; i++) {
      var t = norm(btns[i].innerText || btns[i].value || "");
      for (var j = 0; j < needles.length; j++) {
        if (t.indexOf(needles[j]) !== -1) return btns[i];
      }
    }
    return null;
  }

  function findSubmitButton(platform) {
    if (platform === "vinted") {
      return document.querySelector("button[data-testid*='submit']") ||
             findButtonByText(["hochladen", "einstellen", "veröffentlichen", "veroffentlichen"]) ||
             document.querySelector("button[type='submit']");
    }
    return document.querySelector("#pstad-submit") ||
           findButtonByText(["anzeige aufgeben", "veröffentlichen", "veroffentlichen", "einstellen"]) ||
           document.querySelector("button[type='submit']");
  }

  function highlightButton(btn) {
    if (!btn) return;
    try {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      btn.style.transition = "box-shadow .4s ease";
      btn.style.boxShadow = "0 0 0 4px rgba(9,176,183,.65)";
      btn.style.borderRadius = btn.style.borderRadius || "8px";
    } catch (e) {}
  }

  async function trySubmit(platform) {
    for (var i = 0; i < 6; i++) {
      var btn = findSubmitButton(platform);
      if (btn) { try { btn.click(); return true; } catch (e) {} }
      await sleep(1200);
    }
    return false;
  }

  // ----------------------------------------------------------------------------
  // Visible feedback overlay — also serves as the "debug" view the user can read
  // to see exactly which fields were detected and which need a manual touch.
  // ----------------------------------------------------------------------------

  // One-time injection of the keyframe animations used by the backdrop spinner,
  // the bouncing "publish here" arrow and the pulsing button highlight.
  function injectStyleOnce() {
    if (document.getElementById("velosia-style")) return;
    try {
      var s = document.createElement("style");
      s.id = "velosia-style";
      s.textContent =
        "@keyframes velosia-spin{to{transform:rotate(360deg)}}" +
        "@keyframes velosia-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(9px)}}" +
        "@keyframes velosia-pulse{0%,100%{box-shadow:0 0 0 4px rgba(9,176,183,.6)}50%{box-shadow:0 0 0 10px rgba(9,176,183,.12)}}" +
        "@keyframes velosia-fade{from{opacity:0}to{opacity:1}}";
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  // Vinted/Kleinanzeigen forms are partly DESKTOP layouts rendered in a mobile
  // WebView: the page is wider/taller than the screen and pinch-/pan-zoomable, so
  // position:fixed anchors to the (large) *layout* viewport, not the visible area.
  // A plain inset:0 / right:16px overlay therefore lands off-screen. visualViewport
  // gives us the visible sub-rectangle; we align every overlay to it and keep it in
  // sync while the user scrolls or zooms.
  function viewportRect() {
    var vv = window.visualViewport;
    if (vv) return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function bindViewport(fn) {
    try { fn(); } catch (e) {}
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", fn);
        window.visualViewport.addEventListener("scroll", fn);
      }
      window.addEventListener("scroll", fn, { passive: true });
      window.addEventListener("resize", fn);
    } catch (e) {}
    return fn;
  }

  function unbindViewport(fn) {
    if (!fn) return;
    try {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", fn);
        window.visualViewport.removeEventListener("scroll", fn);
      }
      window.removeEventListener("scroll", fn);
      window.removeEventListener("resize", fn);
    } catch (e) {}
  }

  // Full-screen, interaction-blocking backdrop shown WHILE the form is being
  // filled. It deliberately covers the page so the user does not tap fields the
  // engine is still populating, and it is pinned to the *visible* viewport so the
  // spinner/text never end up off-screen on a scrolled desktop-layout page.
  var _backdropSync = null;
  function ensureBackdrop() {
    injectStyleOnce();
    var bd = document.getElementById("velosia-backdrop");
    if (bd) return bd;
    bd = document.createElement("div");
    bd.id = "velosia-backdrop";
    bd.style.cssText = [
      "position:fixed", "z-index:2147483646",
      "background:rgba(8,11,17,.80)", "-webkit-backdrop-filter:blur(2px)",
      "backdrop-filter:blur(2px)", "display:flex", "flex-direction:column",
      "align-items:center", "justify-content:center", "gap:18px",
      "pointer-events:auto", "animation:velosia-fade .2s ease",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"
    ].join(";");
    var spinner = '<div style="width:46px;height:46px;border-radius:50%;' +
      'border:4px solid rgba(255,255,255,.15);border-top-color:#09b0b7;' +
      'animation:velosia-spin .8s linear infinite;"></div>';
    bd.innerHTML =
      '<div style="font-weight:700;font-size:16px;background:linear-gradient(135deg,#09b0b7,#ec4899);' +
        '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">✨ Velosia</div>' +
      spinner +
      '<div id="velosia-backdrop-text" style="color:#e2e8f0;font-size:14px;max-width:80vw;text-align:center;padding:0 16px;">Formular wird vorbereitet …</div>';
    document.body.appendChild(bd);
    _backdropSync = bindViewport(function () {
      var r = viewportRect();
      bd.style.left = r.left + "px";
      bd.style.top = r.top + "px";
      bd.style.width = r.width + "px";
      bd.style.height = r.height + "px";
    });
    return bd;
  }

  function setBackdrop(text) {
    var t = document.getElementById("velosia-backdrop-text");
    if (t) t.textContent = text;
  }

  function removeBackdrop() {
    unbindViewport(_backdropSync); _backdropSync = null;
    var bd = document.getElementById("velosia-backdrop");
    if (!bd) return;
    try {
      bd.style.transition = "opacity .25s ease";
      bd.style.opacity = "0";
      setTimeout(function () { if (bd && bd.parentNode) bd.remove(); }, 280);
    } catch (e) { try { bd.remove(); } catch (e2) {} }
  }

  // Floating arrow that points at the publish button and keeps tracking it on
  // scroll/zoom, so the user immediately knows what to tap once the form is filled
  // (manual mode only). getBoundingClientRect and position:fixed share the layout-
  // viewport coordinate space, so the arrow stays glued to the button under pan/zoom.
  function pointToButton(btn) {
    if (!btn) return;
    injectStyleOnce();
    try { btn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
    try { btn.style.animation = "velosia-pulse 1.4s infinite"; btn.style.borderRadius = btn.style.borderRadius || "8px"; } catch (e) {}
    setTimeout(function () {
      var old = document.getElementById("velosia-arrow");
      if (old) old.remove();
      var a = document.createElement("div");
      a.id = "velosia-arrow";
      a.textContent = "👇 Hier veröffentlichen";
      a.style.cssText = [
        "position:fixed", "z-index:2147483647", "pointer-events:none",
        "background:linear-gradient(135deg,#09b0b7,#ec4899)", "color:#fff",
        "padding:7px 13px", "border-radius:999px", "font-size:13px", "font-weight:700",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        "box-shadow:0 8px 24px rgba(0,0,0,.45)", "animation:velosia-bounce 1s ease-in-out infinite",
        "white-space:nowrap"
      ].join(";");
      document.body.appendChild(a);
      bindViewport(function () {
        var r = btn.getBoundingClientRect();
        var top = r.top - 46;
        if (top < 8) top = r.bottom + 10; // not enough room above -> sit below
        var left = r.left + r.width / 2 - a.offsetWidth / 2;
        var vp = viewportRect();
        left = Math.max(vp.left + 8, Math.min(vp.left + vp.width - a.offsetWidth - 8, left));
        a.style.top = top + "px";
        a.style.left = left + "px";
      });
    }, 650);
  }

  function showOverlay(result, autoSubmit) {
    try {
      var existing = document.getElementById("velosia-overlay");
      if (existing) existing.remove();

      var box = document.createElement("div");
      box.id = "velosia-overlay";
      box.style.cssText = [
        "position:fixed", "z-index:2147483647", "width:300px", "max-width:86vw",
        "background:#0e121a",
        "color:#f8fafc", "border:1px solid rgba(9,176,183,.35)", "border-radius:14px",
        "box-shadow:0 12px 40px rgba(0,0,0,.55)", "padding:14px 16px",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        "font-size:13px", "line-height:1.45", "box-sizing:border-box"
      ].join(";");

      function row(icon, label, color) {
        return '<div style="display:flex;gap:8px;align-items:flex-start;margin-top:5px;">' +
               '<span style="flex-shrink:0;color:' + color + ';">' + icon + '</span>' +
               '<span style="color:#cbd5e1;">' + label + '</span></div>';
      }

      var filledHtml = result.filled.map(function (f) { return row("✓", f, "#34d399"); }).join("");
      var manualHtml = result.manual.map(function (f) { return row("•", f + " — bitte selbst wählen", "#f59e0b"); }).join("");
      var photoHtml = result.photos > 0
        ? row("✓", result.photos + (result.photos === 1 ? " Foto übertragen" : " Fotos übertragen"), "#34d399")
        : row("•", "Fotos — bitte selbst hinzufügen", "#f59e0b");

      var footer;
      if (result.phase === "category") {
        footer = '<div style="margin-top:11px;color:#94a3b8;font-size:12px;">Kategorie wird gewählt …</div>';
      } else if (autoSubmit) {
        footer = '<div style="margin-top:11px;color:#94a3b8;font-size:12px;">Wird automatisch veröffentlicht …</div>';
      } else {
        footer = '<div style="margin-top:11px;color:#e2e8f0;font-size:12px;background:rgba(9,176,183,.12);border:1px solid rgba(9,176,183,.3);border-radius:8px;padding:8px 10px;">Prüfe die Angaben und klicke unten auf <b>Veröffentlichen</b>.</div>';
      }

      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<span style="font-weight:700;background:linear-gradient(135deg,#09b0b7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">✨ Velosia</span>' +
          '<span id="velosia-overlay-close" style="cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;">&times;</span>' +
        '</div>' +
        filledHtml + photoHtml + manualHtml + footer;

      document.body.appendChild(box);
      // Anchor to the visible viewport's bottom-right (tracks scroll/zoom) so the
      // panel never drifts off a wide/tall desktop-layout page.
      var sync = bindViewport(function () {
        var r = viewportRect();
        box.style.left = Math.max(r.left + 8, r.left + r.width - box.offsetWidth - 16) + "px";
        box.style.top = (r.top + r.height - box.offsetHeight - 16) + "px";
      });
      var close = document.getElementById("velosia-overlay-close");
      if (close) close.addEventListener("click", function () { unbindViewport(sync); box.remove(); });
      if (result.phase !== "category" && !autoSubmit) {
        setTimeout(function () { if (box && box.parentNode) box.style.opacity = "0.96"; }, 50);
      }
    } catch (e) { /* overlay is best-effort, never block autofill */ }
  }

  // ----------------------------------------------------------------------------
  // Core fill (Vinted form + Kleinanzeigen step 2 form)
  // ----------------------------------------------------------------------------

  async function fillForm(draft, options, platform) {
    var map = FIELD_MAP[platform] || FIELD_MAP.vinted;
    var filled = [];
    var manual = [];
    var categoryOk = null;   // null = not applicable here, bool = picker result
    var attrCount = 0;

    // Poll for the title field — both forms render asynchronously.
    setBackdrop("Formular wird gelesen …");
    var titleEl = null;
    for (var i = 0; i < 24 && !titleEl; i++) {
      titleEl = findField(map.title);
      if (!titleEl) await sleep(500);
    }

    var descEl = findField(map.description);
    var priceEl = findField(map.price);

    setBackdrop("Titel, Beschreibung & Preis …");
    if (fillField(titleEl, draft.title)) filled.push("Titel");
    if (fillField(descEl, draft.description)) filled.push("Beschreibung");
    if (draft.price !== undefined && draft.price !== null) {
      if (fillField(priceEl, String(Math.round(draft.price)))) filled.push("Preis");
    }
    if (titleEl) titleEl.__velosiaKnown = true;
    if (descEl) descEl.__velosiaKnown = true;
    if (priceEl) priceEl.__velosiaKnown = true;

    // Photos first — injecting them early (before the slower attribute / category
    // steps) makes the upload feel instant and gives the page the most time to
    // render the previews. Prefer the DataTransfer path everywhere (it uploads ALL
    // draft photos and needs no user gesture); the native chooser is only a fallback
    // for environments without DataTransfer or resolvable URLs.
    setBackdrop("Fotos werden übertragen …");
    var photos = 0;
    // 1) Android bridge (CORS-immune: native shell supplies the photos as data URLs).
    var bridged = await uploadPhotosFromBridge();
    if (bridged >= 0) photos = bridged;
    // 2) Browser fetch + DataTransfer (extension, or Android if the bridge is absent).
    if (photos === 0) {
      var urls = resolveImageUrls(draft, options.backendUrl);
      if (typeof DataTransfer !== "undefined" && urls.length > 0) {
        photos = await uploadPhotosDataTransfer(urls);
      }
    }
    // 3) Last-resort native file chooser.
    if (photos === 0 && options.imageMode === "native") photos = triggerNativeFileChooser();
    try { console.log("Velosia: Fotos übertragen -> " + photos + " (Modus " + options.imageMode + ")"); } catch (e) {}

    if (platform === "kleinanzeigen") {
      selectKleinanzeigenOffer();
      setKleinanzeigenFixedPrice();
      if (options.userZip) {
        var zipEl = firstBySelectors([
          "#ad-zip-code", "input[name='zipCode']", "#postad-postcode", "input[name='postcode']", "input[placeholder*='PLZ']"
        ]);
        if (zipEl) {
          fillField(zipEl, options.userZip);
          zipEl.__velosiaKnown = true;
          zipEl.dispatchEvent(new Event("blur", { bubbles: true }));
          filled.push("PLZ");
        }
      }
      // Attributes may render slightly after the core fields. Fill once, then
      // only keep waiting/retrying while attributes are still missing — when the
      // first pass already caught everything we skip the (formerly fixed) 3.5s.
      setBackdrop("Kategorie-Details werden ausgefüllt …");
      var wantAttr = Object.keys(parseAttributes(draft)).length;
      var attrFilled = fillAttributes(draft);
      for (var pass = 0; pass < 2 && attrFilled.length < wantAttr; pass++) {
        await sleep(900);
        attrFilled = attrFilled.concat(fillAttributes(draft));
      }
      // De-dup attribute labels for the report.
      var dedupAttr = attrFilled.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; });
      attrCount = dedupAttr.length;
      dedupAttr.forEach(function (lbl) { filled.push(lbl); });
    }

    // Vinted: drive the category picker automatically (drilled by catalog id /
    // name). Brand / size / condition are separate pickers — still manual for now.
    if (platform === "vinted") {
      setBackdrop("Kategorie wird ausgewählt …");
      var vintedCatOk = false;
      if (draft.vinted_path || draft.vintedPath || draft.vinted_category || draft.vintedCategory) {
        try { vintedCatOk = await selectVintedCategory(draft); } catch (e) { vintedCatOk = false; }
        categoryOk = vintedCatOk;
      }
      if (vintedCatOk) filled.push("Kategorie");
      else manual.push("Kategorie");
      manual.push("Marke, Größe, Zustand");
    } else if (!draft.category) {
      manual.push("Kategorie");
    }

    return {
      filled: filled, manual: manual, photos: photos,
      found: { title: !!titleEl, description: !!descEl, price: !!priceEl },
      categoryOk: categoryOk, attrCount: attrCount
    };
  }

  // ----------------------------------------------------------------------------
  // Telemetry — anonymous structural outcome (NO listing content) so the backend
  // can automatically detect when Vinted/Kleinanzeigen change their forms.
  // ----------------------------------------------------------------------------

  function sendTelemetry(payload, options) {
    try {
      if (!options || !options.backendUrl) return;
      var headers = { "Content-Type": "application/json" };
      if (options.token) headers["Authorization"] = "Bearer " + options.token;
      payload.engine_version = VERSION;
      fetch(options.backendUrl + "/api/telemetry/autofill", {
        method: "POST", headers: headers, body: JSON.stringify(payload), keepalive: true
      }).catch(function () {});
    } catch (e) { /* telemetry is best-effort, never block autofill */ }
  }

  // ----------------------------------------------------------------------------
  // Published-listing capture — read the public listing id/URL after publishing
  // (no login, no form crawl) and report it so the dashboard can track status.
  // ----------------------------------------------------------------------------

  // Map the *current* (or given) URL to {platform, listingId, listingUrl} if it
  // is a published listing page, else null. Vinted item: /items/<id>-slug;
  // Kleinanzeigen ad: /s-anzeige/<slug>/<id>-... (the "items/new" form and the KA
  // form pages return null — they are not published listings).
  function parseListingUrl(href) {
    href = href || window.location.href;
    var url;
    try { url = new URL(href); } catch (e) { return null; }
    var host = url.hostname || "";
    var path = url.pathname || "";

    if (host.indexOf("vinted") !== -1) {
      if (/\/items\/new/.test(path)) return null;
      var mv = path.match(/\/items\/(\d+)/);
      if (mv) return { platform: "vinted", listingId: mv[1], listingUrl: url.origin + path };
      return null;
    }
    if (host.indexOf("kleinanzeigen") !== -1) {
      var mk = path.match(/\/s-anzeige\/[^/]+\/(\d+)/);
      if (mk) return { platform: "kleinanzeigen", listingId: mk[1], listingUrl: url.origin + path };
      var adId = url.searchParams.get("adId") || url.searchParams.get("adID") || url.searchParams.get("adid");
      if (adId && /^\d+$/.test(adId)) return { platform: "kleinanzeigen", listingId: adId, listingUrl: null };
      return null;
    }
    return null;
  }

  // POST the captured listing to the backend. options = {backendUrl, token,
  // draftId, href?}. No-ops unless the page is a real listing and a draftId +
  // backendUrl are known. Idempotent on the server, so it is safe to fire from
  // multiple hosts (engine watcher + capture content script).
  async function captureListing(options) {
    options = options || {};
    var info = parseListingUrl(options.href || window.location.href);
    if (!info) return null;
    var draftId = (options.draftId != null) ? options.draftId : options.draft_id;
    if (draftId == null || !options.backendUrl) return null;
    try {
      var headers = { "Content-Type": "application/json" };
      if (options.token) headers["Authorization"] = "Bearer " + options.token;
      await fetch(options.backendUrl + "/api/listings/published", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          draft_id: draftId,
          platform: info.platform,
          listing_id: info.listingId,
          listing_url: info.listingUrl
        }),
        keepalive: true
      });
      return info;
    } catch (e) { return null; }
  }

  // Vinted is a React SPA: publishing navigates from /items/new to /items/<id>
  // WITHOUT a document reload, so a content script matched on the item page never
  // runs. We instead keep watching the URL from the already-loaded engine and
  // capture the id once it appears. Fire-and-forget (do not await).
  async function watchVintedPublish(draft, options) {
    if (!draft || draft.id == null || !options || !options.backendUrl) return;
    var deadline = 10 * 60 * 1000; // give the user up to 10 min to review & publish
    for (var elapsed = 0; elapsed < deadline; elapsed += 2500) {
      await sleep(2500);
      var info = parseListingUrl(window.location.href);
      if (info && info.platform === "vinted") {
        await captureListing({ backendUrl: options.backendUrl, token: options.token, draftId: draft.id });
        console.log("Velosia: Vinted-Angebot veröffentlicht erfasst ->", info.listingId);
        return;
      }
    }
  }

  // ----------------------------------------------------------------------------
  // Public entry point
  // ----------------------------------------------------------------------------

  async function autofill(draft, options) {
    options = options || {};
    if (typeof draft === "string") {
      try { draft = JSON.parse(draft); } catch (e) { draft = {}; }
    }
    var platform = options.platform || detectPlatform();
    var phase = detectPhase(platform);
    var autoSubmit = !!options.autoSubmit;
    var showUi = options.showOverlay !== false;

    try {
      // Plain-string log (objects render as "[object Object]" in Android Logcat).
      console.log("Velosia engine v" + VERSION + " autofill: platform=" + platform +
        " phase=" + phase + " autoSubmit=" + autoSubmit +
        " imageMode=" + options.imageMode +
        " category=" + (draft && draft.category) + " category_path=" + (draft && draft.category_path) +
        " vinted_category=" + (draft && draft.vinted_category) + " vinted_path=" + (draft && draft.vinted_path));
    } catch (e) {}

    // Kleinanzeigen step 1: pick the category, then let the step-2 reload fill.
    // A light backdrop signals progress; the page reloads to schritt2 right after.
    if (platform === "kleinanzeigen" && phase === "category") {
      if (showUi) { ensureBackdrop(); setBackdrop("Kategorie wird gewählt …"); }
      var result0 = { platform: platform, phase: phase, filled: [], manual: [], photos: 0, submitted: false };
      var catOk;
      try { catOk = await autoSelectCategory(draft); }
      catch (e) { catOk = false; if (showUi) removeBackdrop(); }
      console.log("Velosia: Kategorie-Auswahl (KA) ->", catOk ? "Weiter geklickt" : "fehlgeschlagen/manuell", "path=", draft && draft.category_path);
      sendTelemetry({ platform: platform, phase: phase, category_ok: !!catOk }, options);
      // If "Weiter" did not fire we stay on this page — drop the backdrop so the
      // user can pick the category manually instead of being stuck behind it.
      if (showUi && !catOk) removeBackdrop();
      return result0;
    }

    // Form phase: block the page behind a full-screen progress backdrop while the
    // engine fills the fields, then reveal the result + an arrow to "Veröffentlichen".
    if (showUi) ensureBackdrop();

    var r;
    try {
      r = await fillForm(draft, options, platform);
    } catch (e) {
      if (showUi) removeBackdrop();
      throw e;
    }
    var result = {
      platform: platform, phase: phase,
      filled: r.filled, manual: r.manual, photos: r.photos, submitted: false
    };

    sendTelemetry({
      platform: platform, phase: phase,
      title_found: r.found ? r.found.title : null,
      description_found: r.found ? r.found.description : null,
      price_found: r.found ? r.found.price : null,
      category_ok: r.categoryOk,
      photos: r.photos, attributes_count: r.attrCount
    }, options);

    // Vinted publishes via SPA navigation (no reload) — start watching for the
    // resulting /items/<id> URL so we can capture & track the listing. Works for
    // both manual and auto-submit. Fire-and-forget. (Kleinanzeigen reloads to a
    // fresh page, so its capture is handled by the capture content script.)
    if (platform === "vinted" && phase === "form") {
      try { watchVintedPublish(draft, options); } catch (e) {}
    }

    if (autoSubmit) {
      // Keep the backdrop up and let image upload + framework state settle before
      // publishing automatically.
      if (showUi) setBackdrop("Wird veröffentlicht …");
      await sleep(3500);
      result.submitted = await trySubmit(platform);
      if (showUi) removeBackdrop();
    } else {
      // Manual mode: drop the blocking backdrop, show the "what was filled" panel
      // and point a tracking arrow at the publish button so the user knows to tap it.
      if (showUi) {
        removeBackdrop();
        showOverlay(result, autoSubmit);
        pointToButton(findSubmitButton(platform));
      }
    }
    return result;
  }

  window.__velosia = {
    __loaded: true,
    version: VERSION,
    autofill: autofill,
    detectPlatform: detectPlatform,
    detectPhase: detectPhase,
    parseListingUrl: parseListingUrl,
    captureListing: captureListing
  };
})();
