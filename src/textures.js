import * as THREE from 'three';

// Texturas 100% procedurais (CanvasTexture) — sem assets externos, deploy offline.
// Cada fábrica é cacheada: a mesma textura é reutilizada por todas as malhas que
// a pedem (economia de memória/GPU). O clima é MANSÃO DE LUXO em penumbra:
// mármore, parquet, boiserie, veludo, couro, damasco, dourado e lombadas de livro.
//
// A densidade vem daqui, não da contagem de objetos: uma prateleira de livros é
// UM plano com a textura `bookSpines`, não 50 malhas de lombada.

const _cache = new Map();
function cached(key, make) {
  let tex = _cache.get(key);
  if (!tex) { tex = make(); _cache.set(key, tex); }
  return tex;
}

// Rampa de sombreamento CEL (look toon estilo Meccha Chameleon). MeshToonMaterial
// amostra este LUT 1×N (canal R) pela luz difusa (N·L), quantizando o degradê em
// poucas bandas chapadas. Cacheada por nº de degraus. O piso é claro (0.45) de
// propósito: mesmo a banda mais escura mantém a cor legível — a camuflagem depende
// de LER a cor da superfície, então nada de bandas quase pretas.
export function toonGradient(steps = 3) {
  return cached(`toon:${steps}`, () => {
    const n = Math.max(2, steps | 0);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      data[i] = Math.round(255 * (0.45 + 0.55 * (i / (n - 1))));
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  });
}

// Variante "brilhante" pro toggle Fosco/Brilhante (Player.setFinish).
// MeshToonMaterial não tem specular de verdade — roughness/metalness são
// inertes nele (só valem em material PBR). Fingir "brilhante" dentro do
// próprio cel shading: a última banda do degradê salta perto do branco,
// lendo como um highlight especular concentrado, em vez do degradê suave
// e "fosco" de toonGradient().
export function toonGradientGloss(steps = 4) {
  return cached(`toonGloss:${steps}`, () => {
    const n = Math.max(3, steps | 0);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      data[i] = i === n - 1 ? 255 : Math.round(255 * (0.45 + 0.4 * (i / (n - 2))));
    }
    const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  });
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
function toTexture(cv, { repeatX = 1, repeatY = 1, aniso = 4 } = {}) {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 0xRRGGBB → '#rrggbb' (ctx.fillStyle exige string, não número).
function hexStr(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }

// ═══════════════════════════════════════════════════════════════════════════
// PADRÕES pixelColorable (Plano 5, Fase 4b) — DIFERENTES de MATERIALS/
// materialMaps() acima: lá, `base` é só o fundo e `draw()` soma detalhe sutil
// por cima (a cor final visível vem de material.color tingindo tudo). Aqui as
// DUAS cores de cada padrão JÁ SÃO a cor final — o mesh que as usa precisa de
// color:0xffffff (sem tingir), porque Player._pixelColorAt lê o canvas bruto
// via UV; se o material tingisse por cima, o que se VÊ deixaria de bater com
// o que se AMOSTRA.
// ═══════════════════════════════════════════════════════════════════════════

// Listras verticais (Corredor Central). `stripes` conta faixas claras+escuras
// alternadas (par, senão a última faixa fica cortada pela repetição do tile).
export function stripeTexture(colorA, colorB, { size = 64, stripes = 8, aniso = 4 } = {}) {
  return cached(`stripe:${colorA}:${colorB}:${size}:${stripes}:${aniso}`, () => {
    const { cv, ctx } = makeCanvas(size, hexStr(colorA));
    const w = size / stripes;
    ctx.fillStyle = hexStr(colorB);
    for (let i = 1; i < stripes; i += 2) ctx.fillRect(Math.round(i * w), 0, Math.ceil(w), size);
    return toTexture(cv, { aniso });
  });
}

// Azulejo hexagonal (Banheiro de Visitas): grid de hexágonos com rejunte
// visível entre eles (raio -1px). `hexR` em pixels do canvas.
export function hexTileTexture(tileColor, groutColor, { size = 128, hexR = 14, aniso = 4 } = {}) {
  return cached(`hextile:${tileColor}:${groutColor}:${size}:${hexR}:${aniso}`, () => {
    const { cv, ctx } = makeCanvas(size, hexStr(groutColor));
    ctx.fillStyle = hexStr(tileColor);
    const w = hexR * Math.sqrt(3), h = hexR * 1.5;
    for (let row = -1; row * h < size + hexR; row++) {
      for (let col = -1; col * w < size + hexR; col++) {
        const cx = col * w + (((row % 2) + 2) % 2 === 1 ? w / 2 : 0);
        drawHexPath(ctx, cx, row * h, hexR - 1);
        ctx.fill();
      }
    }
    return toTexture(cv, { aniso });
  });
}
function drawHexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════════════════════
// PAINÉIS FACETADOS DO BONECO (estilo art toy de vinil técnico — ver referência)
// Sulcos angulares gravados no corpo. O MESMO traçado alimenta duas saídas:
//   • panelNormal() — relevo real (via heightToNormal), sobrevive à camuflagem
//     porque vive no normalMap, não no mapa de cor (que é sobrescrito ao estampar).
//   • panelLines()  — a mesma linha em alpha baixo, carimbada por cima da pele.
// As duas juntas são necessárias: o cel de poucas bandas quase não mostra relevo
// puro, e a linha sozinha não teria volume. O traçado é DETERMINÍSTICO (PRNG
// semeado) — sem isso, relevo e linha sairiam desalinhados.
// ═══════════════════════════════════════════════════════════════════════════

// LCG minúsculo: mesma semente → mesma sequência (traçado idêntico entre saídas).
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Traçado das juntas: costuras longas quase verticais com dobras angulares +
// ramos diagonais ligando-as (a malha de facetas da referência). Devolve uma
// lista de polilinhas em coordenadas 0..1 — independente do tamanho do canvas.
function panelSeams() {
  const rnd = seeded(0x5eed17);
  const seams = [];
  // Costuras principais: segmentos LONGOS e retos com poucas dobras nítidas. O
  // passo em Y é grande de propósito — kinks curtos leem como rabisco, não como
  // painel técnico (foi o erro da 1ª versão).
  for (let i = 0; i < 4; i++) {
    const x0 = 0.12 + i * 0.25;
    const pts = [[x0 + (rnd() - 0.5) * 0.04, -0.05]];
    let x = pts[0][0];
    for (let y = 0.30; y <= 1.05; y += 0.36) {
      x += (rnd() - 0.5) * 0.22;                     // dobra única e ampla
      pts.push([Math.min(0.97, Math.max(0.03, x)), y]);
    }
    seams.push(pts);
  }
  // Chevrons (V) — a marca do peito/membros da referência: duas retas em ângulo.
  // Poucos e grandes: o painel técnico vem de traços DELIBERADOS. Muitos traços
  // curtos viram arranhão (aparecia nas faces planas da forma 'cube').
  for (let i = 0; i < 3; i++) {
    const cx = 0.22 + rnd() * 0.5, cy = 0.16 + rnd() * 0.66;
    const w = 0.26 + rnd() * 0.16, h = 0.12 + rnd() * 0.08;
    seams.push([[cx - w / 2, cy - h], [cx, cy], [cx + w / 2, cy - h]]);
  }
  // Ramos retos ligando costuras vizinhas (fecham as facetas).
  for (let i = 0; i < 4; i++) {
    const y = 0.10 + rnd() * 0.78;
    const x = 0.06 + rnd() * 0.5;
    const w = 0.28 + rnd() * 0.20;
    seams.push([[x, y], [x + w, y + (rnd() - 0.5) * 0.20]]);
  }
  return seams;
}

// Desenha o traçado num contexto com um estilo/espessura dados.
function strokeSeams(ctx, size, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  for (const pts of panelSeams()) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * size, pts[0][1] * size);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * size, pts[i][1] * size);
    ctx.stroke();
  }
}

