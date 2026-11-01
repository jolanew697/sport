<script setup>
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

const mapEl = ref(null)
const saveDlg = ref(null)

const mode = ref('bike')
try { const m = localStorage.getItem('gpxMode'); if (MODES[m]) mode.value = m } catch {}

const waypoints = ref([])        // {lat, lng, name, label?}
const pendingEnd = ref(null)     // tujuan yang dipilih sebelum titik awal
const routes = shallowRef([])    // {label, source, coords, distance, duration, ascent, color, layer}
const selected = ref(-1)
const routeState = ref('none')   // none | loading | error
const routeError = ref('')
const routeNetErr = ref(false)
const canUndo = ref(false)

const place = reactive({ A: '', B: '' })
const sug = reactive({
  A: { items: [], on: -1, open: false, msg: '', wide: false, busy: false },
  B: { items: [], on: -1, open: false, msg: '', wide: false, busy: false },
})

const embedText = ref('')
const parseMsg = ref('')
const parseErr = ref(false)

const gpxName = ref('')
const optEle = ref(true)
const optWpt = ref(false)
const gpxMsg = ref('')
const gpxBusy = ref(false)
const fileName = ref('')

let map = null
let markers = []
let undoStack = []
let lastDrag = 0
let ghost = null
let routeSeq = 0

const lastIndex = computed(() => waypoints.value.length - 1)
const cleanName = computed(() => cleanFile(fileName.value))
const fileCount = computed(() => cleanName.value ? `Tersimpan sebagai: ${cleanName.value}.gpx (${cleanName.value.length} karakter)` : 'Nama file belum diisi.')

function pointLabel(i) { return i === 0 ? 'A' : (i === lastIndex.value ? 'B' : i) }
function pointName(p, i) { return p.name || (i === 0 ? 'Titik awal' : i === lastIndex.value ? 'Tujuan' : 'Titik ' + i) }

/* ---------- Titik rute & kotak A/B ---------- */
function placeText(p) { return p ? (p.label || p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`) : '' }
function syncPlaces() {
  const a = waypoints.value[0]
  const b = waypoints.value.length >= 2 ? waypoints.value[lastIndex.value] : pendingEnd.value
  const focus = document.activeElement?.id
  if (focus !== 'placeA') place.A = placeText(a)
  if (focus !== 'placeB') place.B = placeText(b)
}

function drawMarkers() {
  if (!map) return
  markers.forEach(m => m.remove())
  markers = waypoints.value.map((p, i) => {
    const m = L.marker([p.lat, p.lng], {
      draggable: true,
      icon: L.divIcon({ className: '', html: `<div class="dot" style="border:2px solid #fff;box-shadow:0 1px 4px #0006">${pointLabel(i)}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(map)
    m.on('dragstart', pushUndo)
    m.on('dragend', () => {
      const ll = m.getLatLng()
      waypoints.value[i] = { lat: ll.lat, lng: ll.lng, name: waypoints.value[i].name }
      findRoutes()
    })
    return m
  })
}
watch(waypoints, () => { drawMarkers(); syncPlaces() }, { deep: true, flush: 'post' })
watch(pendingEnd, syncPlaces)

function setWaypoints(pts) { waypoints.value = pts.map(p => ({ ...p })); pendingEnd.value = null; clearRoutes() }

function removeWaypoint(i) {
  pushUndo()
  waypoints.value.splice(i, 1)
  waypoints.value.length >= 2 ? findRoutes() : clearRoutes()
}

function insertIndex(ll) {
  const r = routes.value[selected.value]
  const wp = waypoints.value
  if (r) {
    const idxOf = q => {
      let best = 0, bd = Infinity
      r.coords.forEach((c, i) => {
        const d = (c[0] - q.lat) ** 2 + (c[1] - q.lng) ** 2
        if (d < bd) { bd = d; best = i }
      })
      return best
    }
    const t = idxOf(ll), w = wp.map(idxOf)
    for (let i = 0; i < w.length - 1; i++) if (t >= w[i] && t <= w[i + 1]) return i + 1
  }
  const d = (a, b) => map.distance([a.lat, a.lng], [b.lat, b.lng])
  let best = 1, cost = Infinity
  for (let i = 0; i < wp.length - 1; i++) {
    const c = d(wp[i], ll) + d(ll, wp[i + 1]) - d(wp[i], wp[i + 1])
    if (c < cost) { cost = c; best = i + 1 }
  }
  return best
}

