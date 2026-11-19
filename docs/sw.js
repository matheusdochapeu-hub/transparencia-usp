/* Service worker: app shell offline + dados com atualizaÃ§Ã£o em segundo plano. */

const VERSION = 'v42';
const SHELL = `usp-shell-${VERSION}`;
const DATA = `usp-data-${VERSION}`;

const SHELL_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/data.js',
  'js/charts.js',
  'js/ui.js',
  'js/util.js',
  'js/views/panorama.js',
  'js/views/categorias.js',
  'js/views/categoria.js',
  'js/views/mudancas.js',
  'js/views/vacancia.js',
  'js/contador.js',
  'js/views/tecnicos.js',
  'js/views/vencimentos.js',
  'js/views/movimento.js',
  'js/views/correlacoes.js',
  'js/views/dados.js',
  'js/views/sobre.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // caches de versões anteriores indicam que esta é uma atualização
      const oldVersion = keys.filter(
        (k) => k !== SHELL && k !== DATA && (k.startsWith('usp-shell-') || k.startsWith('usp-data-'))
      );
      await Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)));
      await self.clients.claim();

      // Em atualizações, recarrega as abas abertas: sem isso o navegador pode
      // continuar rodando o JS antigo por causa do cache do service worker.
      if (oldVersion.length) {
        const windows = await self.clients.matchAll({ type: 'window' });
        windows.forEach((client) => {
          if (client.url.startsWith(self.location.origin)) client.navigate(client.url).catch(() => {});
        });
      }
    })()
  );
});

async function networkFirst(request, cacheName, timeoutMs = 6000) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(request, DATA, 5000).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(async () => (await caches.match('index.html')) || (await caches.match('./')) || Response.error())
    );
    return;
  }

  // Código (JS/CSS) é sempre buscado na rede primeiro: atualizações do painel
  // passam a valer no próximo carregamento, sem ficar presas no cache.
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(networkFirst(request, SHELL, 4000).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, SHELL));
});