// Normal map dos painéis: sulco = vale (linha escura no canvas de altura).
export function panelNormal({ size = 256, strength = 2.6, aniso = 4 } = {}) {
  return cached(`panelN:${size}:${strength}:${aniso}`, () => {
    const { cv, ctx } = makeCanvas(size, '#808080');
    strokeSeams(ctx, size, 'rgba(0,0,0,0.85)', Math.max(2, size / 96));   // vale
    strokeSeams(ctx, size, 'rgba(255,255,255,0.28)', Math.max(1, size / 190)); // lábio de luz
    const tex = heightToNormal(cv, { strength, aniso });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; // arte única no corpo, não tile
    return tex;
  });
}

// Canvas com AS MESMAS juntas em tinta suave — carimbado por cima da pele para o
// painel continuar legível sob o cel chapado (e após a estampa da camuflagem).
// Alpha baixo de propósito: o boneco não pode ficar visivelmente mais escuro que
// a superfície copiada, senão a camuflagem "vaza" a olho nu.
// `size` é a resolução de DESENHO (maior = linha nítida); o chamador reescala
// para a pele de 128². Desenhar direto a 128 saía borrado.
export function panelLinesCanvas(size = 256) {
  return cached(`panelL:${size}`, () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    strokeSeams(ctx, size, 'rgba(30,36,46,0.13)', Math.max(1.2, size / 260));
    return cv;
  });
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

// ═══════════════════════════════════════════════════════════════════════════
// SISTEMA DE MATERIAIS PROCEDURAIS (albedo claro "multiply-friendly" + normal)
// Cada material entrega { map, normalMap, normalScale, roughness, metalness }.
// O albedo é claro de propósito: ele MULTIPLICA a material.color (que é o alvo
// de camuflagem), então a superfície continua parecendo a cor copiada. O relevo
// vem do normalMap derivado de um canvas de altura via Sobel. Ver docs/PLANO_REALISMO.md.
// ═══════════════════════════════════════════════════════════════════════════

