// Service worker do PWA (Fase C, Plano 2). Só é registrado FORA de
// localhost/LAN (ver main.js) — em dev o objetivo é sempre servir o JS/CSS
// mais novo (dev_server.py já manda Cache-Control: no-store pra isso), e um
// SW guardando cache por cima quebraria essa garantia.
//
// Estratégia: "cache-first com atualização em segundo plano" pra tudo que é
// GET — cobre tanto os arquivos do próprio repo (index.html, src/*, assets/,
// public/models/*.glb) quanto o CDN externo (three.js/supabase-js), já que
// ambos precisam funcionar offline pro "jogue mais rápido e offline" do
// menu ser verdade. Não tenta ser esperto sobre QUAL arquivo é qual — o
// jogo inteiro é estático (sem API própria além do WebSocket do modo
// Online, que passa direto por `fetch` nunca interceptar `ws(s)://`).
const CACHE_NAME = 'eom-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // WebSocket upgrade e afins não passam por aqui mesmo

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      // Serve do cache na hora se existir (rápido, funciona offline);
      // atualiza o cache em segundo plano pra próxima visita.
      if (cached) { network; return cached; }
      const fresh = await network;
      return fresh || Response.error();
    })
  );
});
