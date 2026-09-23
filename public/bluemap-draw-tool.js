(function () {
  "use strict";

  var PARENT_ORIGIN = window.location.origin;
  var active = false;
  var badge = null;

  function showBadge() {
    if (badge) return;
    badge = document.createElement("div");
    badge.textContent = "Click the map to add a border point";
    badge.style.cssText =
      "position:fixed;top:10px;left:50%;transform:translateX(-50%);" +
      "background:#232326;color:#fff;padding:6px 14px;border-radius:6px;" +
      "font:14px -apple-system,system-ui,sans-serif;z-index:99999;" +
      "pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.4);";
    document.body.appendChild(badge);
  }

  function hideBadge() {
    if (badge) {
      badge.remove();
      badge = null;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== PARENT_ORIGIN) return;
    var data = event.data;
    if (!data || data.source !== "admin-border-tool") return;
    if (data.type === "set-active") {
      active = !!data.active;
      if (active) showBadge();
      else hideBadge();
    }
  });

  function waitForBlueMap() {
    if (window.bluemap && window.bluemap.events) {
      window.bluemap.events.addEventListener("bluemapMapInteraction", function (e) {
        if (!active) return;
        var hit = e.detail && e.detail.hit;
        var point = hit && hit.point;
        if (!point) return;
        window.parent.postMessage(
          {
            source: "bluemap-draw-tool",
            type: "point",
            x: Math.round(point.x),
            z: Math.round(point.z),
          },
          PARENT_ORIGIN,
        );
      });
    } else {
      window.setTimeout(waitForBlueMap, 250);
    }
  }
  waitForBlueMap();
})();
