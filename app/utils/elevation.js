// Profil ketinggian rute: jarak kumulatif, elevasi yang dihaluskan, dan kemiringan (%).

const R = 6371000
const rad = Math.PI / 180

function haversine(a, b) {
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function cumulativeDistance(coords) {
  const d = [0]
  for (let i = 1; i < coords.length; i++) d.push(d[i - 1] + haversine(coords[i - 1], coords[i]))
  return d
}

function smooth(arr, half) {
  return arr.map((_, i) => {
    let s = 0, n = 0
    for (let k = Math.max(0, i - half); k <= Math.min(arr.length - 1, i + half); k++) { s += arr[k]; n++ }
    return s / n
  })
}

// koordinat [lat, lng, ele?] → { dist, ele, grade, pos, total, up, down, min, max, maxGrade }
export async function buildProfile(coords) {
  const cum = cumulativeDistance(coords)
  const total = cum[cum.length - 1]
  // maks 100 titik = satu permintaan elevasi per rute (batas API gratis)
  const n = Math.max(2, Math.min(100, Math.round(total / 50) + 1))

  const samples = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const t = total * k / (n - 1)
    while (j < cum.length - 2 && cum[j + 1] < t) j++
    const a = coords[j], b = coords[j + 1] || coords[j]
    const f = Math.min(1, Math.max(0, (t - cum[j]) / ((cum[j + 1] - cum[j]) || 1)))
    samples.push({
      d: t, lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f,
      ele: a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * f : null,
    })
  }
  if (samples.some(s => s.ele == null)) {
    const filled = await fillElevation(samples.map(s => [s.lat, s.lng]))
    filled.forEach((c, i) => { samples[i].ele = c[2] })
  }

  const spacing = total / (n - 1) || 1
  const ele = smooth(samples.map(s => s.ele), Math.max(1, Math.round(60 / spacing)))
  const dist = samples.map(s => s.d)

  let up = 0, down = 0
  for (let i = 1; i < n; i++) { const df = ele[i] - ele[i - 1]; df > 0 ? up += df : down -= df }

  // kemiringan dihitung pada jendela ±~150 m supaya tidak berisik
  const w = Math.max(1, Math.round(150 / spacing))
  const grade = ele.map((_, i) => {
    const a = Math.max(0, i - w), b = Math.min(n - 1, i + w)
    return (ele[b] - ele[a]) / ((dist[b] - dist[a]) || 1) * 100
  })

  return {
    dist, ele, grade, pos: samples.map(s => [s.lat, s.lng]),
    total, up, down, min: Math.min(...ele), max: Math.max(...ele),
    maxGrade: Math.max(...grade), minGrade: Math.min(...grade),
  }
}

// isi elevasi tiap titik rute dari profil (tanpa permintaan jaringan tambahan)
export function interpolateElevation(coords, profile) {
  const cum = cumulativeDistance(coords)
  let j = 0
  return coords.map((c, i) => {
    const t = cum[i]
    while (j < profile.dist.length - 2 && profile.dist[j + 1] < t) j++
    const span = (profile.dist[j + 1] - profile.dist[j]) || 1
    const f = Math.min(1, Math.max(0, (t - profile.dist[j]) / span))
    return [c[0], c[1], profile.ele[j] + (profile.ele[j + 1] - profile.ele[j]) * f]
  })
}

// warna kemiringan: turun biru, datar hijau, makin curam makin merah
export function gradeColor(g) {
  if (g < -6) return '#1d4ed8'
  if (g < -2) return '#60a5fa'
  if (g < 2) return '#34d399'
  if (g < 5) return '#facc15'
  if (g < 8) return '#fb923c'
  if (g < 12) return '#ef4444'
  return '#991b1b'
}