// Deriva um normal map tangente de um canvas de altura (cinza) via Sobel.
// strength escala a inclinação; a amostragem usa wrap (%) para o tile costurar.
// IMPORTANTE: normal é dado LINEAR → NoColorSpace (nunca sRGB).
export function heightToNormal(heightCv, { strength = 2.0, aniso = 4 } = {}) {
  const size = heightCv.width;
  const src = heightCv.getContext('2d').getImageData(0, 0, size, size).data;
  const H = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) << 2] / 255;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1))
               - (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1));
      const dy = (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1))
               - (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1));
      const nx = dx * strength, ny = dy * strength, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) << 2;
      img.data[i]     = (nx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace; // normal map é linear, NÃO sRGB
  tex.anisotropy = aniso;
  return tex;
}

// Canvas cinza a partir da luminância do albedo (relevo barato p/ materiais lisos).
function luminanceCanvas(cv) {
  const size = cv.width;
  const src = cv.getContext('2d').getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const o = img.data;
  for (let i = 0; i < src.length; i += 4) {
    const l = src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
    o[i] = o[i + 1] = o[i + 2] = l; o[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// Canvas de altura dedicado (cinza médio + relevo do material).
function buildHeight(def, size) {
  const { cv, ctx } = makeCanvas(size, '#808080');
  def.drawHeight(ctx, size);
  return cv;
}

// ── Geradores de albedo (claros) e de altura por material ────────────────────

function drawDrywall(ctx, size) {
  // Mottle de rolo: blobs radiais suaves, alpha baixíssimo.
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * (0.2 + Math.random() * 0.25);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, Math.random() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Arranhões/escoriações curtas.
  ctx.strokeStyle = 'rgba(60,55,45,0.12)'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI, l = size * 0.08;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  dampStain(ctx, Math.random() * size, size * (0.75 + Math.random() * 0.2), size * 0.15, '80,74,60');
  speckle(ctx, size, size * 2, 0.03);
}
function heightDrywall(ctx, size) {
  // "Casca de laranja": micro-bumps aleatórios.
  for (let i = 0; i < size * 6; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
  }
}

function drawWood(ctx, size) {
  const planks = 4, pw = size / planks;
  for (let p = 0; p < planks; p++) {
    const x0 = p * pw;
    ctx.fillStyle = `rgba(120,90,50,${0.03 + Math.random() * 0.03})`;
    ctx.fillRect(x0, 0, pw, size);
    ctx.strokeStyle = 'rgba(90,65,35,0.10)'; ctx.lineWidth = 1;
    for (let g = 0; g < 10; g++) {
      const gx = x0 + Math.random() * pw;
      ctx.beginPath(); ctx.moveTo(gx, 0);
      for (let y = 0; y <= size; y += size / 6) ctx.lineTo(gx + Math.sin(y * 0.05 + p) * 3 + (Math.random() - 0.5) * 2, y);
      ctx.stroke();
    }
    if (Math.random() < 0.5) {
      const ky = Math.random() * size, kx = x0 + pw * 0.5;
      const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, pw * 0.25);
      kg.addColorStop(0, 'rgba(70,45,20,0.4)'); kg.addColorStop(1, 'rgba(70,45,20,0)');
      ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, pw * 0.25, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,28,15,0.25)'; ctx.fillRect(x0, 0, 2, size); // emenda
  }
  speckle(ctx, size, size * 1.5, 0.03);
}
function heightWood(ctx, size) {
  const planks = 4, pw = size / planks;
  for (let p = 0; p < planks; p++) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p * pw, 0, 2, size); }
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
  for (let g = 0; g < 40; g++) {
    const gx = Math.random() * size; ctx.beginPath(); ctx.moveTo(gx, 0);
    for (let y = 0; y <= size; y += size / 6) ctx.lineTo(gx + Math.sin(y * 0.05) * 3, y);
    ctx.stroke();
  }
}