function addVia(ll) {
  pushUndo()
  const p = { lat: ll.lat, lng: ll.lng, name: '' }
  const wp = waypoints.value
  if (wp.length < 2) {
    wp.push(p)
    if (wp.length === 1 && pendingEnd.value) { wp.push(pendingEnd.value); pendingEnd.value = null }
  } else { p.name = 'Lewat sini'; wp.splice(insertIndex(ll), 0, p) }
  wp.length >= 2 ? findRoutes() : clearRoutes()
}

/* tarik garis rute untuk menambah titik singgah (seperti Google Maps) */
function startLineDrag(ev) {
  L.DomEvent.stop(ev)
  map.dragging.disable()
  ghost = L.marker(ev.latlng, {
    icon: L.divIcon({ className: '', html: '<div class="dot" style="border:2px solid #fff;box-shadow:0 1px 6px #0007">+</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
  }).addTo(map)
  const move = e => ghost.setLatLng(e.latlng)
  const up = e => {
    map.off('mousemove', move); map.off('mouseup', up)
    map.dragging.enable()
    const ll = e.latlng; ghost.remove(); ghost = null; lastDrag = Date.now()
    addVia(ll)
  }
  map.on('mousemove', move); map.on('mouseup', up)
}

/* urungkan perubahan */
function pushUndo() {
  undoStack.push(JSON.stringify(waypoints.value))
  if (undoStack.length > 30) undoStack.shift()
  canUndo.value = true
}
function undo() {
  const prev = undoStack.pop()
  if (!prev) return
  waypoints.value = JSON.parse(prev)
  canUndo.value = undoStack.length > 0
  waypoints.value.length >= 2 ? findRoutes() : clearRoutes()
}
function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); undo() }
}
function reverse() { pushUndo(); waypoints.value.reverse(); if (waypoints.value.length >= 2) findRoutes() }
function clearAll() { pushUndo(); waypoints.value = []; pendingEnd.value = null; clearRoutes() }

/* ---------- Cari tempat ---------- */
function setEndpoint(which, p) {
  pushUndo()
  const wp = waypoints.value
  if (which === 'A') {
    if (wp.length) wp[0] = p; else wp.push(p)
    if (wp.length === 1 && pendingEnd.value) { wp.push(pendingEnd.value); pendingEnd.value = null }
  } else if (wp.length >= 2) wp[wp.length - 1] = p
  else if (wp.length === 1) wp.push(p)
  else pendingEnd.value = p
  if (wp.length >= 2) {
    map.fitBounds(L.latLngBounds(wp.map(w => [w.lat, w.lng])), { padding: [40, 40] })
    findRoutes()
  } else { map.setView([p.lat, p.lng], 15); clearRoutes() }
}

const timers = {}
const seqs = { A: 0, B: 0 }

function closeSug(which) { sug[which].open = false; sug[which].on = -1 }

function onPlaceInput(which) {
  clearTimeout(timers[which])
  const q = place[which].trim()
  if (q.length < 3) { closeSug(which); return }
  timers[which] = setTimeout(async () => {
    const my = ++seqs[which]
    const s = sug[which]
    try {
      const items = await searchPlaces(q, map.getCenter())
      if (my !== seqs[which]) return
      s.items = items; s.on = items.length ? 0 : -1; s.msg = 'Tempat tidak ditemukan.'; s.wide = false
    } catch {
      if (my !== seqs[which]) return
      s.items = []; s.on = -1; s.msg = 'Pencarian tempat gagal. Klik peta untuk menaruh titik.'; s.wide = true
    }
    s.open = true
  }, 350)
}

