/**
 * Self-contained MapLibre HTML for Combo reports / uploads CDN.
 * Style JSON is inlined when fetchable (avoids chrome-extension CORS);
 * tiles still load from OpenFreeMap (CORS *).
 */

export type MapMarker = {
  lat: number;
  lng: number;
  label?: string;
  note?: string;
};

export type BuildMapHtmlInput = {
  title: string;
  markers: MapMarker[];
  /** pl → liberty_pl, en → liberty_en */
  locale?: "pl" | "en";
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Pre-fetched style object; when omitted, fetched from CDN */
  styleJson?: unknown;
  /** Override style URL used when styleJson missing / fetch fails */
  styleUrl?: string;
};

export const MAP_STYLE_URLS = {
  pl: "https://assets.nextsolutions.studio/vendor/openfreemap/styles/liberty_pl.json",
  en: "https://assets.nextsolutions.studio/vendor/openfreemap/styles/liberty_en.json",
  /** OpenFreeMap public Liberty (CORS *) — fallback labels usually EN */
  openfreemap: "https://tiles.openfreemap.org/styles/liberty",
} as const;

const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function sanitizeMarkers(markers: MapMarker[]): MapMarker[] {
  return markers
    .filter(
      (m) =>
        typeof m.lat === "number" &&
        typeof m.lng === "number" &&
        Number.isFinite(m.lat) &&
        Number.isFinite(m.lng) &&
        m.lat >= -90 &&
        m.lat <= 90 &&
        m.lng >= -180 &&
        m.lng <= 180,
    )
    .slice(0, 500)
    .map((m) => ({
      lat: m.lat,
      lng: m.lng,
      label: m.label != null ? String(m.label).slice(0, 200) : undefined,
      note: m.note != null ? String(m.note).slice(0, 1000) : undefined,
    }));
}

/** Fetch localized OpenFreeMap Liberty style (for inlining). */
export async function fetchMapStyleJson(
  locale: "pl" | "en" = "pl",
): Promise<{ style: unknown; url: string } | { error: string; url: string }> {
  const url = locale === "en" ? MAP_STYLE_URLS.en : MAP_STYLE_URLS.pl;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `style ${res.status}`, url };
    const style = await res.json();
    return { style, url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), url };
  }
}

/**
 * Build a full HTML document with MapLibre + markers.
 * Prefer inlined styleJson so the page works from uploads CDN and downloads.
 */
export function buildMapHtml(input: BuildMapHtmlInput): string {
  const title = (input.title || "Map").slice(0, 120);
  const markers = sanitizeMarkers(input.markers ?? []);
  const locale = input.locale === "en" ? "en" : "pl";
  const zoom =
    typeof input.zoom === "number" && Number.isFinite(input.zoom)
      ? Math.min(18, Math.max(1, input.zoom))
      : markers.length === 1
        ? 14
        : 6;

  let centerLat = input.center?.lat;
  let centerLng = input.center?.lng;
  if (
    (centerLat == null || centerLng == null) &&
    markers.length > 0
  ) {
    centerLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
    centerLng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
  }
  if (centerLat == null || centerLng == null) {
    // Poland default
    centerLat = 52.1;
    centerLng = 19.4;
  }

  const styleUrl =
    input.styleUrl ??
    (locale === "en" ? MAP_STYLE_URLS.en : MAP_STYLE_URLS.pl);

  const styleLiteral =
    input.styleJson != null
      ? JSON.stringify(input.styleJson)
      : JSON.stringify(styleUrl);

  const markersLiteral = JSON.stringify(markers);

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${MAPLIBRE_CSS}"/>
<style>
  html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#0f1419;color:#e8eef4}
  #bar{padding:10px 14px;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;border-bottom:1px solid #243041}
  #bar h1{font-size:1rem;margin:0;font-weight:650}
  #bar .meta{font-size:12px;opacity:.7}
  #map{height:calc(100% - 44px);width:100%}
  .maplibregl-popup-content{color:#111;font-size:13px;line-height:1.35;max-width:240px}
</style>
</head>
<body>
<div id="bar">
  <h1>${escapeHtml(title)}</h1>
  <span class="meta">${markers.length} pin${markers.length === 1 ? "" : "s"} · OpenFreeMap · ${locale.toUpperCase()} labels</span>
</div>
<div id="map"></div>
<script src="${MAPLIBRE_JS}"></script>
<script>
(function () {
  var styleSpec = ${styleLiteral};
  var markers = ${markersLiteral};
  var map = new maplibregl.Map({
    container: "map",
    style: styleSpec,
    center: [${centerLng}, ${centerLat}],
    zoom: ${zoom},
    attributionControl: true
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  var bounds = new maplibregl.LngLatBounds();
  markers.forEach(function (m) {
    var el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#e85d4c;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer";
    var popupHtml = "<strong>" + (m.label ? String(m.label).replace(/</g,"&lt;") : "Pin") + "</strong>";
    if (m.note) popupHtml += "<br/>" + String(m.note).replace(/</g,"&lt;");
    popupHtml += "<br/><span style='opacity:.65'>" + m.lat.toFixed(5) + ", " + m.lng.toFixed(5) + "</span>";
    new maplibregl.Marker({ element: el })
      .setLngLat([m.lng, m.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml))
      .addTo(map);
    bounds.extend([m.lng, m.lat]);
  });
  if (markers.length > 1) {
    map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
  } else if (markers.length === 1) {
    map.setCenter([markers[0].lng, markers[0].lat]);
  }
})();
</script>
</body>
</html>`;
}
