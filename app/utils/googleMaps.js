// Membaca titik rute dari link / embed Google Maps. Hasil: { points: [{lat, lng, name}], mode }

function extractUrl(text) {
  text = text.trim()
  const m = text.match(/src=["']([^"']+)["']/i)
  if (m) text = m[1]
  return text.replace(/&amp;/g, '&')
}

export function coordFromText(s) {
  const m = String(s).replace(/\+/g, '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  return m ? { lat: +m[1], lng: +m[2], name: '' } : null
}

// pb Google: tiap titik ditulis "!3m2!1d<lat>!2d<lng>", nama tempat "!2s<nama>" sebelumnya.
function parsePb(pb) {
  const tok = pb.split('!').filter(Boolean)
  const points = []
  let mode = null, lastName = ''
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i]
    if (mode === null && /^3e\d$/.test(t)) mode = +t.slice(2)
    if (/^4m\d+$/.test(t)) lastName = ''
    if (/^2s/.test(t)) lastName = t.slice(2)
    if (t === '3m2' && /^1d-?[\d.]+$/.test(tok[i + 1] || '') && /^2d-?[\d.]+$/.test(tok[i + 2] || '')) {
      points.push({ lat: +tok[i + 1].slice(2), lng: +tok[i + 2].slice(2), name: lastName })
      lastName = ''; i += 2
    } else if (t === '1m2' && /^1d-?[\d.]+$/.test(tok[i + 1] || '') && /^2d-?[\d.]+$/.test(tok[i + 2] || '')) {
      points.push({ lat: +tok[i + 2].slice(2), lng: +tok[i + 1].slice(2), name: 'Lewat sini (dari Google)' })
      i += 2
    }
  }
  if (points.length < 2) {
    throw new Error('Embed ini bukan rute (butuh minimal titik awal & tujuan). Buat "Petunjuk arah" dulu di Google Maps.')
  }
  return { points, mode }
}

export function parseGoogle(text) {
  const raw = extractUrl(text)
  let url
  try { url = new URL(raw) } catch { throw new Error('Bukan URL yang valid.') }
  if (/goo\.gl$/.test(url.hostname)) throw new Error('Link pendek (goo.gl) tidak bisa dibaca. Pakai "Sematkan peta" → Salin HTML.')

  const pb = url.searchParams.get('pb')
  if (pb) return parsePb(pb)

  // Embed API: /maps/embed/v1/directions?origin=..&destination=..&waypoints=a|b
  if (url.searchParams.get('origin')) {
    const list = [url.searchParams.get('origin'),
      ...(url.searchParams.get('waypoints') || '').split('|').filter(Boolean),
      url.searchParams.get('destination')]
    const pts = list.map(coordFromText)
    if (pts.some(p => !p)) throw new Error('Link memakai nama tempat, bukan koordinat. Gunakan versi "Sematkan peta" (pb=...).')
    return { points: pts, mode: url.searchParams.get('mode') }
  }

  // Link biasa: /maps/dir/lat,lng/lat,lng/@...  atau data=!1d<lng>!2d<lat>
  const path = decodeURIComponent(url.pathname)
  if (path.includes('/dir/')) {
    const segs = path.split('/dir/')[1].split('/').filter(s => s && !s.startsWith('@') && !s.startsWith('data='))
    const data = (path.match(/data=(.*)$/) || [])[1] || ''
    const dataPts = [...data.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map(m => ({ lat: +m[2], lng: +m[1] }))
    let di = 0
    const pts = segs.map(s => {
      const c = coordFromText(s)
      if (c) return c
      const p = dataPts[di++]
      return p ? { ...p, name: s.replace(/\+/g, ' ').split(',')[0] } : null
    }).filter(Boolean)
    if (pts.length >= 2) return { points: pts }
  }
  throw new Error('Tidak menemukan titik rute di link ini.')
}
