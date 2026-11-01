// Pencarian rute (OSRM, BRouter), pencarian tempat (Photon), elevasi (Open-Meteo), dan pembuat GPX.

export const ROUTE_COLORS = ['#e5192f', '#2f4bff', '#7c3aed', '#0891b2', '#16a34a', '#be123c', '#17203a']

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

function decodePolyline6(str) {
  const out = []
  let i = 0, lat = 0, lng = 0
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let b, shift = 0, result = 0
      do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5 } while (b >= 32)
      const d = (result & 1) ? ~(result >> 1) : (result >> 1)
      axis === 0 ? lat += d : lng += d
    }
    out.push([lat / 1e6, lng / 1e6])
  }
  return out
}

// Valhalla (server publik FOSSGIS): costing 'motorcycle' mengikuti aturan motor, jadi tidak masuk jalan tol
async function valhalla(waypoints, costing, options, name, desc, alternates = 2) {
  const json = {
    locations: waypoints.map(p => ({ lat: p.lat, lon: p.lng })),
    costing, costing_options: { [costing]: options },
    alternates, directions_type: 'none',
  }
  const r = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(json))}`)
  const j = await r.json()
  if (!r.ok || !j.trip) throw new Error('Valhalla ' + (j.error || r.status))
  return [j.trip, ...(j.alternates || []).map(a => a.trip)].map((t, i) => ({
    label: i === 0 ? name : `${name} – alternatif ${i}`,
    source: desc,
    // tiap leg diawali titik akhir leg sebelumnya: buang duplikatnya
    coords: t.legs.flatMap((leg, k) => decodePolyline6(leg.shape).slice(k ? 1 : 0)),
    distance: t.summary.length * 1000, duration: t.summary.time,
  }))
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
      valhalla(wp, 'motorcycle', { use_highways: 0, use_tolls: 0 }, 'Motor – tercepat', 'Tanpa jalan tol, mengikuti aturan motor'),
      valhalla(wp, 'motorcycle', { use_highways: 0, use_tolls: 0, shortest: true }, 'Motor – terpendek', 'Jarak paling pendek, tanpa jalan tol', 0),
    ],
    car: () => [
      valhalla(wp, 'auto', { use_tolls: 0 }, 'Mobil – tanpa tol', 'Menghindari jalan tol bila bisa'),
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
// Elevasi: Open-Meteo (maks 100 titik per permintaan); bila ditolak (mis. 429) coba lagi, lalu pakai OpenTopoData
async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url)
    if (r.ok) return r.json()
    if (r.status !== 429 && r.status < 500) throw new Error('elevasi ' + r.status)
    await new Promise(res => setTimeout(res, 1200 * (i + 1)))
  }
  throw new Error('elevasi: server sibuk')
}

async function elevationChunk(chunk) {
  try {
    const j = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(c => c[0].toFixed(5)).join(',')}&longitude=${chunk.map(c => c[1].toFixed(5)).join(',')}`, 3)
    return j.elevation
  } catch {
    const j = await getJson(`https://api.opentopodata.org/v1/srtm90m?locations=${chunk.map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join('|')}`)
    return j.results.map(x => x.elevation)
  }
}

export async function fillElevation(coords, onProgress) {
  const out = coords.map(c => c.slice())
  for (let i = 0; i < out.length; i += 100) {
    const elev = await elevationChunk(out.slice(i, i + 100))
    elev.forEach((e, k) => { out[i + k][2] = e })
    onProgress?.(Math.min(i + 100, out.length), out.length)
  }
  if (out.some(c => c[2] == null)) throw new Error('elevasi: data kosong')
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
