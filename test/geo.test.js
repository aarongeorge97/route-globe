'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../src/geo.js');
const LAND = require('../data/land.js');
const CITIES = require('../data/cities.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ---------- projection ----------
test('the point at the view centre projects to the middle of the disc, facing the viewer', () => {
  const p = Geo.project(22, -40, -40, 22);
  near(p.x, 0); near(p.y, 0); near(p.z, 1);
});

test('a point 90 degrees east on the equator sits on the right edge, edge-on', () => {
  const p = Geo.project(0, 90, 0, 0);
  near(p.x, 1); near(p.y, 0); near(p.z, 0);
});

test('the north pole is straight up when looking at the equator', () => {
  const p = Geo.project(90, 0, 0, 0);
  near(p.x, 0); near(p.y, 1);
});

test('every projected point lies on a sphere of the requested radius', () => {
  for (const r of [1, 1.2]) for (const [lat, lon] of [[10, 20], [-60, 170], [85, -120]]) {
    const p = Geo.project(lat, lon, 33, -15, r);
    near(Math.hypot(p.x, p.y, p.z), r);
  }
});

// ---------- visibility ----------
test('the far side of the globe is hidden, the near side is visible', () => {
  assert.equal(Geo.isVisible(Geo.project(0, 180, 0, 0)), false); // antipode
  assert.equal(Geo.isVisible(Geo.project(0, 0, 0, 0)), true);
});

test('an elevated arc point behind the horizon but outside the disc stays visible', () => {
  const p = Geo.project(0, 100, 0, 0, 1.3); // z < 0 but x^2 + y^2 > 1
  assert.ok(p.z < 0);
  assert.equal(Geo.isVisible(p), true);
  assert.equal(Geo.isVisible(Geo.project(0, 100, 0, 0, 1.0)), false); // same spot on the ground: hidden
});

// ---------- great circles ----------
test('angular distance: zero, symmetric, quarter circle, half circle', () => {
  near(Geo.angularDistance([10, 20], [10, 20]), 0);
  near(Geo.angularDistance([0, 0], [0, 90]), Math.PI / 2);
  near(Geo.angularDistance([0, 0], [0, 180]), Math.PI);
  near(Geo.angularDistance([40, -74], [51, 0]), Geo.angularDistance([51, 0], [40, -74]));
});

test('great circle: endpoints are exact, the middle is the midpoint and is lifted', () => {
  const a = [0, 0], b = [0, 90], pts = Geo.greatCircle(a, b, 50, 0.3);
  assert.deepEqual([pts[0].lat, pts[0].lon, pts[0].h], [0, 0, 0]);
  assert.deepEqual([pts[50].lat, pts[50].lon], [0, 90]);
  near(pts[25].lon, 45, 1e-6); near(pts[25].lat, 0, 1e-6);
  assert.ok(pts[25].h > 0 && pts[25].h > pts[5].h && pts[25].h > pts[45].h);
  near(pts[50].h, 0, 1e-12);
});

test('great circle between identical points does not divide by zero', () => {
  const pts = Geo.greatCircle([10, 10], [10, 10], 20);
  assert.ok(pts.length >= 2 && pts.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
});

test('a long arc is lifted higher than a short one', () => {
  const long = Geo.greatCircle([0, 0], [0, 150], 40), short = Geo.greatCircle([0, 0], [0, 20], 40);
  assert.ok(Math.max(...long.map((p) => p.h)) > Math.max(...short.map((p) => p.h)));
});

// ---------- polygons ----------
test('point-in-polygon honours holes', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(Geo.inPolygon(2, 2, [outer, hole]), true);
  assert.equal(Geo.inPolygon(5, 5, [outer, hole]), false); // inside the hole
  assert.equal(Geo.inPolygon(20, 5, [outer, hole]), false);
});

test('point-in-polygon is exact when the point sits at the same latitude as a vertex', () => {
  const diamond = [[0, 5], [5, 0], [10, 5], [5, 10], [0, 5]]; // left and right vertices at lat 5
  assert.equal(Geo.inPolygon(3, 5, [diamond]), true);
  assert.equal(Geo.inPolygon(7, 5, [diamond]), true);
  assert.equal(Geo.inPolygon(-2, 5, [diamond]), false);
  assert.equal(Geo.inPolygon(12, 5, [diamond]), false);
});

// ---------- network ----------
test('the network is deterministic for a seed and differs for another', () => {
  const a = Geo.buildNetwork(CITIES, { seed: 7 }), b = Geo.buildNetwork(CITIES, { seed: 7 }), c = Geo.buildNetwork(CITIES, { seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.lanes.map((l) => l.phase), c.lanes.map((l) => l.phase));
  assert.deepEqual(a.lanes.map((l) => [l.from, l.to]), c.lanes.map((l) => [l.from, l.to])); // topology doesn't depend on the seed
});

test('hubs are the biggest cities that are spread apart', () => {
  const { hubs } = Geo.buildNetwork(CITIES, { hubCount: 7, minSepDeg: 28 });
  assert.equal(hubs.length, 7);
  for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) {
    const d = Geo.angularDistance([CITIES[hubs[i]].lat, CITIES[hubs[i]].lon], [CITIES[hubs[j]].lat, CITIES[hubs[j]].lon]);
    assert.ok(d >= 28 * Geo.RAD, `${CITIES[hubs[i]].name} and ${CITIES[hubs[j]].name} are too close`);
  }
  assert.equal(CITIES[hubs[0]].name, CITIES[0].name); // the single largest city is always a hub
});

test('the network is connected, has no duplicate or self lanes, and every city is on a lane', () => {
  const { lanes } = Geo.buildNetwork(CITIES, { seed: 3 });
  const keys = lanes.map((l) => [Math.min(l.from, l.to), Math.max(l.from, l.to)].join('-'));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(lanes.every((l) => l.from !== l.to));
  const adj = new Map(CITIES.map((_, i) => [i, []]));
  for (const l of lanes) { adj.get(l.from).push(l.to); adj.get(l.to).push(l.from); }
  const seen = new Set([0]); const stack = [0];
  while (stack.length) for (const n of adj.get(stack.pop())) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  assert.equal(seen.size, CITIES.length, 'every city is reachable from every other');
});

test('every spoke attaches to the nearest hub', () => {
  const { hubs, lanes } = Geo.buildNetwork(CITIES, { seed: 1 });
  const d = (i, j) => Geo.angularDistance([CITIES[i].lat, CITIES[i].lon], [CITIES[j].lat, CITIES[j].lon]);
  for (const l of lanes.filter((x) => x.kind === 'spoke')) {
    const best = Math.min(...hubs.map((h) => d(l.to, h)));
    near(d(l.from, l.to), best, 1e-12);
  }
});

// ---------- generated data ----------
test('land dots are in range, plentiful, and unique', () => {
  assert.ok(LAND.length / 2 > 3000);
  const seen = new Set();
  for (let i = 0; i < LAND.length; i += 2) {
    const lon = LAND[i] / 10, lat = LAND[i + 1] / 10;
    assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90);
    seen.add(LAND[i] + ',' + LAND[i + 1]);
  }
  assert.equal(seen.size, LAND.length / 2);
});

test('land dots fall where continents are and not where oceans are', () => {
  const has = (lat, lon, tol = 1.5) => { for (let i = 0; i < LAND.length; i += 2) if (Math.abs(LAND[i] / 10 - lon) < tol && Math.abs(LAND[i + 1] / 10 - lat) < tol) return true; return false; };
  for (const [name, lat, lon] of [['Kansas', 39, -98], ['Sahara', 23, 10], ['Siberia', 62, 100], ['Amazon', -5, -60], ['Australia', -25, 135]]) assert.ok(has(lat, lon), name);
  for (const [name, lat, lon] of [['mid-Atlantic', 0, -30], ['mid-Pacific', 0, -150], ['Indian Ocean', -30, 80]]) assert.ok(!has(lat, lon, 4), name);
});

test('the city list is sorted by population with sane coordinates', () => {
  assert.equal(CITIES.length, 40);
  for (let i = 1; i < CITIES.length; i++) assert.ok(CITIES[i - 1].pop >= CITIES[i].pop);
  assert.ok(CITIES.every((c) => c.name && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180));
});
