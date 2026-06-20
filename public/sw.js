const CACHE_NAME = 'luvira-os-v1'
const OFFLINE_URL = '/offline.html'

const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return

  // Network-only for Supabase API (always fresh data)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
    return
  }

  // Cache-first for icons, images, fonts
  if (
    url.pathname.startsWith('/icons/') ||
    /\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
            }
            return res
          })
      )
    )
    return
  }

  // Network-first with offline fallback for page navigations
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || caches.match('/'))
      )
    )
    return
  }

  // Stale-while-revalidate for JS/CSS bundles
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return res
      })
      return cached || network
    })
  )
})