// hasil Photon kurang? Tambah dari Nominatim atas permintaan pengguna
async function searchWide(which) {
  const s = sug[which]
  s.busy = true
  try {
    const more = await searchPlacesWide(place[which].trim(), map.getCenter())
    const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lng - b.lng) < 0.0003
    s.items = [...s.items, ...more.filter(m => !s.items.some(o => near(o, m)))]
    s.on = s.items.length ? 0 : -1
    s.msg = 'Tempat tidak ditemukan.'
  } catch { s.msg = 'Pencarian lebih luas gagal. Coba lagi sebentar lagi.' }
  s.wide = true; s.busy = false
}

function pickSug(which, i) {
  const p = sug[which].items[i]
  if (!p) return
  place[which] = p.label
  closeSug(which)
  setEndpoint(which, p)
}

function onPlaceKey(which, e) {
  const s = sug[which]
  if (!s.open) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!s.items.length) return
    e.preventDefault()
    s.on = (s.on + (e.key === 'ArrowDown' ? 1 : s.items.length - 1)) % s.items.length
  } else if (e.key === 'Enter' && s.on >= 0) { e.preventDefault(); pickSug(which, s.on) }
  else if (e.key === 'Escape') closeSug(which)
}

function onPlaceBlur(which) { closeSug(which); nextTick(syncPlaces) }

function setMode(m) {
  if (m === mode.value) return
  mode.value = m
  try { localStorage.setItem('gpxMode', m) } catch {}
  if (waypoints.value.length >= 2) findRoutes()
}

/* ---------- Routing ---------- */
function clearRoutes() {
  routeSeq++
  routes.value.forEach(r => r.layer?.remove())
  routes.value = []; selected.value = -1
  routeState.value = 'none'
}

async function findRoutes() {
  const wp = waypoints.value
  if (wp.length < 2) return
  clearRoutes()
  const my = routeSeq
  routeState.value = 'loading'
  const res = await Promise.allSettled(routeJobs(mode.value, wp.map(p => ({ lat: p.lat, lng: p.lng }))))
  if (my !== routeSeq) return   // ada pencarian yang lebih baru
  const errs = []
  let found = []
  res.forEach(r => r.status === 'fulfilled' ? found.push(...r.value) : errs.push(r.reason.message))
  found = dedupeRoutes(found)
  found.forEach((r, i) => {
    r.color = ROUTE_COLORS[i % ROUTE_COLORS.length]
    const ll = r.coords.map(c => [c[0], c[1]])
    r.casing = L.polyline(ll, { color: '#fff', weight: 9, opacity: .9 })
    r.line = L.polyline(ll, { color: r.color, weight: 5, opacity: .85 })
    r.layer = L.featureGroup([r.casing, r.line]).addTo(map)
      .on('click', ev => { L.DomEvent.stop(ev); selectRoute(i) })
      .on('mousedown', ev => { if (i === selected.value) startLineDrag(ev) })
    markRaw(r)
  })
  routes.value = found
  if (!found.length) {
    routeNetErr.value = errs.every(e => /fetch|NetworkError|Load failed/i.test(e))
    routeError.value = [...new Set(errs)].join('; ')
    routeState.value = 'error'
    return
  }
  routeState.value = 'none'
  selectRoute(0)
  map.fitBounds(L.featureGroup(found.map(r => r.layer)).getBounds(), { padding: [30, 30] })
}

function selectRoute(i) {
  selected.value = i
  routes.value.forEach((r, j) => {
    const on = j === i
    r.casing.setStyle({ weight: on ? 13 : 9, color: on ? '#111' : '#fff', opacity: on ? .55 : .9 })
    r.line.setStyle({ weight: on ? 8 : 5, opacity: on ? 1 : .8, dashArray: on ? null : '10 8' })
  })
  routes.value[i].layer.bringToFront()
  gpxMsg.value = ''
}

