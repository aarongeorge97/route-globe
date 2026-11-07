/* geo.js: pure geometry for the globe. No DOM. Works as a classic <script>
 * (exposes window.Geo) and as a CommonJS module (for tests and the build script). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RAD = Math.PI / 180;

  /** Orthographic projection of (lat, lon) at radius r, for a view centred on
   *  (pitch, yaw) in degrees. Returns { x, y, z }: x right, y up, z toward the viewer. */
  function project(lat, lon, yaw, pitch, r) {
    r = r === undefined ? 1 : r;
    var phi = lat * RAD, lam = (lon - yaw) * RAD, phi0 = pitch * RAD;
    var cp = Math.cos(phi), sp = Math.sin(phi);
    return {
      x: r * cp * Math.sin(lam),
      y: r * (Math.cos(phi0) * sp - Math.sin(phi0) * cp * Math.cos(lam)),
      z: r * (Math.sin(phi0) * sp + Math.cos(phi0) * cp * Math.cos(lam)),
    };
  }

  /** A point is hidden only if it is behind the globe AND inside its silhouette.
   *  Arc points that rise above the horizon stay visible. */
  function isVisible(p) {
    return p.z >= 0 || p.x * p.x + p.y * p.y >= 1;
  }

  /** Great-circle angle between two [lat, lon] points, in radians (haversine). */
  function angularDistance(a, b) {
    var p1 = a[0] * RAD, p2 = b[0] * RAD, dl = (b[1] - a[1]) * RAD;
    var h = Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** n+1 points along the great circle from a to b, each { lat, lon, h }.
   *  h is a lift above the surface (0 at the ends, peaking mid-way) so arcs
   *  read as flights rather than lines on the ground. */
  function greatCircle(a, b, n, lift) {
    var d = angularDistance(a, b), out = [], i;
    var p1 = a[0] * RAD, l1 = a[1] * RAD, p2 = b[0] * RAD, l2 = b[1] * RAD;
    if (d < 1e-9) return [{ lat: a[0], lon: a[1], h: 0 }, { lat: b[0], lon: b[1], h: 0 }];
    for (i = 0; i <= n; i++) {
      var f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
      var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
      var z = A * Math.sin(p1) + B * Math.sin(p2);
      var lon = Math.atan2(y, x) / RAD;
      out.push({ lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, lon: lon, h: (lift === undefined ? 0.28 : lift) * (d / Math.PI) * Math.sin(Math.PI * f) });
    }
    // Pin the endpoints exactly so floating-point drift can't detach an arc from its city.
    out[0].lat = a[0]; out[0].lon = a[1]; out[n].lat = b[0]; out[n].lon = b[1];
    return out;
  }

  /** Ray-casting point-in-ring test; ring is [[lon, lat], ...]. */
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** GeoJSON polygon (outer ring then holes). */
  function inPolygon(lon, lat, rings) {
    if (!inRing(lon, lat, rings[0])) return false;
    for (var h = 1; h < rings.length; h++) if (inRing(lon, lat, rings[h])) return false;
    return true;
  }

  /** Small deterministic PRNG so the demo network is reproducible. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * A synthetic hub-and-spoke network over `cities` = [{ name, lat, lon, pop }].
   * Hubs are the largest cities that are at least `minSepDeg` apart; every other
   * city spokes to its nearest hub; each hub trunks to its two nearest hubs.
   * Lane phases come from a seeded PRNG, so the same seed gives the same network.
   */
  function buildNetwork(cities, opts) {
    opts = opts || {};
    var hubCount = opts.hubCount || 7, minSep = (opts.minSepDeg || 28) * RAD, rand = mulberry32(opts.seed === undefined ? 1 : opts.seed);
    var order = cities.map(function (c, i) { return i; }).sort(function (a, b) { return cities[b].pop - cities[a].pop; });
    var dist = function (i, j) { return angularDistance([cities[i].lat, cities[i].lon], [cities[j].lat, cities[j].lon]); };
    var hubs = [];
    order.forEach(function (i) {
      if (hubs.length < hubCount && hubs.every(function (h) { return dist(i, h) >= minSep; })) hubs.push(i);
    });
    var lanes = [], seen = {};
    var add = function (i, j, kind) {
      var key = Math.min(i, j) + '-' + Math.max(i, j);
      if (i === j || seen[key]) return;
      seen[key] = true;
      lanes.push({ from: i, to: j, kind: kind, dist: dist(i, j), phase: rand(), speed: 0.05 + rand() * 0.06 });
    };
    hubs.forEach(function (h) {
      hubs.filter(function (o) { return o !== h; })
        .sort(function (a, b) { return dist(h, a) - dist(h, b); })
        .slice(0, 2).forEach(function (o) { add(h, o, 'trunk'); });
    });
    order.forEach(function (i) {
      if (hubs.indexOf(i) >= 0) return;
      var nearest = hubs.slice().sort(function (a, b) { return dist(i, a) - dist(i, b); })[0];
      add(nearest, i, 'spoke');
    });
    return { hubs: hubs, lanes: lanes };
  }

  return { RAD: RAD, project: project, isVisible: isVisible, angularDistance: angularDistance, greatCircle: greatCircle, inRing: inRing, inPolygon: inPolygon, mulberry32: mulberry32, buildNetwork: buildNetwork };
});
