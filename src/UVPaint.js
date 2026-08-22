// Pincel 3D por UV — Fase 1 (prova de conceito) do sistema de pintura de
// camuflagem. Raycast contra a própria malha do personagem → UV do ponto
// atingido → carimbo num canvas 2D usado como `.map` dinâmico do material
// (ver AnimationManager.js, setPaintTexture). Ativo só atrás de `?paint=1`
// (ver Player.js) — não interfere no jogo padrão nem na camuflagem de
// verdade (2 cores hex), que continua sendo a mecânica de detecção.
//
// A UV da malha tem 6 regiões não sobrepostas numa grade 3x2 (cabeça/tronco/
// braço esq./braço dir./perna esq./perna dir. — ver
// scripts/gerar_personagem_glb.py, reunwrap_por_regiao). Isso importa aqui:
// um arrasto que pula de uma região pra outra na malha 3D (ex.: dedo escorrega
// da cabeça pro tronco) pula pra uma célula BEM distante no espaço de textura
// — interpolar uma linha reta entre os dois pontos pintaria um rastro por
// cima de células de outras regiões no meio do caminho. strokeBetween corta
// a interpolação (e só carimba os dois extremos) quando a distância no
// espaço de textura é grande demais pra ser um traço contínuo de verdade.

import * as THREE from 'three';

const TEX_SIZE = 512;
const BASE_COLOR = '#eef0f2'; // mesmo branco art-toy da cor padrão do boneco (Player.js BASE)
const SALTO_MAX_FRACAO = 0.3; // 30% do lado da textura — acima disso não é um traço contínuo

export function createPaintTexture(size = TEX_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BASE_COLOR;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, texture };
}

// UV (0-1, origem inferior-esquerda — convenção Three.js) → pixel de canvas
// (origem superior-esquerda, daí o V invertido).
function uvParaPixel(uv, size) {
  return { x: uv.x * size, y: (1 - uv.y) * size };
}

function carimboEm(ctx, x, y, colorHex, radiusPx) {
  ctx.fillStyle = colorHex;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

export function stampCircle(ctx, uv, colorHex, radiusPx) {
  const p = uvParaPixel(uv, ctx.canvas.width);
  carimboEm(ctx, p.x, p.y, colorHex, radiusPx);
}

export function strokeBetween(ctx, uvFrom, uvTo, colorHex, radiusPx) {
  const size = ctx.canvas.width;
  const a = uvParaPixel(uvFrom, size);
  const b = uvParaPixel(uvTo, size);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);

  if (dist > size * SALTO_MAX_FRACAO) {
    // Salto grande demais (provável troca de região) — carimba só o destino,
    // sem ligar os pontos.
    carimboEm(ctx, b.x, b.y, colorHex, radiusPx);
    return;
  }

  const passos = Math.max(1, Math.ceil(dist / (radiusPx * 0.5)));
  for (let i = 1; i <= passos; i++) {
    const t = i / passos;
    carimboEm(ctx, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, colorHex, radiusPx);
  }
}

export function clearTexture(ctx, colorHex = BASE_COLOR) {
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// ---------------------------------------------------------------------
// Raycast manual contra a pose ANIMADA de um SkinnedMesh.
//
// O Raycaster padrão do Three.js testa a geometria da BIND POSE de um
// SkinnedMesh, não a pose animada de verdade — mesma armadilha já
// documentada em docs/PIPELINE_PERSONAGEM.md pro jato de água do Caçador
// ("o raycast testa a bind pose... 'acertava' a parede atrás"). Confirmado
// aqui na prática: um raycast comum contra o personagem em pé (idle) errava
// quase sempre, só acertando por acaso a geometria da bind pose (que fica
// deslocada da pose visível). `SkinnedMesh.applyBoneTransform(index, vetor)`
// (Three.js) devolve a posição de um vértice já transformada pelos ossos
// NA POSE ATUAL — é a peça que falta pra testar contra o que está
// realmente na tela.
//
// Custo: percorre os ~12.000 triângulos do personagem (ver
// scripts/gerar_personagem_glb.py) por chamada — aceitável pro throttle de
// pintura (dezenas de vezes por segundo), mas é o primeiro candidato a
// otimizar (BVH, ou restringir por região/osso) se isto virar gargalo real
// em celular — fora do escopo da Fase 1 (prova de conceito).
const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _tc = new THREE.Vector3();
const _tPoint = new THREE.Vector3();
const _tBary = new THREE.Vector3();
const _tTriangle = new THREE.Triangle();
const _tUvA = new THREE.Vector2();
const _tUvB = new THREE.Vector2();
const _tUvC = new THREE.Vector2();

export function raycastAnimatedSkinnedMesh(raycaster, mesh) {
  if (!mesh || !mesh.isSkinnedMesh) return null;
  const geom = mesh.geometry;
  const index = geom.index;
  const uvAttr = geom.attributes.uv;
  if (!index || !uvAttr) return null;

  mesh.updateMatrixWorld();
  const ray = raycaster.ray;
  const posAttr = geom.attributes.position;

  let closestDist = Infinity;
  let closestUV = null;

  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i);
    const ib = index.getX(i + 1);
    const ic = index.getX(i + 2);

    // `applyBoneTransform(index, target)` NÃO busca a posição base sozinho —
    // espera receber em `target` a posição local (bind pose) do vértice, e
    // só então aplica os ossos da pose atual por cima. Esquecer o
    // `fromBufferAttribute` antes não dá erro nenhum, só devolve lixo
    // numérico astronômico (~1e122) sem avisar — bug real encontrado e
    // corrigido durante o teste (ficou sem pintar nada, silenciosamente).
    _ta.fromBufferAttribute(posAttr, ia);
    _tb.fromBufferAttribute(posAttr, ib);
    _tc.fromBufferAttribute(posAttr, ic);
    mesh.applyBoneTransform(ia, _ta).applyMatrix4(mesh.matrixWorld);
    mesh.applyBoneTransform(ib, _tb).applyMatrix4(mesh.matrixWorld);
    mesh.applyBoneTransform(ic, _tc).applyMatrix4(mesh.matrixWorld);

    const hit = ray.intersectTriangle(_ta, _tb, _tc, false, _tPoint);
    if (!hit) continue;
    const dist = ray.origin.distanceTo(hit);
    if (dist >= closestDist) continue;

    _tTriangle.set(_ta, _tb, _tc);
    _tTriangle.getBarycoord(hit, _tBary);
    _tUvA.fromBufferAttribute(uvAttr, ia);
    _tUvB.fromBufferAttribute(uvAttr, ib);
    _tUvC.fromBufferAttribute(uvAttr, ic);

    closestDist = dist;
    closestUV = new THREE.Vector2(
      _tUvA.x * _tBary.x + _tUvB.x * _tBary.y + _tUvC.x * _tBary.z,
      _tUvA.y * _tBary.x + _tUvB.y * _tBary.y + _tUvC.y * _tBary.z,
    );
  }

  return closestUV ? { uv: closestUV, distance: closestDist } : null;
}