/* ---------- GPX ---------- */
function cleanFile(s) { return s.replace(/\.gpx$/i, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') }

function shortName() {
  const wp = waypoints.value
  const word = s => (s || '').split(/[\s,]+/)[0].slice(0, 12)
  const a = word(wp[0]?.name), b = word(wp[wp.length - 1]?.name)
  const km = Math.round(routes.value[selected.value].distance / 1000) + 'km'
  return cleanFile(a && b ? `${a}-${b}_${km}` : `${MODES[mode.value].file}_${km}_${new Date().toISOString().slice(5, 10)}`)
}

function defaultName() {
  const wp = waypoints.value
  const a = wp[0]?.name, b = wp[wp.length - 1]?.name
  return a && b ? `${a} - ${b}` : `Rute ${new Date().toISOString().slice(0, 10)}`
}

function openSave() {
  if (!routes.value[selected.value]) return
  fileName.value = shortName()
  saveDlg.value.showModal()
  nextTick(() => document.getElementById('fileName')?.select())
}

function onSave(e) {
  if (!cleanName.value) { e.preventDefault(); return }
  downloadGpx(cleanName.value)
}

async function downloadGpx(name) {
  const r = routes.value[selected.value]
  if (!r) return
  const title = gpxName.value.trim() || defaultName()
  let coords = r.coords
  gpxBusy.value = true
  try {
    if (optEle.value && coords.some(c => c[2] == null)) {
      try { coords = await fillElevation(coords, (n, total) => { gpxMsg.value = `Mengambil elevasi… ${n}/${total}` }) }
      catch { gpxMsg.value = 'Elevasi gagal diambil, GPX dibuat tanpa elevasi.' }
    }
    if (!optEle.value) coords = coords.map(c => [c[0], c[1]])
    const gpx = buildGpx({ name: title, coords, waypoints: waypoints.value, withWpt: optWpt.value, type: MODES[mode.value].type })
    const blob = new Blob([gpx], { type: 'application/gpx+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name + '.gpx'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    gpxMsg.value = `${name}.gpx dibuat: ${coords.length} titik, ${(r.distance / 1000).toFixed(1)} km.`
  } finally { gpxBusy.value = false }
}

/* ---------- Link embed Google Maps ---------- */
const GOOGLE_MODES = { 0: 'mobil', 1: 'sepeda', 2: 'jalan kaki', 3: 'transportasi umum', 9: 'motor' }
const GOOGLE_TO_MODE = { 0: 'car', 1: 'bike', 9: 'motor' }
const SAMPLE = '<iframe src="https://www.google.com/maps/embed?pb=!1m28!1m12!1m3!1d31731.5!2d106.82!3d-6.2!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!4m13!3e1!4m5!1s0x2e69f5d2e764b12d%3A0x3d2ad6e1e0e9bcc8!2sMonumen%20Nasional!3m2!1d-6.1753924!2d106.8271528!4m5!1s0x2e69f1ec2422b0b3%3A0x39a0d0fe47404d02!2sGelora%20Bung%20Karno!3m2!1d-6.2186!2d106.8023!5e0!3m2!1sid!2sid!4v1700000000000!5m2!1sid!2sid" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy"></iframe>'

function parseEmbed() {
  parseErr.value = false
  try {
    const { points, mode: gMode } = parseGoogle(embedText.value)
    setWaypoints(points)
    parseMsg.value = `${points.length} titik ditemukan${gMode != null && GOOGLE_MODES[gMode] ? ` (mode Google: ${GOOGLE_MODES[gMode]})` : ''}.`
    if (!gpxName.value) gpxName.value = defaultName()
    map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [40, 40] })
    if (GOOGLE_TO_MODE[gMode]) mode.value = GOOGLE_TO_MODE[gMode]
    findRoutes()
  } catch (e) {
    parseErr.value = true; parseMsg.value = e.message
  }
}
function useSample() { embedText.value = SAMPLE; parseEmbed() }

/* ---------- Peta ---------- */
onMounted(() => {
  map = L.map(mapEl.value).setView([-6.2, 106.82], 12)
  // Esri World Street Map: gaya jalan berwarna mirip Google Maps (OSM standar tetap tersedia)
  const layers = {
    'Peta': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
    'Satelit': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' }),
    'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }),
  }
  let base = 'Peta'
  try { const b = localStorage.getItem('gpxBase2'); if (layers[b]) base = b } catch {}
  layers[base].addTo(map)
  L.control.layers(layers, null, { position: 'topright' }).addTo(map)
  map.on('baselayerchange', e => { try { localStorage.setItem('gpxBase2', e.name) } catch {} })
  map.on('click', e => { if (Date.now() - lastDrag > 400) addVia(e.latlng) })
  drawMarkers()
})
onBeforeUnmount(() => { map?.remove(); map = null })

// halaman disimpan (keepalive): ukuran peta perlu dihitung ulang tiap kali tampil lagi,
// dan pintasan Ctrl+Z hanya boleh aktif saat halaman ini yang terlihat
onActivated(() => {
  document.addEventListener('keydown', onKey)
  setTimeout(() => map?.invalidateSize(), 50)
})
onDeactivated(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="gpx">
    <aside>
      <header class="hero">
        <h1>GPX Rute</h1>
        <p class="sub">Cari tempat → pilih kendaraan → pilih rute → unduh GPX.</p>
        <svg viewBox="0 0 300 42" aria-hidden="true">
          <path class="trail" pathLength="1" d="M10 32 C42 32 52 10 87 12 S132 36 167 28 S227 6 262 14"/>
          <circle class="pin" cx="10" cy="32" r="7" fill="#e5195f"/>
          <circle class="pin pin-b" cx="262" cy="14" r="7" fill="#fff"/>
        </svg>
      </header>

      <h2>Dari mana ke mana?</h2>
      <div class="modes" role="group" aria-label="Kendaraan">
        <button type="button" class="mode" :aria-pressed="mode === 'bike'" @click="setMode('bike')">🚲 Sepeda</button>
        <button type="button" class="mode" :aria-pressed="mode === 'motor'" @click="setMode('motor')">🛵 Motor</button>
        <button type="button" class="mode" :aria-pressed="mode === 'car'" @click="setMode('car')">🚗 Mobil</button>
      </div>
      <div v-for="w in ['A', 'B']" :key="w" class="place">
        <span class="dot">{{ w }}</span>
        <input type="text" :id="'place' + w" v-model="place[w]" :placeholder="w === 'A' ? 'Titik awal' : 'Tujuan'"
          autocomplete="off" spellcheck="false" role="combobox" :aria-expanded="sug[w].open" :aria-controls="'sug' + w"
          @input="onPlaceInput(w)" @keydown="onPlaceKey(w, $event)" @blur="onPlaceBlur(w)">
        <ul v-if="sug[w].open" class="suggest" :id="'sug' + w" role="listbox" @mousedown.prevent>
          <li v-for="(p, i) in sug[w].items" :key="i" role="option" :class="{ on: i === sug[w].on }" @mousedown.prevent="pickSug(w, i)">
            <b>{{ p.name }}</b>
            <small>{{ p.rest }}</small>
          </li>
          <li v-if="!sug[w].items.length" class="none">{{ sug[w].msg }}</li>
          <li v-if="!sug[w].wide" class="more" @mousedown.prevent="searchWide(w)">{{ sug[w].busy ? 'Mencari…' : 'Tidak ketemu? Cari lebih luas' }}</li>
        </ul>
      </div>
      <div class="msg">Ketik nama tempat, atau klik peta untuk menaruh titik.</div>
      <div class="hint">
        Rute beda dari yang kamu mau? <b>Tarik garis rute</b> ke jalan lain, atau <b>klik jalan di peta</b> untuk menyisipkan titik singgah. Penanda bisa digeser, dan ada tombol Urungkan.
      </div>
      <details class="paste">
        <summary>Punya link embed Google Maps?</summary>
        <p class="msg">Di Google Maps: buat rute (Petunjuk arah) → <b>Bagikan</b> → <b>Sematkan peta</b> → <b>Salin HTML</b>, lalu tempel di sini. Bisa juga link <code>google.com/maps/dir/...</code>. Link pendek <code>maps.app.goo.gl</code> tidak bisa dibaca.</p>
        <textarea v-model="embedText" placeholder='<iframe src="https://www.google.com/maps/embed?pb=!1m28..."></iframe>'></textarea>
        <div class="row">
          <button class="primary grow" @click="parseEmbed">Baca titik rute</button>
          <button title="Isi contoh" @click="useSample">Contoh</button>
        </div>
        <div class="msg" :class="{ err: parseErr }">{{ parseMsg }}</div>
      </details>

      <h2>Titik rute</h2>
      <ol v-if="waypoints.length" class="wps">
        <li v-for="(p, i) in waypoints" :key="i">
          <span class="dot">{{ pointLabel(i) }}</span>
          <span class="wp-name"><b>{{ pointName(p, i) }}</b><small>{{ p.lat.toFixed(5) }}, {{ p.lng.toFixed(5) }}</small></span>
          <button class="x" title="Hapus" @click="removeWaypoint(i)">×</button>
        </li>
      </ol>
      <div v-else class="msg">Tempel link, atau klik peta untuk menambah titik.</div>
      <div class="row">
        <button :disabled="!canUndo" title="Urungkan (Ctrl+Z)" @click="undo">↶ Urungkan</button>
        <button @click="reverse">⇅ Balik arah</button>
        <button @click="clearAll">Hapus semua</button>
        <button class="primary grow" :disabled="waypoints.length < 2" @click="findRoutes">Cari rute</button>
      </div>

      <h2>Pilih rute</h2>
      <div class="routes">
        <div v-if="routeState === 'loading'" class="msg">Mencari rute…</div>
        <template v-else-if="routeState === 'error'">
          <div class="msg err">Gagal mencari rute: {{ routeError }}</div>
          <div v-if="routeNetErr" class="hint">Browser tidak bisa menghubungi server rute. Biasanya karena internet mati, atau jaringan kantor/VPN/ad-blocker memblokir <code>brouter.de</code> dan <code>routing.openstreetmap.de</code>.</div>
        </template>
        <div v-else-if="!routes.length" class="msg">Belum ada rute.</div>
        <div v-for="(r, i) in routes" :key="i" class="route" :class="{ sel: i === selected }" :style="{ '--rc': r.color }" @click="selectRoute(i)">
          <span class="swatch"></span>
          <div>
            <div class="t">{{ r.label }}</div>
            <div class="m">{{ (r.distance / 1000).toFixed(1) }} km · ±{{ formatDuration(r.duration) }}<template v-if="r.ascent"> · ↗ {{ Math.round(r.ascent) }} m</template></div>
            <div class="m">{{ r.source }}</div>
          </div>
          <span v-if="i === selected" class="pick">Dipilih</span>
        </div>
      </div>

      <h2>Buat GPX</h2>
      <input type="text" v-model="gpxName" placeholder="Nama rute (mis. Gowes Minggu)">
      <label class="chk"><input type="checkbox" v-model="optEle"> Sertakan ketinggian (elevasi)</label>
      <label class="chk"><input type="checkbox" v-model="optWpt"> Sertakan titik rute sebagai waypoint</label>
      <div class="row">
        <button class="primary grow" :disabled="selected < 0 || gpxBusy" @click="openSave">⬇ Unduh GPX</button>
      </div>
      <div class="msg">{{ gpxMsg }}</div>
    </aside>
    <div ref="mapEl" class="gpx-map"></div>

    <dialog ref="saveDlg">
      <form method="dialog" @submit="onSave">
        <h3>Simpan file GPX</h3>
        <div class="msg" style="margin:0">Nama pendek lebih mudah dibaca di layar cyclocomputer.</div>
        <div class="fname"><input type="text" id="fileName" v-model="fileName" maxlength="40" autocomplete="off" spellcheck="false"><span>.gpx</span></div>
        <div class="msg">{{ fileCount }}</div>
        <div class="row" style="justify-content:flex-end">
          <button type="button" @click="saveDlg.close()">Batal</button>
          <button type="submit" class="primary" :disabled="!cleanName">Simpan</button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style>
.gpx { display: grid; grid-template-columns: 390px 1fr; height: 100%; overflow: hidden; }
.gpx aside { background: var(--panel); overflow-y: auto; padding: 18px 16px 28px; counter-reset: step; }
.gpx .gpx-map { height: 100%; border-left: 2.5px solid var(--ink); font-family: inherit; }
.gpx .leaflet-control-layers { border: 2px solid var(--ink); border-radius: 12px; box-shadow: 3px 3px 0 var(--ink); background: #fff; font: inherit; }
.gpx .leaflet-control-layers-expanded { padding: 6px 10px; }
.gpx .leaflet-control-layers label { font-weight: 600; }

.gpx .hero svg { display: block; width: 100%; height: 42px; margin-top: 8px; overflow: visible; }
.gpx .hero .trail { fill: none; stroke: var(--ink); stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: gpx-draw 1.6s .2s ease-out forwards; }
.gpx .hero .pin { stroke: var(--ink); stroke-width: 2.5; }
.gpx .hero .pin-b { opacity: 0; animation: gpx-pop .3s 1.7s ease-out forwards; }
@keyframes gpx-draw { to { stroke-dashoffset: 0; } }
@keyframes gpx-pop { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .gpx .hero .trail { animation: none; stroke-dashoffset: 0; }
  .gpx .hero .pin-b { animation: none; opacity: 1; }
}

.gpx h2 { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; margin: 26px 0 10px; }
.gpx h2::before {
  counter-increment: step; content: counter(step); flex: none; width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center; font-size: 14px; font-weight: 800; border: 2.5px solid var(--ink); background: var(--sun);
}
.gpx h2:nth-of-type(2)::before { background: var(--mint); }
.gpx h2:nth-of-type(3)::before { background: var(--blush); }
.gpx h2:nth-of-type(4)::before { background: var(--sky); }

.gpx textarea, .gpx input[type=text] {
  width: 100%; background: var(--bg); color: var(--text); border: 2px solid var(--ink);
  border-radius: 10px; padding: 8px 10px; font: inherit;
}
.gpx textarea:focus, .gpx input[type=text]:focus { outline: 3px solid var(--blue); outline-offset: 1px; }
.gpx textarea { height: 92px; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }

.gpx button {
  font: inherit; font-weight: 600; border-radius: 10px; border: 2px solid var(--ink); background: #fff;
  color: var(--ink); padding: 7px 12px; cursor: pointer; box-shadow: 0 3px 0 var(--ink);
  transition: transform .08s, box-shadow .08s;
}
.gpx button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 0 var(--ink); }
.gpx button:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.gpx button:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
.gpx button.primary { background: var(--accent); color: #fff; font-weight: 700; }
.gpx button:disabled { opacity: .45; cursor: not-allowed; box-shadow: 0 3px 0 rgba(23,32,58,.4); }
.gpx button.x, .gpx button.x:hover:not(:disabled), .gpx button.x:active:not(:disabled) {
  border: none; background: none; box-shadow: none; transform: none; color: var(--muted); padding: 2px 6px; font-size: 18px;
}
.gpx button.x:hover { color: var(--accent); }

.gpx .row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.gpx .row > .grow { flex: 1; }
.gpx .msg { margin-top: 8px; font-size: 13px; color: var(--muted); }
.gpx .msg.err { color: var(--danger); font-weight: 600; }
.gpx ol.wps { margin: 0; padding: 0; list-style: none; }
.gpx ol.wps li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1.5px dashed var(--line); }
.gpx .dot { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; flex: none; }
.gpx ol.wps .dot { border: 2px solid var(--ink); }
.gpx .wp-name { flex: 1; min-width: 0; }
.gpx .wp-name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.gpx .wp-name small { color: var(--muted); font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
.gpx .routes { display: flex; flex-direction: column; gap: 10px; }
.gpx .route { border: 2px solid var(--line); border-radius: 12px; padding: 10px 12px; cursor: pointer; display: flex; gap: 10px; align-items: flex-start; background: #fff; transition: transform .1s, box-shadow .1s; }
.gpx .route:hover { border-color: var(--ink); }
.gpx .route.sel { border-color: var(--ink); background: var(--accent-2); box-shadow: 4px 4px 0 var(--rc); transform: translate(-1px, -1px); }
.gpx .swatch { width: 8px; align-self: stretch; border-radius: 4px; flex: none; background: var(--rc); }
.gpx .route .pick { margin-left: auto; font-size: 11px; font-weight: 800; color: #fff; background: var(--ink); border-radius: 999px; padding: 3px 9px; align-self: center; }
.gpx .route .t { font-weight: 700; }
.gpx .route .m { color: var(--muted); font-size: 12.5px; }
.gpx dialog { border: 2.5px solid var(--ink); border-radius: 18px; padding: 18px; width: min(400px, calc(100vw - 32px)); background: var(--panel); color: var(--text); box-shadow: 6px 6px 0 var(--ink); }
.gpx dialog::backdrop { background: rgba(23,32,58,.5); }
.gpx dialog h3 { margin: 0 0 4px; font-size: 18px; font-weight: 800; }
.gpx .fname { display: flex; align-items: center; border: 2px solid var(--ink); border-radius: 10px; background: var(--bg); margin-top: 10px; }
.gpx .fname:focus-within { outline: 3px solid var(--blue); outline-offset: 1px; }
.gpx .fname input[type=text] { border: none; background: none; flex: 1; min-width: 0; outline: none !important; }
.gpx .fname span { color: var(--muted); padding-right: 10px; font-family: ui-monospace, Menlo, monospace; }
.gpx .hint { font-size: 12.5px; color: var(--ink); background: #e3e9ff; border-radius: 12px; padding: 10px 12px; margin-top: 12px; }
.gpx .hint code { font-size: 11.5px; }
.gpx label.chk { display: flex; gap: 8px; align-items: center; margin-top: 8px; font-size: 13px; }
.gpx label.chk input { accent-color: var(--accent); width: 16px; height: 16px; }

.gpx .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.gpx button.mode[aria-pressed="true"], .gpx button.mode[aria-pressed="true"]:hover:not(:disabled) { background: var(--sun); transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
.gpx .place { position: relative; display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.gpx .place .dot { border: 2px solid var(--ink); }
.gpx .place input { flex: 1; min-width: 0; }
.gpx .suggest { position: absolute; z-index: 1000; left: 30px; right: 0; top: 100%; margin: 4px 0 0; padding: 4px; list-style: none; background: #fff; border: 2px solid var(--ink); border-radius: 12px; box-shadow: 3px 3px 0 var(--ink); }
.gpx .suggest li { padding: 7px 9px; border-radius: 8px; cursor: pointer; }
.gpx .suggest li b { display: block; font-weight: 600; }
.gpx .suggest li small { display: block; color: var(--muted); font-size: 12px; }
.gpx .suggest li.on { background: var(--accent-2); }
.gpx .suggest li.none { color: var(--muted); cursor: default; }
.gpx .suggest li.more { color: var(--blue); font-weight: 600; border-top: 1.5px dashed var(--line); border-radius: 0 0 8px 8px; }
.gpx details.paste { margin-top: 12px; border: 2px dashed var(--line); border-radius: 12px; padding: 8px 12px; }
.gpx details.paste[open] { border-color: var(--ink); }
.gpx details.paste summary { cursor: pointer; font-weight: 600; }
.gpx details.paste summary:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; border-radius: 6px; }
.gpx details.paste textarea { margin-top: 8px; }

@media (max-width: 800px) {
  .gpx { display: block; overflow-y: auto; }
  .gpx aside { overflow: visible; border-bottom: 2.5px solid var(--ink); }
  .gpx .gpx-map { height: 60vh; border-left: none; }
}
</style>
