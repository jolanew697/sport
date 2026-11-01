<template>
  <div class="shell">
    <main class="views"><slot /></main>
    <nav class="tabs" aria-label="Menu">
      <NuxtLink to="/timer" class="tab" exact-active-class="on">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5"/></svg>
        Timer
      </NuxtLink>
      <NuxtLink to="/gpx" class="tab" exact-active-class="on">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16"/></svg>
        GPX
      </NuxtLink>
    </nav>
  </div>
</template>

<style>
.shell { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
.views { flex: 1; min-height: 0; position: relative; }
.views > * { height: 100%; }
.tabs {
  display: flex; justify-content: center; gap: 10px; padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
  background: var(--panel); border-top: 2.5px solid var(--ink);
}
.tab {
  flex: 1; max-width: 220px; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 8px 0; border: 2px solid transparent; border-radius: 12px;
  color: var(--muted); font-weight: 700; font-size: 14px; text-decoration: none;
}
.tab svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tab:hover { color: var(--ink); }
.tab.on { background: var(--sun); border-color: var(--ink); color: var(--ink); box-shadow: 0 3px 0 var(--ink); }
.tab:focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
</style>
