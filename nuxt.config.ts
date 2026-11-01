// Situs statis (nuxt generate) untuk GitHub Pages: tanpa server, router pakai hash (#/gpx)
// supaya tidak butuh pengalihan 404 di sisi host.
const base = process.env.NUXT_APP_BASE_URL || '/'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/theme.css'],
  router: { options: { hashMode: true } },
  app: {
    // GitHub Pages memakai sub-path /<nama-repo>/; workflow mengisinya lewat NUXT_APP_BASE_URL
    baseURL: base,
    head: {
      htmlAttrs: { lang: 'id' },
      title: 'Workout & GPX',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap' },
      ],
    },
  },
})
