// Pencarian rute (OSRM, BRouter), pencarian tempat (Photon), elevasi (Open-Meteo), dan pembuat GPX.

export const ROUTE_COLORS = ['#2f4bff', '#e5195f', '#7c3aed', '#0891b2', '#16a34a', '#be123c', '#17203a']

export const MODES = {
  bike:  { type: 'cycling', file: 'Gowes' },
  motor: { type: 'motorcycling', file: 'Motor' },
  car:   { type: 'driving', file: 'Mobil' },
}

async function osrm(waypoints, profile, name) {
  const c = waypoints.map(p => `${p.lng},${p.lat}`).join(';')
  const alt = waypoints.length === 2 ? '&alternatives=3' : ''
  const r = await fetch(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${c}?overview=full&geometries=geojson${alt}`)
  if (!r.ok) throw new Error('OSRM ' + r.status)
  const j = await r.json()
  if (j.code !== 'Ok') throw new Error(j.message || j.code)
  return j.routes.map((rt, i) => ({
    label: i === 0 ? name : `${name} – alternatif ${i}`,
    source: 'Rute tercepat versi OSRM',
    coords: rt.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: rt.distance, duration: rt.duration,
  }))
}

async function brouter(waypoints, profile, label, desc, altIdx = 0) {
  const ll = waypoints.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|')
  const r = await fetch(`https://brouter.de/brouter?lonlats=${ll}&profile=${profile}&alternativeidx=${altIdx}&format=geojson`)
  if (!r.ok) throw new Error('BRouter ' + (await r.text()).slice(0, 120))
  const j = await r.json()
  const f = j.features[0], pr = f.properties
  return [{
    label, source: desc,
    coords: f.geometry.coordinates.map(([lng, lat, ele]) => [lat, lng, ele]),
    distance: +pr['track-length'], duration: +pr['total-time'], ascent: +pr['filtered ascend'],
  }]
}

// satu janji per sumber rute; yang gagal diabaikan oleh pemanggil (Promise.allSettled)
export function routeJobs(mode, wp) {
  // fungsi, bukan array langsung: hanya mode terpilih yang boleh memanggil server
  return {
    bike: () => [
      brouter(wp, 'fastbike', 'Sepeda balap (fastbike)', 'Utamakan jalan aspal mulus, cocok roadbike'),
      brouter(wp, 'trekking', 'Touring (trekking)', 'Seimbang, hindari jalan besar bila bisa'),
      brouter(wp, 'safety', 'Paling aman (safety)', 'Hindari lalu lintas ramai'),
      brouter(wp, 'shortest', 'Terpendek', 'Jarak paling pendek'),
      osrm(wp, 'bike', 'OSRM Sepeda'),
    ],
    motor: () => [
      brouter(wp, 'moped', 'Motor (moped)', 'Jalan yang boleh dilalui motor'),
      brouter(wp, 'car-fast', 'Tercepat', 'Utamakan jalan besar'),
      brouter(wp, 'car-eco', 'Hemat BBM', 'Kecepatan stabil, lebih irit'),
      osrm(wp, 'car', 'OSRM'),
    ],
    car: () => [
      brouter(wp, 'car-fast', 'Mobil – tercepat', 'Utamakan jalan besar dan cepat'),
      brouter(wp, 'car-eco', 'Mobil – hemat BBM', 'Kecepatan stabil, lebih irit'),
      osrm(wp, 'car', 'OSRM Mobil'),
    ],
  }[mode]()
}

function sameish(a, b) {
  const pick = r => r.coords[Math.floor(r.coords.length / 2)]
  const p = pick(a), q = pick(b)
  return Math.abs(p[0] - q[0]) < 0.0005 && Math.abs(p[1] - q[1]) < 0.0005
}

// buang rute yang identik
export function dedupeRoutes(routes) {
  return routes.filter((r, i) => !routes.slice(0, i).some(o => Math.abs(o.distance - r.distance) < 30 && o.coords.length && sameish(o, r)))
}

export function formatDuration(s) {
  if (!s) return '-'
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? `${h} j ${m} mnt` : `${m} mnt`
}

/* ---------- Cari tempat (Photon / OpenStreetMap) ---------- */
function placeLabel(pr) {
  const first = pr.name || [pr.street, pr.housenumber].filter(Boolean).join(' ')
  return [...new Set([first, pr.district, pr.city || pr.county, pr.state].filter(Boolean))].join(', ')
}

function toPlace(lat, lng, label) {
  const parts = label.split(', ')
  return { lat, lng, label, name: parts[0], rest: parts.slice(1).join(', ') }
}

export async function searchPlaces(q, center) {
  const c = coordFromText(q)
  if (c) return [{ lat: c.lat, lng: c.lng, label: `${c.lat}, ${c.lng}`, name: 'Koordinat', rest: `${c.lat}, ${c.lng}` }]
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&zoom=11&location_bias_scale=0.4`)
  if (!r.ok) throw new Error(r.status)
  const j = await r.json()
  return j.features.map(f => toPlace(f.geometry.coordinates[1], f.geometry.coordinates[0], placeLabel(f.properties))).filter(p => p.label)
}

// Nominatim (OpenStreetMap): hanya dipanggil saat pengguna meminta "cari lebih luas", bukan tiap ketikan
export async function searchPlacesWide(q, center) {
  const d = 1.5
  const box = `${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}`
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&viewbox=${box}`)
  if (!r.ok) throw new Error(r.status)
  const j = await r.json()
  return j.map(x => {
    const parts = x.display_name.split(', ')
    const label = [x.name || parts[0], ...parts.slice(x.name && x.name !== parts[0] ? 0 : 1, 4)].join(', ')
    return toPlace(+x.lat, +x.lon, label)
  })
}

/* ---------- Elevasi & GPX ---------- */
// Open-Meteo elevation API: maks 100 titik per permintaan
export async function fillElevation(coords, onProgress) {
  const out = coords.map(c => c.slice())
  for (let i = 0; i < out.length; i += 100) {
    const chunk = out.slice(i, i + 100)
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(c => c[0].toFixed(5)).join(',')}&longitude=${chunk.map(c => c[1].toFixed(5)).join(',')}`)
    if (!r.ok) throw new Error('elevasi ' + r.status)
    const j = await r.json()
    j.elevation.forEach((e, k) => out[i + k][2] = e)
    onProgress?.(Math.min(i + 100, out.length), out.length)
  }
  return out
}

export function buildGpx({ name, coords, waypoints, withWpt, type }) {
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const pts = coords.map(c => `      <trkpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}">${c[2] != null && !isNaN(c[2]) ? `<ele>${(+c[2]).toFixed(1)}</ele>` : ''}</trkpt>`).join('\n')
  const wpts = withWpt ? waypoints.map((p, i) => `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${x(p.name || (i === 0 ? 'Start' : i === waypoints.length - 1 ? 'Finish' : 'Titik ' + i))}</name></wpt>`).join('\n') + '\n' : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPX Rute" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${x(name)}</name><time>${new Date().toISOString()}</time></metadata>
${wpts}  <trk>
    <name>${x(name)}</name>
    <type>${type}</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`
}
