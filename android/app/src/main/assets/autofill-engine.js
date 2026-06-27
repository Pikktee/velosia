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
  // Be patient: Kleinanzeigen's rebuilt React form (2026) mounts the dropzone input
  // noticeably later than the old layout, and on a slow device the old 2.4 s window
  // was too short — the engine gave up and the listing went up photo-less. ~8 s now.
  async function waitForFileInput() {
    var input = findFileInput();
    for (var i = 0; i < 20 && !input; i++) {
      await sleep(400);
      input = findFileInput();
    }
    return input;
  }

  // Fire a synthetic drop carrying the same files onto the dropzone — for react-dropzone
  // style uploaders (Kleinanzeigen's new form) that ingest via 'drop' rather than the
  // input's 'change'. Verified live: 'change' alone DOES upload on KA, so this is only a
  // fallback (see commitFilesToInput) and never doubles the upload.
  function fireDropEvent(zone, dt) {
    if (!zone) return;
    try {
      var de;
      try { de = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }); }
      catch (e) { de = new Event("drop", { bubbles: true, cancelable: true }); try { de.dataTransfer = dt; } catch (e2) {} }
      zone.dispatchEvent(de);
    } catch (e) {}
  }

  // Inject the prepared files into the page's upload input. The 'change' event is what
  // both Vinted and Kleinanzeigen (react-dropzone) normally read. On Kleinanzeigen we
  // additionally fire a dropzone 'drop' — but ONLY if 'change' did not consume the files
  // (react-dropzone empties input.files once it ingests them). That guard means we never
  // upload every photo twice while still covering a missed 'change'.
  async function commitFilesToInput(input, dt, allowDrop) {
    try {
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return false; }
    if (allowDrop) {
      await sleep(500);
      try {
        if (input.files && input.files.length > 0) {
          var zone = input.closest("[class*='dashed'], [class*='drop'], [class*='Drop'], [class*='upload'], [class*='Upload']") || input.parentElement;
          fireDropEvent(zone, dt);
        }
      } catch (e) {}
    }
    return true;
  }

  // Fetch each photo and inject ALL of them into the file input via a DataTransfer
  // so the host page's normal upload handler runs. Used by the extension AND by the
  // Android WebView (CORS is "*" on the backend, so the cross-origin fetch of
  // /uploads works) — this uploads every draft photo and needs no user gesture,
  // unlike a programmatic file-chooser click which the WebView blocks.
  async function uploadPhotosDataTransfer(urls, allowDrop) {
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
    var ok = await commitFilesToInput(input, dt, allowDrop);
    return ok ? count : 0;
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
  async function uploadPhotosFromBridge(allowDrop) {
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
    var ok = await commitFilesToInput(input, dt, allowDrop);
    return ok ? count : 0;
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
        // Skip combobox/autocomplete inputs (e.g. KA's new "Marke" field). Writing raw
        // text into them does NOT commit a real selection — KA reverts it on blur, so
        // the field ends up empty — yet it would mark the field "done" and block the
        // dedicated picker (selectKleinanzeigenBrand). Those are handled separately.
        if (texts[t].getAttribute("role") === "combobox" ||
            texts[t].getAttribute("aria-autocomplete") ||
            texts[t].getAttribute("aria-haspopup") === "listbox") continue;
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

  // Kleinanzeigen "Zustand" — Velosia captures the condition, so set it directly
  // instead of relying on the server having backfilled it into the attributes (which
  // only happens when the category resolved + the AI/validator emitted the field).
  // Maps the free-text condition to KA's fixed option set (Neu / Sehr Gut / Gut /
  // In Ordnung / Defekt). Mirrors the backend CONDITION_TO_ZUSTAND table.
  var KA_CONDITION_MAP = {
    "neu": "Neu",
    "neuwertig": "Sehr Gut",
    "sehr gut": "Sehr Gut",
    "gut": "Gut",
    "zufriedenstellend": "In Ordnung",
    "in ordnung": "In Ordnung",
    "befriedigend": "In Ordnung",
    "defekt": "Defekt"
  };

  // Recognise the Zustand <select> by its OPTION fingerprint (it offers Neu …
  // Defekt) — far more reliable than label matching, which the form often omits.
  function isKleinanzeigenConditionSelect(sel) {
    var hasNeu = false, hasDefekt = false, mid = 0;
    for (var i = 0; i < sel.options.length; i++) {
      var t = norm(sel.options[i].textContent);
      if (t === "neu") hasNeu = true;
      else if (t === "defekt") hasDefekt = true;
      else if (t === "sehr gut" || t === "gut" || t === "in ordnung") mid++;
    }
    return (hasNeu && hasDefekt) || (hasNeu && mid >= 1) || mid >= 2;
  }

  function selectKleinanzeigenCondition(draft) {
    var cond = norm(draft.condition || "");
    if (!cond) return false;
    var target = KA_CONDITION_MAP[cond];
    if (!target) { console.log("Velosia KA: Zustand '" + cond + "' ohne Entsprechung — manuell"); return false; }

    var selects = Array.prototype.slice.call(document.querySelectorAll("select"));
    // Prefer a select whose label mentions "zustand"; else fall back to the fingerprint.
    var sel = null;
    for (var i = 0; i < selects.length; i++) {
      if (selects[i].__velosiaKnown) continue;
      if (labelTextFor(selects[i]).indexOf("zustand") !== -1) { sel = selects[i]; break; }
    }
    if (!sel) {
      for (var j = 0; j < selects.length; j++) {
        if (selects[j].__velosiaKnown) continue;
        if (isKleinanzeigenConditionSelect(selects[j])) { sel = selects[j]; break; }
      }
    }
    if (sel) {
      var opt = pickOption(sel, target);
      if (opt) {
        sel.value = opt.value;
        sel.__velosiaKnown = true;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        console.log("Velosia KA: Zustand '" + target + "' im Dropdown gesetzt");
        return true;
      }
    }

    // Some categories render Zustand as a row of button/radio "pills" instead.
    var pills = document.querySelectorAll("button, [role='radio'], label, input[type='radio']");
    var nt = norm(target);
    for (var p = 0; p < pills.length; p++) {
      var el = pills[p];
      if (!isInteractable(el)) continue;
      if (el.closest("#velosia-backdrop, #velosia-overlay")) continue;
      if (norm(el.textContent || el.getAttribute("aria-label") || "") === nt) {
        try { el.click(); console.log("Velosia KA: Zustand '" + target + "' per Pill gesetzt"); return true; } catch (e) {}
      }
    }
    console.log("Velosia KA: Zustand-Feld nicht gefunden — manuell");
    return false;
  }

  // --------------------------------------------------------------------------
  // Kleinanzeigen NEW (2026 React form) attribute fields — Zustand / Größe /
  // Farbe / Marke. The <select>/pill paths above no-op on this layout, so we drive
  // the new UI: each field is a <label>Name</label> + a control that opens either a
  // [role=listbox] (click option = immediate) or a modal with radios + a "Bestätigen"
  // button. Options are matched by VISIBLE TEXT, never KA's internal value codes.
  // Verified live: the whole flow (open + select + confirm) runs on synthetic clicks
  // — the earlier "isTrusted gate" reading was a broken detector (KA uses no
  // role=dialog), not a real block.
  // --------------------------------------------------------------------------

  function kaVisible(el) {
    return !!(el && el.offsetParent !== null && !el.closest("#velosia-backdrop, #velosia-overlay"));
  }

  function kaFindVisibleButton(text) {
    var t = norm(text);
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (kaVisible(btns[i]) && norm(btns[i].textContent) === t) return btns[i];
    }
    return null;
  }

  // The control that opens a field's picker. Most fields expose id === the label's
  // "for"; Zustand's "for" points at an id with no element, so we fall back to the
  // first popup-control inside the field row.
  function kaFieldControl(labelText) {
    var want = norm(labelText);
    var labels = document.querySelectorAll("label");
    for (var i = 0; i < labels.length; i++) {
      if (norm(labels[i].textContent) !== want) continue;
      var forId = labels[i].getAttribute("for");
      if (forId) {
        var byId = document.getElementById(forId);
        if (byId && kaVisible(byId)) return byId;
      }
      var row = labels[i];
      for (var k = 0; k < 5 && row.parentElement; k++) {
        row = row.parentElement;
        var ctrl = row.querySelector("button[aria-haspopup='dialog'], [role='combobox'], input[role='combobox']");
        if (ctrl && ctrl !== labels[i] && kaVisible(ctrl)) return ctrl;
      }
    }
    return null;
  }

  // Visible options of an open picker: listbox options, else (modal pattern) the
  // radio-labels — but only when a "Bestätigen" button is actually on screen.
  function kaOptionPool() {
    var opts = Array.prototype.slice.call(document.querySelectorAll("[role='option']")).filter(kaVisible);
    if (opts.length) return opts;
    if (kaFindVisibleButton("bestätigen")) {
      return Array.prototype.slice.call(document.querySelectorAll("label[for]")).filter(function (l) {
        if (!kaVisible(l)) return false;
        var r = document.getElementById(l.getAttribute("for"));
        return r && r.type === "radio";
      });
    }
    return [];
  }

  // Connector-insensitive key so "Jack & Jones" == "Jack and Jones" == "Jack Jones".
  function kaLooseKey(s) {
    return norm(s).replace(/\b(und|and|the|by)\b/g, " ").replace(/\s+/g, " ").trim();
  }

  // What to TYPE into the brand search to filter: only the part before the first
  // connector (&/+/and/und), because KA's filter is literal — "Jack and Jones" finds
  // nothing, "Jack" finds the superset that contains "Jack & Jones".
  function kaBrandFilterText(brand) {
    var s = String(brand).trim();
    var m = s.match(/^(.*?)\s*(?:&|\+|\band\b|\bund\b)/i);
    var key = (m ? m[1] : s).trim();
    return key.length >= 2 ? key : s;
  }

  // Does an option's text match a wanted value? Handles "M (38)" vs "M" vs "38".
  function kaOptMatches(optText, want, exactOnly) {
    var o = norm(optText), c = norm(want);
    if (!o || !c) return false;
    if (o === c) return true;
    if (exactOnly) return kaLooseKey(optText) === kaLooseKey(want);
    var pre = norm(String(optText).split("(")[0]);
    if (pre && pre === c) return true;
    var m = String(optText).match(/\(([^)]+)\)/);
    if (m && norm(m[1]) === c) return true;
    return (c.length >= 2 && o.length < 30 && o.indexOf(c) !== -1);
  }

  function kaSelectFromPool(candidates, exactOnly) {
    var pool = kaOptionPool();
    for (var c = 0; c < candidates.length; c++) {
      for (var i = 0; i < pool.length; i++) {
        if (kaOptMatches(pool[i].textContent, candidates[c], exactOnly)) return pool[i];
      }
    }
    return null;
  }

  function kaCloseOverlay(control) {
    try { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
    try { if (control) control.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (e) {}
  }

  // Open one new-form picker and pick the option matching `candidates`. exactOnly is
  // used for Marke (never a wrong brand). Returns true only when an option matched.
  async function selectKleinanzeigenAttribute(labelText, candidates, exactOnly) {
    if (!candidates || !candidates.length) return false;
    var control = kaFieldControl(labelText);
    if (!control) return false;
    try { control.scrollIntoView({ block: "center" }); } catch (e) {}
    try { control.click(); } catch (e) {}
    if (control.tagName === "INPUT") { try { control.focus(); } catch (e) {} }

    var opt = null;
    for (var i = 0; i < 12 && !opt; i++) {
      await sleep(200);
      opt = kaSelectFromPool(candidates, exactOnly);
    }
    if (!opt) { kaCloseOverlay(control); return false; }

    var radioId = (opt.tagName === "LABEL") ? opt.getAttribute("for") : null;
    var radio = radioId ? document.getElementById(radioId) : null;
    try { (radio || opt).click(); } catch (e) {}
    await sleep(200);
    // Modal pattern: commit with "Bestätigen". Listbox pattern: nothing to confirm.
    var confirm = kaFindVisibleButton("bestätigen");
    if (confirm) { try { confirm.click(); } catch (e) {} await sleep(200); }
    try { console.log("Velosia KA: '" + labelText + "' gesetzt (" + norm(opt.textContent).slice(0, 24) + ")"); } catch (e) {}
    return true;
  }

  // After opening the Marke control, find the input that actually filters. Desktop:
  // the control itself. Mobile: KA (like Vinted) may pop a SEARCH MODAL with its own
  // autofocused input — so prefer the focused/visible search input in an open overlay.
  function pickBrandSearchInput(control) {
    var ae = document.activeElement;
    if (ae && ae.tagName === "INPUT" && kaVisible(ae)) return ae;
    var inputs = document.querySelectorAll("input[type='text'], input[type='search'], input[role='combobox'], input:not([type])");
    for (var i = 0; i < inputs.length; i++) {
      if (!kaVisible(inputs[i])) continue;
      if (inputs[i].closest("[role='dialog'], [class*='odal'], [class*='verlay'], [class*='ottomSheet'], [class*='heet'], [class*='earch']")) return inputs[i];
    }
    return (control.tagName === "INPUT") ? control : null;
  }

  // Fire a full pointer+mouse+click sequence on an option. KA's brand combobox (like
  // many React autocompletes) commits the selection on pointerdown/mousedown — NOT a
  // bare .click() (which would arrive only after the input blur already closed the
  // list). So on mobile opt.click() "succeeds" yet the field stays empty; dispatching
  // the whole sequence is what actually commits the pick.
  function kaCommitClick(el) {
    var o = { bubbles: true, cancelable: true, view: window };
    ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) {
      try {
        var Ctor = (t.indexOf("pointer") === 0 && window.PointerEvent) ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(t, o));
      } catch (e) { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e2) {} }
    });
    try { el.click(); } catch (e) {}
  }

  // Did the brand actually land? After a real commit KA fills the visible combobox with
  // the full brand text AND writes the hidden attributeMap[...brand] input — either is a
  // reliable signal (typing the filter only ever set the control to the prefix). Lets us
  // report honest success/failure instead of trusting that a click did anything.
  function kaBrandCommitted(brand, control) {
    // STRICT: the combobox's own displayed value must equal the full brand. The earlier
    // "any brand-named input is non-empty" heuristic false-positived on the typed filter
    // prefix ("Jack"), so the engine wrongly reported success while the field was empty.
    return !!(control && kaLooseKey(control.value || "") === kaLooseKey(brand));
  }

  // Type the brand to FILTER the (huge) brand listbox, then click the exact
  // (connector-insensitive) match. KA only filters on a real InputEvent — a plain
  // Event("input") does NOT — and we also fire key events for keyup-based filters.
  // Filtering dodges the full-list render that on mobile left the brand unmatched.
  // Never commits a non-exact brand. `options` is only used for an optional beacon.
  async function selectKleinanzeigenBrand(brand, options) {
    // Emit exactly one structural diagnostic per call (no listing content beyond the
    // brand length) so the Railway logs reveal WHERE the brand step bails on mobile —
    // the previous probe only fired mid-loop and so never arrived when the function
    // returned early. reason tells us: no control / no input / no matching option.
    function bail(reason, extra) {
      var detail = extra ? Object.keys(extra).map(function (k) { return k + "=" + extra[k]; }).join(" ") : "";
      try { sendDebug(Object.assign({ event: "ka_brand_probe", reason: reason, brandLen: String(brand || "").length }, extra || {}), options); } catch (e) {}
      return { ok: false, reason: reason, detail: detail };
    }
    if (!brand) return bail("no_brand_value");
    var control = kaFieldControl("Marke");
    if (!control) return bail("no_control");
    try { control.scrollIntoView({ block: "center" }); } catch (e) {}
    try { control.click(); } catch (e) {}
    await sleep(350);
    var input = pickBrandSearchInput(control);
    if (!input) { kaCloseOverlay(control); return bail("no_input", { activeTag: (document.activeElement || {}).tagName || null }); }
    try { input.focus(); } catch (e) {}
    // Type only the part BEFORE the first connector: KA's own filter is literal and
    // does NOT treat "and" == "&" (typing "Jack and Jones" filters to nothing), so we
    // type "Jack", get the superset, and exact-match the full brand in the results.
    var filterText = kaBrandFilterText(brand);
    var last = filterText.slice(-1);
    try { input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: last })); } catch (e) {}
    setNativeValue(input, filterText);
    try { input.dispatchEvent(new InputEvent("input", { bubbles: true, data: filterText, inputType: "insertText" })); }
    catch (e) { input.dispatchEvent(new Event("input", { bubbles: true })); }
    try { input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: last })); } catch (e) {}

    var want = kaLooseKey(brand);
    var opt = null, lastCount = 0;
    for (var i = 0; i < 25 && !opt; i++) {
      await sleep(200);
      var pool = Array.prototype.slice.call(document.querySelectorAll("[role='option']")).filter(kaVisible);
      lastCount = pool.length;
      for (var j = 0; j < pool.length; j++) {
        if (kaLooseKey(pool[j].textContent) === want) { opt = pool[j]; break; }
      }
    }
    if (!opt) {
      kaCloseOverlay(control);
      return bail("no_match", { optionCount: lastCount,
        typedInto: input === control ? "control" : "overlay-input",
        activeTag: (document.activeElement || {}).tagName || null,
        inputVal: (input.value || "").slice(0, 20) });
    }
    // Commit via the full pointer/mouse sequence (mobile needs pointerdown/mousedown),
    // then VERIFY the field really changed — only then report success. Retry on an inner
    // element and the wrapping <li> in case the React handler sits there.
    kaCommitClick(opt);
    await sleep(250);
    if (!kaBrandCommitted(brand, control)) {
      var inner = opt.querySelector && opt.querySelector("[role='option'], button, a, [class*='ell'], span, div");
      if (inner) { kaCommitClick(inner); await sleep(250); }
    }
    if (!kaBrandCommitted(brand, control)) {
      var li = opt.closest && opt.closest("li");
      if (li && li !== opt) { kaCommitClick(li); await sleep(250); }
    }
    var committed = kaBrandCommitted(brand, control);
    // One-shot rich dump (retrievable via GET /api/telemetry/debug/recent) of how KA
    // backs the brand field on mobile — so we fix the real commit signal instead of
    // guessing. No listing content beyond the brand name itself.
    try {
      var bInputs = Array.prototype.slice.call(
        document.querySelectorAll("input[name*='brand' i], input[name*='marke' i]")
      ).slice(0, 5).map(function (x) {
        return (x.getAttribute("name") || x.type || "?").slice(0, 36) + "=" + String(x.value || "").slice(0, 20);
      });
      sendDebug({ event: "ka_brand_dump", committed: committed,
        ctrlTag: control.tagName, ctrlRole: control.getAttribute("role") || null,
        ctrlName: (control.getAttribute("name") || "").slice(0, 36),
        ctrlVal: String(control.value || "").slice(0, 24),
        ariaActive: control.getAttribute("aria-activedescendant") || null,
        optCount: lastCount, optText: norm(opt.textContent).slice(0, 24),
        optHtml: (opt.outerHTML || "").replace(/\s+/g, " ").slice(0, 220),
        brandInputs: bInputs }, options);
    } catch (e) {}
    if (committed) {
      // Drop focus so the brand field isn't left active/highlighted after the fill
      // (cosmetic). Safe now that the value is verified committed — blurring only ever
      // discards UNcommitted combobox text, which we've already passed.
      try { if (control && control.blur) control.blur(); } catch (e) {}
      try { var ae = document.activeElement; if (ae && ae.blur) ae.blur(); } catch (e) {}
      try { console.log("Velosia KA: Marke '" + brand + "' gesetzt (gefiltert)"); } catch (e) {}
      return { ok: true };
    }
    // Clicked the right option but KA didn't commit it — report honestly so the overlay
    // shows "Marke — clicked_no_commit" instead of a false "Alles ausgefüllt".
    return bail("clicked_no_commit", { optText: norm(opt.textContent).slice(0, 18), ctrlVal: (control.value || "").slice(0, 18) });
  }

  // Velosia's free-text condition -> the new KA option labels (no "Defekt" any more
  // -> left manual). "Neu" tries the plain option before "Neu mit Etikett".
  function kaConditionCandidates(condition) {
    var target = KA_CONDITION_MAP[norm(condition || "")];
    if (!target || target === "Defekt") return [];
    if (target === "Neu") return ["Neu", "Neu mit Etikett"];
    return [target];
  }

  // Men's jeans waist -> KA's letter sizing. KA jeans offer ONLY XS…8XL (no waist
  // field), so "W36" must become "XL" to match. Approximate but the user reviews.
  function kaWaistToLetter(w) {
    w = parseInt(w, 10);
    if (!w) return null;
    if (w <= 28) return "XS";
    if (w <= 30) return "S";
    if (w <= 32) return "M";
    if (w <= 34) return "L";
    if (w <= 36) return "XL";
    if (w <= 38) return "XXL";
    if (w <= 40) return "XXXL";
    if (w <= 44) return "4XL";
    return "5XL";
  }

  // Expand a free-text size into candidates the matcher can hit against options like
  // "M (38)" / "XS (34)" / "M" / "Einheitsgröße". Order matters — letter/waist-letter
  // before the bare number so a waist size resolves to its alpha, not a DE number.
  function kaSizeCandidates(size) {
    var s = String(size || "").trim();
    if (!s) return [];
    var out = [s];
    var letter = (s.match(/\b(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\dXL)\b/i) || [])[0];
    if (letter) out.push(letter.toUpperCase());
    // Waist/length like "W36 H34" / "W36/L34" / "36/34" -> letter equivalent.
    var waist = (s.match(/\bW\s*(\d{2})\b/i) || s.match(/^(\d{2})\s*[\/x]\s*\d{2}/i) || [])[1];
    if (waist) { var wl = kaWaistToLetter(waist); if (wl) out.push(wl); }
    var num = (s.match(/\d{2,3}/) || [])[0];
    if (num) out.push(num);
    return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
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
  // The OPEN picker modal's search box ("Finde eine Kategorie"). Must be strict: a
  // looser "contains kategorie" matched the page's top-nav/catalog search too, which
  // made the engine think the picker was already open and SKIP opening the real modal.
  function vintedCategorySearchInput() {
    var inputs = document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])");
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (!isInteractable(inp)) continue;
      var txt = norm(inp.placeholder || "") + " " + norm(inp.getAttribute("aria-label") || "");
      var aboutCategory = txt.indexOf("kategorie") !== -1 || txt.indexOf("category") !== -1;
      if (!aboutCategory) continue;
      if (txt.indexOf("finde") !== -1 || txt.indexOf("find") !== -1 ||
          inp.closest("[role='dialog'], [aria-modal='true']")) return inp;
    }
    return null;
  }

  // The collapsed category FIELD on the form that opens the modal when clicked.
  // Excludes the top-nav category tabs / browse links / headings.
  function vintedCategoryOpener() {
    var o = firstBySelectors([
      "[data-testid='catalog-select-dropdown-input']",
      "[data-testid='catalog-select-dropdown-chevron']",
      "[data-testid='catalog-select-dropdown']"
    ]);
    if (o) return o;
    var cands = document.querySelectorAll("[role='button'], button, [tabindex], input[readonly], li, div");
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (!isInteractable(el)) continue;
      if (el.closest("a[href], header, nav, [role='navigation'], [role='tablist'], [role='tab'], #velosia-backdrop, #velosia-overlay")) continue;
      if (el.querySelector("input, textarea")) continue;
      var t = norm(el.textContent || el.getAttribute("placeholder") || el.value || "");
      if (t === "kategorie" || (t.indexOf("kategorie") !== -1 && t.length <= 24)) {
        if (!best || el.getElementsByTagName("*").length < best.getElementsByTagName("*").length) best = el;
      }
    }
    return best;
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

  // Resolve the actual clickable element — but NEVER an <a href> (navigation). Beyond
  // buttons/roles we also accept a <label> or a web_ui Cell wrapper, because some Vinted
  // pickers (e.g. the size BottomSheet) render option rows as plain Cells / labels with
  // a hidden radio rather than role=button elements.
  function vintedClickable(el) {
    return (el.closest && el.closest(
      "button, li, [role='button'], [role='option'], [role='menuitem'], [role='radio'], [role='checkbox'], label, div[tabindex], [class*='Cell__cell'], [class*='Cell__default']"
    )) || el;
  }

  // Robust click for picker option rows whose React handler may sit on a label-wrapped
  // hidden radio/checkbox rather than the visible row: prefer clicking the input itself
  // (toggles the radio), else fire a full mousedown→mouseup→click sequence on the
  // resolved clickable cell (some Vinted sheets ignore a bare .click() on the text div).
  function vintedRobustClick(el) {
    var target = vintedClickable(el);
    if (target === el) {
      // No clickable ancestor — look for a clickable DESCENDANT (Vinted's size rows wrap
      // the option in an inner button/[role]/cell inside the <li>, where the handler is).
      var child = el.querySelector && el.querySelector(
        "[role='checkbox'], [role='radio'], [role='button'], [role='option'], button, div[tabindex], [class*='filter-grid__option'], [class*='Cell__cell'], label"
      );
      if (child) target = child;
    }
    var input = (target.querySelector && target.querySelector("input[type='radio'], input[type='checkbox']")) ||
                (el.querySelector && el.querySelector("input[type='radio'], input[type='checkbox']")) || null;
    var opts = { bubbles: true, cancelable: true, view: window };
    if (input) { try { input.click(); return; } catch (e) {} }
    try { target.dispatchEvent(new MouseEvent("mousedown", opts)); } catch (e) {}
    try { target.dispatchEvent(new MouseEvent("mouseup", opts)); } catch (e) {}
    try { target.click(); } catch (e) { try { target.dispatchEvent(new MouseEvent("click", opts)); } catch (e2) {} }
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

  // Diagnostic: log small elements whose text CONTAINS the substring (e.g. to find
  // the collapsed category field that opens the modal).
  function vintedDiagText(sub) {
    try {
      var needle = norm(sub);
      var nodes = document.querySelectorAll("[role='button'], button, [tabindex], input, li, div, span");
      var hits = [];
      for (var i = 0; i < nodes.length && hits.length < 8; i++) {
        var el = nodes[i];
        var t = norm(el.textContent || el.getAttribute("placeholder") || el.value || "");
        if (!t || t.indexOf(needle) === -1 || t.length > 28) continue;
        var inNav = el.closest("header, nav, [role='navigation'], [role='tablist'], [role='tab']");
        hits.push(el.tagName +
          (el.getAttribute && el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : "") +
          " '" + t.slice(0, 24) + "' inNav=" + !!inNav + " kids=" + el.getElementsByTagName("*").length +
          " cls=" + ((el.className || "").toString().slice(0, 40)));
      }
      console.log("Velosia Vinted DIAGTEXT '" + sub + "' [" + hits.length + "]: " + (hits.length ? hits.join("  ||  ") : "nichts"));
    } catch (e) {}
  }

  // Diagnostic: while the picker modal is OPEN, log its buttons / close controls
  // (incl. icon buttons via aria-label) so we can find a SAFE way to close it while
  // keeping the selection (X / Zurück / Fertig — but never Abbrechen/Cancel).
  function vintedDiagModal() {
    try {
      var nodes = document.querySelectorAll("button, [role='button'], [aria-label]");
      var out = [];
      for (var i = 0; i < nodes.length && out.length < 16; i++) {
        var el = nodes[i];
        if (!isInteractable(el)) continue;
        if (el.closest("a[href], header, nav, [role='navigation'], [role='tablist'], #velosia-overlay, #velosia-backdrop")) continue;
        var text = norm(el.textContent || "");
        var label = norm(el.getAttribute("aria-label") || "");
        var t = text || label;
        if (!t || t.length > 30) continue;
        out.push(el.tagName + " '" + t.slice(0, 22) + "'" + (label && label !== text ? " aria='" + label.slice(0, 16) + "'" : ""));
      }
      console.log("Velosia Vinted DIAGMODAL [" + out.length + "]: " + out.join("  ||  "));
    } catch (e) {}
  }

  // Diagnostic: the modal's navigation/header bar (back arrow / title / X / "Fertig")
  // — the controls deliberately excluded elsewhere, which is where the close/confirm
  // most likely lives.
  function vintedDiagNav() {
    try {
      var heads = document.querySelectorAll("[data-testid^='catalog-navigation'], [class*='Navigation'], [class*='__modal'], [class*='Modal'], [class*='__header'], [role='dialog']");
      var out = [];
      for (var h = 0; h < heads.length && out.length < 14; h++) {
        var els = heads[h].querySelectorAll("button, [role='button'], a, [aria-label], [data-testid]");
        for (var i = 0; i < els.length && out.length < 14; i++) {
          var el = els[i];
          if (!isInteractable(el)) continue;
          var text = norm(el.textContent || "");
          var label = norm(el.getAttribute("aria-label") || "");
          var tid = el.getAttribute("data-testid") || "";
          var t = text || label || tid;
          if (!t || t.length > 30) continue;
          out.push(el.tagName + " '" + t.slice(0, 18) + "'" + (tid ? " tid=" + tid.slice(0, 22) : ""));
        }
      }
      console.log("Velosia Vinted DIAGNAV [" + out.length + "]: " + (out.length ? out.join("  ||  ") : "nichts"));
    } catch (e) {}
  }

  // Diagnostic: the currently visible option-row titles (which level are we on?).
  function vintedDiagOptions() {
    try {
      var titles = document.querySelectorAll(".web_ui__Cell__title, [class*='Cell__title']");
      var out = [];
      for (var i = 0; i < titles.length && out.length < 12; i++) {
        if (!isInteractable(titles[i])) continue;
        if (titles[i].closest("[role='tab'], [role='tablist'], header, nav")) continue;
        var t = norm(titles[i].textContent || "");
        if (t) out.push("'" + t.slice(0, 22) + "'");
      }
      console.log("Velosia Vinted DIAGOPTIONS [" + out.length + "]: " + out.join(" "));
    } catch (e) {}
  }

  // The picker modal's own "Fertig" save button that commits the selected leaf and
  // closes the modal (data-testid input-dropdown-save-button). This is the modal's
  // save — NOT a form button like "Entwurf speichern"/"Hochladen".
  function vintedSaveButton() {
    var b = firstBySelectors([
      "[data-testid='input-dropdown-save-button']",
      "button[data-testid*='dropdown-save']",
      "button[data-testid*='save-button']"
    ]);
    if (b && isInteractable(b)) return b;
    var btns = document.querySelectorAll("button, [role='button']");
    for (var i = 0; i < btns.length; i++) {
      var el = btns[i];
      if (!isInteractable(el)) continue;
      if (el.closest("a[href], header, nav, [role='navigation']")) continue;
      var t = norm(el.textContent || "");
      if (t === "fertig" || t === "done") return el;
    }
    return null;
  }

  // Whether the picker modal is actually VISIBLE on screen. The "Finde eine
  // Kategorie" input lingers hidden in the DOM after the modal closes, so a plain
  // "does the input exist" check wrongly reports the picker still open — we must
  // check real visibility (size + offsetParent).
  function vintedModalVisible() {
    var s = vintedCategorySearchInput();
    if (!s) return false;
    if (s.offsetParent === null) return false;
    var r = s.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  async function selectVintedCategory(draft) {
    var ids = String(draft.vinted_path || draft.vintedPath || "").split("/").filter(Boolean);
    var names = String(draft.vinted_category || draft.vintedCategory || "")
      .split(">").map(function (s) { return s.trim(); }).filter(Boolean);
    if (names.length === 0 && ids.length === 0) return false;
    console.log("Velosia Vinted: Kategorie '" + names.join(" > ") + "' (ids " + ids.join("/") + ")");

    // Open the picker modal if it is not already open. Clicking the collapsed
    // "Kategorie" field on the form opens it (mobile) / focuses the dropdown (desktop).
    if (!vintedPickerContainer()) {
      var opener = vintedCategoryOpener();
      if (!opener) vintedDiagText("kategorie");
      console.log("Velosia Vinted: Opener=" + (opener ? (opener.tagName + " '" + norm(opener.textContent || "").slice(0, 24) + "'") : "KEINER"));
      if (opener) {
        for (var o = 0; o < 16 && !vintedPickerContainer(); o++) {
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
    if (!vintedPickerContainer()) vintedDiagText("kategorie");
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
      setBackdrop("Kategorie: " + (i + 1) + "/" + levels + " — " + (names[i] || "") + " …");
      var ok = await vintedClickLevel(ids[i] || null, names[i] || "");
      console.log("Velosia Vinted: Ebene " + i + " '" + (names[i] || "") + "' (id " + (ids[i] || "-") + ") -> " + (ok ? "geklickt" : "NICHT gefunden"));
      if (!ok) { vintedDiag(names[i] || ""); drilled = false; break; }
      await sleep(450);
    }
    if (drilled) {
      // Every level incl. the leaf was clicked, which SELECTS the leaf. The mobile
      // picker then needs an explicit "Fertig" tap (its own save button, testid
      // input-dropdown-save-button) to commit the selection and close the modal.
      // Success is honest: only true once the modal is actually gone (the "Finde eine
      // Kategorie" input lingers hidden in the DOM, so we check real visibility).
      await sleep(300);
      var save = vintedSaveButton();
      console.log("Velosia Vinted: Fertig-Button=" + (save ? "gefunden" : "KEINER"));
      if (save) { try { vintedClickable(save).click(); } catch (e) {} }
      for (var v = 0; v < 16 && vintedModalVisible(); v++) await sleep(300);
      var stillOpen = vintedModalVisible();
      if (stillOpen) { vintedDiagNav(); vintedDiagOptions(); }
      console.log("Velosia Vinted: nach Fertig Modal sichtbar=" + stillOpen);
      return !stillOpen;
    }

    // Strategy B (rescue) — only when drilling FAILED at some level: mobile search
    // box, type the leaf, click the matching result.
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
      if (clicked) {
        await sleep(300);
        var save2 = vintedSaveButton();
        if (save2) { try { vintedClickable(save2).click(); } catch (e) {} }
        for (var c2 = 0; c2 < 14 && vintedModalVisible(); c2++) await sleep(300);
        var open2 = vintedModalVisible();
        console.log("Velosia Vinted: per Suche gewählt + Fertig, Modal sichtbar=" + open2);
        return !open2;
      }
    }

    console.warn("Velosia Vinted: Picker blieb offen — Kategorie nicht gesetzt");
    return false;
  }

  // ----------------------------------------------------------------------------
  // Vinted condition ("Zustand") picker — Velosia already captures the condition,
  // so we map it to Vinted's own options and select it via the same dropdown/modal
  // machinery as the category. Brand & size stay manual (no reliable source data).
  // ----------------------------------------------------------------------------
  //
  // Velosia stores a free-text German condition (Neu / Sehr Gut / Gut / …). Vinted's
  // labels differ slightly and have changed wording over time ("Etikett" vs
  // "Preisschild"), so each Velosia value maps to a PRIORITISED list of candidate
  // Vinted labels — the picker tries them in order and clicks the first present row.
  var VINTED_CONDITION_MAP = {
    "neu":               ["Neu ohne Preisschild", "Neu ohne Etikett", "Neu mit Preisschild", "Neu mit Etikett", "Neu"],
    "neuwertig":         ["Sehr gut", "Neu ohne Preisschild"],
    "sehr gut":          ["Sehr gut"],
    "gut":               ["Gut"],
    "zufriedenstellend": ["Zufriedenstellend", "Befriedigend"],
    "in ordnung":        ["Zufriedenstellend", "Befriedigend"],
    "befriedigend":      ["Zufriedenstellend", "Befriedigend"]
  };

  // The collapsed FORM field that opens a Vinted dropdown/modal, identified by its
  // visible label text (e.g. "Zustand"). Mirrors vintedCategoryOpener but generic.
  // avoidWords: when several fields share the label (e.g. "Größe" exists BOTH as the
  // clothing size AND as Vinted's shipping PACKAGE size "Klein/Mittel/Groß"), a field
  // whose surrounding section mentions one of these words is de-prioritised, so we open
  // the right one. Among equal-penalty matches the shallowest (fewest descendants) wins.
  function vintedDropdownOpener(labelNeedle, testidHints, avoidWords) {
    var o = testidHints && testidHints.length ? firstBySelectors(testidHints) : null;
    if (o) return o;
    var cands = document.querySelectorAll("[role='button'], button, [tabindex], input[readonly], li, div");
    var best = null, bestPenalty = 9, bestKids = 1e9;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (!isInteractable(el)) continue;
      if (el.closest("a[href], header, nav, [role='navigation'], [role='tablist'], [role='tab'], #velosia-backdrop, #velosia-overlay")) continue;
      if (el.querySelector("input, textarea")) continue;
      var t = norm(el.textContent || el.getAttribute("placeholder") || el.value || "");
      if (t === labelNeedle || (t.indexOf(labelNeedle) !== -1 && t.length <= labelNeedle.length + 14)) {
        var penalty = 0;
        if (avoidWords && avoidWords.length) {
          var ctx = norm((el.closest("fieldset, section, [class*='Cell'], [class*='ield'], [class*='ow']") || el.parentElement || el).textContent || "");
          for (var a = 0; a < avoidWords.length; a++) { if (ctx.indexOf(avoidWords[a]) !== -1) { penalty = 1; break; } }
        }
        var kids = el.getElementsByTagName("*").length;
        if (penalty < bestPenalty || (penalty === bestPenalty && kids < bestKids)) {
          best = el; bestPenalty = penalty; bestKids = kids;
        }
      }
    }
    // If avoidWords were given and the ONLY matches are penalised (e.g. only the
    // shipping package-size field matched "Größe"), open nothing — better to leave the
    // field manual than to wrongly change the package size.
    if (avoidWords && avoidWords.length && bestPenalty > 0) return null;
    return best;
  }

  // Vinted lists clothing sizes in varied notations. From the AI value (e.g. "W36 L34"
  // or "M" or "40") build a prioritised list of spellings to try against the options.
  function vintedSizeCandidates(value) {
    var out = [], seen = {};
    function add(v) { v = String(v || "").trim(); var k = norm(v); if (v && !seen[k]) { seen[k] = 1; out.push(v); } }
    add(value);
    var w = /w\s*(\d{2,3})/i.exec(value), l = /l\s*(\d{2,3})/i.exec(value);
    if (w && l) {
      // Vinted's jeans size list is keyed on the WAIST only (e.g. "W36"), with no
      // separate length option — so the waist spellings come FIRST, the combined and
      // the bare number only as fallbacks.
      add("W" + w[1]); add("W" + w[1] + " L" + l[1]); add("W" + w[1] + "/L" + l[1]);
      add(w[1] + "/" + l[1]); add(w[1]);
    } else if (w) {
      add("W" + w[1]); add(w[1]);
    } else {
      var nums = String(value).match(/\d{2,3}/g);
      if (nums && nums.length) add(nums[0]);
    }
    return out;
  }

  // Generic Vinted form dropdown: open the field (by label/testid), then click the
  // first CANDIDATE value whose option row is present, committing via the modal's
  // "Fertig" save if the picker uses one. Used for Zustand / Größe / Farbe / Material.
  // Best-effort and side-effect-safe: if the field or option is absent it just leaves
  // the value blank (returns false) — we NEVER pick a wrong option.
  // Dump the short, leaf-ish option labels currently visible in the open picker so we
  // can see EXACTLY which values Vinted offers (e.g. the real jeans size list).
  function vintedDiagPicker(tag) {
    try {
      var root = vintedPickerContainer() || document.body;
      var nodes = root.querySelectorAll("button, li, [role='option'], [role='button'], [class*='Cell'], div, span");
      var out = [], seen = {};
      for (var i = 0; i < nodes.length && out.length < 18; i++) {
        var el = nodes[i];
        if (!isInteractable(el)) continue;
        if (el.closest("a[href], header, nav, [role='tablist'], [role='tab'], #velosia-backdrop, #velosia-overlay")) continue;
        if (el.querySelector("input, textarea")) continue;
        if (el.getElementsByTagName("*").length > 3) continue;
        var t = norm(el.textContent || "");
        if (!t || t.length > 20 || seen[t]) continue;
        seen[t] = 1; out.push("'" + t + "'");
      }
      console.log("Velosia Vinted DIAGPICKER " + tag + " [" + out.length + "]: " + out.join(" "));
    } catch (e) {}
  }

  async function selectVintedDropdownValue(fieldLabel, testidHints, candidates, logName, avoidWords) {
    candidates = (candidates || []).filter(Boolean);
    if (!candidates.length) return false;
    var opener = vintedDropdownOpener(fieldLabel, testidHints, avoidWords);
    if (!opener) { console.log("Velosia Vinted: " + logName + "-Feld nicht gefunden — manuell"); return false; }
    var beforeText = norm(opener.textContent || opener.value || "");

    function findOptionRow() {
      var root = vintedPickerContainer() || document.body;
      for (var k = 0; k < candidates.length; k++) {
        var row = vintedRowMatch(root, candidates[k]);
        if (row) return { row: row, label: candidates[k] };
      }
      return null;
    }

    var picked = null;
    for (var attempt = 0; attempt < 3 && !picked; attempt++) {
      try {
        opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opener.click();
        if (opener.focus) opener.focus();
      } catch (e) {}
      for (var s = 0; s < 8 && !picked; s++) {
        await sleep(300);
        picked = findOptionRow();
      }
    }
    if (!picked) {
      vintedDiagPicker(logName);
      console.log("Velosia Vinted: " + logName + "-Option (" + candidates.join("/") + ") nicht gefunden");
      return false;
    }
    var rowText = norm(picked.row.textContent || "").slice(0, 24);
    vintedRobustClick(picked.row);
    // Some Vinted dropdowns commit on click; the modal variant needs the "Fertig" save.
    await sleep(300);
    var save = vintedSaveButton();
    if (save) { try { vintedClickable(save).click(); } catch (e) {} await sleep(300); }

    // Verify honestly: re-read the collapsed field; it should now show the value
    // instead of the bare label. If nothing changed, the click did NOT take — report
    // the field as still open rather than falsely claiming success.
    await sleep(150);
    var after = vintedDropdownOpener(fieldLabel, testidHints, avoidWords);
    var afterText = after ? norm(after.textContent || after.value || "") : beforeText;
    var num = (norm(picked.label).match(/\d+/) || [""])[0];
    var verified = (afterText !== beforeText) || (num && afterText.indexOf(num) !== -1) ||
                   afterText.indexOf(norm(picked.label)) !== -1;
    console.log("Velosia Vinted: " + logName + " Kandidat='" + picked.label + "' Zeile='" + rowText +
      "' -> " + (verified ? "übernommen" : "Klick OHNE Übernahme (Feld unverändert)"));
    return !!verified;
  }

  async function selectVintedCondition(draft) {
    var cond = norm(draft.condition || "");
    if (!cond) return false;
    var candidates = VINTED_CONDITION_MAP[cond];
    if (!candidates) { console.log("Velosia Vinted: Zustand '" + cond + "' ohne Vinted-Entsprechung — manuell"); return false; }
    return selectVintedDropdownValue("zustand", [
      "[data-testid='condition-select-dropdown-input']",
      "[data-testid='condition-select-dropdown-chevron']",
      "[data-testid='status-select-dropdown-input']"
    ], candidates, "Zustand");
  }

  // Read a single AI-extracted attribute value by its (normalised) field name, e.g.
  // attrValue(draft, "größe"). Returns "" when the AI did not provide it (so the field
  // is simply left blank rather than guessed).
  function attrValue(draft, normName) {
    var attrs = parseAttributes(draft);
    var keys = Object.keys(attrs);
    for (var i = 0; i < keys.length; i++) {
      if (norm(keys[i]) === normName) {
        var v = String(attrs[keys[i]] == null ? "" : attrs[keys[i]]).trim();
        if (v) return v;
      }
    }
    return "";
  }

  // ----------------------------------------------------------------------------
  // Vinted brand picker — a SEARCH/autocomplete field, not a fixed dropdown.
  // CRITICAL: we only commit a brand when an EXACT suggestion match appears. We never
  // create a "custom brand" — a missing brand is far better than a wrong/invented one.
  // ----------------------------------------------------------------------------

  // The brand modal's search input (after the field is opened).
  function vintedBrandSearchInput() {
    var inputs = document.querySelectorAll("input[type='text'], input[type='search'], input:not([type])");
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (!isInteractable(inp)) continue;
      if (inp.closest("#velosia-backdrop, #velosia-overlay")) continue;
      var txt = norm(inp.placeholder || "") + " " + norm(inp.getAttribute("aria-label") || "");
      if (txt.indexOf("marke") !== -1 || txt.indexOf("brand") !== -1) return inp;
      if (inp.closest("[role='dialog'], [aria-modal='true']")) return inp;
    }
    return null;
  }

  // A suggestion row whose normalised text EXACTLY equals the brand. Equality alone
  // already excludes "X als Marke hinzufügen" rows (they carry extra words). Never a
  // link/nav element. Returns the shallowest exact match.
  function vintedBrandExactRow(target) {
    var root = vintedPickerContainer() || document.body;
    var nodes = root.querySelectorAll("button, li, div, span, p, [role='button'], [role='option'], [role='menuitem']");
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!isInteractable(el)) continue;
      if (el.closest("#velosia-backdrop, #velosia-overlay")) continue;
      if (el.closest("a[href], header, nav, [role='navigation'], [role='tablist'], [role='tab']")) continue;
      if (el.querySelector("input, textarea, a[href]")) continue;
      if (norm(el.textContent || "") !== target) continue;
      if (!best || el.getElementsByTagName("*").length < best.getElementsByTagName("*").length) best = el;
    }
    return best;
  }

  async function selectVintedBrand(draft) {
    var brand = attrValue(draft, "marke");
    if (!brand) return false;                       // AI gave no brand -> leave blank
    var target = norm(brand);

    var opener = vintedDropdownOpener("marke", [
      "[data-testid='brand-select-dropdown-input']",
      "[data-testid='brand-select-dropdown-chevron']",
      "[data-testid='brand-select-dropdown']"
    ]);
    if (!opener) { console.log("Velosia Vinted: Marke-Feld nicht gefunden — manuell"); return false; }

    var search = null;
    for (var o = 0; o < 12 && !search; o++) {
      try {
        opener.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        opener.click();
        if (opener.focus) opener.focus();
      } catch (e) {}
      await sleep(300);
      search = vintedBrandSearchInput();
    }
    if (!search) { console.log("Velosia Vinted: Marken-Suchfeld nicht gefunden — manuell"); return false; }

    vintedSetSearch(search, brand);
    var clicked = false;
    for (var s = 0; s < 16 && !clicked; s++) {
      await sleep(300);
      var row = vintedBrandExactRow(target);
      if (row) { try { vintedClickable(row).click(); clicked = true; } catch (e) {} }
    }
    if (!clicked) {
      console.log("Velosia Vinted: keine EXAKTE Marke '" + brand + "' in Vinteds Vorschlägen — bleibt LEER (keine Halluzination)");
      return false;
    }
    await sleep(250);
    var save = vintedSaveButton();
    if (save) { try { vintedClickable(save).click(); } catch (e) {} await sleep(300); }
    console.log("Velosia Vinted: Marke '" + brand + "' gesetzt (exakter Treffer)");
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

  // One-time injection of the keyframe animations used by the backdrop spinner,
  // the bouncing "publish here" arrow and the pulsing button highlight.
  function injectStyleOnce() {
    if (document.getElementById("velosia-style")) return;
    try {
      var s = document.createElement("style");
      s.id = "velosia-style";
      s.textContent =
        "@keyframes velosia-spin{to{transform:rotate(360deg)}}" +
        "@keyframes velosia-pulse{0%,100%{box-shadow:0 0 0 4px rgba(9,176,183,.6)}50%{box-shadow:0 0 0 10px rgba(9,176,183,.12)}}" +
        "@keyframes velosia-breathe{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.08);opacity:1}}" +
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
    // The native Android shell paints an identical #velosia-backdrop at onPageStarted
    // (so the freshly-navigated form is never briefly visible un-covered). If one is
    // already present we ADOPT it instead of creating a second — but we still (re)bind
    // the viewport sync below so the spinner stays centred on scrolled/zoomed pages.
    var bd = document.getElementById("velosia-backdrop");
    if (!bd) {
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
      // A sleek dual-layer spinner: a gradient conic ring (masked to a thin band) over a
      // soft "breathing" glow. No progress text — the animation alone signals "working".
      var spinner =
        '<div style="position:relative;width:62px;height:62px;display:flex;align-items:center;justify-content:center;">' +
          '<div style="position:absolute;inset:8px;border-radius:50%;background:radial-gradient(circle,rgba(9,176,183,.35),transparent 70%);animation:velosia-breathe 1.8s ease-in-out infinite;"></div>' +
          '<div style="width:62px;height:62px;border-radius:50%;' +
            'background:conic-gradient(from 0deg,rgba(9,176,183,0) 0deg,#09b0b7 130deg,#ec4899 290deg,rgba(236,72,153,0) 360deg);' +
            '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 5px));' +
            'mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 calc(100% - 5px));' +
            'animation:velosia-spin .9s linear infinite;"></div>' +
        '</div>';
      bd.innerHTML =
        '<div style="font-weight:700;font-size:16px;letter-spacing:.3px;background:linear-gradient(135deg,#09b0b7,#ec4899);' +
          '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">✨ Velosia</div>' +
        spinner;
      (document.body || document.documentElement).appendChild(bd);
    }
    if (!_backdropSync) {
      _backdropSync = bindViewport(function () {
        var r = viewportRect();
        bd.style.left = r.left + "px";
        bd.style.top = r.top + "px";
        bd.style.width = r.width + "px";
        bd.style.height = r.height + "px";
      });
    }
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

  // Gently highlight the publish button once the form is filled (manual mode): scroll
  // it into view and apply a soft pulsing ring so the user knows what to tap. We no
  // longer render a separate bouncing "Hier veröffentlichen" label — the pulsing
  // button alone is enough and far less intrusive.
  function pointToButton(btn) {
    if (!btn) return;
    injectStyleOnce();
    try { btn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
    try { btn.style.animation = "velosia-pulse 1.4s infinite"; btn.style.borderRadius = btn.style.borderRadius || "8px"; } catch (e) {}
  }

  function showOverlay(result, autoSubmit) {
    try {
      var existing = document.getElementById("velosia-overlay");
      if (existing) existing.remove();

      // Only surface what STILL NEEDS a manual touch — successfully filled fields stay
      // silent (no clutter). The panel is dismissible via × or the explicit "Ok" button.
      var open = (result.manual || []).slice();
      var photosMissing = !(result.photos > 0);

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

      function row(label) {
        return '<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;">' +
               '<span style="flex-shrink:0;color:#f59e0b;">•</span>' +
               '<span style="color:#cbd5e1;">' + label + '</span></div>';
      }

      var title, bodyHtml;
      if (open.length === 0 && !photosMissing) {
        // Everything the engine handles is done — short confirmation only.
        title = "✅ Alles ausgefüllt";
        bodyHtml = '<div style="margin-top:6px;color:#94a3b8;font-size:12px;">' +
          (autoSubmit ? "Wird automatisch veröffentlicht …"
                      : "Prüfe kurz und tippe unten auf <b>Hochladen</b>.") + "</div>";
      } else {
        title = "Noch offen";
        var items = open.map(function (f) { return row(f); }).join("");
        if (photosMissing) items += row("Fotos — bitte selbst hinzufügen");
        bodyHtml = items +
          '<div style="margin-top:10px;color:#94a3b8;font-size:12px;">Bitte ergänze diese Punkte' +
          (autoSubmit ? "." : ", dann tippe auf <b>Hochladen</b>.") + "</div>";
      }

      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">' +
          '<span style="font-weight:700;background:linear-gradient(135deg,#09b0b7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">✨ ' + title + '</span>' +
          '<span id="velosia-overlay-close" style="cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;">&times;</span>' +
        '</div>' +
        bodyHtml +
        '<button id="velosia-overlay-ok" style="margin-top:12px;width:100%;border:0;cursor:pointer;' +
          'background:linear-gradient(135deg,#09b0b7,#ec4899);color:#fff;font-weight:700;font-size:13px;' +
          'padding:9px 12px;border-radius:9px;font-family:inherit;">Ok</button>';

      document.body.appendChild(box);
      // Anchor to the visible viewport's bottom-right (tracks scroll/zoom) so the
      // panel never drifts off a wide/tall desktop-layout page.
      var sync = bindViewport(function () {
        var r = viewportRect();
        box.style.left = Math.max(r.left + 8, r.left + r.width - box.offsetWidth - 16) + "px";
        box.style.top = (r.top + r.height - box.offsetHeight - 16) + "px";
      });
      function dismiss() { unbindViewport(sync); if (box && box.parentNode) box.remove(); }
      var close = document.getElementById("velosia-overlay-close");
      if (close) close.addEventListener("click", dismiss);
      var ok = document.getElementById("velosia-overlay-ok");
      if (ok) ok.addEventListener("click", dismiss);
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
    // Kleinanzeigen's new react-dropzone uploader also accepts a 'drop' fallback.
    var allowDrop = platform === "kleinanzeigen";
    // 1) Android bridge (CORS-immune: native shell supplies the photos as data URLs).
    var bridged = await uploadPhotosFromBridge(allowDrop);
    if (bridged >= 0) photos = bridged;
    // 2) Browser fetch + DataTransfer (extension, or Android if the bridge is absent).
    if (photos === 0) {
      var urls = resolveImageUrls(draft, options.backendUrl);
      if (typeof DataTransfer !== "undefined" && urls.length > 0) {
        photos = await uploadPhotosDataTransfer(urls, allowDrop);
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

      // Zustand: set it directly from draft.condition. First the old <select>/pill
      // layout, then the new 2026 React modal (radios + "Bestätigen"). Report once.
      var zustandDone = filled.some(function (l) { return norm(l).indexOf("zustand") !== -1; });
      if (!zustandDone && draft.condition) {
        if (selectKleinanzeigenCondition(draft)) { filled.push("Zustand"); zustandDone = true; }
      }
      // trySel: never let one picker's failure abort the rest of the fill.
      var trySel = async function (label, cands, exact) {
        try { return await selectKleinanzeigenAttribute(label, cands, exact); }
        catch (e) { return false; }
      };
      if (!zustandDone && draft.condition) {
        var condCands = kaConditionCandidates(draft.condition);
        if (condCands.length && await trySel("Zustand", condCands, false)) {
          filled.push("Zustand"); zustandDone = true;
        }
      }
      if (!zustandDone && draft.condition) manual.push("Zustand");

      // New 2026 form: Größe / Farbe / Marke are dialog/listbox/combobox pickers the
      // old fillAttributes (<select>/text only) can't drive. Values come from the AI
      // attributes; Marke is EXACT-only (never a wrong brand — leer ist besser als
      // halluziniert). A field the AI didn't provide is simply skipped.
      var alreadyFilled = function (word) {
        return filled.some(function (l) { return norm(l).indexOf(word) !== -1; });
      };
      var kaSize = attrValue(draft, "größe");
      if (kaSize && !alreadyFilled("größe") && !alreadyFilled("grosse")) {
        if (await trySel("Größe", kaSizeCandidates(kaSize), false)) filled.push("Größe");
        else manual.push("Größe");
      }
      var kaColor = attrValue(draft, "farbe");
      if (kaColor && !alreadyFilled("farbe")) {
        if (await trySel("Farbe", [kaColor], false)) filled.push("Farbe");
      }
      var kaBrand = attrValue(draft, "marke");
      if (kaBrand && !alreadyFilled("marke")) {
        // selectKleinanzeigenBrand returns {ok, reason, detail}. On failure we surface
        // the reason RIGHT IN THE OVERLAY ("Marke — no_match (optionCount=0 …)") so the
        // exact mobile bail point is visible without depending on the (flaky) logs.
        var br = { ok: false, reason: "exception", detail: "" };
        try { br = await selectKleinanzeigenBrand(kaBrand, options); } catch (e) { br = { ok: false, reason: "throw", detail: String(e && e.message || e).slice(0, 60) }; }
        if (br && br.ok) filled.push("Marke");
        else manual.push("Marke — " + ((br && br.reason) || "?") + (br && br.detail ? " (" + br.detail + ")" : ""));
      } else if (!kaBrand) {
        // No brand attribute on the draft -> show which keys DID arrive so we can tell
        // "AI didn't detect a brand" apart from "key normalises differently".
        manual.push("Marke — kein Attribut [" + Object.keys(parseAttributes(draft)).map(norm).join(",").slice(0, 80) + "]");
      }
    }

    // Vinted: drive the category picker automatically (drilled by catalog id / name),
    // then the condition picker (Velosia captures the condition). Brand & size are
    // separate pickers with no reliable source data — still manual.
    if (platform === "vinted") {
      setBackdrop("Kategorie wird ausgewählt …");
      var vintedCatOk = false;
      if (draft.vinted_path || draft.vintedPath || draft.vinted_category || draft.vintedCategory) {
        try { vintedCatOk = await selectVintedCategory(draft); } catch (e) { vintedCatOk = false; }
        categoryOk = vintedCatOk;
      }
      if (vintedCatOk) filled.push("Kategorie");
      else manual.push("Kategorie");

      // Condition ("Zustand"): best-effort, only after the category modal has closed.
      var condOk = false;
      if (draft.condition) {
        try { condOk = await selectVintedCondition(draft); } catch (e) { condOk = false; }
      }
      if (condOk) filled.push("Zustand");
      else if (draft.condition) manual.push("Zustand");

      // Größe / Farbe / Material (fixed dropdowns) + Marke (search field). Every value
      // comes from the AI attributes; a value the AI could NOT determine is simply
      // skipped (left blank — never guessed). The brand is only set on an EXACT match.
      setBackdrop("Details werden ausgefüllt …");
      var sizeVal = attrValue(draft, "größe");
      var colorVal = attrValue(draft, "farbe");
      var materialVal = attrValue(draft, "material");
      var brandVal = attrValue(draft, "marke");

      var sizeOk = false, colorOk = false, materialOk = false, brandOk = false;
      if (sizeVal) {
        // Exclude Vinted's shipping PACKAGE size field (also labelled "Größe") via
        // avoidWords, and try several size spellings (W36 L34 / 36/34 / 36 …).
        try { sizeOk = await selectVintedDropdownValue("größe",
          ["[data-testid='size-select-dropdown-input']", "[data-testid='size-select-dropdown-chevron']"],
          vintedSizeCandidates(sizeVal), "Größe",
          ["versand", "paket", "pushen", "schneller", "sichtbarkeit", "spotlight"]); } catch (e) {}
      }
      if (colorVal) {
        try { colorOk = await selectVintedDropdownValue("farbe",
          ["[data-testid='color-select-dropdown-input']", "[data-testid='color-select-dropdown-chevron']"],
          [colorVal], "Farbe"); } catch (e) {}
      }
      if (materialVal) {
        try { materialOk = await selectVintedDropdownValue("material",
          ["[data-testid='material-select-dropdown-input']", "[data-testid='material-select-dropdown-chevron']"],
          [materialVal], "Material"); } catch (e) {}
      }
      if (brandVal) {
        try { brandOk = await selectVintedBrand(draft); } catch (e) {}
      }

      if (sizeOk) filled.push("Größe");
      if (colorOk) filled.push("Farbe");
      if (materialOk) filled.push("Material");
      if (brandOk) filled.push("Marke");

      // Only nag about the two key fashion fields, and only when they were NOT set.
      // "(nicht erkannt)" tells the user it's blank because the AI couldn't read it
      // off the photos (so they add it), vs. a picker that simply didn't match.
      if (!brandOk) manual.push("Marke" + (brandVal ? "" : " (nicht auf Fotos erkannt)"));
      if (!sizeOk) manual.push("Größe" + (sizeVal ? "" : " (nicht auf Fotos erkannt)"));
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

  // Temporary, UNAUTHENTICATED diagnostic beacon (no listing content — only a short
  // event tag + observed request method/url) so we can confirm publish detection in
  // the Railway logs without adb. Unauthenticated on purpose: it must still report
  // even if the auth token is missing (the very failure mode we are chasing).
  function sendDebug(payload, options) {
    try {
      if (!options || !options.backendUrl) return;
      payload.engine_version = VERSION;
      fetch(options.backendUrl + "/api/telemetry/debug", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), keepalive: true
      }).catch(function () {});
    } catch (e) {}
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

  // Vinted is a React SPA: publishing does NOT reliably navigate to /items/<id>
  // (esp. on mobile it may stay on /items/new or jump elsewhere), so URL-watching
  // alone misses the event. The robust signal is the item-creation API RESPONSE:
  // we patch fetch/XHR before publish and read the new item's id out of the JSON
  // the moment Vinted's create call returns — independent of any navigation.
  // Backstop: keep polling the URL too. Fire-and-forget (do not await).
  async function watchVintedPublish(draft, options) {
    if (!draft || draft.id == null || !options || !options.backendUrl) return;
    var captured = false;

    function originOf() { try { return window.location.origin; } catch (e) { return ""; } }

    // Build an absolute listing URL from whatever the API gave us (full url, a
    // relative path, or just an id) so the backend can poll it later.
    function listingUrlFrom(item) {
      var u = item && (item.url || item.path);
      if (u) return /^https?:/.test(u) ? u : (originOf() + u);
      if (item && item.id != null) return originOf() + "/items/" + item.id;
      return null;
    }

    function fire(item) {
      if (captured || !item || item.id == null) return;
      captured = true;
      var listingUrl = listingUrlFrom(item);
      console.log("Velosia: Vinted-Item erkannt -> id=" + item.id + " url=" + listingUrl);
      sendDebug({ event: "vinted_item_captured", id: String(item.id), url: listingUrl }, options);
      // Backend capture (works on desktop too; idempotent server-side).
      captureListing({
        backendUrl: options.backendUrl, token: options.token,
        draftId: draft.id, href: listingUrl
      });
      // Native shell: let it capture authenticated + auto-close with a success
      // message. Harmless no-op in the browser extension (no bridge).
      try {
        if (window.VelosiaBridge && window.VelosiaBridge.onListingPublished) {
          window.VelosiaBridge.onListingPublished("vinted", String(item.id), listingUrl || "");
        }
      } catch (e) {}
    }

    // Vinted's create-item call (confirmed live): POST /api/v2/item_upload/items.
    // Keep the plain /items endpoint as an alternative just in case.
    function isCreateEndpoint(url) {
      return /\/api\/v\d+\/item_upload\/items(\/|\?|$)/i.test(url || "") ||
             /\/api\/v\d+\/items(\/|\?|$)/i.test(url || "");
    }

    // Pull the new item out of the create response. id alone is enough here (we only
    // parse the known create endpoint, so a bare id is the listing id).
    function itemFromJson(data) {
      if (!data || typeof data !== "object") return null;
      var item = data.item || data;
      if (item && item.id != null) return item;
      return null;
    }

    // Report the response shape (keys only, no content) so we can confirm where the
    // id lives if extraction ever misses. Temporary diagnostic.
    function reportShape(url, data) {
      try {
        var keys = (data && typeof data === "object") ? Object.keys(data).slice(0, 40) : [];
        var item = data && (data.item || data);
        var itemKeys = (item && typeof item === "object") ? Object.keys(item).slice(0, 40) : [];
        sendDebug({
          event: "vinted_create_response", url: url, keys: keys, itemKeys: itemKeys,
          itemId: (item && item.id != null) ? String(item.id) : null
        }, options);
      } catch (e) {}
    }

    // A POST/PUT to a Vinted /api/ path is a publish candidate. EXCLUDE our own
    // backend calls (telemetry/listing capture) — otherwise the debug beacon's own
    // POST is seen as a candidate and loops.
    var backendUrl = options.backendUrl || "";
    var dbgCount = 0;
    function isCandidate(url, method) {
      url = url || "";
      if (!/post|put/i.test(method || "") || !/\/api\//i.test(url)) return false;
      if (backendUrl && url.indexOf(backendUrl) !== -1) return false;
      if (/\/api\/(telemetry|listings)\//i.test(url)) return false;
      return true;
    }
    function noteCandidate(method, url) {
      if (captured || !isCandidate(url, method)) return;
      console.log("Velosia: Vinted-Publish-Request beobachtet -> " + method + " " + url);
      if (dbgCount < 30) {
        dbgCount++;
        sendDebug({ event: "vinted_publish_request", method: method, url: url }, options);
      }
    }

    // --- Patch fetch: inspect POST/PUT responses to Vinted's API. ---
    try {
      var origFetch = window.fetch;
      if (origFetch && !origFetch.__velosiaPatched) {
        var patched = function (input, init) {
          var url = (typeof input === "string") ? input : (input && input.url) || "";
          var method = (init && init.method) || (input && input.method) || "GET";
          var p = origFetch.apply(this, arguments);
          try {
            if (!captured && isCandidate(url, method)) {
              noteCandidate(method, url);
              if (isCreateEndpoint(url)) {
                p.then(function (resp) {
                  try {
                    resp.clone().json().then(function (data) {
                      reportShape(url, data);
                      var item = itemFromJson(data);
                      if (item) fire(item);
                    }).catch(function () {});
                  } catch (e) {}
                }).catch(function () {});
              }
            }
          } catch (e) {}
          return p;
        };
        patched.__velosiaPatched = true;
        window.fetch = patched;
      }
    } catch (e) {}

    // --- Patch XHR as a secondary path (in case Vinted uses XHR somewhere). ---
    try {
      var XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype && !XHR.prototype.__velosiaPatched) {
        var origOpen = XHR.prototype.open;
        var origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
          this.__velosiaMethod = method; this.__velosiaUrl = url;
          return origOpen.apply(this, arguments);
        };
        XHR.prototype.send = function () {
          try {
            var self = this;
            if (!captured && isCandidate(self.__velosiaUrl, self.__velosiaMethod)) {
              noteCandidate(self.__velosiaMethod, self.__velosiaUrl);
              if (isCreateEndpoint(self.__velosiaUrl)) {
                self.addEventListener("load", function () {
                  try {
                    var data = JSON.parse(self.responseText);
                    reportShape(self.__velosiaUrl, data);
                    var item = itemFromJson(data);
                    if (item) fire(item);
                  } catch (e) {}
                });
              }
            }
          } catch (e) {}
          return origSend.apply(this, arguments);
        };
        XHR.prototype.__velosiaPatched = true;
      }
    } catch (e) {}

    // --- Backstop: poll the URL in case Vinted DOES navigate to /items/<id>. ---
    var deadline = 10 * 60 * 1000; // give the user up to 10 min to review & publish
    for (var elapsed = 0; elapsed < deadline && !captured; elapsed += 2500) {
      await sleep(2500);
      var info = parseListingUrl(window.location.href);
      if (info && info.platform === "vinted") {
        fire({ id: info.listingId, url: info.listingUrl });
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