function drawMetal(ctx, size) {
  // Escovado horizontal: linhas 1px com jitter de brilho.
  for (let y = 0; y < size; y++) {
    const a = Math.random() * 0.06;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(0, y, size, 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(Math.floor(size * 0.5), 0, 1, size); // emenda vertical
  speckle(ctx, size, size, 0.02);
}
function heightMetal(ctx, size) {
  for (let y = 0; y < size; y++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.10})`; ctx.fillRect(0, y, size, 1); }
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(Math.floor(size * 0.5), 0, 1, size);
}

function drawFabric(ctx, size) {
  const cell = 4;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const warp = ((x / cell + y / cell) % 2) === 0;
      ctx.fillStyle = warp ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  speckle(ctx, size, size * 3, 0.04); // felpa
}
function heightFabric(ctx, size) {
  const cell = 4;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const warp = ((x / cell + y / cell) % 2) === 0;
      ctx.fillStyle = warp ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

function drawPlastic(ctx, size) {
  ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(size * 0.5, 0); ctx.lineTo(size * 0.5, size); ctx.stroke(); // linha de molde
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * 0.3;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.03)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  speckle(ctx, size, size * 0.5, 0.02);
}

function drawConcrete(ctx, size) {
  speckle(ctx, size, size * 6, 0.05);
  speckle(ctx, size, size * 3, 0.05, false);
  ctx.strokeStyle = 'rgba(40,38,34,0.20)'; ctx.lineWidth = 1;
  for (let c = 0; c < 3; c++) {
    let x = Math.random() * size, y = Math.random() * size; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * size * 0.15; y += (Math.random() - 0.5) * size * 0.15; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) dampStain(ctx, Math.random() * size, Math.random() * size, size * 0.2, '70,70,66');
}
function heightConcrete(ctx, size) {
  speckle(ctx, size, size * 8, 0.12);
  speckle(ctx, size, size * 4, 0.10, false);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
  for (let c = 0; c < 3; c++) {
    let x = Math.random() * size, y = Math.random() * size; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * size * 0.15; y += (Math.random() - 0.5) * size * 0.15; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// ── MATERIAIS DE MANSÃO ──────────────────────────────────────────────────────
// Todos os que forem usados em corpos COLORÁVEIS têm albedo claro (camoSafe):
// a riqueza escura entra por material.color + normalMap, nunca por albedo escuro,
// senão a superfície deixa de parecer a cor que a camuflagem copiou.
// Os `sceneOnly` (lombadas, tapete persa, tela de quadro) podem ser escuros e
// saturados porque nunca são alvo de camuflagem — Level._addBox recusa usá-los
// num corpo colorável.

// Veio de mármore: curva fina e ramificada, desenhada em 3 escalas.
function marbleVein(ctx, size, x0, y0, len, w, alpha, tint) {
  ctx.strokeStyle = `rgba(${tint},${alpha})`;
  ctx.lineWidth = w;
  let x = x0, y = y0, ang = Math.random() * Math.PI * 2;
  ctx.beginPath(); ctx.moveTo(x, y);
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    ang += (Math.random() - 0.5) * 0.9;
    const cx = x + Math.cos(ang) * (len / steps) * 0.6;
    const cy = y + Math.sin(ang) * (len / steps) * 0.6;
    x += Math.cos(ang) * (len / steps);
    y += Math.sin(ang) * (len / steps);
    ctx.quadraticCurveTo(cx, cy, x, y);
  }
  ctx.stroke();
}

function drawMarble(ctx, size) {
  // Nuvens de fundo (variação de tom do bloco).
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * (0.25 + Math.random() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(190,182,166,0.10)');
    g.addColorStop(1, 'rgba(190,182,166,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Veios: 3 grossos cinza-fumo, 6 médios, 12 capilares dourados.
  for (let i = 0; i < 3; i++) marbleVein(ctx, size, Math.random() * size, Math.random() * size, size * 1.1, 2.4, 0.20, '92,88,82');
  for (let i = 0; i < 6; i++) marbleVein(ctx, size, Math.random() * size, Math.random() * size, size * 0.7, 1.2, 0.16, '110,104,94');
  for (let i = 0; i < 12; i++) marbleVein(ctx, size, Math.random() * size, Math.random() * size, size * 0.35, 0.6, 0.13, '150,124,64');
  speckle(ctx, size, size, 0.02);
}
function heightMarble(ctx, size) {
  // Mármore é polido: relevo quase nulo, só o veio levemente rebaixado.
  for (let i = 0; i < 3; i++) marbleVein(ctx, size, Math.random() * size, Math.random() * size, size * 1.1, 2.0, 0.10, '0,0,0');
}

// Parquet "de Versalhes": quadros alternando tábuas horizontais e verticais.
// Constrói-se em células de 2u — tila sem costura, ao contrário do espinha-de-peixe
// puro, que exigiria um tile em diagonal.
function parquetCells(size) {
  const cells = 4;
  return { cells, c: size / cells, u: size / cells / 2 };
}
function drawParquet(ctx, size) {
  const { cells, c, u } = parquetCells(size);
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const x0 = gx * c, y0 = gy * c;
      const vertical = ((gx + gy) & 1) === 0;
      for (let k = 0; k < 2; k++) {
        // Tábua: 2u × u (horizontal) ou u × 2u (vertical).
        const bx = vertical ? x0 + k * u : x0;
        const by = vertical ? y0 : y0 + k * u;
        const bw = vertical ? u : c;
        const bh = vertical ? c : u;
        // Tom próprio da tábua (madeira nunca é uniforme).
        ctx.fillStyle = `rgba(140,104,62,${0.03 + Math.random() * 0.05})`;
        ctx.fillRect(bx, by, bw, bh);
        // Veio ao longo do comprimento da tábua.
        ctx.strokeStyle = 'rgba(104,74,40,0.13)'; ctx.lineWidth = 1;
        for (let g = 0; g < 5; g++) {
          ctx.beginPath();
          if (vertical) {
            const gxp = bx + 2 + Math.random() * (bw - 4);
            ctx.moveTo(gxp, by);
            for (let y = by; y <= by + bh; y += bh / 4) ctx.lineTo(gxp + Math.sin(y * 0.09) * 1.6, y);
          } else {
            const gyp = by + 2 + Math.random() * (bh - 4);
            ctx.moveTo(bx, gyp);
            for (let x = bx; x <= bx + bw; x += bw / 4) ctx.lineTo(x, gyp + Math.sin(x * 0.09) * 1.6);
          }
          ctx.stroke();
        }
        // Junta escura ao redor da tábua.
        ctx.strokeStyle = 'rgba(58,40,20,0.32)'; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      }
    }
  }
  // Verniz: brilho difuso irregular (piso encerado de mansão).
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * 0.35;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,250,236,0.06)'); g.addColorStop(1, 'rgba(255,250,236,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
function heightParquet(ctx, size) {
  const { cells, c, u } = parquetCells(size);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const x0 = gx * c, y0 = gy * c;
      const vertical = ((gx + gy) & 1) === 0;
      for (let k = 0; k < 2; k++) {
        const bx = vertical ? x0 + k * u : x0;
        const by = vertical ? y0 : y0 + k * u;
        ctx.strokeRect(bx + 0.5, by + 0.5, (vertical ? u : c) - 1, (vertical ? c : u) - 1);
      }
    }
  }
}

// Damasco: arabesco tom-sobre-tom, 2×2 motivos por tile (padrão de parede nobre).
function damaskMotif(ctx, cx, cy, s, style, w) {
  ctx.strokeStyle = style; ctx.lineWidth = w;
  // Folha central em espelho + volutas laterais.
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.42);
    ctx.bezierCurveTo(cx + sx * s * 0.34, cy + s * 0.16, cx + sx * s * 0.30, cy - s * 0.22, cx, cy - s * 0.44);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + sx * s * 0.06, cy - s * 0.16);
    ctx.bezierCurveTo(cx + sx * s * 0.40, cy - s * 0.30, cx + sx * s * 0.46, cy + s * 0.06, cx + sx * s * 0.22, cy + s * 0.14);
    ctx.stroke();
    // Voluta que fecha o desenho para fora.
    ctx.beginPath();
    ctx.moveTo(cx + sx * s * 0.30, cy + s * 0.30);
    ctx.bezierCurveTo(cx + sx * s * 0.50, cy + s * 0.22, cx + sx * s * 0.48, cy - s * 0.02, cx + sx * s * 0.34, cy);
    ctx.stroke();
  }
  // Pistilo: pequena elipse cheia.
  ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.05, s * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
}
function drawDamask(ctx, size) {
  const n = 2, c = size / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      // Meia-passagem: linhas ímpares deslocadas meio motivo (padrão real).
      const off = (gy & 1) ? c / 2 : 0;
      const cx = ((gx * c + c / 2 + off) % size);
      const cy = gy * c + c / 2;
      damaskMotif(ctx, cx, cy, c * 0.9, 'rgba(126,112,88,0.20)', 2);
      damaskMotif(ctx, cx, cy, c * 0.52, 'rgba(126,112,88,0.14)', 1);
      // Losango de ligação entre motivos (fundo do damasco).
      ctx.strokeStyle = 'rgba(126,112,88,0.09)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - c * 0.5); ctx.lineTo(cx + c * 0.5, cy);
      ctx.lineTo(cx, cy + c * 0.5); ctx.lineTo(cx - c * 0.5, cy);
      ctx.closePath(); ctx.stroke();
    }
  }
  speckle(ctx, size, size, 0.02);
}
function heightDamask(ctx, size) {
  const n = 2, c = size / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const off = (gy & 1) ? c / 2 : 0;
      damaskMotif(ctx, (gx * c + c / 2 + off) % size, gy * c + c / 2, c * 0.9, 'rgba(255,255,255,0.30)', 3);
    }
  }
}

// Veludo: felpa direcional densa + faixas de brilho (anisotropia do pelo).
function drawVelvet(ctx, size) {
  for (let x = 0; x < size; x++) {
    const a = Math.random() * 0.07;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(x, 0, 1, size);
  }
  // Faixas largas de sheen (o pelo deitado reflete em bandas).
  for (let i = 0; i < 4; i++) {
    const y = Math.random() * size, h = size * (0.1 + Math.random() * 0.2);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y, size, h);
  }
  speckle(ctx, size, size * 6, 0.035);      // pontas de felpa
  speckle(ctx, size, size * 3, 0.03, false);
}
function heightVelvet(ctx, size) {
  for (let i = 0; i < size * 10; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(x, y, 1, 1 + Math.random() * 2); // felpa alongada em Y
  }
}

// Couro: células de grão (pebble) + vincos longos.
function leatherCells(size, cb) {
  const n = 10, step = size / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const jx = (Math.random() - 0.5) * step * 0.5, jy = (Math.random() - 0.5) * step * 0.5;
      cb(gx * step + step / 2 + jx, gy * step + step / 2 + jy, step * (0.34 + Math.random() * 0.2));
    }
  }
}
function drawLeather(ctx, size) {
  leatherCells(size, (x, y, r) => {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,252,244,0.13)');
    g.addColorStop(0.7, 'rgba(120,96,70,0.05)');
    g.addColorStop(1, 'rgba(90,70,48,0.16)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.9, Math.random(), 0, Math.PI * 2); ctx.fill();
  });
  // Vincos de uso: linhas longas e suaves.
  ctx.strokeStyle = 'rgba(80,60,40,0.14)'; ctx.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (Math.random() - 0.5) * size * 0.3; y += (Math.random() - 0.4) * size * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, size, size * 2, 0.03);
}
function heightLeather(ctx, size) {
  leatherCells(size, (x, y, r) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
  });
}

// Boiserie: caixotões de moldura em RELEVO. O albedo é quase liso (a parede é
// pintada de uma cor só) — quem desenha o painel é o normal map. É assim que a
// densidade sai de graça: um painel almofadado sem uma única malha extra.
function boiserieFrames(size, cb) {
  const n = 2, c = size / n, pad = c * 0.12;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      cb(gx * c + pad, gy * c + pad, c - pad * 2, c - pad * 2);
    }
  }
}
function drawBoiserie(ctx, size) {
  // Só uma insinuação de sombra/luz nas bordas do caixotão (o resto é normal map).
  boiserieFrames(size, (x, y, w, h) => {
    ctx.strokeStyle = 'rgba(110,100,84,0.13)'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,252,242,0.16)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    ctx.strokeStyle = 'rgba(110,100,84,0.08)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + w * 0.10, y + h * 0.10, w * 0.80, h * 0.80);
  });
  speckle(ctx, size, size, 0.02);
}
function heightBoiserie(ctx, size) {
  boiserieFrames(size, (x, y, w, h) => {
    // Moldura saliente (clara) e centro rebaixado (escuro) = almofada.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(x + w * 0.09, y + h * 0.09, w * 0.82, h * 0.82);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillRect(x + w * 0.16, y + h * 0.16, w * 0.68, h * 0.68);
  });
}

// Dourado escovado com desgaste nas bordas (arandelas, molduras, castiçais).
function drawGilt(ctx, size) {
  for (let y = 0; y < size; y++) {
    const a = Math.random() * 0.09;
    ctx.fillStyle = Math.random() < 0.45 ? `rgba(255,244,206,${a})` : `rgba(96,74,30,${a})`;
    ctx.fillRect(0, y, size, 1);
  }
  // Realce especular em faixa (metal polido).
  const g = ctx.createLinearGradient(0, 0, size, 0);
  g.addColorStop(0, 'rgba(120,96,44,0.10)');
  g.addColorStop(0.45, 'rgba(255,250,224,0.16)');
  g.addColorStop(1, 'rgba(120,96,44,0.12)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // Desgaste: o ouro gasta e mostra o bolo escuro por baixo, nos cantos do tile.
  for (const [wx, wy] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, size * 0.3);
    wg.addColorStop(0, 'rgba(70,52,26,0.26)');
    wg.addColorStop(1, 'rgba(70,52,26,0)');
    ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(wx, wy, size * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  speckle(ctx, size, size, 0.03);
}
function heightGilt(ctx, size) {
  for (let y = 0; y < size; y++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.09})`; ctx.fillRect(0, y, size, 1); }
}

