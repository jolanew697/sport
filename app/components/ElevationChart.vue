<script setup>
// Grafik elevasi (SVG). mode 'ele': satu warna; mode 'grade': diwarnai menurut kemiringan.
const props = defineProps({
  profile: { type: Object, required: true },
  mode: { type: String, default: 'grade' },
})
const emit = defineEmits(['hover'])

const H = 170, ML = 42, MR = 12, MT = 10, MB = 22
const box = ref(null)
const W = ref(600)
const hi = ref(-1)
let ro

onMounted(() => {
  W.value = box.value.clientWidth || 600
  ro = new ResizeObserver(() => { W.value = box.value.clientWidth || W.value })
  ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())

const LEGEND = [
  ['< −6%', '#1d4ed8'], ['−6 – −2%', '#60a5fa'], ['datar', '#34d399'],
  ['2 – 5%', '#facc15'], ['5 – 8%', '#fb923c'], ['8 – 12%', '#ef4444'], ['> 12%', '#991b1b'],
]

const n = computed(() => props.profile.dist.length)
const plotW = computed(() => Math.max(10, W.value - ML - MR))
const plotH = H - MT - MB
const yb = MT + plotH

const dom = computed(() => {
  const { min, max } = props.profile
  const pad = Math.max(5, (max - min) * 0.12)
  return [min - pad, max + pad]
})
const X = d => ML + d / (props.profile.total || 1) * plotW.value
const Y = e => MT + (1 - (e - dom.value[0]) / (dom.value[1] - dom.value[0])) * plotH

const xs = computed(() => props.profile.dist.map(X))
const ys = computed(() => props.profile.ele.map(Y))
const line = computed(() => xs.value.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys.value[i].toFixed(1)}`).join(''))
const area = computed(() => `${line.value}L${xs.value[n.value - 1].toFixed(1)},${yb}L${xs.value[0].toFixed(1)},${yb}Z`)
const segments = computed(() => xs.value.slice(0, -1).map((x, i) => {
  const x2 = xs.value[i + 1], y1 = ys.value[i], y2 = ys.value[i + 1]
  const g = (props.profile.grade[i] + props.profile.grade[i + 1]) / 2
  return { d: `M${x.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}L${x2.toFixed(1)},${yb}L${x.toFixed(1)},${yb}Z`, color: gradeColor(g) }
}))

const nice = v => { const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p }
const yTicks = computed(() => {
  const [lo, hi2] = dom.value
  const step = nice((hi2 - lo) / 3)
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi2; v += step) out.push(v)
  return out
})
const xTicks = computed(() => {
  const km = props.profile.total / 1000
  const step = nice(km / 6)
  const out = []
  for (let v = 0; v <= km; v += step) out.push(v)
  return out
})

const tip = computed(() => {
  if (hi.value < 0) return null
  const i = hi.value, p = props.profile
  return { x: xs.value[i], y: ys.value[i], text: `${(p.dist[i] / 1000).toFixed(1)} km · ${Math.round(p.ele[i])} m · ${p.grade[i].toFixed(1)}%` }
})

function onMove(e) {
  const rect = box.value.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - ML) / plotW.value))
  hi.value = Math.round(frac * (n.value - 1))
  emit('hover', hi.value)
}
function onLeave() { hi.value = -1; emit('hover', null) }
</script>

<template>
  <div>
    <div ref="box" class="elev-chart" @pointermove="onMove" @pointerleave="onLeave">
      <svg :width="W" :height="H" role="img" aria-label="Grafik elevasi rute">
        <g class="grid">
          <template v-for="v in yTicks" :key="'y' + v">
            <line :x1="ML" :x2="W - MR" :y1="Y(v)" :y2="Y(v)" />
            <text :x="ML - 6" :y="Y(v) + 4" text-anchor="end">{{ Math.round(v) }}</text>
          </template>
          <text v-for="v in xTicks" :key="'x' + v" :x="X(v * 1000)" :y="H - 6" text-anchor="middle">{{ v }}</text>
        </g>
        <g v-if="mode === 'grade'">
          <path v-for="(s, i) in segments" :key="i" :d="s.d" :fill="s.color" :stroke="s.color" stroke-width=".6" />
        </g>
        <path v-else :d="area" fill="#ffc2d4" />
        <path :d="line" fill="none" stroke="#17203a" stroke-width="2" stroke-linejoin="round" />
        <g v-if="tip">
          <line :x1="tip.x" :x2="tip.x" :y1="MT" :y2="yb" stroke="#17203a" stroke-width="1.5" stroke-dasharray="4 3" />
          <circle :cx="tip.x" :cy="tip.y" r="5" fill="#fff" stroke="#17203a" stroke-width="2.5" />
        </g>
      </svg>
      <div v-if="tip" class="elev-tip" :style="{ left: Math.min(Math.max(tip.x, 90), W - 90) + 'px' }">{{ tip.text }}</div>
    </div>
    <div v-if="mode === 'grade'" class="elev-legend">
      <span v-for="[label, color] in LEGEND" :key="label"><i :style="{ background: color }"></i>{{ label }}</span>
    </div>
  </div>
</template>

<style>
.elev-chart { position: relative; touch-action: pan-y; cursor: crosshair; }
.elev-chart svg { display: block; }
.elev-chart .grid line { stroke: var(--line); stroke-width: 1; }
.elev-chart .grid text { fill: var(--muted); font-size: 11px; font-family: inherit; }
.elev-tip {
  position: absolute; top: 0; transform: translateX(-50%); pointer-events: none; white-space: nowrap;
  background: var(--ink); color: #fff; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 8px;
}
.elev-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 11.5px; color: var(--muted); }
.elev-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; border: 1px solid var(--ink); vertical-align: -1px; }
</style>
