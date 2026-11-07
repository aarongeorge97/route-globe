#!/usr/bin/env node
/* Builds data/land.js and data/cities.js from Natural Earth (public domain).
 *
 *   node scripts/build-data.js <ne_110m_admin_0_countries.geojson> <ne_110m_populated_places_simple.geojson>
 *
 * Land becomes a dot-matrix: points on a roughly equal-area lat/lon grid that fall
 * inside any country polygon. Dots (not filled polygons) mean there is no
 * horizon-clipping problem to solve at render time and the output stays tiny.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Geo = require('../src/geo.js');

const [countriesPath, placesPath] = process.argv.slice(2);
if (!countriesPath || !placesPath) {
  console.error('usage: node scripts/build-data.js <countries.geojson> <populated_places.geojson>');
  process.exit(2);
}
const STEP = 1.7;        // degrees between dot rows
const CITY_COUNT = 40;   // largest populated places kept

const countries = JSON.parse(fs.readFileSync(countriesPath, 'utf8'));
const polys = [];
for (const f of countries.features) {
  const g = f.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const rings of list) {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [x, y] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    polys.push({ rings, minX, maxX, minY, maxY });
  }
}

const dots = [];
for (let lat = -58; lat <= 84; lat += STEP) {
  // Fewer dots per row toward the poles keeps the density even on the sphere.
  const stepLon = STEP / Math.max(0.2, Math.cos(lat * Geo.RAD));
  for (let lon = -180; lon < 180; lon += stepLon) {
    if (polys.some((p) => lon >= p.minX && lon <= p.maxX && lat >= p.minY && lat <= p.maxY && Geo.inPolygon(lon, lat, p.rings))) {
      dots.push(Math.round(lon * 10), Math.round(lat * 10));
    }
  }
}

const places = JSON.parse(fs.readFileSync(placesPath, 'utf8')).features
  .map((f) => ({ name: f.properties.name, lat: +f.properties.latitude.toFixed(2), lon: +f.properties.longitude.toFixed(2), pop: f.properties.pop_max }))
  .filter((c) => c.pop > 0)
  .sort((a, b) => b.pop - a.pop)
  .slice(0, CITY_COUNT);

const out = path.join(__dirname, '..', 'data');
fs.mkdirSync(out, { recursive: true });
const banner = '/* Derived from Natural Earth (public domain), https://www.naturalearthdata.com. Regenerate with scripts/build-data.js. */\n';
fs.writeFileSync(path.join(out, 'land.js'),
  `${banner}/* flat [lon*10, lat*10, ...] */\nvar ROUTE_LAND = ${JSON.stringify(dots)};\nif (typeof module !== 'undefined') module.exports = ROUTE_LAND;\n`);
fs.writeFileSync(path.join(out, 'cities.js'),
  `${banner}var ROUTE_CITIES = ${JSON.stringify(places)};\nif (typeof module !== 'undefined') module.exports = ROUTE_CITIES;\n`);
console.log(`land dots: ${dots.length / 2}  cities: ${places.length}  (${polys.length} polygons)`);
