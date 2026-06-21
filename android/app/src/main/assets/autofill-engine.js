/*
 * Vintamie Autofill Engine — shared single source of truth
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
 *   window.__vintamie.autofill(draft, options) -> Promise<result>
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
  if (window.__vintamie && window.__vintamie.__loaded) return;

  var VERSION = "1.0.0";

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
    try { el.setAttribute("data-vintamie-filled", "1"); } catch (e) {}
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

  // Extension mode: fetch each photo and inject all of them into the file input
  // via a DataTransfer so the host page's normal upload handler runs.
  async function uploadPhotosDataTransfer(urls) {
    var input = findFileInput();
    if (!input || urls.length === 0) return 0;
    var dt = new DataTransfer();
    var count = 0;
    for (var i = 0; i < urls.length; i++) {
      try {
        var resp = await fetch(urls[i]);
        if (!resp.ok) continue;
        var blob = await resp.blob();
        var type = blob.type || "image/jpeg";
        var ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
        var file = new File([blob], "vintamie_" + (i + 1) + "." + ext, { type: type });
        dt.items.add(file);
        count++;
      } catch (e) { /* skip individual image failures */ }
    }
    if (count === 0) return 0;
    try {
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return 0; }
    return count;
  }

  // Native mode (Android): just trigger the file chooser; the WebView host
  // intercepts onShowFileChooser and supplies the prepared photo URI.
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
      if (btn) { try { btn.click(); return true; } catch (e) {} }
      await sleep(500);
    }
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
        if (selects[i].__vintamieKnown) continue;
        if (labelTextFor(selects[i]).indexOf(label) === -1) continue;
        var opt = pickOption(selects[i], value);
        if (opt) {
          selects[i].value = opt.value;
          selects[i].__vintamieKnown = true;
          selects[i].dispatchEvent(new Event("change", { bubbles: true }));
          filledLabels.push(key);
          return;
        }
      }
      // Then free-text inputs.
      for (var t = 0; t < texts.length; t++) {
        if (texts[t].__vintamieKnown) continue;
        if (labelTextFor(texts[t]).indexOf(label) === -1) continue;
        fillField(texts[t], value);
        texts[t].__vintamieKnown = true;
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

  function vintedPickerContainer() {
    return document.querySelector("[data-testid='catalog-select-dropdown-content']");
  }

  function vintedClickable(el) {
    return (el.closest && el.closest("[role='button'],button,li,a,div[tabindex]")) || el.parentElement || el;
  }

  function vintedFindRowByName(container, name) {
    var target = norm(name);
    if (!target) return null;
    var nodes = container.querySelectorAll(
      ".web_ui__Cell__title, .web_ui__Cell__heading, li.web_ui__Item__item, [role='button']"
    );
    for (var i = 0; i < nodes.length; i++) {
      if (!isInteractable(nodes[i])) continue;
      if (norm(nodes[i].textContent) === target) return nodes[i];
    }
    return null;
  }

  async function vintedClickLevel(id, name) {
    for (var t = 0; t < 16; t++) {
      var c = vintedPickerContainer();
      if (c) {
        var icon = id ? c.querySelector("[data-testid='catalog-icon-" + id + "']") : null;
        if (icon && isInteractable(icon)) { vintedClickable(icon).click(); return true; }
        var row = vintedFindRowByName(c, name);
        if (row) { vintedClickable(row).click(); return true; }
      }
      await sleep(350);
    }
    return false;
  }

  async function selectVintedCategory(draft) {
    var path = draft.vinted_path || draft.vintedPath;
    if (!path) return false;
    var ids = String(path).split("/").filter(Boolean);
    if (ids.length === 0) return false;
    var names = String(draft.vinted_category || draft.vintedCategory || "")
      .split(">").map(function (s) { return s.trim(); });

    // Open the picker.
    var input = firstBySelectors(["[data-testid='catalog-select-dropdown-input']"]);
    if (!input) return false;
    for (var o = 0; o < 12 && !vintedPickerContainer(); o++) {
      try {
        input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        input.click();
        input.focus();
      } catch (e) {}
      await sleep(300);
    }
    if (!vintedPickerContainer()) return false;

    // Drill each level (ID first, name fallback), waiting for the next to render.
    for (var i = 0; i < ids.length; i++) {
      var ok = await vintedClickLevel(ids[i], names[i] || "");
      if (!ok) return false;
      await sleep(500);
    }
    return true;
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

  function showOverlay(result, autoSubmit) {
    try {
      var existing = document.getElementById("vintamie-overlay");
      if (existing) existing.remove();

      var box = document.createElement("div");
      box.id = "vintamie-overlay";
      box.style.cssText = [
        "position:fixed", "z-index:2147483647", "right:16px", "bottom:16px",
        "width:300px", "max-width:calc(100vw - 32px)", "background:#0e121a",
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
          '<span style="font-weight:700;background:linear-gradient(135deg,#09b0b7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">✨ Vintamie</span>' +
          '<span id="vintamie-overlay-close" style="cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;">&times;</span>' +
        '</div>' +
        filledHtml + photoHtml + manualHtml + footer;

      document.body.appendChild(box);
      var close = document.getElementById("vintamie-overlay-close");
      if (close) close.addEventListener("click", function () { box.remove(); });
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

    // Poll for the title field — both forms render asynchronously.
    var titleEl = null;
    for (var i = 0; i < 24 && !titleEl; i++) {
      titleEl = findField(map.title);
      if (!titleEl) await sleep(500);
    }

    var descEl = findField(map.description);
    var priceEl = findField(map.price);

    if (fillField(titleEl, draft.title)) filled.push("Titel");
    if (fillField(descEl, draft.description)) filled.push("Beschreibung");
    if (draft.price !== undefined && draft.price !== null) {
      if (fillField(priceEl, String(Math.round(draft.price)))) filled.push("Preis");
    }
    if (titleEl) titleEl.__vintamieKnown = true;
    if (descEl) descEl.__vintamieKnown = true;
    if (priceEl) priceEl.__vintamieKnown = true;

    if (platform === "kleinanzeigen") {
      selectKleinanzeigenOffer();
      setKleinanzeigenFixedPrice();
      if (options.userZip) {
        var zipEl = firstBySelectors([
          "#ad-zip-code", "input[name='zipCode']", "#postad-postcode", "input[name='postcode']", "input[placeholder*='PLZ']"
        ]);
        if (zipEl) {
          fillField(zipEl, options.userZip);
          zipEl.__vintamieKnown = true;
          zipEl.dispatchEvent(new Event("blur", { bubbles: true }));
          filled.push("PLZ");
        }
      }
      // Attributes may render slightly after the core fields — retry a few times.
      var attrFilled = fillAttributes(draft);
      await sleep(1500);
      attrFilled = attrFilled.concat(fillAttributes(draft));
      await sleep(2000);
      attrFilled = attrFilled.concat(fillAttributes(draft));
      // De-dup attribute labels for the report.
      attrFilled.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; })
                .forEach(function (lbl) { filled.push(lbl); });
    }

    // Vinted: drive the category picker automatically (drilled by catalog id /
    // name). Brand / size / condition are separate pickers — still manual for now.
    if (platform === "vinted") {
      var vintedCatOk = false;
      if (draft.vinted_path || draft.vintedPath) {
        try { vintedCatOk = await selectVintedCategory(draft); } catch (e) { vintedCatOk = false; }
      }
      if (vintedCatOk) filled.push("Kategorie");
      else manual.push("Kategorie");
      manual.push("Marke, Größe, Zustand");
    } else if (!draft.category) {
      manual.push("Kategorie");
    }

    // Photos
    var photos = 0;
    if (options.imageMode === "native") {
      photos = triggerNativeFileChooser();
    } else {
      var urls = resolveImageUrls(draft, options.backendUrl);
      photos = await uploadPhotosDataTransfer(urls);
    }

    return { filled: filled, manual: manual, photos: photos };
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

    // Kleinanzeigen step 1: pick the category, then let the step-2 reload fill.
    if (platform === "kleinanzeigen" && phase === "category") {
      var result0 = { platform: platform, phase: phase, filled: [], manual: [], photos: 0, submitted: false };
      if (showUi) showOverlay(result0, autoSubmit);
      await autoSelectCategory(draft);
      return result0;
    }

    var r = await fillForm(draft, options, platform);
    var result = {
      platform: platform, phase: phase,
      filled: r.filled, manual: r.manual, photos: r.photos, submitted: false
    };

    if (showUi) showOverlay(result, autoSubmit);

    if (autoSubmit) {
      // Give image upload + framework state a moment to settle before publishing.
      await sleep(7000);
      result.submitted = await trySubmit(platform);
    } else {
      highlightButton(findSubmitButton(platform));
    }
    return result;
  }

  window.__vintamie = {
    __loaded: true,
    version: VERSION,
    autofill: autofill,
    detectPlatform: detectPlatform,
    detectPhase: detectPhase
  };
})();
