// Velosia listing-capture content script.
// -----------------------------------------------------------------------------
// Runs on *published* listing pages (Kleinanzeigen ad pages and Vinted item pages
// reached via a full page load). If the user just published a Velosia draft, this
// reads the public listing id from the URL and reports it to the backend so the
// dashboard can show & track the listing's status (online / reserviert / verkauft
// / geloescht). It reads ONLY the URL (and the referrer), never the page content,
// and never the listing form. Vinted's in-form SPA publish is handled by the
// engine's own watcher; this script is the full-reload fallback (and the
// Kleinanzeigen path, if the confirmation page did not already capture the ad).
//
// "Just published" = the pending-capture marker that content.js arms only when
// the publish action is triggered (not when autofill runs). It is valid for 10
// minutes and used up by the FIRST listing page of that platform that reads it,
// whatever happens next — so a later ad (e.g. someone else's, opened in another
// tab) is never stored as the user's own listing.

(function () {
  var MARKER = "velosia_pending_capture";
  var TTL_MS = 10 * 60 * 1000;

  function parseListingUrl(href) {
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

  // Was this page clearly reached by browsing the platform rather than by
  // publishing? Decided from a same-site referrer only: search results, category
  // pages, another ad or the watchlist (KA), anything but the listing form (Vinted).
  // An empty, cross-site or origin-only referrer (new tab, payment hand-off, strict
  // referrer policy) is not decisive.
  function reachedByBrowsing(info) {
    var ref;
    try { ref = new URL(document.referrer || ""); } catch (e) { return false; }
    if (ref.hostname !== window.location.hostname) return false;
    var p = ref.pathname || "/";
    if (p === "/") return false;
    if (info.platform === "vinted") return !/^\/items\/new(\/|$)/.test(p);
    if (/^\/m-merkliste/.test(p)) return true;
    if (!/^\/s-/.test(p)) return false;
    var refAd = p.match(/^\/s-anzeige\/[^/]+\/(\d+)/);
    return !(refAd && refAd[1] === info.listingId);
  }

  var info = parseListingUrl(window.location.href);
  if (!info) return;

  chrome.storage.local.get(
    [MARKER, "velosia_token", "velosia_backend_url"],
    function (data) {
      var pc = data[MARKER];
      if (!pc) return;
      // Only a marker armed by an actual publish counts (older ones were set on
      // every autofill and are dropped). Another platform's marker is left alone.
      if (pc.v !== 2 || !pc.armedAt) {
        chrome.storage.local.remove(MARKER);
        return;
      }
      if (pc.platform !== info.platform) return;

      // One-shot: this listing page uses the marker up, before and regardless of
      // the outcome below.
      chrome.storage.local.remove(MARKER);

      var age = Date.now() - pc.armedAt;
      if (age < 0 || age > TTL_MS) return;
      if (pc.draftId == null) return;
      if (reachedByBrowsing(info)) return;
      var token = data.velosia_token;
      if (!token) return;
      var backendUrl = data.velosia_backend_url || "https://api.velosia.henrikheil.net";

      fetch(backendUrl + "/api/listings/published", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
          "X-Velosia-Client": "ext/" + chrome.runtime.getManifest().version
        },
        body: JSON.stringify({
          draft_id: pc.draftId,
          platform: info.platform,
          listing_id: info.listingId,
          listing_url: info.listingUrl
        })
      }).catch(function () {});
    }
  );
})();
