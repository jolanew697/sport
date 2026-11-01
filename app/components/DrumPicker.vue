<script setup>
// Pemilih putar (scroll-snap). Nilai = min + posisi gulir / tinggi item.
const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
})
const emit = defineEmits(['update:modelValue'])

const ITEM_H = 40
const el = ref(null)
const count = props.max - props.min + 1
const clamp = i => Math.max(0, Math.min(count - 1, i))
const idx = ref(clamp(props.modelValue - props.min))
let raf = 0

const toScroll = () => { if (el.value) el.value.scrollTop = idx.value * ITEM_H }

function onScroll() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    // elemen sedang tersembunyi / terlepas dari halaman (pindah tab): posisi gulir tidak bisa dipercaya
    if (!el.value || !el.value.clientHeight) return
    const i = clamp(Math.round(el.value.scrollTop / ITEM_H))
    if (i === idx.value) return
    idx.value = i
    emit('update:modelValue', props.min + i)
  })
}

watch(() => props.modelValue, v => {
  const i = clamp(v - props.min)
  if (i !== idx.value) { idx.value = i; toScroll() }
})

onMounted(() => requestAnimationFrame(toScroll))
onActivated(() => requestAnimationFrame(toScroll))
onBeforeUnmount(() => cancelAnimationFrame(raf))

const cls = i => {
  const d = Math.abs(i - idx.value)
  return d === 0 ? 'd0' : d === 1 ? 'd1' : d === 2 ? 'd2' : ''
}
</script>

<template>
  <div class="drum-wrap">
    <div class="drum-band"></div>
    <div class="drum-fade-t"></div>
    <div class="drum-fade-b"></div>
    <div ref="el" class="drum" @scroll.passive="onScroll">
      <span class="drum-sp"></span>
      <div v-for="v in count" :key="v" class="pi" :class="cls(v - 1)">{{ min + v - 1 }}</div>
      <span class="drum-sp"></span>
    </div>
  </div>
</template>

<style>
.drum-wrap { position: relative; width: 100%; height: 200px; overflow: hidden; }
.drum-band {
  position: absolute; left: 14px; right: 14px; top: calc(50% - 20px); height: 40px; z-index: 0; pointer-events: none;
  background: var(--accent-2); border: 2px solid var(--ink); border-radius: 10px;
}
.drum-fade-t, .drum-fade-b { position: absolute; left: 0; right: 0; height: 70px; z-index: 2; pointer-events: none; }
.drum-fade-t { top: 0; background: linear-gradient(to bottom, var(--panel) 0%, transparent 100%); }
.drum-fade-b { bottom: 0; background: linear-gradient(to top, var(--panel) 0%, transparent 100%); }
.drum {
  position: relative; z-index: 1; height: 100%; overflow-y: scroll;
  scroll-snap-type: y mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none;
}
.drum::-webkit-scrollbar { display: none; }
.drum-sp { display: block; height: 80px; }
.pi {
  height: 40px; display: flex; align-items: center; justify-content: center;
  scroll-snap-align: center; user-select: none; font-variant-numeric: tabular-nums;
  color: #c3c9e3; font-size: 13px; font-weight: 500;
}
.pi.d0 { color: var(--ink); font-size: 24px; font-weight: 800; }
.pi.d1 { color: var(--muted); font-size: 18px; }
.pi.d2 { color: #9aa3c4; font-size: 15px; }
</style>