// ── sceneOnly: podem ser escuros/saturados (nunca alvo de camuflagem) ──────────

// Lombadas de livro: a peça central da densidade. Um plano por prateleira substitui
// ~50 malhas de lombada. Larguras variáveis, nervuras, faixa de título dourada.
const SPINE_TONES = [
  '#4a2a22', '#5c2130', '#243a52', '#2c3f2c', '#4a3a1e', '#3a2b3f', '#6a4a2c', '#1f2429',
];
function drawBookSpines(ctx, size) {
  let x = 0;
  const shelfTop = size * 0.06;              // sombra do vão acima dos livros
  ctx.fillStyle = '#0d0b09'; ctx.fillRect(0, 0, size, size);
  while (x < size) {
    const w = size * (0.028 + Math.random() * 0.055);
    const h = size * (0.80 + Math.random() * 0.14);
    const tone = SPINE_TONES[(Math.random() * SPINE_TONES.length) | 0];
    const top = size - h;
    ctx.fillStyle = tone;
    ctx.fillRect(x, top, w - 1, h);
    // Sombreado do volume: lado esquerdo claro, direito escuro.
    ctx.fillStyle = 'rgba(255,240,214,0.10)'; ctx.fillRect(x, top, Math.max(1, w * 0.18), h);
    ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(x + w - 2, top, 1.5, h);
    // Nervuras horizontais (costura da lombada) + faixa de título dourada.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 1; k <= 3; k++) ctx.fillRect(x, top + h * (k / 4), w - 1, 1.5);
    if (Math.random() < 0.65) {
      ctx.fillStyle = 'rgba(198,164,86,0.72)';
      ctx.fillRect(x + w * 0.16, top + h * 0.26, Math.max(1, w * 0.55), 2);
      if (Math.random() < 0.5) ctx.fillRect(x + w * 0.16, top + h * 0.34, Math.max(1, w * 0.35), 1.5);
    }
    // Corte superior das folhas (creme) quando o livro está inclinado/recuado.
    ctx.fillStyle = 'rgba(224,212,182,0.35)'; ctx.fillRect(x, top, w - 1, 1.5);
    x += w;
  }
  // Vão escuro no topo da prateleira: dá profundidade ao plano único.
  const g = ctx.createLinearGradient(0, 0, 0, shelfTop * 2.2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, shelfTop * 2.2);
}
function heightBookSpines(ctx, size) {
  let x = 0;
  while (x < size) {
    const w = size * (0.028 + Math.random() * 0.055);
    // Cada lombada projeta-se um pouco diferente (livro mais para fora/dentro).
    const v = 118 + Math.random() * 90;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, size * 0.06, w - 1, size);
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x + w - 1.5, size * 0.06, 1.5, size); // fenda entre livros
    x += w;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, size, size * 0.06);
}

