// Velosia listing-capture content script.
// -----------------------------------------------------------------------------
// Runs on *published* listing pages (Kleinanzeigen ad pages and Vinted item pages
// reached via a full page load). If the user just published a Velosia draft — a
// short-lived "pending capture" marker is set when autofill runs — this reads the
// public listing id from the URL and reports it to the backend so the dashboard
// can show & track the listing's status (online / reserviert / verkauft /
// geloescht). It reads ONLY the URL, never the page content, and never the
// listing form. Vinted's in-form SPA publish is handled by the engine's own
// watcher; this script is the full-reload fallback (and the Kleinanzeigen path).

(function () {
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

  var info = parseListingUrl(window.location.href);
  if (!info) return;

  chrome.storage.local.get(
    ["velosia_pending_capture", "velosia_token", "velosia_backend_url"],
    function (data) {
      var pc = data.velosia_pending_capture;
      var token = data.velosia_token;
      if (!pc || !token) return;
      var backendUrl = data.velosia_backend_url || "https://api.velosia.henrikheil.net";

      // The marker must be fresh (just published) and match this platform.
      if (!pc.ts || (Date.now() - pc.ts) > 60 * 60 * 1000) {
        chrome.storage.local.remove("velosia_pending_capture");
        return;
      }
      if (pc.platform && pc.platform !== info.platform) return;
      if (pc.draftId == null) return;

      fetch(backendUrl + "/api/listings/published", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          draft_id: pc.draftId,
          platform: info.platform,
          listing_id: info.listingId,
          listing_url: info.listingUrl
        })
      })
        .then(function (r) {
          if (r && r.ok) chrome.storage.local.remove("velosia_pending_capture");
        })
        .catch(function () {});
    }
  );
})();
