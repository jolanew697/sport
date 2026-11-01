<script setup>
const CIRCUM = 703.716   // 2π × 112

const timerSec = ref(0)
const breakSec = ref(0)
const reps = ref(0)

// idle | work | rest | paused | done
const phase = ref('idle')
const prev = ref('work')   // fase aktif terakhir (untuk melanjutkan setelah pause)
const rep = ref(0)
const display = ref('--')
const frac = ref(0)
const idleHint = ref('tap start')
const flash = ref(false)
const summary = ref(null)

let remMs = 0, totMs = 0, t0 = 0, raf = 0, prevSecs = -1

const shownPhase = computed(() => phase.value === 'paused' ? prev.value : phase.value)
const tone = computed(() => ({ work: 'work', rest: 'rest', done: 'done' }[shownPhase.value] || ''))
const BADGE = { idle: 'Ready', work: 'Work', rest: 'Break', paused: 'Paused', done: 'Done' }
const PHASE_TEXT = { work: 'Work', rest: 'Break', paused: 'Paused', done: 'Complete' }
const phaseText = computed(() => phase.value === 'idle' ? idleHint.value : PHASE_TEXT[phase.value])
const active = computed(() => ['work', 'rest', 'paused'].includes(phase.value))
const dashOffset = computed(() => CIRCUM * (1 - Math.max(0, Math.min(1, frac.value))))