// Tapete persa: medalhão central, bordas geométricas, paleta quente.
function drawPersianRug(ctx, size) {
  const cx = size / 2, cy = size / 2;
  // Campo + bordas concêntricas.
  const bands = [[0.50, '#7d2b25'], [0.44, '#2d3a56'], [0.41, '#b08d42'], [0.38, '#7d2b25']];
  for (const [f, col] of bands) {
    ctx.fillStyle = col;
    ctx.fillRect(cx - size * f, cy - size * f, size * 2 * f, size * 2 * f);
  }
  // Grega da borda: dentes alternados.
  ctx.fillStyle = 'rgba(216,196,150,0.75)';
  const step = size / 24;
  for (let i = 0; i < 24; i++) {
    if (i % 2) continue;
    const p = size * 0.415;
    ctx.fillRect(cx - p + i * step, cy - p, step, step * 0.6);
    ctx.fillRect(cx - p + i * step, cy + p - step * 0.6, step, step * 0.6);
    ctx.fillRect(cx - p, cy - p + i * step, step * 0.6, step);
    ctx.fillRect(cx + p - step * 0.6, cy - p + i * step, step * 0.6, step);
  }
  // Medalhão central em losango, com miolo creme e volutas.
  ctx.fillStyle = '#2d3a56';
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.24); ctx.lineTo(cx + size * 0.16, cy);
  ctx.lineTo(cx, cy + size * 0.24); ctx.lineTo(cx - size * 0.16, cy);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c9ad72';
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.14); ctx.lineTo(cx + size * 0.09, cy);
  ctx.lineTo(cx, cy + size * 0.14); ctx.lineTo(cx - size * 0.09, cy);
  ctx.closePath(); ctx.fill();
  // Enchimento floral do campo (pontos e ganchos claros).
  ctx.strokeStyle = 'rgba(216,196,150,0.45)'; ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = size * (0.10 + Math.random() * 0.26);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.beginPath(); ctx.arc(x, y, size * 0.012, 0, Math.PI * 2); ctx.stroke();
  }
  speckle(ctx, size, size * 3, 0.05);        // uso/poeira
}
function heightPersianRug(ctx, size) {
  speckle(ctx, size, size * 8, 0.12);
  speckle(ctx, size, size * 4, 0.10, false);
}

