/* globe.js: canvas renderer. Depends on geo.js. No libraries, no network. */
(function (root) {
  'use strict';
  var Geo = root.Geo;
  var TAU = Math.PI * 2;

  function Globe(canvas, opts) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.cities = opts.cities;
    this.network = opts.network;
    this.reduced = !!opts.reducedMotion;
    // Static geometry, precomputed once.
    var land = opts.land, n = land.length / 2;
    this.land = new Float32Array(n * 3); // lat, lon, unused
    for (var i = 0; i < n; i++) { this.land[i * 3] = land[i * 2 + 1] / 10; this.land[i * 3 + 1] = land[i * 2] / 10; }
    this.arcs = this.network.lanes.map(function (l) {
      var a = this.cities[l.from], b = this.cities[l.to];
      return Geo.greatCircle([a.lat, a.lon], [b.lat, b.lon], 56);
    }, this);
    this.hubSet = {}; this.network.hubs.forEach(function (h) { this.hubSet[h] = true; }, this);
    this.degree = this.cities.map(function () { return 0; });
    this.network.lanes.forEach(function (l) { this.degree[l.from]++; this.degree[l.to]++; }, this);
    // View state.
    this.yaw = -40; this.pitch = 22; this.vyaw = 0; this.vpitch = 0; this.zoom = 1;
    this.idleSince = 0; this.dragging = false; this.hover = -1; this.projected = [];
    this.onhover = opts.onhover || function () {};
    this._bind();
    this.resize();
  }

  Globe.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), r = this.c.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Globe.prototype._bind = function () {
    var g = this, c = this.c, lx = 0, ly = 0;
    c.addEventListener('pointerdown', function (e) {
      g.dragging = true; lx = e.clientX; ly = e.clientY; g.vyaw = g.vpitch = 0; c.setPointerCapture(e.pointerId); c.classList.add('grab');
      if (g.hover !== -1) { g.hover = -1; g.onhover(null); }
    });
    c.addEventListener('pointermove', function (e) {
      var rect = c.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (g.dragging) {
        var k = 0.32 / g.zoom, dx = e.clientX - lx, dy = e.clientY - ly;
        g.yaw -= dx * k; g.pitch = Math.max(-80, Math.min(80, g.pitch + dy * k));
        g.vyaw = -dx * k; g.vpitch = dy * k; lx = e.clientX; ly = e.clientY; g.idleSince = performance.now();
      } else g._pick(px, py);
    });
    function up(e) { g.dragging = false; c.classList.remove('grab'); g.idleSince = performance.now(); try { c.releasePointerCapture(e.pointerId); } catch (_) {} }
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', function () { if (!g.dragging) { g.hover = -1; g.onhover(null); } });
    c.addEventListener('wheel', function (e) { e.preventDefault(); g.zoom = Math.max(0.7, Math.min(2.4, g.zoom * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });
    c.addEventListener('keydown', function (e) {
      var s = 6, map = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] };
      if (map[e.key]) { e.preventDefault(); g.yaw += map[e.key][0]; g.pitch = Math.max(-80, Math.min(80, g.pitch + map[e.key][1])); g.idleSince = performance.now(); }
      if (e.key === '+' || e.key === '=') g.zoom = Math.min(2.4, g.zoom * 1.1);
      if (e.key === '-') g.zoom = Math.max(0.7, g.zoom / 1.1);
    });
    window.addEventListener('resize', function () { g.resize(); });
  };

  Globe.prototype._pick = function (px, py) {
    var best = -1, bd = 16 * 16;
    for (var i = 0; i < this.projected.length; i++) {
      var p = this.projected[i]; if (!p) continue;
      var d = (p.sx - px) * (p.sx - px) + (p.sy - py) * (p.sy - py);
      if (d < bd) { bd = d; best = i; }
    }
    if (best !== this.hover) { this.hover = best; this.onhover(this._hoverInfo()); }
  };

  Globe.prototype._hoverInfo = function () {
    var i = this.hover, p = i < 0 ? null : this.projected[i];
    return p ? { city: this.cities[i], lanes: this.degree[i], hub: !!this.hubSet[i], x: p.sx, y: p.sy } : null;
  };

  Globe.prototype.frame = function (now) {
    var t = now / 1000;
    // Motion is scaled by elapsed time (k = 1 at 60 fps) so speed is the same on a 60 Hz and a 120 Hz display.
    var k = this._last ? Math.min(3, (now - this._last) / 16.667) : 1;
    this._last = now;
    if (!this.dragging) {
      this.yaw += this.vyaw * k; this.pitch = Math.max(-80, Math.min(80, this.pitch + this.vpitch * k));
      var decay = Math.pow(0.94, k); this.vyaw *= decay; this.vpitch *= decay;
      if (!this.reduced && now - this.idleSince > 2500) this.yaw += 0.07 * k;
    }
    var ctx = this.ctx, W = this.w, H = this.h, cx = W / 2, cy = H / 2;
    var R = Math.min(W, H) * 0.40 * this.zoom, yaw = this.yaw, pitch = this.pitch;
    ctx.clearRect(0, 0, W, H);

    // Atmosphere + sphere body.
    var halo = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.22);
    halo.addColorStop(0, 'rgba(120,170,255,0.30)'); halo.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, TAU); ctx.fill();
    var body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#16233f'); body.addColorStop(1, '#070c18');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

    var P = Geo.project, self = this;
    function sx(p) { return cx + p.x * R; } function sy(p) { return cy - p.y * R; }

    // Graticule.
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(140,175,255,0.10)';
    for (var lat = -60; lat <= 60; lat += 30) this._line(function (k) { return [lat, -180 + k * 3]; }, 121, 1);
    for (var lon = -180; lon < 180; lon += 30) this._line(function (k) { return [-90 + k * 3, lon]; }, 61, 1);

    // Land dots, brighter toward the viewer.
    var L = this.land, n = L.length / 3;
    for (var i = 0; i < n; i++) {
      var p = P(L[i * 3], L[i * 3 + 1], yaw, pitch, 1);
      if (p.z <= 0) continue;
      var a = 0.18 + 0.72 * p.z;
      ctx.fillStyle = 'rgba(' + (110 + 80 * p.z | 0) + ',' + (160 + 60 * p.z | 0) + ',255,' + a.toFixed(3) + ')';
      var s = (0.9 + 0.9 * p.z) * Math.min(1.6, this.zoom);
      ctx.fillRect(sx(p) - s / 2, sy(p) - s / 2, s, s);
    }

    // Lanes and travelling pulses.
    ctx.lineCap = 'round';
    for (var li = 0; li < this.arcs.length; li++) {
      var lane = this.network.lanes[li], arc = this.arcs[li], trunk = lane.kind === 'trunk';
      var pts = arc.map(function (q) { return P(q.lat, q.lon, yaw, pitch, 1 + q.h); });
      ctx.strokeStyle = trunk ? 'rgba(255,196,110,0.55)' : 'rgba(255,150,100,0.32)';
      ctx.lineWidth = trunk ? 1.4 : 1;
      var open = false;
      ctx.beginPath();
      for (var k = 0; k < pts.length; k++) {
        if (Geo.isVisible(pts[k])) { if (!open) { ctx.moveTo(sx(pts[k]), sy(pts[k])); open = true; } else ctx.lineTo(sx(pts[k]), sy(pts[k])); } else open = false;
      }
      ctx.stroke();
      var f = this.reduced ? lane.phase : (t * lane.speed + lane.phase) % 1, idx = f * (pts.length - 1);
      for (var tr = 0; tr < 7; tr++) {
        var q = Math.floor(idx) - tr; if (q < 0) break;
        var pp = pts[q]; if (!Geo.isVisible(pp)) continue;
        ctx.fillStyle = 'rgba(255,236,190,' + (0.9 * (1 - tr / 7)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(sx(pp), sy(pp), (trunk ? 2.3 : 1.8) * (1 - tr / 9), 0, TAU); ctx.fill();
      }
    }

    // Cities.
    this.projected.length = this.cities.length;
    for (var ci = 0; ci < this.cities.length; ci++) {
      var cp = P(this.cities[ci].lat, this.cities[ci].lon, yaw, pitch, 1);
      if (cp.z <= 0.02) { this.projected[ci] = null; continue; }
      var X = sx(cp), Y = sy(cp), hub = !!this.hubSet[ci], hov = ci === this.hover;
      this.projected[ci] = { sx: X, sy: Y };
      if (hub) {
        var pulse = this.reduced ? 0.5 : (t * 0.6 + ci * 0.37) % 1;
        ctx.strokeStyle = 'rgba(255,205,130,' + (0.5 * (1 - pulse)).toFixed(3) + ')'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(X, Y, 4 + pulse * 14, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = hub ? '#ffd28a' : '#ff9a6a';
      ctx.beginPath(); ctx.arc(X, Y, (hub ? 3.6 : 2.4) + (hov ? 2 : 0), 0, TAU); ctx.fill();
      if (hub && cp.z > 0.25) {
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.fillStyle = 'rgba(255,230,190,' + Math.min(1, cp.z * 1.4).toFixed(2) + ')';
        ctx.fillText(this.cities[ci].name.toUpperCase(), X + 8, Y - 7);
      }
    }

    // Keep the tooltip glued to its city as the globe turns; drop it if the city rotates out of view.
    if (this.hover >= 0) {
      var info = this._hoverInfo();
      if (!info) this.hover = -1;
      this.onhover(info);
    }
  };

  /** Stroke a polyline given by fn(k) -> [lat, lon], splitting where it goes behind the globe. */
  Globe.prototype._line = function (fn, count, r) {
    var ctx = this.ctx, R = Math.min(this.w, this.h) * 0.40 * this.zoom, cx = this.w / 2, cy = this.h / 2, open = false;
    ctx.beginPath();
    for (var k = 0; k < count; k++) {
      var ll = fn(k), p = Geo.project(ll[0], ll[1], this.yaw, this.pitch, r);
      if (p.z >= 0) { if (!open) { ctx.moveTo(cx + p.x * R, cy - p.y * R); open = true; } else ctx.lineTo(cx + p.x * R, cy - p.y * R); } else open = false;
    }
    ctx.stroke();
  };

  root.Globe = Globe;
})(typeof self !== 'undefined' ? self : this);