/* ---------- Audio ---------- */
let audioCtx = null
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  if (audioCtx.state === 'suspended') audioCtx.resume()
}
function beep(freq, dur, vol = 0.5) {
  if (!audioCtx) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(vol, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
  osc.start()
  osc.stop(audioCtx.currentTime + dur)
}
// tick hitung mundur: work nada tinggi, break lebih rendah dan lembut
function tickBeep(secs, ph) {
  if (ph === 'work') secs === 1 ? beep(1200, 0.18, 0.6) : beep(880, 0.07, 0.35)
  else secs === 1 ? beep(740, 0.18, 0.5) : beep(550, 0.07, 0.25)
}
// penanda awal fase WORK: nada panjang, sama seperti detik terakhir
const startBeep = () => beep(1200, 0.18, 0.6)
// fanfare selesai: arpeggio naik + akor panjang
function completionSound() {
  if (!audioCtx) return
  const now = audioCtx.currentTime
  const seq = [
    { freq: 523, t: 0.00, dur: 0.14, vol: 0.35 },  // C5
    { freq: 659, t: 0.13, dur: 0.14, vol: 0.38 },  // E5
    { freq: 784, t: 0.26, dur: 0.14, vol: 0.40 },  // G5
    { freq: 1047, t: 0.39, dur: 0.55, vol: 0.45 }, // C6, panjang
    { freq: 784, t: 0.39, dur: 0.55, vol: 0.30 },  // G5
    { freq: 659, t: 0.39, dur: 0.55, vol: 0.25 },  // E5
  ]
  seq.forEach(({ freq, t, dur, vol }) => {
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    const at = now + t
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(vol, at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur)
    osc.start(at); osc.stop(at + dur + 0.05)
  })
}
function buzz(p) {
  const pattern = { work: [70], rest: [30, 50, 30], done: [80, 60, 80, 60, 160] }[p]
  if (pattern && navigator.vibrate) navigator.vibrate(pattern)
}

/* ---------- Mesin fase ---------- */
function flashRing() {
  flash.value = false
  nextTick(() => { flash.value = true })
}

function tick() {
  const rem = Math.max(0, remMs - (Date.now() - t0))
  const secs = Math.ceil(rem / 1000)

  // bunyi: WORK tiap detik | BREAK hanya 5 detik terakhir
  if ((phase.value === 'work' || phase.value === 'rest') && secs !== prevSecs && secs >= 1) {
    if (phase.value === 'work') secs === Math.ceil(totMs / 1000) ? startBeep() : tickBeep(secs, 'work')
    else if (secs <= 5) tickBeep(secs, 'rest')
  }
  prevSecs = secs

  display.value = secs
  frac.value = rem / totMs
  if (rem <= 0) { onEnd(); return }
  raf = requestAnimationFrame(tick)
}

function begin(ph, n) {
  cancelAnimationFrame(raf)
  phase.value = ph
  prev.value = ph
  rep.value = n
  totMs = (ph === 'work' ? timerSec.value : breakSec.value) * 1000
  remMs = totMs
  t0 = Date.now()
  prevSecs = -1
  flashRing()
  raf = requestAnimationFrame(tick)
  buzz(ph)
}

function onEnd() {
  cancelAnimationFrame(raf)
  if (phase.value === 'work') {
    // tiap set punya break-nya sendiri, termasuk set terakhir
    if (breakSec.value > 0) begin('rest', rep.value)
    else if (rep.value < reps.value) begin('work', rep.value + 1)
    else finish()
  } else {
    rep.value < reps.value ? begin('work', rep.value + 1) : finish()
  }
}

function start() {
  // timer / repeat masih 0 → tidak ada yang bisa dijalankan
  if (timerSec.value === 0 || reps.value === 0) {
    idleHint.value = 'set timer & repeat'
    flashRing()
    return
  }
  initAudio() // harus dipicu gestur pengguna (iOS)
  summary.value = null
  begin('work', 1)
}

function pauseResume() {
  if (phase.value === 'work' || phase.value === 'rest') {
    cancelAnimationFrame(raf)
    remMs = Math.max(0, remMs - (Date.now() - t0))
    prev.value = phase.value
    phase.value = 'paused'
  } else if (phase.value === 'paused') {
    phase.value = prev.value
    t0 = Date.now()
    raf = requestAnimationFrame(tick)
  }
}

function stop() {
  cancelAnimationFrame(raf)
  phase.value = 'idle'; rep.value = 0
  display.value = '--'; frac.value = 0
  idleHint.value = 'tap start'
  summary.value = null
}

function finish() {
  phase.value = 'done'
  display.value = '✓'; frac.value = 1
  buzz('done')
  completionSound()
  const w = timerSec.value, b = breakSec.value, r = reps.value
  const total = r * (w + b)
  const mm = Math.floor(total / 60), ss = total % 60
  summary.value = { r, w, b, total: `${mm > 0 ? mm + 'm ' : ''}${ss}s` }
}

/* ---------- Keyboard (hanya saat halaman ini terlihat) ---------- */
function onKey(e) {
  if (e.code === 'Space') { e.preventDefault(); phase.value === 'idle' ? start() : pauseResume() }
  if (e.code === 'Escape') stop()
}
onActivated(() => document.addEventListener('keydown', onKey))
onDeactivated(() => document.removeEventListener('keydown', onKey))
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="tm">
    <div class="tm-app">
      <header class="hero">
        <h1>Workout Timer</h1>
        <p class="sub">Set your work, break and sets.</p>
      </header>

      <div class="tm-status">
        <div class="tm-badge" :class="[tone, { paused: phase === 'paused' }]"><span class="tm-badge-dot"></span>{{ BADGE[phase] }}</div>
        <div class="tm-rep">Set <b>{{ phase === 'idle' ? 0 : rep }}</b> / <b>{{ reps }}</b></div>
      </div>

      <div class="tm-card tm-ring" :class="{ done: phase === 'done' }">
        <svg v-show="phase !== 'done'" class="tm-ring-svg" width="260" height="260" viewBox="0 0 260 260" aria-hidden="true">
          <circle class="tm-r-bg" cx="130" cy="130" r="112"/>
          <circle class="tm-r-fg" :class="tone" cx="130" cy="130" r="112" :stroke-dasharray="CIRCUM" :stroke-dashoffset="dashOffset"/>
        </svg>
        <div class="tm-ring-inner">
          <template v-if="phase !== 'done'">
            <div class="tm-num" :class="[tone, { flash }]" @animationend="flash = false">{{ display }}</div>
            <div class="tm-phase" :class="tone">{{ phaseText }}</div>
          </template>
          <div v-else class="tm-done">
            <div class="tm-done-icon">🏆</div>
            <div class="tm-done-title">Workout Complete!</div>
            <div v-if="summary" class="tm-done-line">
              <b>{{ summary.r }}</b> sets &nbsp;·&nbsp; <b>{{ summary.w }}s</b> work &nbsp;·&nbsp; <b>{{ summary.b }}s</b> break<br>
              Total active: <b>{{ summary.total }}</b>
            </div>
          </div>
        </div>
      </div>

      <div class="tm-cfg" :class="{ dim: active }">
        <div class="tm-card tm-pickers">
          <div class="tm-col">
            <div class="tm-lbl">Timer</div>
            <DrumPicker v-model="timerSec" :min="0" :max="300" />
            <div class="tm-unit">seconds</div>
          </div>
          <div class="tm-col">
            <div class="tm-lbl">Break</div>
            <DrumPicker v-model="breakSec" :min="0" :max="300" />
            <div class="tm-unit">seconds</div>
          </div>
          <div class="tm-col">
            <div class="tm-lbl">Repeat</div>
            <DrumPicker v-model="reps" :min="0" :max="99" />
            <div class="tm-unit">sets</div>
          </div>
        </div>
      </div>

      <div class="tm-actions">
        <button v-if="phase === 'idle'" class="tm-btn go" @click="start">▶  Start</button>
        <template v-else-if="phase === 'work' || phase === 'rest'">
          <button class="tm-btn pause" @click="pauseResume">⏸  Pause</button>
          <button class="tm-btn stop" @click="stop">■  Stop</button>
        </template>
        <template v-else-if="phase === 'paused'">
          <button class="tm-btn go" @click="pauseResume">▶  Resume</button>
          <button class="tm-btn stop" @click="stop">■  Stop</button>
        </template>
        <button v-else class="tm-btn again" @click="stop">↺  Restart</button>
      </div>
    </div>
  </div>
</template>

<style>
.tm { overflow-y: auto; display: flex; justify-content: center; }
.tm-app { width: 100%; max-width: 420px; padding: 16px 16px 32px; display: flex; flex-direction: column; gap: 18px; }
.tm-app > * { flex: none; }
.tm .hero { margin-right: 0; }

.tm-status { display: flex; align-items: center; justify-content: space-between; padding: 0 4px; min-height: 30px; }
.tm-badge {
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px 4px 9px; border-radius: 999px;
  font-size: 13px; font-weight: 700; background: #fff; color: var(--muted); border: 2px solid var(--ink);
}
.tm-badge-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.tm-badge.work { background: var(--accent); color: #fff; }
.tm-badge.rest { background: var(--blue); color: #fff; }
.tm-badge.done { background: #0f9d63; color: #fff; }
.tm-badge.work .tm-badge-dot, .tm-badge.rest .tm-badge-dot { background: #fff; animation: tm-pulse 1.4s ease-in-out infinite; }
.tm-badge.done .tm-badge-dot { background: #fff; }
.tm-badge.paused { background: var(--sun); color: var(--ink); }
.tm-badge.paused .tm-badge-dot { background: var(--ink); animation: none; }
.tm-rep { font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
.tm-rep b { color: var(--ink); font-weight: 800; }
@keyframes tm-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.8); } }

.tm-card { background: var(--panel); border: 2.5px solid var(--ink); border-radius: 22px; box-shadow: 5px 5px 0 var(--ink); }

/* lingkaran hitung mundur */
.tm-ring { position: relative; display: flex; justify-content: center; align-items: center; padding: 10px 0; margin-right: 5px; }
.tm-ring-svg { transform: rotate(-90deg); display: block; width: 176px; height: 176px; }
.tm-r-bg { fill: none; stroke: var(--line); stroke-width: 12; }
.tm-r-fg { fill: none; stroke: var(--muted); stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset .22s linear, stroke .4s ease; }
.tm-r-fg.work { stroke: var(--accent); }
.tm-r-fg.rest { stroke: var(--blue); }
.tm-r-fg.done { stroke: #0f9d63; }
.tm-ring-inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; pointer-events: none; }
.tm-num { font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: -2px; font-variant-numeric: tabular-nums; color: var(--muted); transition: color .35s; }
.tm-num.work { color: var(--accent); }
.tm-num.rest { color: var(--blue); }
.tm-num.done { color: #0f9d63; }
.tm-num.flash { animation: tm-flash .5s ease; }
@keyframes tm-flash { 0%, 100% { opacity: 1; } 40% { opacity: .15; } }
.tm-phase { font-size: 13px; font-weight: 700; color: var(--muted); }
.tm-phase.work { color: var(--accent); }
.tm-phase.rest { color: var(--blue); }
.tm-phase.done { color: #0f9d63; }
/* selesai: lingkaran diganti total oleh ringkasan */
.tm-ring.done .tm-ring-inner { position: static; padding: 18px 16px; }
.tm-done { text-align: center; }
.tm-done-icon { font-size: 36px; line-height: 1; margin-bottom: 10px; }
.tm-done-title { font-size: 22px; font-weight: 800; color: #0f9d63; margin-bottom: 6px; }
.tm-done-line { font-size: 14px; color: var(--muted); line-height: 1.9; }
.tm-done-line b { color: var(--ink); }

/* pengaturan */
.tm-cfg { display: flex; flex-direction: column; gap: 18px; transition: opacity .3s; }
.tm-cfg.dim { opacity: .4; pointer-events: none; }
.tm-pickers { display: flex; overflow: hidden; margin-right: 5px; }
.tm-col { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 14px 0 12px; position: relative; }
.tm-col + .tm-col { border-left: 2px dashed var(--line); }
.tm-lbl { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
.tm-unit { font-size: 12px; color: var(--muted); margin-top: 8px; }

/* tombol aksi */
.tm-actions { display: flex; gap: 12px; margin-right: 5px; }
.tm-btn {
  flex: 1; padding: 16px; border-radius: 14px; border: 2.5px solid var(--ink); box-shadow: 0 4px 0 var(--ink);
  font: inherit; font-size: 17px; font-weight: 800; cursor: pointer; background: #fff; color: var(--ink);
  transition: transform .08s, box-shadow .08s;
}
.tm-btn:active { transform: translateY(4px); box-shadow: 0 0 0 var(--ink); }
.tm-btn.go { background: var(--accent); color: #fff; }
.tm-btn.pause { background: var(--sun); }
.tm-btn.stop { color: var(--danger); }
.tm-btn.again { background: var(--blue); color: #fff; }
.tm-btn:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .tm-badge-dot, .tm-num.flash { animation: none !important; }
}
</style>