// Tela de quadro a óleo: fundo escuro de galeria com massas de pincelada. Serve
// de "pintura" genérica atrás de uma moldura dourada.
function drawOilPainting(ctx, size) {
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#2a2318'); g.addColorStop(0.6, '#171a14'); g.addColorStop(1, '#0e0d0b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  // Massas de luz (figura/paisagem indistinta em penumbra).
  for (let i = 0; i < 14; i++) {
    const x = size * (0.2 + Math.random() * 0.6), y = size * (0.2 + Math.random() * 0.6);
    const r = size * (0.05 + Math.random() * 0.16);
    const bg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = Math.random() < 0.6;
    bg.addColorStop(0, warm ? 'rgba(206,170,110,0.30)' : 'rgba(150,160,170,0.22)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // Craquelê do verniz velho.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1;
  for (let c = 0; c < 10; c++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * size * 0.18; y += (Math.random() - 0.5) * size * 0.18; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

// Registro: base + parâmetros PBR + escala de normal + geradores.
// camoSafe=false → material de CENA (albedo escuro/saturado): proibido em corpos
// coloráveis, porque a camuflagem compara material.color e o albedo escuro faria
// a superfície não parecer a cor copiada.
const MATERIALS = {
  drywall:   { base: '#f2f0ea', roughness: 0.92, metalness: 0.00, normalScale: 0.25, draw: drawDrywall,   drawHeight: heightDrywall },
  wood:      { base: '#f0e6d4', roughness: 0.55, metalness: 0.00, normalScale: 0.40, draw: drawWood,      drawHeight: heightWood },
  metal:     { base: '#ededed', roughness: 0.35, metalness: 0.30, normalScale: 0.20, draw: drawMetal,     drawHeight: heightMetal },
  fabric:    { base: '#eae7e0', roughness: 0.92, metalness: 0.00, normalScale: 0.50, draw: drawFabric,    drawHeight: heightFabric },
  plastic:   { base: '#f3f3f3', roughness: 0.40, metalness: 0.00, normalScale: 0.15, draw: drawPlastic },
  concrete:  { base: '#ecebe6', roughness: 1.00, metalness: 0.00, normalScale: 0.50, draw: drawConcrete,  drawHeight: heightConcrete },

  // Mansão — camoSafe (albedo claro, cor vem de material.color)
  marble:    { base: '#f1eee7', roughness: 0.22, metalness: 0.05, normalScale: 0.12, draw: drawMarble,    drawHeight: heightMarble },
  parquet:   { base: '#f0e5d2', roughness: 0.42, metalness: 0.02, normalScale: 0.45, draw: drawParquet,   drawHeight: heightParquet },
  damask:    { base: '#efe9de', roughness: 0.88, metalness: 0.00, normalScale: 0.30, draw: drawDamask,    drawHeight: heightDamask },
  velvet:    { base: '#eae4dc', roughness: 0.95, metalness: 0.00, normalScale: 0.55, draw: drawVelvet,    drawHeight: heightVelvet },
  leather:   { base: '#ece4d8', roughness: 0.60, metalness: 0.02, normalScale: 0.60, draw: drawLeather,   drawHeight: heightLeather },
  boiserie:  { base: '#f1ede4', roughness: 0.80, metalness: 0.00, normalScale: 0.95, draw: drawBoiserie,  drawHeight: heightBoiserie },
  gilt:      { base: '#f7f0dc', roughness: 0.28, metalness: 0.55, normalScale: 0.22, draw: drawGilt,      drawHeight: heightGilt },

  // Mansão — sceneOnly (escuros e saturados de propósito)
  bookSpines: { base: '#141110', roughness: 0.68, metalness: 0.04, normalScale: 0.85, camoSafe: false, draw: drawBookSpines, drawHeight: heightBookSpines },
  persianRug: { base: '#7d2b25', roughness: 0.98, metalness: 0.00, normalScale: 0.35, camoSafe: false, draw: drawPersianRug, drawHeight: heightPersianRug },
  oilPaint:   { base: '#171a14', roughness: 0.55, metalness: 0.00, normalScale: 0.20, camoSafe: false, draw: drawOilPainting },
};

// API pública, cacheada por (nome, size, normals, aniso). normals=false → sem
// normalMap (props pequenos / piso no mobile). Retorna tudo que o material precisa,
// incluindo camoSafe (Level._addBox usa isto para recusar material de cena num
// corpo colorável).
export function materialMaps(name, { size = 256, normals = true, aniso = 4 } = {}) {
  return cached(`mat:${name}:${size}:${normals}:${aniso}`, () => {
    const def = MATERIALS[name];
    if (!def) throw new Error('material desconhecido: ' + name);
    const { cv, ctx } = makeCanvas(size, def.base);
    def.draw(ctx, size);
    const map = toTexture(cv, { aniso });
    let normalMap = null;
    if (normals) {
      const hCv = def.drawHeight ? buildHeight(def, size) : luminanceCanvas(cv);
      normalMap = heightToNormal(hCv, { strength: 2.0, aniso });
    }
    return {
      map, normalMap, normalScale: def.normalScale,
      roughness: def.roughness, metalness: def.metalness,
      camoSafe: def.camoSafe !== false,
      canvas: cv, // exposto só para verificação headless (albedo médio)
    };
  });
}

// Nomes registrados (usado pelas verificações headless).
export const MATERIAL_NAMES = Object.keys(MATERIALS);
