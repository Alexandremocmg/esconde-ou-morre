import * as THREE from 'three';

// Texturas 100% procedurais (CanvasTexture) — sem assets externos, deploy offline.
// Cada fábrica é cacheada: a mesma textura é reutilizada por todas as malhas que
// a pedem (economia de memória/GPU). O clima é "escritório corporativo decadente"
// estilo Backrooms: amarelo-monótono, carpete úmido e falso teto de gesso.

const _cache = new Map();
function cached(key, make) {
  let tex = _cache.get(key);
  if (!tex) { tex = make(); _cache.set(key, tex); }
  return tex;
}

// Cria um <canvas> 2D quadrado já com um preenchimento de base.
function makeCanvas(size, base) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  return { cv, ctx, size };
}

// Empacota o canvas numa CanvasTexture repetível, pronta para tiles.
function toTexture(cv, { repeatX = 1, repeatY = 1 } = {}) {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ruído granulado leve (grão de superfície suja/áspera).
function speckle(ctx, size, count, alpha, dark = true) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const a = alpha * (0.4 + Math.random() * 0.6);
    ctx.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
}

// Mancha de umidade: gradiente radial escuro e irregular.
function dampStain(ctx, x, y, r, tint = '30,26,10') {
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, `rgba(${tint},0.42)`);
  g.addColorStop(0.6, `rgba(${tint},0.20)`);
  g.addColorStop(1, `rgba(${tint},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
  ctx.fill();
}

// ── Papel de parede oitentista amarelo-creme, listras verticais sutis + desgaste ──
export function wallpaperTexture() {
  return cached('wallpaper', () => {
    // Base clara: a cor amarela (alvo de camuflagem) vem do material.color e
    // multiplica esta textura — mantê-la clara evita amarelo escuro demais.
    const size = 256;
    const { cv, ctx } = makeCanvas(size, '#ece7cf');

    // Listras verticais bem discretas (papel de parede listrado desbotado).
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, 8, size);
    }

    // Padrão geométrico oitentista discreto: pequenos losangos numa grade.
    ctx.strokeStyle = 'rgba(120,110,60,0.18)';
    ctx.lineWidth = 1;
    for (let y = 8; y < size; y += 32) {
      for (let x = 8; x < size; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y);
        ctx.closePath(); ctx.stroke();
      }
    }

    // Umidade/manchas e desgaste (grão + escurecimento nas bordas do tile).
    for (let i = 0; i < 5; i++) {
      dampStain(ctx, Math.random() * size, Math.random() * size, 24 + Math.random() * 40, '70,64,30');
    }
    speckle(ctx, size, 900, 0.06);

    return toTexture(cv);
  });
}

// ── Carpete corporativo áspero marrom-escuro com manchas de umidade ──
export function carpetTexture() {
  return cached('carpet', () => {
    const size = 256;
    const { cv, ctx } = makeCanvas(size, '#3b3228');

    // Fibra do carpete: microlistras cruzadas e grão denso.
    for (let y = 0; y < size; y += 3) {
      ctx.fillStyle = (y / 3) % 2 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(90,80,60,0.10)';
      ctx.fillRect(0, y, size, 1);
    }
    speckle(ctx, size, 4000, 0.10);
    speckle(ctx, size, 1500, 0.08, false);

    // Manchas de umidade escuras (carpete úmido) espalhadas.
    for (let i = 0; i < 7; i++) {
      dampStain(ctx, Math.random() * size, Math.random() * size, 20 + Math.random() * 46, '18,14,8');
    }

    return toTexture(cv);
  });
}

// ── Falso teto de gesso: grade de placas off-white, algumas escuras (faltando) ──
export function ceilingTileTexture() {
  return cached('ceiling', () => {
    const size = 256;
    const { cv, ctx } = makeCanvas(size, '#d8d6c8');
    const cells = 4;                 // 4×4 placas por tile
    const step = size / cells;

    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const x = gx * step, y = gy * step;
        // ~1 em 10 placas "faltando" → escuro revelando fiação por trás.
        const missing = Math.random() < 0.10;
        if (missing) {
          ctx.fillStyle = '#0b0b0d';
          ctx.fillRect(x + 2, y + 2, step - 4, step - 4);
          // Vislumbre de fiação/dutos.
          ctx.strokeStyle = 'rgba(60,60,66,0.7)';
          ctx.lineWidth = 1;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.moveTo(x + 4, y + 6 + k * 6);
            ctx.lineTo(x + step - 4, y + 6 + k * 6 + (Math.random() * 6 - 3));
            ctx.stroke();
          }
        } else {
          // Textura sutil de gesso perfurado + leve mancha.
          speckle(ctx, size, 0, 0); // no-op guard
          ctx.fillStyle = 'rgba(0,0,0,0.03)';
          for (let i = 0; i < 40; i++) {
            ctx.fillRect(x + Math.random() * step, y + Math.random() * step, 1, 1);
          }
          if (Math.random() < 0.5) dampStain(ctx, x + step / 2, y + step / 2, step * 0.4, '90,84,50');
        }
        // Sulco escuro da grelha metálica entre as placas.
        ctx.strokeStyle = 'rgba(30,28,22,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, step - 2, step - 2);
      }
    }

    return toTexture(cv);
  });
}
