// Service worker do PWA (Fase C, Plano 2). Só é registrado FORA de
// localhost/LAN (ver main.js) — em dev o objetivo é sempre servir o JS/CSS
// mais novo (dev_server.py já manda Cache-Control: no-store pra isso), e um
// SW guardando cache por cima quebraria essa garantia.
//
// Estratégia por tipo de requisição:
// - Navegação (`index.html`/`/`): NETWORK-FIRST com fallback pro cache. É o
//   ÚNICO arquivo sem `?v=N` (cache-busting por URL, ver CLAUDE.md) — ele é
//   quem CARREGA todos os outros com a versão certa. Cache-first aqui era um
//   bug real (já corrigido à mão uma vez, commit `a00144f`): um PWA instalado
//   recebia o HTML de ANTES do deploy mais recente, e com ele os imports
//   `?v=N` antigos — só atualizava na visita seguinte, sempre um deploy
//   atrasado.
// - Todo o resto (src/*?v=N, assets/, public/models/*.glb, CDN externo):
//   CACHE-FIRST com atualização em segundo plano — seguro porque a URL muda
//   quando o conteúdo muda, e cobre o "jogue mais rápido e offline" do menu.
const CACHE_NAME = 'eom-v2';

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

  // Requisição de navegação (abrir/recarregar a página) — cobre tanto o
  // clique no ícone do PWA instalado quanto um reload manual. `mode ===
  // 'navigate'` é a forma padrão de detectar isto, mais robusta que comparar
  // a URL (cobre `/`, `/index.html`, e qualquer query string que main.js
  // já use nela, como `?stage=N`/`?continue=1`).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(req)))
    );
    return;
  }

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
