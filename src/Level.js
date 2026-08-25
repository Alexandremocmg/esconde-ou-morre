import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materialMaps, toonGradient, stripeTexture, hexTileTexture } from './textures.js?v=4';

// Carregador de imagem compartilhado (quadros, céu). Único asset externo do jogo:
// arte toon gerada, empacotada em assets/ — segue offline (servida localmente).
const _texLoader = new THREE.TextureLoader();
// Pinturas toon geradas: rodam nas molduras douradas (superfícies NÃO-colaráveis).
const PAINTINGS = ['painting-1.jpg', 'painting-2.jpg', 'painting-3.jpg', 'painting-4.jpg'];

// ─────────────────────────────────────────────────────────────────────────────
// MANSÃO DE LUXO — térreo (Fase 3). Pegada ~25×25 m por andar (10,7× menor que a
// arena Backrooms), o que reescala visão/fog/sombra (ver Game.js) e o balanço.
// Marca cada malha com userData:
//   climbable = superfície onde o jogador pode grudar (paredes/pilares/móveis altos)
//   colorable = objeto cuja cor pode ser copiada pela camuflagem (alvo de camo)
// A DENSIDADE vem de textura+normal (mármore, parquet, boiserie, lombadas de livro),
// não de contagem de objetos. A penumbra rica vem de material.color + normal em
// albedo CLARO — nunca de albedo escuro (que quebraria a leitura da camuflagem).
// ─────────────────────────────────────────────────────────────────────────────
const HALF = 14.5;     // meia-largura do piso (mansão 29×29 por andar)
// Anel da laje do 2º andar — módulo-level para o _build (janelas), _buildMezzanine
// e _buildUpstairsRoom compartilharem a mesma geometria. Mudar HALF/RING_DEPTH
// propaga para a borda interna (= face frontal da laje) e o centro da faixa.
const RING_DEPTH = 4.0;                    // profundidade da faixa útil (alcovas + janelas E/W)
const RING_IN = HALF - RING_DEPTH;         // 10.5 — topo das escadarias + face onde os poços da laje terminam
const WALL_H = 10.8;   // pé-direito do salão (triplo); teto do salão em WALL_H — +3m (sensação de baixo p/ extensão da área)
const ROOM_H = 6.2;    // altura das paredes de cômodo (abaixo da laje do 2º andar) — +3m, acompanha o salão
const ROOM2_H = 4.4;   // altura das divisórias dos quartos do 2º andar (sobre a laje) — +2m, pedido específico pro piso superior
const ROUTE_Y = 1.1;   // altura dos waypoints (= EYE_Y do Caçador)
const DOOR_MIN = 3.2;  // vão mínimo de porta: o Caçador (BODY_R=0.6 + desvio) atravessa
const FLOOR2_Y = 6.4;  // topo da laje do 2º andar (anel de quartos sobre o hall) — +3m, acompanha o salão
const MEZZ3_Y = 8.2;   // topo da sacada (3º nível) sobre a faixa W — "varanda dupla" — +3m, acompanha o salão
const EYE_Y = 1.1;     // altura dos olhos do Caçador (= Seeker EYE_Y) — p/ routeY do andar

// Paleta ASSINATURA da MANSÃO — os ALVOS FORTES de camuflagem (corpos grudáveis).
// Poucas cores, verificadas: só o que é grudável precisa ser distinto. A riqueza
// escura/rica da cena vem de material.color + normal map e de decoração NÃO-colorável.
// Verificada na métrica atual (sRGB, ver Player.toSRGB): distância par-a-par mínima
// = 0.161 (dourado~carvalho), >= 0.145 do amarelo de parede legado (0xcbbf82) e
// >= 0.188 da base do boneco (0xeef0f2). Folga sobre o limiar de camo EXIT=0.13.
// (script: scratchpad/palette_check.js)
// Paleta POP/TOON (Fase 6): cores vivas e chapadas por cômodo (estilo Meccha),
// no lugar dos tons de material discretos do realismo. As CHAVES são mantidas
// (evita mexer nos ~40 usos) — os nomes agora são só rótulos de cor. Deltas de
// camuflagem verificados: mín. par-a-par 0.169 (sRGB), mín. do boneco 0.290
// (ver /tmp/palcheck; meta ≥0.16 e ≥0.188).
const MANSION = {
  marmore:  0xEBD9A8, // creme dourado — paredes/base (o "anel-âncora")
  ebano:    0x2F3350, // ardósia escuro — estantes/molduras (contraste)
  latao:    0xF2C63C, // amarelo ouro — arandelas, detalhes
  porcelana:0x59C1E8, // azul céu — quartos
  bordo:    0xE85D6C, // coral — estofados
  prussia:  0x3F6FD6, // azul forte — biblioteca
  ametista: 0xA05CE0, // roxo — galeria
  salvia:   0x63C98B, // verde menta — escritórios
  carvalho: 0xE59B4C, // laranja/tan — tacos, aparadores
};
// Array para o espalhador e para índices por-seed (ordem estável).
const SIGNATURE = Object.values(MANSION);

// ─────────────────────────────────────────────────────────────────────────────
// MAPA 2 — FÁBRICA ABANDONADA DE BRINQUEDOS/TINTA (layout=4). Casco PRÓPRIO —
// não passa por `_build()` (não herda paredes/mezanino/paleta da mansão), só
// reaproveita os helpers de baixo nível (_addBox/_addStairFlight/_deco/
// materiais toon). Ver `_buildFactoryLevel()`.
const FACTORY = {
  amareloSeguranca: 0xF5C518, // faixas de alerta, corrimãos
  cinzaMetal:       0x5C6670, // painéis metálicos do perímetro/passarela
  ferrugem:         0x8B4A2B, // caixotes/paletes envelhecidos
  tintaTeal:        0x2FB6A8, // tanque de tinta A + sala de tintas
  tintaRoxa:        0x8A4FD1, // tanque de tinta B
  vermelhoAlerta:   0xE0483E, // vestiário/porta de emergência
  concreto:         0xC9B896, // (reservado — cor de cena, não-colorável)
  azulIndustrial:   0x3E7CB1, // linha de montagem
  verdeToxico:      0x8FCB3E, // barris de solvente
};
// Verificado com o MESMO método da paleta MANSION (Player.js:toSRGB — hex já
// nasce em sRGB, então a distância certa é Euclidiana direta nos bytes, sem
// nenhuma conversão de gamma): mín. par-a-par 0.238 (tintaTeal~azulIndustrial),
// mín. vs. base do boneco (0xeef0f2) 0.447 (concreto) — folga bem acima do
// mínimo exigido (>=0.161 / >=0.188, mesmo limiar da paleta MANSION).
// Script: scratchpad/palette_check_factory.mjs (sessão, não versionado).
const F_HALF = HALF;    // mesma meia-largura da mansão (29×29 m) — mantém as
                         // faixas de alcance/velocidade do Seeker já calibradas
const F_WALL_H = 7.6;   // pé-direito único (sem os 3 níveis da mansão)
const F_ROOM_H = 5.2;   // paredes dos 4 cômodos de canto
const F_CAT_Y = 4.4;    // altura da passarela elevada (equivalente ao mezanino)

// ─────────────────────────────────────────────────────────────────────────────
// MAPA 3 — CHAMELEON MANOR (layout=5, Plano 5). Casco PRÓPRIO como a Fábrica
// (não passa por _build()), mas reaproveita a paleta/materiais da FAMÍLIA
// mansão (MANSION acima, materiais toon de textures.js) — é tematicamente uma
// mansão, ao contrário da Fábrica (paleta industrial própria). 4 níveis
// físicos (porão/térreo/1º andar/ático), ~15× a área da mansão atual —
// decisão explícita do usuário de seguir a escala completa da especificação
// externa (docs/ESPECIFICACAO_MAPA_CHAMELEON_MANOR (1).md), não uma versão
// reduzida. Ver .claude/skills/level-design/SKILL.md pro processo (headless
// antes de visual, sempre).
//
// Fase 0 do Plano 5: só o CASCO (piso/parede/teto dos 4 níveis + 3 escadas de
// transição + rotas-placeholder retangulares). Conteúdo de zona (Ballroom,
// Galeria, Biblioteca, amostragem por pixel, passagens secretas...) entra nas
// fases seguintes — não adicionar aqui sem atualizar o plano.
const CM_HALF_X = 60;        // meia-largura em X — planta 120m
const CM_HALF_Z = 40;        // meia-largura em Z — planta 80m
const CM_BASEMENT_Y = -3;    // piso do porão
const CM_GROUND_Y = 0;       // piso do térreo (= teto do porão)
const CM_FLOOR1_Y = 4.5;     // piso do 1º andar (= teto do térreo)
const CM_ATTIC_Y = 8.5;      // piso do ático (= teto do 1º andar)
const CM_ROOF_Y = 11;        // teto do ático
const CM_T = 0.6;            // espessura de parede — mesma da Fábrica

// Paleta CHAMELEON (Fase 2 do Plano 5) — só as cores que são alvo REAL de
// camuflagem (colorable/pixelColorable), não a tabela decorativa inteira da
// especificação original (molduras, prateleiras vazias etc. ficam
// colorable:false, mesmo critério das outras 2 paletas). Verificada com o
// MESMO método sRGB de MANSION/FACTORY (script scratchpad/
// palette_check_chameleon.mjs, sessão, não versionado, agora com 18 cores):
// mín. par-a-par 0,173, mín. vs. base do boneco (0xeef0f2) 0,208 — acima dos
// limiares 0,161/0,188. Gerada via HSL (não hex à mão) — algumas
// combinações "família" (verde-oliva vs. verde-planta, azul-parede vs.
// azul-lombada, laranja-madeira vs. vermelho-tecido) colidiam por padrão e
// precisaram de matiz/luminosidade ajustados à parte; o script documenta o
// processo caso a paleta precise crescer de novo nas próximas fases.
const CHAMELEON = {
  marmore: 0xA9B6BC,       // marble_white — pilares do Ballroom, hero B1/B6 (cinza-azulado, não branco puro)
  floral: 0xDABEA9,        // wall_floral — papel de parede do 1º andar, hero B2
  salvia: 0x3C8667,        // wall_sage — paredes da Galeria/corredores, hero A7
  carvalho: 0x9F7438,      // wood_oak — estantes/piso/portas (Biblioteca, Hall)
  madeiraEscura: 0x533B2D, // wood_dark — Ático/Porão, hero A4/A5
  azulejoPreto: 0x262626,  // tile_black — banheiro de luxo (base do padrão hexagonal), hero S4
  azulejoAzul: 0x356E97,   // tile_blue — banheiro/cozinha industrial
  vermelho: 0xB63540,      // fabric_red — cortinas/tapetes/sofá, hero A1/A3
  dourado: 0xC7AB6B,       // fabric_gold — molduras/detalhes da Galeria
  concreto: 0x808080,      // concrete_gray — Porão/chaminé do Ático, hero B5
  verde: 0x338830,         // plant_green — vasos/folhagem, hero A6
  lombada1: 0x8A3B14,      // book_spine_1 — Biblioteca (base do padrão de lombadas), hero S1
  lombada2: 0x14265D,      // book_spine_2 — Biblioteca, hero S1
  lombada3: 0x800000,      // book_spine_3 — Biblioteca
  lombada4: 0x80B635,      // book_spine_4 — Biblioteca
  // Fase 4b — cores de padrão pixelColorable: aqui as DUAS cores de cada par
  // JÁ SÃO a cor final do canvas (não um base+tint como as demais — ver
  // textures.js stripeTexture/hexTileTexture), então precisam da MESMA
  // verificação sRGB que qualquer outra entrada colorable.
  listraClara: 0xB861B8,    // wall_striped claro — Corredor
  listraEscura: 0x633663,   // wall_striped escuro — Corredor
  azulejoBanheiro: 0xDFBBE2, // tile_white (não branco puro) — Banheiro de Visitas, hero B4 (rejunte reusa `concreto`)
};

// Waypoint na altura de operação do Caçador.
function wp(x, z) { return new THREE.Vector3(x, ROUTE_Y, z); }

export class Level {
  constructor(scene, layout = 1, opts = {}) {
    this.scene = scene;
    this.layout = layout;
    // Scaling de qualidade (mobile): texturas menores, menos normais, menos casters.
    this._mobile = !!opts.mobile;
    this._texSize = this._mobile ? 128 : 256;
    this._aniso = this._mobile ? 2 : 4;
    this._matCache = new Map(); // materiais compartilhados (SÓ não-climbables — ver _stdMat)
    this._geoCache = new Map(); // geometrias compartilhadas (seguro sempre)
    this._imgCache = new Map(); // texturas de imagem (assets/) — 1 upload por arquivo
    this._paintIdx = 0;         // cicla as pinturas geradas pelos quadros da mansão
    this.climbables = []; // alvos do raycaster de latching (superfícies verticais)
    this.colorables = []; // alvos do raycaster de camuflagem
    this.solids = [];     // AABBs (THREE.Box3) para colisão de topo/queda
    this.fixtures = [];   // luminárias {x,y,z,radius,intensity} → penumbra (Fase 5)
    // Verticalidade (Fase 4): superfícies HORIZONTAIS onde o Caçador pisa (chão,
    // lajes do mezanino, degraus). A sonda de chão do Seeker raycasta contra estas.
    this.walkables = [];
    this._slabs = [];     // lajes horizontais do 2º andar (bloqueiam visão entre andares)
    // occluders/cameraColliders são materializados no fim de _build (climbables+lajes).
    this.occluders = [];
    this.cameraColliders = [];

    // Definidos por cada layout (usados por Player e Game):
    this.spawn = new THREE.Vector3(0, 0, 6);      // início do jogador (x,z; y = chão)
    this.routes = [];                             // rotas de patrulha (1 por Caçador)
    this.routeY = [];                             // altura inicial dos olhos por rota (andar)
    // Quais índices de `routes` o modo Caçador jogável usa como pontos candidatos
    // de spawn de ChameleonTarget (Game._spawnHunterTargets). Default [0,1] cobre
    // mansão/fábrica sem mudança de comportamento; Chameleon Manor (layout=5)
    // sobrescreve para [0,1,2,3] — 4 domínios verticais, não 2.
    this.huntTargetRouteIndices = [0, 1];

    // Materiais animados no loop (bruxuleio de velas) — preenchidos em _build.
    this._flames = [];    // { mat, phase, base } chamas emissivas que tremulam
    this._roomDoors = []; // {x,z} dos vãos de cômodo → mantidos livres no espalhamento

    // layout=4/5 são LOCAIS diferentes (fábrica, chameleon manor), casco
    // próprio — não passam por _build() (paredes/mezanino/paleta da mansão
    // base). Layouts 1-3 continuam exatamente como antes.
    if (this.layout === 4) this._buildFactoryLevel();
    else if (this.layout === 5) this._buildChameleonManor();
    else this._build();
  }

  // Estimativa BARATA de luz em pos (0..1) para a mecânica de PENUMBRA (Fase 5):
  // soma a contribuição das luminárias (intensity * queda linear até radius) sobre
  // um piso ambiente (nenhum canto é breu absoluto). ~N luminárias × distância por
  // Caçador/frame — desprezível. Não lê shadow map nem usa luz real.
  lightAt(pos) {
    let acc = 0.25; // piso ambiente
    for (const f of this.fixtures) {
      const dx = pos.x - f.x, dy = pos.y - f.y, dz = pos.z - f.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < f.radius) acc += f.intensity * (1 - d / f.radius);
    }
    return acc < 1 ? acc : 1;
  }

  // Anima a iluminação de cena: velas/lustres bruxuleiam de leve (dá vida à
  // penumbra sem custo de luz real) + passagens secretas em trânsito (Fase 5,
  // Plano 5). Chamado por Game no loop.
  update(t, dt = 0) {
    for (const f of this._flames) {
      const flick = f.base * (1 + 0.10 * Math.sin(t * 11 + f.phase) + 0.06 * Math.sin(t * 27 + f.phase * 1.7));
      f.mat.emissiveIntensity = flick;
    }
    if (this._secretPassages) this._updateSecretPassages(dt);
  }

  // Passagens secretas (Fase 5, Plano 5): o painel É um climbable/colorable
  // NORMAL (`_addBox`, mesmo material da parede) que desliza entre
  // `closedPos`/`openPos` por lerp. CRÍTICO: `solids` guarda um snapshot
  // (Box3) tirado na criação — mover mesh.position NÃO move o Box3 sozinho
  // (ao contrário de climbables/occluders, que são referências ao mesh e
  // portanto já ficam corretos de graça em qualquer raycast, já que leem a
  // matrixWorld atual). Por isso o Box3 do painel precisa ser resssincronizado
  // manualmente a cada frame em trânsito — é essa ressincronização que este
  // método faz. Não precisa tocar `occluders`/`cameraColliders`: são arrays
  // de referência ao MESMO mesh, então a oclusão já enxerga a posição nova
  // sozinha assim que o painel se move.
  _updateSecretPassages(dt) {
    for (const p of this._secretPassages) {
      if (p.state !== 'opening' && p.state !== 'closing') continue;
      p.progress = Math.min(1, p.progress + dt / p.duration);
      const [from, to] = p.state === 'opening' ? [p.closedPos, p.openPos] : [p.openPos, p.closedPos];
      p.mesh.position.lerpVectors(from, to, p.progress);
      p.box.setFromCenterAndSize(p.mesh.position, p.boxSize);
      if (p.progress >= 1) p.state = p.state === 'opening' ? 'open' : 'closed';
    }
  }

  // Gatilho: proximidade + botão Escalar (Game.js intercepta ANTES de
  // player.toggleLatch — ver comentário lá). Cooldown 5s (spec) contado a
  // partir do INÍCIO do movimento, não do fim — evita destrancar o cooldown
  // cedo demais se o jogador tentar de novo no meio da animação.
  trySecretPassage(playerPos) {
    if (!this._secretPassages) return false;
    const now = performance.now();
    for (const p of this._secretPassages) {
      if (now < p.cooldownUntil) continue;
      if (p.state !== 'open' && p.state !== 'closed') continue;
      if (playerPos.distanceTo(p.triggerPos) > p.triggerRadius) continue;
      p.state = p.state === 'closed' ? 'opening' : 'closing';
      p.progress = 0;
      p.cooldownUntil = now + 5000;
      return true;
    }
    return false;
  }

  // opts.seekerPass=true → colisão SÓ do jogador/câmera (o Caçador ignora). Para
  // enfeites: barram você, mas não prendem o Caçador (que não tem pathfinding e
  // ficava travado orbitando props pequenos na linha de patrulha).
  _addSolid(w, h, d, x, y, z, opts = {}) {
    const box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(w, h, d)
    );
    if (opts.seekerPass) box.seekerPass = true;
    this.solids.push(box);
    return box; // Fase 5 (Plano 5): passagens secretas guardam a referência p/ mover em sync com o mesh.
  }

  // Registra uma luminária para a estimativa barata de luz (penumbra, Fase 5).
  _addFixture(x, y, z, radius, intensity) {
    this.fixtures.push({ x, y, z, radius, intensity });
  }

  // Mapas de material cientes de qualidade (size/aniso do mobile). Cacheado em
  // textures.js por (nome,size,normals,aniso) → um upload por material.
  _mat(name, { normals = true } = {}) {
    return materialMaps(name, { size: this._texSize, normals, aniso: this._aniso });
  }

  // Textura de imagem de assets/ (ex.: pinturas toon), cacheada por arquivo. sRGB
  // para albedo; sem RepeatWrapping (arte não-tileável → ClampToEdge padrão). O
  // load é assíncrono: a malha aparece cinza por um frame e recebe a arte ao chegar.
  _img(file, { srgb = true } = {}) {
    let tex = this._imgCache.get(file);
    if (!tex) {
      tex = _texLoader.load(`assets/${file}?v=3`);
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = this._aniso;
      this._imgCache.set(file, tex);
    }
    return tex;
  }

  // Geometria compartilhada por chave (dims quantizadas). Nunca é mutada por-mesh.
  _geo(key, make) {
    let g = this._geoCache.get(key);
    if (!g) { g = make(); this._geoCache.set(key, g); }
    return g;
  }

  // Material padrão para meshes NÃO-climbable (deco/esferas/cones/cilindros).
  // PODE ser compartilhado com segurança: a oclusão só muta materiais de
  // climbables (ver Game._updateOcclusion). Materiais EMISSIVOS nunca entram no
  // cache — sua intensidade é animada no loop (chamas).
  _stdMat(o) {
    if (o.emissive != null && o.emissive !== undefined) return this._makeMat(o);
    const key = `${o.color}|${o.roughness ?? 0.7}|${o.metalness ?? 0.05}|` +
      `${o.map ? o.map.uuid : 0}|${o.normalMap ? o.normalMap.uuid : 0}|${o.normalScale ?? 1}`;
    let m = this._matCache.get(key);
    if (!m) { m = this._makeMat(o); this._matCache.set(key, m); }
    return m;
  }

  // roughness/metalness são inertes no MeshToonMaterial (mantidos na assinatura só
  // para os chamadores não quebrarem); o sombreamento vem do gradientMap cel.
  _makeMat({ color, roughness = 0.7, metalness = 0.05, map = null, normalMap = null, normalScale = 1, emissive = null, emissiveIntensity = 0 }) {
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (map) mat.map = map;
    if (normalMap) { mat.normalMap = normalMap; mat.normalScale = new THREE.Vector2(normalScale, normalScale); }
    if (emissive !== null) { mat.emissive = new THREE.Color(emissive); mat.emissiveIntensity = emissiveIntensity; }
    return mat;
  }

  // Corpo grudável/colorável (parede, pilar, móvel alto). Cada climbable tem
  // material ÚNICO (a oclusão o muta por-objeto — nunca compartilhar). `mat` é um
  // pacote de materialMaps() (camoSafe garantido pelos chamadores).
  //
  // `pixelColorable` (Plano 5, Fase 1): a camuflagem passa a amostrar o pixel
  // EXATO da textura de padrão (`map`) em vez da cor média do material — para
  // superfícies como listras/hexágonos onde "acertar" depende de alinhar com
  // o padrão, não só a cor geral. Exige `map` (sem padrão não há o que amostrar
  // por pixel) e `map.image` ser um `<canvas>` (todo material procedural de
  // textures.js já é — ver materialMaps()/CanvasTexture).
  _addBox(w, h, d, color, x, y, z, {
    climbable = true, colorable = true, pixelColorable = false,
    map = null, mapRepeat = null, roughness = 0.85, metalness = 0.0,
    normalMap = null, normalScale = 1,
    emissive = null, emissiveIntensity = 0, seekerPass = false,
  } = {}) {
    const radius = Math.min(0.22, 0.14 * Math.min(w, h, d));
    const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (emissive !== null) { mat.emissive = new THREE.Color(emissive); mat.emissiveIntensity = emissiveIntensity; }
    if (map) {
      const tex = map.clone(); tex.needsUpdate = true;
      if (mapRepeat) tex.repeat.set(mapRepeat.x, mapRepeat.y);
      mat.map = tex;
    }
    if (normalMap) {
      const ntex = normalMap.clone(); ntex.needsUpdate = true;
      if (mapRepeat) ntex.repeat.set(mapRepeat.x, mapRepeat.y);
      mat.normalMap = ntex;
      mat.normalScale = new THREE.Vector2(normalScale, normalScale);
    }
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
    mesh.position.set(x, y, z);
    // Casters no mobile: só estruturas altas grudáveis (a passada de sombra é
    // custo por-frame; ver docs/PLANO_REALISMO.md §4).
    mesh.castShadow = this._mobile ? (climbable && h >= 3.0) : true;
    mesh.receiveShadow = true;
    mesh.userData.climbable = climbable;
    mesh.userData.colorable = colorable;
    if (pixelColorable && map) {
      const src = this._buildPixelSource(map, mapRepeat);
      if (src) { mesh.userData.pixelColorable = true; mesh.userData.pixelSource = src; }
    }
    this.scene.add(mesh);
    if (climbable) this.climbables.push(mesh);
    if (colorable) this.colorables.push(mesh);
    this._addSolid(w, h, d, x, y, z, { seekerPass });
    return mesh;
  }

  // Lê o canvas-fonte de uma textura procedural pra fora do pipeline de GPU —
  // 1x por objeto, na criação, nunca por-frame (getImageData() do canvas
  // inteiro é caro). `repeatX/Y` precisa ser o MESMO valor aplicado à textura
  // deste mesh (mapRepeat), senão a amostra ignora a repetição real do padrão
  // numa parede grande. Consumido por Player._pixelColorAt.
  _buildPixelSource(map, mapRepeat) {
    const img = map.image;
    if (!img || !img.getContext) return null; // não é CanvasTexture — sem pixel pra ler
    const w = img.width, h = img.height;
    const data = img.getContext('2d').getImageData(0, 0, w, h).data;
    return { data, width: w, height: h, repeatX: mapRepeat ? mapRepeat.x : 1, repeatY: mapRepeat ? mapRepeat.y : 1 };
  }

  // Parede de boiserie (painéis em relevo) na cor creme de mármore — alvo claro
  // de camuflagem (o "anel-âncora" da mansão, análogo ao amarelo Backrooms).
  // Grudável + colorável + sólida.
  _addWall(w, h, d, x, y, z, color = MANSION.marmore) {
    const bo = this._mat('boiserie', { normals: false });
    const long = Math.max(w, d);
    // Fase 2c: superfícies grandes SEM normalMap. Sob cel-shading o relevo vira
    // banda ruidosa (o LUT reage a cada perturbação da normal), e é o maior custo
    // de fill-rate no mobile. O albedo (bo.map) chapado basta para o toon.
    return this._addBox(w, h, d, color, x, y, z, {
      roughness: bo.roughness, metalness: 0.02,
      map: bo.map,
      mapRepeat: { x: Math.max(1, long / 3), y: Math.max(1, h / 3) },
    });
  }

  _addSphere(r, color, x, y, z, {
    roughness = 0.6, metalness = 0.05, map = null, normalMap = null, normalScale = 1, cast = true,
  } = {}) {
    const geo = this._geo(`sph:${r.toFixed(2)}`, () => new THREE.SphereGeometry(r, 24, 18));
    const mesh = new THREE.Mesh(geo, this._stdMat({ color, roughness, metalness, map, normalMap, normalScale }));
    mesh.position.set(x, y, z);
    mesh.castShadow = this._mobile ? false : cast;
    mesh.receiveShadow = true;
    mesh.userData.colorable = true;
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  _addCylinder(r, h, color, x, z, {
    cast = true, roughness = 0.7, metalness = 0.05, map = null, normalMap = null, normalScale = 1,
    y = null, colorable = true,
  } = {}) {
    const geo = this._geo(`cyl:${r.toFixed(2)}:${h.toFixed(2)}`, () => new THREE.CylinderGeometry(r, r, h, 20));
    const mesh = new THREE.Mesh(geo, this._stdMat({ color, roughness, metalness, map, normalMap, normalScale }));
    mesh.position.set(x, y == null ? h / 2 : y, z);
    mesh.castShadow = this._mobile ? (cast && h >= 3.0) : cast;
    mesh.receiveShadow = true;
    if (colorable) { mesh.userData.colorable = true; this.colorables.push(mesh); }
    this.scene.add(mesh);
    return mesh;
  }

  _addCone(r, h, color, x, z, {
    cast = true, roughness = 0.7, metalness = 0.05, map = null, normalMap = null, normalScale = 1,
  } = {}) {
    const geo = this._geo(`cone:${r.toFixed(2)}:${h.toFixed(2)}`, () => new THREE.ConeGeometry(r, h, 22));
    const mesh = new THREE.Mesh(geo, this._stdMat({ color, roughness, metalness, map, normalMap, normalScale }));
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = this._mobile ? (cast && h >= 3.0) : cast;
    mesh.receiveShadow = true;
    mesh.userData.colorable = true;
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  // Detalhe decorativo genérico (qualquer geometria). Sem AABB e não-grudável;
  // colorável por padrão. Usado por molduras/tampos/almofadas e pelas superfícies
  // de CENA (lombadas, tapetes, telas) que NÃO devem ser alvo de camuflagem
  // (colorable:false) — a cor de cena vem do albedo próprio, não de material.color.
  _deco(geo, color, x, y, z, {
    rot = 0, rx = 0, rz = 0, cast = false, colorable = true,
    emissive = null, emissiveIntensity = 0, roughness = 0.7, metalness = 0.05,
    map = null, normalMap = null, normalScale = 1,
  } = {}) {
    const mat = this._stdMat({ color, roughness, metalness, map, normalMap, normalScale, emissive, emissiveIntensity });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, rot, rz);
    mesh.castShadow = this._mobile ? false : cast;
    mesh.receiveShadow = true;
    if (colorable) { mesh.userData.colorable = true; this.colorables.push(mesh); }
    this.scene.add(mesh);
    return mesh;
  }

  // ── CÔMODOS ("cabines" de camuflagem) ───────────────────────────────────────
  // Cômodo PASSÁVEL: 4 paredes de boiserie coloridas grudáveis com vãos largos
  // (o Caçador não tem pathfinding — becos fechados prendem-no ou trancam o jogador).
  // `doors` usa 'n','s','e','w' (n=-z, s=+z, w=-x, e=+x).
  _buildRoom(cx, cz, w, d, color, { doors = ['s', 'n'], door = DOOR_MIN, h = ROOM_H } = {}) {
    const hw = w / 2, hd = d / 2, t = 0.5;
    const bo = this._mat('boiserie', { normals: false }); // Fase 2c: paredes chapadas (sem normal)
    const opts = {
      roughness: bo.roughness, metalness: 0.02,
      map: bo.map,
    };
    const rep = (len) => ({ x: Math.max(1, len / 3), y: Math.max(1, h / 3) });

    // Rodapé de madeira (P1 — stretch): faixa baixa COLORÁVEL por segmento de parede,
    // protuberante nas duas faces (BB_T > t) para a ZONA das pernas amostrar de ambos
    // os lados. `_deco` → sem colisão (não bloqueia andar rente à base, STEP_UP=0.30).
    const wd = this._mat('wood');
    const bbOpts = { colorable: true, map: wd.map, roughness: wd.roughness, metalness: wd.metalness };
    const BB_H = 0.4, BB_T = t + 0.18;
    const bbX = (zPos, segW, segCx) => this._deco(new THREE.BoxGeometry(segW, BB_H, BB_T), MANSION.carvalho, segCx, BB_H / 2, zPos, bbOpts);
    const bbZ = (xPos, segD, segCz) => this._deco(new THREE.BoxGeometry(BB_T, BB_H, segD), MANSION.carvalho, xPos, BB_H / 2, segCz, bbOpts);

    const wallAlongX = (zPos, hasDoor) => {
      if (!hasDoor) { this._addBox(w, h, t, color, cx, h / 2, zPos, { ...opts, mapRepeat: rep(w) }); bbX(zPos, w, cx); return; }
      const seg = (w - door) / 2;
      if (seg <= 0.2) return;
      const cxL = cx - (door / 2 + seg / 2), cxR = cx + (door / 2 + seg / 2);
      this._addBox(seg, h, t, color, cxL, h / 2, zPos, { ...opts, mapRepeat: rep(seg) }); bbX(zPos, seg, cxL);
      this._addBox(seg, h, t, color, cxR, h / 2, zPos, { ...opts, mapRepeat: rep(seg) }); bbX(zPos, seg, cxR);
    };
    const wallAlongZ = (xPos, hasDoor) => {
      if (!hasDoor) { this._addBox(t, h, d, color, xPos, h / 2, cz, { ...opts, mapRepeat: rep(d) }); bbZ(xPos, d, cz); return; }
      const seg = (d - door) / 2;
      if (seg <= 0.2) return;
      const czN = cz - (door / 2 + seg / 2), czS = cz + (door / 2 + seg / 2);
      this._addBox(t, h, seg, color, xPos, h / 2, czN, { ...opts, mapRepeat: rep(seg) }); bbZ(xPos, seg, czN);
      this._addBox(t, h, seg, color, xPos, h / 2, czS, { ...opts, mapRepeat: rep(seg) }); bbZ(xPos, seg, czS);
    };

    wallAlongX(cz - hd, doors.includes('n'));
    wallAlongX(cz + hd, doors.includes('s'));
    wallAlongZ(cx - hw, doors.includes('w'));
    wallAlongZ(cx + hw, doors.includes('e'));

    const doorPts = [];
    if (doors.includes('n')) doorPts.push({ x: cx, z: cz - hd });
    if (doors.includes('s')) doorPts.push({ x: cx, z: cz + hd });
    if (doors.includes('w')) doorPts.push({ x: cx - hw, z: cz });
    if (doors.includes('e')) doorPts.push({ x: cx + hw, z: cz });
    return { center: { x: cx, z: cz }, doors: doorPts, w, d };
  }

  _collectDoors(...rooms) {
    for (const r of rooms) {
      for (const d of r.doors) this._roomDoors.push({ x: d.x, z: d.z });
      this._roomDoors.push({ x: r.center.x, z: r.center.z });
    }
  }

  // ── MOBÍLIA DA MANSÃO ────────────────────────────────────────────────────────
  // O CORPO dominante é grudável e colorido (alvo real de camuflagem via _addBox);
  // os detalhes e as superfícies de CENA (lombadas/telas/tapetes) vão em _deco.

  // Pilar de mármore: superfície vertical ampla e grudável — ótimo alvo de camo.
  _buildPillar(x, z, h = WALL_H, color = MANSION.marmore) {
    const mb = this._mat('marble');
    this._addBox(1.1, h, 1.1, color, x, h / 2, z, {
      roughness: mb.roughness, metalness: mb.metalness,
      map: mb.map, normalMap: mb.normalMap, normalScale: mb.normalScale,
      mapRepeat: { x: 1, y: Math.max(1, h / 3) },
    });
    // Base e capitel (carvalho/latão) — detalhe não-grudável.
    this._deco(new THREE.BoxGeometry(1.35, 0.3, 1.35), MANSION.carvalho, x, 0.15, z, { cast: true });
    this._deco(new THREE.BoxGeometry(1.35, 0.28, 1.35), MANSION.latao, x, h - 0.14, z, { metalness: 0.5, roughness: 0.35 });
  }

  // Estante de biblioteca: carcaça de ébano grudável + painel FRONTAL de lombadas
  // (textura bookSpines num único plano — a densidade de ~centenas de livros sem
  // as malhas). O painel é sceneOnly (não-colorável).
  _buildBookshelf(x, z, dir = { x: 0, z: 1 }, color = MANSION.ebano) {
    const w = 2.2, h = 2.8, d = 0.5;
    const wd = this._mat('wood');
    this._addBox(w, h, d, color, x, h / 2, z, {
      roughness: wd.roughness, metalness: 0,
      map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale,
    });
    // Painel de lombadas na face frontal (dir aponta a frente).
    const bs = this._mat('bookSpines');
    const alongX = Math.abs(dir.z) >= Math.abs(dir.x);
    const off = d / 2 + 0.02;
    this._deco(new THREE.PlaneGeometry(w * 0.92, h * 0.82), 0xffffff,
      x + dir.x * off, h * 0.52, z + dir.z * off, {
        rot: alongX ? (dir.z < 0 ? Math.PI : 0) : (dir.x < 0 ? -Math.PI / 2 : Math.PI / 2),
        map: bs.map, normalMap: bs.normalMap, normalScale: bs.normalScale,
        roughness: bs.roughness, colorable: false,
      });
  }

  // Poltrona/sofá de veludo: encosto colorido grudável (alvo vertical) + assento/braços.
  _buildArmchair(x, z, color = MANSION.bordo, base = 0) {
    const ve = this._mat('velvet');
    const vopts = { roughness: ve.roughness, metalness: 0, map: ve.map, normalMap: ve.normalMap, normalScale: ve.normalScale };
    this._addBox(1.5, 1.0, 0.3, color, x, base + 0.7, z - 0.45, vopts); // encosto (grudável)
    this._deco(new THREE.BoxGeometry(1.5, 0.4, 0.9), shade(color, -0.05), x, base + 0.35, z, { roughness: 0.95 });
    for (const sx of [-1, 1])
      this._deco(new THREE.BoxGeometry(0.24, 0.6, 0.95), shade(color, -0.1), x + sx * 0.63, base + 0.5, z, { roughness: 0.95 });
    this._deco(new THREE.BoxGeometry(1.05, 0.2, 0.75), shade(color, 0.12), x, base + 0.62, z, {}); // almofada
  }

  // Aparador de carvalho: corpo grudável + tampo de mármore + item de latão.
  _buildSideboard(x, z, color = MANSION.carvalho, base = 0) {
    const wd = this._mat('wood');
    this._addBox(1.9, 1.0, 0.7, color, x, base + 0.5, z, {
      roughness: wd.roughness, metalness: 0,
      map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale,
    });
    this._deco(new THREE.BoxGeometry(2.0, 0.08, 0.8), MANSION.marmore, x, base + 1.04, z, { roughness: 0.25 });
    // Candelabro de latão (com chama emissiva bruxuleante) sobre o aparador.
    this._buildCandelabra(x, base + 1.1, z);
  }

  // Guarda-roupa alto de ébano: excelente alvo grudável (parede vertical).
  _buildWardrobe(x, z, color = MANSION.ebano) {
    const wd = this._mat('wood');
    this._addBox(1.6, 2.9, 0.8, color, x, 1.45, z, {
      roughness: wd.roughness, metalness: 0,
      map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale,
    });
    this._deco(new THREE.BoxGeometry(0.03, 2.6, 0.02), MANSION.latao, x, 1.45, z + 0.41, { metalness: 0.5, roughness: 0.35 });
    for (const sy of [1.0, 1.9])
      this._deco(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), MANSION.latao, x + 0.3, sy, z + 0.42, { colorable: false, metalness: 0.5 });
  }

  // Cama: cabeceira de veludo grudável (alvo vertical) + colchão + edredom.
  _buildBed(x, z, color = MANSION.porcelana) {
    const ve = this._mat('velvet');
    this._addBox(2.4, 1.3, 0.3, color, x, 0.75, z - 1.0, {
      roughness: ve.roughness, metalness: 0, map: ve.map, normalMap: ve.normalMap, normalScale: ve.normalScale,
    }); // cabeceira (grudável)
    this._deco(new THREE.BoxGeometry(2.4, 0.5, 2.2), MANSION.carvalho, x, 0.35, z, {}); // estrado
    this._deco(new THREE.BoxGeometry(2.2, 0.3, 2.0), shade(color, 0.25), x, 0.72, z + 0.05, { roughness: 0.95 }); // edredom
    for (const sx of [-0.6, 0.6])
      this._deco(new THREE.BoxGeometry(0.7, 0.22, 0.5), 0xf3efe6, x + sx, 0.9, z - 0.7, { roughness: 1.0, colorable: false }); // travesseiros
  }

  // Rotação Y para uma peça plana encostada numa parede, dada a direção `dir`
  // (unitária em x/z) para onde a face olha.
  _facing(dir) {
    const alongX = Math.abs(dir.z) >= Math.abs(dir.x);
    return alongX ? (dir.z < 0 ? Math.PI : 0) : (dir.x < 0 ? -Math.PI / 2 : Math.PI / 2);
  }

  // Janela alta: caixilho dourado, vidro de noite (emissivo frio), montantes e
  // duas cortinas de veludo. As paredes de perímetro são superfícies enormes e
  // vazias — é o maior ganho visual por malha do cenário. Registra uma luminária
  // fria e ampla (luar), que também alimenta a mecânica de penumbra.
  _buildWindow(x, y, z, dir, w = 1.9, h = 2.8) {
    const rot = this._facing(dir);
    const gi = this._mat('gilt', { normals: false });
    const off = (k) => [x + dir.x * k, z + dir.z * k];
    // Vidro (noite lá fora): escuro, levemente emissivo — lê como vidro, não buraco.
    let [px, pz] = off(0.06);
    this._deco(new THREE.PlaneGeometry(w, h), 0x0d1622, px, y, pz, {
      rot, colorable: false, roughness: 0.15, metalness: 0.1,
      emissive: 0x2c4a6e, emissiveIntensity: 0.55,
    });
    // Caixilho + montantes (cruz) por cima do vidro.
    [px, pz] = off(0.1);
    const frameOpts = { rot, colorable: false, map: gi.map, roughness: gi.roughness, metalness: gi.metalness };
    this._deco(new THREE.BoxGeometry(w + 0.22, 0.16, 0.12), 0xffffff, px, y + h / 2, pz, frameOpts);
    this._deco(new THREE.BoxGeometry(w + 0.22, 0.16, 0.12), 0xffffff, px, y - h / 2, pz, frameOpts);
    this._deco(new THREE.BoxGeometry(0.12, h, 0.12), 0xffffff, px, y, pz, frameOpts);
    this._deco(new THREE.BoxGeometry(w, 0.1, 0.1), 0xffffff, px, y, pz, frameOpts);
    // Cortinas de veludo bordô (colorável: mais um alvo de camuflagem da paleta).
    const ve = this._mat('velvet');
    const vOpts = {
      rot, roughness: ve.roughness, metalness: 0,
      map: ve.map, normalMap: ve.normalMap, normalScale: ve.normalScale,
    };
    [px, pz] = off(0.22);
    const side = { x: dir.z, z: -dir.x };   // perpendicular no plano
    for (const s of [-1, 1]) {
      this._deco(new THREE.BoxGeometry(0.55, h + 0.5, 0.3), MANSION.bordo,
        px + side.x * s * (w / 2 + 0.3), y, pz + side.z * s * (w / 2 + 0.3), vOpts);
    }
    // Bandô superior.
    this._deco(new THREE.BoxGeometry(w + 1.3, 0.4, 0.34), MANSION.bordo, px, y + h / 2 + 0.35, pz, vOpts);
    this._addFixture(x + dir.x * 0.5, y, z + dir.z * 0.5, 7, 0.3);
  }

  // Espelho ornamentado. Reflexo REAL exigiria um render target e um re-render da
  // cena por espelho (zero infra hoje) — aqui é uma superfície escura bem metálica
  // e lisa, que capta os emissivos ao redor e lê como espelho a custo de 2 malhas.
  _buildMirror(x, y, z, dir, w = 1.2, h = 1.9) {
    const rot = this._facing(dir);
    const gi = this._mat('gilt', { normals: false });
    this._deco(new THREE.BoxGeometry(w + 0.24, h + 0.24, 0.1), 0xffffff,
      x + dir.x * 0.05, y, z + dir.z * 0.05,
      { rot, colorable: false, map: gi.map, roughness: gi.roughness, metalness: gi.metalness });
    this._deco(new THREE.PlaneGeometry(w, h), 0x8d949c, x + dir.x * 0.11, y, z + dir.z * 0.11,
      { rot, colorable: false, roughness: 0.06, metalness: 1.0 });
  }

  // Cimalha (topo) e rodapé ao longo das paredes de perímetro: duas faixas finas
  // que "fecham" a parede e dão escala. 8 malhas para o cenário inteiro.
  _buildTrim() {
    const gi = this._mat('gilt', { normals: false });
    const corn = { colorable: false, map: gi.map, roughness: gi.roughness, metalness: gi.metalness };
    // Rodapé (P1): agora é COLORÁVEL, de MADEIRA (carvalho) e mais alto (0.4) — é a
    // faixa de cor baixa que a ZONA das pernas amostra, enquanto o tronco amostra a
    // parede acima. Habilita a camuflagem bi-tom estilo Meccha no perímetro.
    const wd = this._mat('wood');
    const base = { colorable: true, map: wd.map, roughness: wd.roughness, metalness: wd.metalness };
    for (const s of [-1, 1]) {
      this._deco(new THREE.BoxGeometry(HALF * 2, 0.3, 0.22), 0xffffff, 0, WALL_H - 0.2, s * (HALF - 0.2), corn);
      this._deco(new THREE.BoxGeometry(0.22, 0.3, HALF * 2), 0xffffff, s * (HALF - 0.2), WALL_H - 0.2, 0, corn);
      this._deco(new THREE.BoxGeometry(HALF * 2, 0.4, 0.16), MANSION.carvalho, 0, 0.2, s * (HALF - 0.24), base);
      this._deco(new THREE.BoxGeometry(0.16, 0.4, HALF * 2), MANSION.carvalho, s * (HALF - 0.24), 0.2, 0, base);
    }
  }

  // Quadro emoldurado: moldura dourada (deco) + tela a óleo (sceneOnly). `dir`
  // aponta para fora da parede (a face pintada). Fica plano contra a parede.
  _buildPainting(x, y, z, dir = { x: 0, z: 1 }, w = 1.3, h = 1.7) {
    const rot = this._facing(dir);
    const gi = this._mat('gilt', { normals: false });
    // Moldura (levemente saliente).
    this._deco(new THREE.BoxGeometry(w + 0.18, h + 0.18, 0.08), 0xffffff,
      x + dir.x * 0.05, y, z + dir.z * 0.05, {
        rot, map: gi.map, roughness: gi.roughness, metalness: gi.metalness, colorable: false,
      });
    // Tela: pintura toon GERADA (assets/), ciclando entre as 4 telas. Substitui o
    // óleo procedural. colorable:false → nunca é alvo de camuflagem.
    const tex = this._img(PAINTINGS[this._paintIdx++ % PAINTINGS.length]);
    this._deco(new THREE.PlaneGeometry(w, h), 0xffffff, x + dir.x * 0.1, y, z + dir.z * 0.1, {
      rot, map: tex, roughness: 0.7, colorable: false,
    });
  }

  // Candelabro/vela: chama emissiva quente (bruxuleia via _flames) + registra
  // uma luminária para a mecânica de penumbra (Fase 5). Sem custo de luz real.
  _buildCandelabra(x, y, z, intensity = 0.6, radius = 5) {
    this._deco(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 10), MANSION.latao, x, y + 0.25, z, { colorable: false, metalness: 0.5, roughness: 0.35 });
    const flame = this._deco(new THREE.SphereGeometry(0.09, 8, 8), 0x2a1c08, x, y + 0.58, z, {
      colorable: false, emissive: 0xffcf8a, emissiveIntensity: 1.6,
    });
    this._flames.push({ mat: flame.material, phase: Math.random() * 6.28, base: 1.6 });
    this._addFixture(x, y + 0.58, z, radius, intensity);
  }

  // Lustre suspenso: anel de latão + várias chamas; ilumina o salão (fixture forte).
  _buildChandelier(x, z, y = WALL_H - 1.4) {
    this._deco(new THREE.TorusGeometry(0.7, 0.06, 8, 20), MANSION.latao, x, y, z, {
      rx: Math.PI / 2, colorable: false, metalness: 0.55, roughness: 0.3,
    });
    this._deco(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), MANSION.latao, x, y + 0.6, z, { colorable: false, metalness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const fx = x + Math.cos(a) * 0.7, fz = z + Math.sin(a) * 0.7;
      const flame = this._deco(new THREE.SphereGeometry(0.08, 8, 8), 0x2a1c08, fx, y + 0.06, fz, {
        colorable: false, emissive: 0xffdca0, emissiveIntensity: 1.8,
      });
      this._flames.push({ mat: flame.material, phase: a, base: 1.8 });
    }
    this._addFixture(x, y, z, 9, 1.0); // luminária forte central
  }

  // Arandela de parede: chama pequena rente à parede (fixture média para penumbra).
  _buildSconce(x, y, z) {
    const flame = this._deco(new THREE.SphereGeometry(0.07, 8, 8), 0x2a1c08, x, y, z, {
      colorable: false, emissive: 0xffcf8a, emissiveIntensity: 1.4,
    });
    this._deco(new THREE.ConeGeometry(0.12, 0.22, 10, 1, true), MANSION.latao, x, y - 0.16, z, { colorable: false, metalness: 0.5 });
    this._flames.push({ mat: flame.material, phase: Math.random() * 6.28, base: 1.4 });
    this._addFixture(x, y, z, 4.5, 0.5);
  }

  // Tapete persa: placa fina no chão. P3c: agora COLORÁVEL, em cor de assinatura
  // (bordô) — é o alvo de camuflagem para a pose DEITADO ("virar tapete"). Não
  // bloqueia (é _deco, sem colisão).
  _buildRug(x, z, w = 4, d = 3, y = 0.02, color = MANSION.bordo) {
    const rg = this._mat('persianRug', { normals: false });
    this._deco(new THREE.PlaneGeometry(w, d), color, x, y, z, {
      rx: -Math.PI / 2, map: rg.map, roughness: rg.roughness, colorable: true,
    });
  }

  // Vaso/busto ornamental: pedestal (carvalho) + peça (mármore/latão) — cores
  // de disfarce extras, não-grudáveis.
  _buildPedestalPiece(x, z, kind = 0, base = 0) {
    this._deco(new THREE.CylinderGeometry(0.28, 0.32, 1.0, 16), MANSION.carvalho, x, base + 0.5, z, { cast: true });
    if (kind === 0) this._deco(new THREE.SphereGeometry(0.32, 16, 12), MANSION.marmore, x, base + 1.2, z, { roughness: 0.25, cast: true }); // busto/urna
    else this._deco(new THREE.ConeGeometry(0.3, 0.7, 14), MANSION.latao, x, base + 1.35, z, { metalness: 0.5, roughness: 0.35, cast: true }); // chama/obelisco
    this._addSolid(0.7, 1.6, 0.7, x, base + 0.8, z, { seekerPass: true }); // barra jogador; Caçador atravessa
  }

  // ── NOVOS TIPOS (variedade visual do 2º andar) ──────────────────────────────
  // Planta em vaso: vaso de carvalho + folhagem verde sálvia (cores da paleta).
  // Folhagem é _deco colorável (alvo de camo de brinde); vaso idem. `base` = piso.
  _buildPlant(x, z, base = 0) {
    this._deco(new THREE.CylinderGeometry(0.26, 0.34, 0.6, 14), MANSION.carvalho, x, base + 0.3, z, { cast: true, roughness: 0.6 });
    this._addSphere(0.45, MANSION.salvia, x, base + 1.0, z, { roughness: 0.9 });
    this._deco(new THREE.ConeGeometry(0.34, 0.6, 12), MANSION.salvia, x, base + 1.5, z, { roughness: 0.9, cast: true });
    this._addSolid(0.7, 1.8, 0.7, x, base + 0.9, z, { seekerPass: true }); // barra jogador; Caçador atravessa
  }

  // Biombo/divisória decorativa: painel fino e alto (corpo grudável = mais um alvo
  // de camuflagem vertical e uma leve cobertura de linha de visão). `dir` = face.
  _buildScreen(x, z, color = MANSION.ametista, base = 0, dir = { x: 0, z: 1 }) {
    const bo = this._mat('boiserie');
    const alongX = Math.abs(dir.z) >= Math.abs(dir.x);
    const w = 1.7, h = 1.8, t = 0.16;
    this._addBox(alongX ? w : t, h, alongX ? t : w, color, x, base + h / 2, z, {
      roughness: bo.roughness, metalness: 0.02, map: bo.map, normalMap: bo.normalMap, normalScale: bo.normalScale,
      mapRepeat: { x: 1, y: 1 },
    });
    // Coroamento de latão (detalhe, não-colorável).
    this._deco(new THREE.BoxGeometry(alongX ? w + 0.1 : t, 0.1, alongX ? t : w + 0.1), MANSION.latao,
      x, base + h + 0.05, z, { colorable: false, metalness: 0.5, roughness: 0.35 });
  }

  // Mesa redonda: pé + tampo (cilindros baixos), com uma peça central opcional.
  _buildRoundTable(x, z, base = 0) {
    this._deco(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 12), MANSION.ebano, x, base + 0.4, z, { cast: true });
    this._deco(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 24), MANSION.marmore, x, base + 0.85, z, { roughness: 0.25, cast: true });
    this._deco(new THREE.SphereGeometry(0.16, 12, 10), MANSION.latao, x, base + 1.02, z, { colorable: false, metalness: 0.5, roughness: 0.35 });
    this._addSolid(1.2, 1.0, 1.2, x, base + 0.5, z, { seekerPass: true }); // barra jogador; Caçador atravessa
  }

  // ── VERTICALIDADE: laje, degrau, mezanino ───────────────────────────────────
  // Laje horizontal do 2º andar: superfície onde se PISA (walkable + solid) e que
  // BLOQUEIA a visão entre andares (_slabs → occluders). NÃO é grudável (o jogador
  // não gruda no teto) nem colorável.
  _addSlab(w, d, cx, cz, topY) {
    const pq = this._mat('parquet', { normals: false });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.4, d),
      this._makeMat({ color: 0xffffff, roughness: pq.roughness, metalness: pq.metalness, map: rep(pq.map, Math.max(1, w / 3), Math.max(1, d / 3)) })
    );
    mesh.position.set(cx, topY - 0.2, cz);
    mesh.receiveShadow = true;
    mesh.castShadow = false; // laje grande horizontal: pular caster (perf)
    this.scene.add(mesh);
    this._addSolid(w, 0.4, d, cx, topY - 0.2, cz);
    this.walkables.push(mesh);
    this._slabs.push(mesh);
    return mesh;
  }

  // Degrau da escadaria: caixa maciça de y=0 até topY (stringer fechado). Entra em
  // walkables (sonda de chão do Caçador) e solids (o jogador sobe degrau a degrau),
  // mas NÃO em occluders/climbables — senão os whiskers leriam a escada como parede
  // e o Caçador orbitaria a base (ver PLANO da mansão, Fase 4c).
  // `baseY` > 0 para escadas que partem de uma laje (ex.: 2º andar → sacada).
  _addStep(w, d, cx, cz, topY, baseY = 0) {
    const st = this._mat('marble', { normals: false });
    const h = topY - baseY, cy = (topY + baseY) / 2;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      this._makeMat({ color: MANSION.marmore, roughness: st.roughness, metalness: st.metalness, map: st.map })
    );
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this._addSolid(w, h, d, cx, cy, cz);
    this.walkables.push(mesh);
    return mesh;
  }

  // Lance de escada genérico ao longo de +z (ou -z se z1<z0), de baseY a topY.
  // Retorna os waypoints de base e topo (XZ; o Y vem da sonda de chão do Seeker).
  _addStairFlight(cx, width, z0, z1, baseY, topY, steps = 16) {
    const dz = (z1 - z0) / steps;
    for (let i = 1; i <= steps; i++) {
      const zc = z0 + (i - 0.5) * dz;
      this._addStep(width, Math.abs(dz) + 0.02, cx, zc, baseY + i * ((topY - baseY) / steps), baseY);
    }
    // Corrimãos SÓ VISUAIS nos DOIS lados (brass acompanhando a inclinação). SEM
    // colisão: barreiras sólidas laterais das duas escadarias (ambas em cx=0) se
    // encontravam e muravam o próprio caminho de subida. A queda lateral é rara e
    // menos ruim que travar o lance — fica só o guia visual.
    const rise = topY - baseY, run = Math.abs(z1 - z0);
    const railY = (baseY + topY) / 2 + 0.9, railTilt = Math.sign(z1 - z0) * -Math.atan2(rise, run);
    for (const sx of [-1, 1]) {
      this._deco(new THREE.BoxGeometry(0.08, 0.1, Math.hypot(run, rise)), MANSION.latao,
        cx + sx * (width / 2 + 0.05), railY, (z0 + z1) / 2,
        { colorable: false, rx: railTilt, metalness: 0.5 });
    }
    return { bot: wp(cx, z0), top: wp(cx, z1) };
  }

  // Mezanino-varanda: anel de laje no perímetro (y=FLOOR2_Y) sobre o hall aberto,
  // escadaria no canto SE, guarda-corpo e arandelas. Compartilhado pelos 3 layouts.
  // Define this._stairBot/_stairTop/_balcony para as rotas montarem a patrulha vertical.
  _buildMezzanine() {
    const IN = RING_IN; // topo das escadarias + face onde os poços terminam (herdado)
    // LAJE CHEIA do 2º andar (Fase B — "laje grande com esconderijos"): no lugar do
    // antigo ANEL (faixa de 4 m em volta de um vão de 21×21), um piso sólido 29×29 em
    // FLOOR2_Y. Deixa DOIS poços sobre as escadarias (S e N) para o jogador EMERGIR —
    // sem eles a laje viraria teto e prenderia quem sobe (o mesmo travamento que a
    // escada já resolvia ao terminar na borda). Cada poço = x∈[-HW,HW], z∈[HZ..IN].
    // A laje é montada por 5 retângulos que contornam os poços (mesma contagem do anel).
    const HW = 1.5;  // meia-largura do poço = meia-largura da escada (3 m) → sem sacada lateral aberta
    const HZ = 4.5;  // início do poço em z; o miolo z∈[-HZ,HZ] liga as duas saídas de escada
    this._addSlab(HALF - HW, HALF * 2, -(HALF + HW) / 2, 0, FLOOR2_Y); // W: x∈[-14.5,-2]
    this._addSlab(HALF - HW, HALF * 2, (HALF + HW) / 2, 0, FLOOR2_Y);  // E: x∈[2,14.5]
    this._addSlab(HW * 2, HALF - IN, 0, (HALF + IN) / 2, FLOOR2_Y);    // centro-S: z∈[10.5,14.5]
    this._addSlab(HW * 2, HZ * 2, 0, 0, FLOOR2_Y);                     // miolo:    z∈[-4.5,4.5]
    this._addSlab(HW * 2, HALF - IN, 0, -(HALF + IN) / 2, FLOOR2_Y);   // centro-N: z∈[-14.5,-10.5]
    // Guarda-corpo SÓLIDO dos dois poços: BALAUSTRADA BAIXA (PH=0.6), não parede.
    // Ainda bloqueia a queda — a colisão só ignora sólidos com topo <= pés+STEP_UP
    // (FLOOR2_Y+0.30) e o topo daqui é FLOOR2_Y+PH=FLOOR2_Y+0.6, sempre 0.3 acima do
    // limite — mas agora se enxerga POR CIMA: do
    // corredor central você vê o vão e os degraus, e a escada se lê como escada.
    // Com PH=1.0 as três murets formavam um U opaco de frente para o corredor e o
    // 2º andar parecia ter "paredes tampando as escadas" (relato do playtest).
    // A boca do lance segue aberta na face externa (z=±IN), onde o topo dos degraus
    // encosta na laje; as 3 bordas de queda (travessa em z=±HZ + laterais x=±HW)
    // continuam protegidas.
    const PH = 0.6, PY = FLOOR2_Y + PH / 2, PT = 0.16;
    const boP = this._mat('boiserie');
    const guard = { climbable: false, roughness: boP.roughness, metalness: 0.02, map: boP.map, normalMap: boP.normalMap, normalScale: boP.normalScale, mapRepeat: { x: 1, y: 1 } };
    for (const sz of [1, -1]) {                    // sz=+1 poço S, sz=-1 poço N
      const zCross = sz * HZ;                       // travessa junto ao miolo
      const zSideMid = sz * (HZ + IN) / 2;          // centro das laterais
      this._addBox(HW * 2, PH, PT, MANSION.marmore, 0, PY, zCross, guard);        // travessa
      this._addBox(PT, PH, IN - HZ, MANSION.marmore, -HW, PY, zSideMid, guard);   // lateral W
      this._addBox(PT, PH, IN - HZ, MANSION.marmore, HW, PY, zSideMid, guard);    // lateral E
    }

    // ESCADARIA SUL (x=0): térreo → 2º andar, sobe em +z de z=5 até a BORDA interna
    // da faixa S (z=IN), onde o último degrau (topo = FLOOR2_Y) encosta na face da laje.
    // CRÍTICO subir só até z=IN, não além: a laje é um sólido de 0.4 m e sua face
    // frontal (z=IN) age como parede até os pés do jogador estarem a STEP_UP do topo.
    // Se a escada passa da borda, os degraus de altura cheia ficam ENTERRADOS sob a
    // laje e o jogador bate na face ~0.34 m abaixo do piso → trava ao chegar em cima.
    // Terminar na borda deixa um degrau cheio rente à laje (como a passagem MEZZ3 já
    // faz). x=0 é livre no térreo dos 3 layouts.
    // O SENTIDO é subir PARA FORA de propósito: do hall (onde se joga a maior parte
    // do tempo) você encara os DEGRAUS, convidativos. Inverter o lance põe o costado
    // maciço de 3.4 m de frente para o hall — vira um paredão que tapa a escada
    // (testado e revertido; a legibilidade do térreo pesa mais que a do 2º andar).
    // `steps` recalibrado pro FLOOR2_Y atual: cada degrau sobe FLOOR2_Y/steps, e isso
    // PRECISA ficar abaixo de STEP_UP=0.30 (Player.js/Seeker.js) — senão o jogador
    // trava no meio da escada (o degrau seguinte fica alto demais pra subir andando).
    // Com FLOOR2_Y=6.4, 20 degraus dava 0.32 (> 0.30, quebrava a subida); 28 dá ≈0.229,
    // com folga. Se FLOOR2_Y mudar nesta linha de novo, recalcular `stairSteps`.
    const stairSteps = 28;
    const sS = this._addStairFlight(0, 3, 5, IN, 0, FLOOR2_Y, stairSteps);
    // ESCADARIA NORTE (x=0): rota alternativa, espelhada. Sem ela, a escada única
    // era um gargalo — jogador e Caçador sempre no mesmo ponto de subida.
    const sN = this._addStairFlight(0, 3, -5, -IN, 0, FLOOR2_Y, stairSteps);
    this._stairBot = sS.bot; this._stairTop = wp(0, IN + 0.3);
    this._stairBotN = sN.bot; this._stairTopN = wp(0, -(IN + 0.3));

    // QUARTOS DO 2º ANDAR: 4 alcovas nos cantos do anel. A divisória é PARCIAL
    // (parte da parede externa e para antes da borda interna), então corta a linha
    // de visão ao longo do anel sem criar beco — a circulação passa pelo lado do
    // vão, larga o bastante para o Caçador (que só tem whiskers, não pathfinding).
    const cQ = (HALF + IN) / 2;          // centro da faixa (|coord| = 10.75)
    for (const sx2 of [-1, 1]) for (const sz2 of [-1, 1]) {
      this._buildUpstairsRoom(sx2 * cQ, sz2 * cQ, sx2, sz2);
    }

    // SACADA (3º nível, y=5.2) sobre a faixa W, encostada na parede externa: uma
    // varanda dupla olhando o vão. Fica FORA do vão central, então não conflita
    // com pilares/paredes de nenhum layout. Acesso por lance próprio a partir do
    // 2º andar (senão seria zona inalcançável = esconderijo seguro demais).
    // Ocupa a LARGURA TODA da faixa W (x ∈ [-12.5,-9]) e o meio dela (|z| < 6.5,
    // livre das divisórias dos quartos de canto, que ficam em z=±7.55). Largura
    // total é essencial: com uma folga lateral o Caçador contornaria a escada
    // rente à borda e nunca subiria. Assim a faixa W do anel VIRA a passagem
    // elevada — sobe, atravessa, desce — e o circuito do 2º andar a usa naturalmente.
    const bw = 3.5, bx = -(HALF - bw / 2);   // x ∈ [-12.5,-9], centro -10.75
    this._addSlab(bw, 8, bx, 0, MEZZ3_Y);                                  // z ∈ [-4,4]
    this._addStairFlight(bx, bw, -6.5, -4, FLOOR2_Y, MEZZ3_Y, 10);         // sobe (N)
    this._addStairFlight(bx, bw, 6.5, 4, FLOOR2_Y, MEZZ3_Y, 10);           // desce (S)
    // Guarda-corpo da sacada (borda interna) + cobertura grudável + arandelas.
    this._deco(new THREE.BoxGeometry(0.08, 0.1, 8), MANSION.latao, bx + bw / 2, MEZZ3_Y + 0.5, 0,
      { colorable: false, roughness: 0.4, metalness: 0.5 });
    const wd = this._mat('wood');
    const cabOpts = { roughness: wd.roughness, metalness: 0, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale };
    this._addBox(1.0, 1.5, 1.4, MANSION.prussia, bx - 1.0, MEZZ3_Y + 0.75, 1.6, cabOpts);
    this._buildSconce(-HALF + 0.4, MEZZ3_Y + 1.6, -2);
    this._buildSconce(-HALF + 0.4, MEZZ3_Y + 1.6, 2);

    // Arandelas do 2º andar (fixtures de penumbra lá em cima).
    this._buildSconce(HALF - 0.4, FLOOR2_Y + 2, 0);
    this._buildSconce(0, FLOOR2_Y + 2, HALF - 0.4);

    // Esconderijos da LAJE (Fase B — "laje grande com objetos pra esconder"). Com o
    // piso cheio, o 2º andar vira um campo de cobertura: móveis-esconderijo COM colisão
    // (guarda-roupas/baús/biombos, via _addBox → grudáveis = camo + oclusão) espalhados
    // em corredores, mais acentos decorativos. Evita os poços das escadas (x∈[-2,2],
    // |z|∈[4.5,10.5]), a faixa da sacada (x<-9, |z|<6.5) e as 4 alcovas de canto.
    this._decorateFloor2();

    // Waypoints do anel (Y é ignorado no alcance; serve de XZ-alvo). Laço de 8
    // pontos hugando o anel (cantos + meios de aresta) para não cortar o canto e
    // cair no vão. bc=HALF-1.9 (dentro de [9,12.5]), passando pela borda interna
    // das alcovas. Começa em (0,bc), na faixa S, junto à escadaria sul.
    const bc = HALF - 1.9;
    this._balcony = [
      wp(0, bc), wp(bc, bc), wp(bc, 0), wp(bc, -bc),
      wp(0, -bc), wp(-bc, -bc), wp(-bc, 0), wp(-bc, bc),
    ];
    // Circuito dos andares altos = o próprio anel: a faixa W dele é a passagem
    // elevada (sobe ao 3º nível, atravessa e desce), então o Caçador cobre os
    // três níveis sem waypoints especiais. O ponto (-bc, 0) cai sobre a sacada.
    this._upperLoop = this._balcony;
  }

  // Móvel-esconderijo de madeira: 1 malha, grudável+colorável (alvo de camuflagem
  // E cobertura de linha de visão), com colisão. h alto = guarda-roupa; baixo = baú.
  // seekerPass: o Caçador ATRAVESSA (barra só o jogador). Sem pathfinding, ele
  // entalava no vão estreito entre um móvel e um pilar estrutural (vão 1.0m < corpo
  // 1.2m). Assim ele colide só com estrutura (paredes/pilares/murets), sempre passável.
  _hideBox(w, h, d, color, x, z, base) {
    const wd = this._mat('wood');
    this._addBox(w, h, d, color, x, base + h / 2, z, {
      roughness: wd.roughness, metalness: 0, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale,
      seekerPass: true,
    });
  }

  // Popular a LAJE CHEIA do 2º andar com esconderijos (Fase B). base = FLOOR2_Y.
  // Campos livres (evitam poços das escadas, sacada e alcovas de canto): campo E
  // (x∈[3,10]) e campo W (x∈[-8,-3]), ambos em |z|≲8, mantendo o corredor central
  // x∈[-2,2] aberto entre as duas saídas de escada. Rotação de cor por layout dá
  // variedade aos 3 mapas sem custo de malha. Tudo com colisão vira cobertura.
  _decorateFloor2() {
    const b = FLOOR2_Y;
    const pal = [MANSION.bordo, MANSION.prussia, MANSION.ametista, MANSION.ebano, MANSION.porcelana];
    const col = (i) => pal[(i + this.layout) % pal.length];

    // — Guarda-roupas altos (2 m): melhores esconderijos (bloqueiam visão em pé).
    //   Pares espelhados nos campos E/W; x≥-7 mantém-nos a leste da sacada (x≤-9).
    const wardrobe = [[-7, -4], [-7, 4], [7, -4], [7, 4], [9.5, 0]];
    wardrobe.forEach(([x, z], i) => this._hideBox(1.4, 2.0, 0.8, col(i), x, z, b));
    // — Baús/arcas mais baixos (1.2 m): cobertura agachada, espalhados nos campos.
    const chest = [[-4, -6], [-4, 6], [4, -6], [4, 6], [-5.5, 0], [5.5, 0]];
    chest.forEach(([x, z]) => this._hideBox(1.3, 1.2, 1.1, MANSION.carvalho, x, z, b));
    // — Biombos (cortam linha de visão sem virar beco), um em cada campo.
    this._buildScreen(-8.5, -7, col(2), b, { x: 1, z: 0 });
    this._buildScreen(8, 6.5, col(4), b, { x: 1, z: 0 });

    // — Acentos decorativos (sem colisão): plantas e mesas nas bordas livres.
    this._buildPlant(12.8, -6, b);
    this._buildPlant(12.8, 6, b);
    this._buildPlant(-6, 12.8, b);
    this._buildRoundTable(11, 3, b);
    this._buildRoundTable(11, -3, b);

    // — Quadros nas paredes externas do 2º andar (sem colisão), entre as janelas
    //   (x=±5 em N/S) e as alcovas de canto. y ao lado dos caixilhos.
    for (const sz of [-1, 1]) {
      this._buildPainting(-9.3, b + 1.7, sz * (HALF - 0.32), { x: 0, z: -sz }, 1.3, 1.7);
      this._buildPainting(9.3, b + 1.7, sz * (HALF - 0.32), { x: 0, z: -sz }, 1.3, 1.7);
    }
  }

  // Define as rotas de patrulha: 0 = TÉRREO (por layout), 1 = andares altos (anel
  // do 2º andar + passagem elevada), 2 = térreo em sentido oposto (3º Caçador,
  // estágios avançados). `routeY` dá a altura de nascimento de cada uma.
  _setRoutes(ground) {
    this.routes = [ground, this._upperLoop.slice(), ground.slice().reverse()];
    this.routeY = [EYE_Y, FLOOR2_Y + EYE_Y, EYE_Y];
  }

  // Alcova-quarto do 2º andar num canto do anel. `sx/sz` = sinais do canto.
  // A divisória parte da parede EXTERNA e para antes da borda interna, deixando a
  // passagem do anel livre. Cama + guarda-roupa dão cobertura e alvos de camuflagem.
  _buildUpstairsRoom(cx, cz, sx, sz) {
    const wd = this._mat('wood');
    const bo = this._mat('boiserie');
    const color = (sx * sz > 0) ? MANSION.porcelana : MANSION.bordo;
    const base = FLOOR2_Y;

    // Divisória transversal (ao longo de X), 1.8 m a partir da parede externa.
    const segLen = 1.8, segX = sx * (HALF - segLen / 2);
    this._addBox(segLen, ROOM2_H, 0.4, color, segX, base + ROOM2_H / 2, cz - sz * 3.2, {
      roughness: bo.roughness, metalness: 0.02,
      map: bo.map, normalMap: bo.normalMap, normalScale: bo.normalScale,
      mapRepeat: { x: 1, y: 1 },
    });

    // Cabeceira de cama encostada na parede externa (corpo grudável = alvo de camo).
    const ve = this._mat('velvet');
    this._addBox(1.8, 1.0, 0.3, color, sx * (HALF - 0.55), base + 0.5, cz, {
      roughness: ve.roughness, metalness: 0, map: ve.map, normalMap: ve.normalMap, normalScale: ve.normalScale,
    });
    this._deco(new THREE.BoxGeometry(1.8, 0.45, 1.9), MANSION.carvalho, sx * (HALF - 1.6), base + 0.22, cz, {});
    this._deco(new THREE.BoxGeometry(1.7, 0.26, 1.7), shade(color, 0.25), sx * (HALF - 1.6), base + 0.55, cz, { roughness: 0.95 });

    // Guarda-roupa alto na outra ponta da alcova, para DENTRO do mapa (-sz).
    this._addBox(1.3, 2.0, 0.7, MANSION.ebano, cx + sx * 0.4, base + 1.0, cz - sz * 2.2, {
      roughness: wd.roughness, metalness: 0, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale,
    });

    this._buildRug(cx, cz, 2.6, 2.0, base + 0.02);
    // Arandela à frente da parede (sz*1.2 mantém-na dentro do cômodo; 1.6 a
    // enterrava na espessura da parede de perímetro).
    this._buildSconce(sx * (HALF - 0.4), base + 2.0, cz + sz * 1.2);

    // Enriquecimento visual (alcova maior com DEPTH=4). Todas peças SEM colisão
    // (_deco/_addSphere não geram solids) → não estreitam a passagem do anel nem
    // prendem o Caçador. Quadro na parede z externa, planta no canto extremo,
    // mesinha ao pé da cama e vaso no pedestal do lado do vão.
    this._buildPainting(sx * (HALF - 2.3), base + 1.7, sz * (HALF - 0.28), { x: 0, z: -sz }, 1.2, 1.5);
    this._buildPlant(sx * (HALF - 0.6), sz * (HALF - 0.6), base);
    this._buildRoundTable(sx * (HALF - 0.8), cz - sz * 1.7, base);
  }

  // ── SHELL (casca comum a todos os layouts) ──────────────────────────────────
  _build() {
    // Piso: parquet espinha-de-peixe (não-colorável → cor livre, branco multiplica
    // o albedo). Sem normal no mobile (cobre muita tela → fill-rate).
    const pq = this._mat('parquet', { normals: !this._mobile });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(HALF * 2, 1, HALF * 2),
      this._makeMat({
        color: 0xffffff, roughness: pq.roughness, metalness: pq.metalness,
        map: rep(pq.map, 8, 8), normalMap: this._mobile ? null : rep(pq.normalMap, 8, 8), normalScale: pq.normalScale,
      })
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this._addSolid(HALF * 2, 1, HALF * 2, 0, -0.5, 0); // topo em y = 0
    this.walkables.push(floor);                        // sonda de chão do Caçador (térreo)

    // Placa de mármore no centro (piso do salão) — leitura de nobreza.
    const mb = this._mat('marble', { normals: false });
    const inlay = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      this._makeMat({ color: 0xffffff, roughness: mb.roughness, metalness: mb.metalness, map: rep(mb.map, 2, 2) })
    );
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.y = 0.011;
    inlay.receiveShadow = true;
    this.scene.add(inlay);

    // Paredes de perímetro: boiserie creme (pé-direito do salão).
    const t = 0.6;
    this._addWall(HALF * 2, WALL_H, t, 0, WALL_H / 2, -HALF); // fundo (n)
    this._addWall(HALF * 2, WALL_H, t, 0, WALL_H / 2, HALF);  // frente (s)
    this._addWall(t, WALL_H, HALF * 2, -HALF, WALL_H / 2, 0); // esquerda (w)
    this._addWall(t, WALL_H, HALF * 2, HALF, WALL_H / 2, 0);  // direita (e)

    // Teto do salão (gesso, virado para baixo, sem colisão) + rosácea.
    this._addCeiling();

    // Cimalha + rodapé e janelas altas no perímetro. As janelas ficam ACIMA da
    // laje do 2º andar (y≈5.1): são vistas de perto da varanda e iluminam o vão
    // duplo por cima, sem esbarrar na mobília rente às paredes do térreo.
    this._buildTrim();
    const wy = FLOOR2_Y + 1.7;
    for (const a of [-5, 5]) {           // N/S: centrais, emolduram o vão duplo
      this._buildWindow(a, wy, HALF - 0.35, { x: 0, z: -1 });
      this._buildWindow(a, wy, -(HALF - 0.35), { x: 0, z: 1 });
    }
    // E/W: |z| entre a passagem elevada (sacada + lances, |z|<6.5) e a divisória
    // das alcovas (|z| = centro da faixa − 3.2), ambas dependentes do tamanho do anel.
    const divZ = (HALF + RING_IN) / 2 - 3.2;   // z da divisória de canto
    const wEW = (6.5 + divZ) / 2;              // janela no meio do vão livre
    for (const a of [-wEW, wEW]) {
      this._buildWindow(HALF - 0.35, wy, a, { x: -1, z: 0 });
      this._buildWindow(-(HALF - 0.35), wy, a, { x: 1, z: 0 });
    }

    // Mezanino-varanda (2º andar) + escadaria — antes do layout, que consome
    // this._stairBot/_stairTop/_balcony para montar a patrulha vertical.
    this._buildMezzanine();

    // Estrutura interna + spawn + rotas variam por ala (estágio).
    if (this.layout === 2) this._buildBedroomWing();
    else if (this.layout === 3) this._buildGalleryWing();
    else this._buildGrandHall();

    // Densidade procedural: mobília + ornamentos pelas áreas livres.
    this._scatterProps();

    // Materializa oclusores de VISÃO (grudáveis + lajes: o 2º andar bloqueia a
    // linha de visão entre andares) e colisores de CÂMERA (idem, p/ a câmera não
    // atravessar o piso). Game._updateOcclusion usa este `occluders`.
    this.occluders = this.climbables.concat(this._slabs);
    this.cameraColliders = this.climbables.concat(this._slabs);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAPA 2 — FÁBRICA ABANDONADA. Único nível + passarela elevada (mais simples
  // que o mezanino de 3 níveis da mansão) — 4 cômodos de canto (mesma topologia
  // passável de _buildRoom, nunca beco sem saída) em volta de um piso aberto
  // central com tanques de tinta (alvos de camuflagem) e caixotes.
  // ═══════════════════════════════════════════════════════════════════════
  _buildFactoryLevel() {
    const H = F_HALF, t = 0.6;

    // Piso: concreto, não-colorável (decoração de cena — mesmo espírito do
    // parquet/mármore da mansão, que também não são alvo de camuflagem).
    const cc = this._mat('concrete', { normals: !this._mobile });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(H * 2, 1, H * 2),
      this._makeMat({
        color: 0xffffff, roughness: cc.roughness, metalness: cc.metalness,
        map: rep(cc.map, 8, 8), normalMap: this._mobile ? null : rep(cc.normalMap, 8, 8), normalScale: cc.normalScale,
      })
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this._addSolid(H * 2, 1, H * 2, 0, -0.5, 0);
    this.walkables.push(floor);

    // Faixa de alerta amarela no centro (equivalente à placa de mármore central
    // da mansão) — decorativa, não-colorável.
    this._deco(new THREE.PlaneGeometry(11, 11), FACTORY.amareloSeguranca, 0, 0.011, 0,
      { rx: -Math.PI / 2, colorable: false, roughness: 1 });

    // Paredes de perímetro: painel metálico corrugado.
    const mt = this._mat('metal');
    const wallOpts = { roughness: mt.roughness, metalness: mt.metalness, map: mt.map, normalMap: mt.normalMap, normalScale: mt.normalScale };
    const wallRep = (len) => ({ x: Math.max(1, len / 3), y: Math.max(1, F_WALL_H / 3) });
    this._addBox(H * 2, F_WALL_H, t, FACTORY.cinzaMetal, 0, F_WALL_H / 2, -H, { ...wallOpts, mapRepeat: wallRep(H * 2) });
    this._addBox(H * 2, F_WALL_H, t, FACTORY.cinzaMetal, 0, F_WALL_H / 2, H, { ...wallOpts, mapRepeat: wallRep(H * 2) });
    this._addBox(t, F_WALL_H, H * 2, FACTORY.cinzaMetal, -H, F_WALL_H / 2, 0, { ...wallOpts, mapRepeat: wallRep(H * 2) });
    this._addBox(t, F_WALL_H, H * 2, FACTORY.cinzaMetal, H, F_WALL_H / 2, 0, { ...wallOpts, mapRepeat: wallRep(H * 2) });

    // Teto: chapa metálica lisa virada pra baixo, sem colisão (mesmo padrão de
    // _addCeiling, mas na altura própria da fábrica — _addCeiling usa WALL_H
    // da mansão direto, não dá pra reaproveitar sem gerar altura errada aqui).
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2, H * 2),
      new THREE.MeshToonMaterial({ color: 0x8890a0, gradientMap: toonGradient(), side: THREE.FrontSide })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = F_WALL_H;
    ceil.receiveShadow = true;
    this.scene.add(ceil);

    // 4 cômodos de canto — mesma topologia passável da ala de quartos (corredor
    // aberto no meio, 2 portas por cômodo, nunca beco sem saída).
    const rDep = this._buildFactoryRoom(-8, -8, 7, 7, FACTORY.ferrugem, ['s', 'e']);       // Depósito de Caixas
    const rLin = this._buildFactoryRoom(8, -8, 7, 7, FACTORY.azulIndustrial, ['s', 'w']);  // Linha de Montagem
    const rTin = this._buildFactoryRoom(-8, 8, 7, 7, FACTORY.tintaTeal, ['n', 'e']);       // Sala de Tintas
    const rVes = this._buildFactoryRoom(8, 8, 7, 7, FACTORY.vermelhoAlerta, ['n', 'w']);   // Vestiário

    // Tanques de tinta: caixas grandes grudáveis/coloráveis (ótimos alvos de
    // camuflagem) no piso aberto central, fora das linhas retas entre as portas.
    this._addBox(2.4, 3.2, 2.4, FACTORY.tintaRoxa, -3, 1.6, -3, { roughness: 0.4, metalness: 0.1 });
    this._addBox(2.4, 3.2, 2.4, FACTORY.verdeToxico, 3, 1.6, 3, { roughness: 0.4, metalness: 0.1 });

    // Caixotes empilhados (cobertura de baixo porte, seekerPass como a mobília
    // da mansão — o Caçador não tem pathfinding e entalava em vãos estreitos).
    const crate = (x, z, color) => this._addBox(1.0, 1.0, 1.0, color, x, 0.5, z, { roughness: 0.75, seekerPass: true });
    crate(4.5, -4.5, FACTORY.ferrugem);
    crate(-4.5, 4.5, FACTORY.ferrugem);
    crate(5.5, -3.2, FACTORY.amareloSeguranca);
    crate(-5.5, 3.2, FACTORY.amareloSeguranca);

    // Passarela elevada: um ANEL só (sem "poços" — como fica FORA do miolo dos
    // cômodos, o vão central já é aberto por baixo, não precisa recortar
    // buraco nenhum, diferente do mezanino cheio da mansão). Duas restrições
    // reais descobertas testando com simulação de verdade (não só olhando o
    // desenho): (1) a borda EXTERNA precisa encostar na parede do perímetro —
    // sem isso sobra um vão sem piso NEM corrimão entre a passarela e a
    // parede, e o jogador cai reto até o térreo ao atravessar; (2) a borda
    // INTERNA precisa ficar ALÉM da extensão dos 4 cômodos de canto (que vão
    // até |coord|=11.5 = 8+7/2) — com uma borda mais apertada, o anel da
    // passarela ATRAVESSA as paredes dos cômodos (mesma altura, Y se sobrepõe).
    const CW = H - t / 2, CIN = 11.8; // borda externa (encosta na parede) / interna (livre dos cômodos)
    const CWID = CW - CIN;
    const catSlab = (w, d, cx, cz) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.3, d),
        this._makeMat({ color: FACTORY.cinzaMetal, roughness: 0.5, metalness: 0.4 })
      );
      mesh.position.set(cx, F_CAT_Y - 0.15, cz);
      mesh.receiveShadow = true; mesh.castShadow = false;
      this.scene.add(mesh);
      this._addSolid(w, 0.3, d, cx, F_CAT_Y - 0.15, cz);
      this.walkables.push(mesh); this._slabs.push(mesh);
    };
    catSlab(H * 2 - 1, CWID, 0, -(CW - CWID / 2)); // norte
    catSlab(H * 2 - 1, CWID, 0, CW - CWID / 2);    // sul
    catSlab(CWID, H * 2 - 1, -(CW - CWID / 2), 0); // oeste
    catSlab(CWID, H * 2 - 1, CW - CWID / 2, 0);    // leste

    // Guarda-corpo na borda INTERNA da passarela (evita cair no vão central) —
    // com vão livre em x∈[-2,2] nos lados N/S, onde as escadas atravessam (sem
    // isso o próprio corrimão bloquearia quem está subindo, ver mansão:
    // "boca do lance segue aberta").
    const railSeg = (x1, z1, x2, z2) => {
      const w = Math.max(0.08, Math.abs(x2 - x1)), d = Math.max(0.08, Math.abs(z2 - z1));
      this._addBox(w, 0.9, d, FACTORY.amareloSeguranca, (x1 + x2) / 2, F_CAT_Y + 0.45, (z1 + z2) / 2,
        { climbable: false, colorable: false, roughness: 0.5, metalness: 0.3 });
    };
    const GAP = 2.0; // metade do vão livre pra escada (largura 3 + folga)
    railSeg(-H + 0.5, -CIN, -GAP, -CIN); railSeg(GAP, -CIN, H - 0.5, -CIN); // norte, com vão
    railSeg(-H + 0.5, CIN, -GAP, CIN); railSeg(GAP, CIN, H - 0.5, CIN);     // sul, com vão
    railSeg(-CIN, -H + 0.5, -CIN, H - 0.5); // oeste, inteiro (sem escada)
    railSeg(CIN, -H + 0.5, CIN, H - 0.5);   // leste, inteiro (sem escada)

    // 2 escadas (N e S) do térreo até a passarela. CRÍTICO subir só até z=±CIN
    // (a borda INTERNA da passarela), não além — a laje é um sólido de 0.3 m
    // e sua face frontal agiria como parede se a escada continuasse por baixo
    // dela (mesma pegadinha já documentada pra escada da mansão, ver
    // _buildMezzanine: "CRÍTICO subir só até z=IN, não além"). 16 degraus pra
    // 4.4 m de subida ≈ 0.28 m/degrau — abaixo do STEP_UP=0.30 do jogador.
    this._addStairFlight(0, 3, 6, CIN, 0, F_CAT_Y, 16);
    this._addStairFlight(0, 3, -6, -CIN, 0, F_CAT_Y, 16);

    // Spawn no meio do piso aberto, longe de todo cômodo.
    this.spawn.set(0, 0, -2);

    // Rotas: térreo passa pelas 4 portas sem entrar fundo em nenhum cômodo
    // (mesmo raciocínio de custo-benefício da ala de quartos — espiar da porta
    // já cobre a maior parte do cômodo bem mais barato que entrar); passarela
    // é o anel elevado.
    const ground = [
      wp(0, -2), wp(-4.5, -6), wp(-8, -4.5), wp(0, -2), wp(4.5, -6), wp(8, -4.5),
      wp(0, 0), wp(-4.5, 6), wp(-8, 4.5), wp(0, 2), wp(4.5, 6), wp(8, 4.5), wp(0, -2),
    ];
    const catwalk = [
      wp(0, -CW), wp(CW, -CW), wp(CW, 0), wp(CW, CW),
      wp(0, CW), wp(-CW, CW), wp(-CW, 0), wp(-CW, -CW),
    ];
    this.routes = [ground, catwalk, ground.slice().reverse()];
    this.routeY = [EYE_Y, F_CAT_Y + EYE_Y, EYE_Y];

    this._collectDoors(rDep, rLin, rTin, rVes);

    // Materializa oclusores/colisores de câmera — mesmo passo final de _build(),
    // repetido aqui porque este layout não passa por ele.
    this.occluders = this.climbables.concat(this._slabs);
    this.cameraColliders = this.climbables.concat(this._slabs);
  }

  // Cômodo de fábrica: MESMA topologia passável de _buildRoom (paredes com vão
  // largo, nunca beco sem saída — o Caçador não tem pathfinding), mas com
  // painel metálico em vez de boiserie. _buildRoom é compartilhado pelas 3
  // alas da mansão — não convém mudar a textura dele pra isto.
  _buildFactoryRoom(cx, cz, w, d, color, doors, { door = DOOR_MIN, h = F_ROOM_H } = {}) {
    const hw = w / 2, hd = d / 2, t = 0.5;
    const mt = this._mat('metal');
    const opts = { roughness: mt.roughness, metalness: mt.metalness, map: mt.map, normalMap: mt.normalMap, normalScale: mt.normalScale };
    const rep2 = (len) => ({ x: Math.max(1, len / 3), y: Math.max(1, h / 3) });

    const wallAlongX = (zPos, hasDoor) => {
      if (!hasDoor) { this._addBox(w, h, t, color, cx, h / 2, zPos, { ...opts, mapRepeat: rep2(w) }); return; }
      const seg = (w - door) / 2;
      if (seg <= 0.2) return;
      this._addBox(seg, h, t, color, cx - (door / 2 + seg / 2), h / 2, zPos, { ...opts, mapRepeat: rep2(seg) });
      this._addBox(seg, h, t, color, cx + (door / 2 + seg / 2), h / 2, zPos, { ...opts, mapRepeat: rep2(seg) });
    };
    const wallAlongZ = (xPos, hasDoor) => {
      if (!hasDoor) { this._addBox(t, h, d, color, xPos, h / 2, cz, { ...opts, mapRepeat: rep2(d) }); return; }
      const seg = (d - door) / 2;
      if (seg <= 0.2) return;
      this._addBox(t, h, seg, color, xPos, h / 2, cz - (door / 2 + seg / 2), { ...opts, mapRepeat: rep2(seg) });
      this._addBox(t, h, seg, color, xPos, h / 2, cz + (door / 2 + seg / 2), { ...opts, mapRepeat: rep2(seg) });
    };

    wallAlongX(cz - hd, doors.includes('n'));
    wallAlongX(cz + hd, doors.includes('s'));
    wallAlongZ(cx - hw, doors.includes('w'));
    wallAlongZ(cx + hw, doors.includes('e'));

    const doorPts = [];
    if (doors.includes('n')) doorPts.push({ x: cx, z: cz - hd });
    if (doors.includes('s')) doorPts.push({ x: cx, z: cz + hd });
    if (doors.includes('w')) doorPts.push({ x: cx - hw, z: cz });
    if (doors.includes('e')) doorPts.push({ x: cx + hw, z: cz });
    return { center: { x: cx, z: cz }, doors: doorPts, w, d };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAPA 3 — CHAMELEON MANOR. Fase 0 (Plano 5): só o CASCO — 4 níveis vazios
  // (piso/parede/teto), 3 escadas de transição, rotas-placeholder em
  // retângulo por domínio (substituídas por rotas reais tecendo pelas zonas
  // nas Fases 3-6). Objetivo desta fase: casco navegável e fisicamente são,
  // testável isoladamente antes de qualquer conteúdo de zona.
  // ═══════════════════════════════════════════════════════════════════════
  _buildChameleonManor() {
    const HX = CM_HALF_X, HZ = CM_HALF_Z, t = CM_T;
    // Material de casco provisório (boiserie da família mansão) — cada zona
    // troca pelo material temático certo nas Fases 3-6; aqui só valida forma.
    const wd = this._mat('boiserie');
    const wallOpts = { roughness: wd.roughness, metalness: wd.metalness, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale };
    const wallRep = (len, h) => ({ x: Math.max(1, len / 3), y: Math.max(1, h / 3) });

    const perimeter = (yFloor, h) => {
      const cy = yFloor + h / 2;
      this._addBox(HX * 2, h, t, MANSION.marmore, 0, cy, -HZ, { ...wallOpts, mapRepeat: wallRep(HX * 2, h) });
      this._addBox(HX * 2, h, t, MANSION.marmore, 0, cy, HZ, { ...wallOpts, mapRepeat: wallRep(HX * 2, h) });
      this._addBox(t, h, HZ * 2, MANSION.marmore, -HX, cy, 0, { ...wallOpts, mapRepeat: wallRep(HZ * 2, h) });
      this._addBox(t, h, HZ * 2, MANSION.marmore, HX, cy, 0, { ...wallOpts, mapRepeat: wallRep(HZ * 2, h) });
    };
    perimeter(CM_BASEMENT_Y, CM_GROUND_Y - CM_BASEMENT_Y); // porão
    perimeter(CM_GROUND_Y, CM_FLOOR1_Y - CM_GROUND_Y);     // térreo
    perimeter(CM_FLOOR1_Y, CM_ATTIC_Y - CM_FLOOR1_Y);      // 1º andar
    perimeter(CM_ATTIC_Y, CM_ROOF_Y - CM_ATTIC_Y);         // ático

    // Piso do porão: nível mais baixo, nada abaixo dele — só walkable, não
    // entra em _slabs (mesmo padrão do piso térreo da Fábrica).
    const cc = this._mat('concrete', { normals: !this._mobile });
    const basementFloor = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 2, 1, HZ * 2),
      this._makeMat({ color: 0xffffff, roughness: cc.roughness, metalness: cc.metalness, map: rep(cc.map, 10, 7) })
    );
    basementFloor.position.set(0, CM_BASEMENT_Y - 0.5, 0);
    basementFloor.receiveShadow = true;
    this.scene.add(basementFloor);
    this._addSolid(HX * 2, 1, HZ * 2, 0, CM_BASEMENT_Y - 0.5, 0);
    this.walkables.push(basementFloor);

    // Lajes térreo/1º andar/ático: cada uma é piso do nível de cima E teto do
    // de baixo — bloqueiam visão vertical entre domínios. _addSlab já cuida
    // de walkables+solids+_slabs (mesmo padrão de FLOOR2_Y/MEZZ3_Y da mansão).
    //
    // CRÍTICO (landmine já documentada na skill, cometida de novo aqui na
    // 1ª tentativa e pega só por simulação, não por inspeção): uma laje CHEIA
    // sem vão nenhum vira TETO SÓLIDO bem em cima de quem sobe a escada — a
    // pessoa fica presa embaixo dela pra sempre. Cada laje precisa de um vão
    // retangular exatamente onde a escada daquele nível a atravessa, do mesmo
    // jeito que o mezanino da mansão deixa "2 poços sobre as escadarias".
    // `slabWithGaps` decompõe a laje em faixas de Z ao redor de N vãos (cada
    // vão vira até 3 peças na sua própria faixa — oeste/leste do vão, ou a
    // faixa inteira se o vão cobre toda a largura — e as faixas SEM vão
    // ficam como 1 peça só). Generalização de "1 vão só" (usada por
    // porão/térreo/1º andar) pra "2 vãos" (Fase 6: ático precisa do vão da
    // escada E do vão da claraboia sobre o Ballroom, na MESMA laje) — os
    // vãos não podem se sobrepor em Z (não é o caso aqui: a escada fica em
    // z≈24, a claraboia em z≈-8).
    const slabWithGaps = (topY, gaps) => {
      const sorted = [...gaps].sort((a, b) => (a.gz - a.gd / 2) - (b.gz - b.gd / 2));
      let zCur = -HZ;
      for (const g of sorted) {
        const gx0 = g.gx - g.gw / 2, gx1 = g.gx + g.gw / 2;
        const gz0 = g.gz - g.gd / 2, gz1 = g.gz + g.gd / 2;
        if (gz0 > zCur) this._addSlab(HX * 2, gz0 - zCur, 0, (zCur + gz0) / 2, topY); // faixa cheia antes do vão
        if (gx0 > -HX) this._addSlab(gx0 + HX, g.gd, (-HX + gx0) / 2, g.gz, topY);    // oeste do vão
        if (gx1 < HX) this._addSlab(HX - gx1, g.gd, (gx1 + HX) / 2, g.gz, topY);      // leste do vão
        zCur = gz1;
      }
      if (zCur < HZ) this._addSlab(HX * 2, HZ - zCur, 0, (zCur + HZ) / 2, topY); // faixa cheia depois do último vão
    };
    // Posição/extensão de cada escada (ver flights abaixo) — o vão de cada
    // laje usa os MESMOS números. Largura 3 → vão 6 (folga lateral segura, o
    // trajeto não anda em X). Comprimento do vão = EXATAMENTE o lance +0,8m
    // (0,4 de cada lado) — NÃO +4: uma margem generosa aqui foi tentada
    // primeiro e é o bug oposto do landmine já documentado ("escada além da
    // borda da laje"). Achado por simulação real (não por inspeção): com
    // margem de 2m no lado de CHEGADA, o jogador termina de subir os degraus,
    // dá mais um passo pra além do último degrau e CAI — porque o vão
    // continua aberto (sem laje) por 2m depois de onde a escada realmente
    // acaba, e não há nada ali pra pisar (não é degrau, não é laje). A laje
    // precisa voltar a ser sólida quase imediatamente após o último degrau.
    const st1 = { cx: -40, z0: -30, z1: -22 }; // porão ↔ térreo
    const st2 = { cx: 40, z0: -30, z1: -20 };  // térreo ↔ 1º andar
    const st3 = { cx: 0, z0: 20, z1: 28 };     // 1º andar ↔ ático
    // Claraboia (Fase 6, Plano 5): vão adicional em x=0,z=-8 — bem acima do
    // centro do Ballroom (térreo) — nas lajes de CM_FLOOR1_Y E CM_ATTIC_Y (as
    // DUAS lajes entre o ático e o Ballroom), formando um poço vertical de
    // verdade. Cai também na laje do 1º andar de propósito: "buraco
    // proposital" da spec — quem andar sobre ele em QUALQUER um dos 2
    // andares cai até o Ballroom, não só no ático.
    const skylight = { gx: 0, gz: -8, gw: 6, gd: 6 };
    const st1Gap = { gx: st1.cx, gz: (st1.z0 + st1.z1) / 2, gw: 6, gd: Math.abs(st1.z1 - st1.z0) + 0.8 };
    const st2Gap = { gx: st2.cx, gz: (st2.z0 + st2.z1) / 2, gw: 6, gd: Math.abs(st2.z1 - st2.z0) + 0.8 };
    const st3Gap = { gx: st3.cx, gz: (st3.z0 + st3.z1) / 2, gw: 6, gd: Math.abs(st3.z1 - st3.z0) + 0.8 };
    slabWithGaps(CM_GROUND_Y, [st1Gap]);
    slabWithGaps(CM_FLOOR1_Y, [st2Gap, skylight]);
    slabWithGaps(CM_ATTIC_Y, [st3Gap, skylight]);

    // Teto do ático: só visual, sem colisão (mesmo padrão da Fábrica).
    const roof = new THREE.Mesh(
      new THREE.PlaneGeometry(HX * 2, HZ * 2),
      new THREE.MeshToonMaterial({ color: 0x8890a0, gradientMap: toonGradient(), side: THREE.FrontSide })
    );
    roof.rotation.x = Math.PI / 2;
    roof.position.y = CM_ROOF_Y;
    roof.receiveShadow = true;
    this.scene.add(roof);

    // 3 escadas de transição, espaçadas pra não se cruzarem em XZ — posições
    // provisórias desta fase; Fases 3/4a/5/6 as encaixam nas zonas reais.
    this._addStairFlight(st1.cx, 3, st1.z0, st1.z1, CM_BASEMENT_Y, CM_GROUND_Y, 12); // porão ↔ térreo
    this._addStairFlight(st2.cx, 3, st2.z0, st2.z1, CM_GROUND_Y, CM_FLOOR1_Y, 16);   // térreo ↔ 1º andar
    this._addStairFlight(st3.cx, 3, st3.z0, st3.z1, CM_FLOOR1_Y, CM_ATTIC_Y, 14);    // 1º andar ↔ ático

    // Spawn: centro do térreo, longe das escadas.
    this.spawn.set(0, 0, 0);

    // Rotas-placeholder: 1 loop retangular por domínio, com folga das
    // paredes — substituídas por rotas reais tecendo pelas zonas nas Fases
    // 3-6. Y de cada ponto fica em ROUTE_Y (mesma convenção de wp() em toda
    // a mansão/fábrica) — a altura REAL de cada domínio vem de `routeY`
    // abaixo + correção ao vivo por _groundY, não do Y guardado no ponto.
    const inX = HX - 10, inZ = HZ - 10;
    const rectRoute = () => [wp(-inX, -inZ), wp(inX, -inZ), wp(inX, inZ), wp(-inX, inZ)];
    this.routes = [rectRoute(), rectRoute(), rectRoute(), rectRoute()]; // porão, térreo, 1º andar, ático
    this.routeY = [CM_BASEMENT_Y + EYE_Y, CM_GROUND_Y + EYE_Y, CM_FLOOR1_Y + EYE_Y, CM_ATTIC_Y + EYE_Y];

    // Fase 3 do Plano 5: Porão real (Cozinha Industrial, Adega, Área de
    // Serviço) — substitui o placeholder retangular de routes[0] por uma
    // rota tecendo pelas salas de verdade.
    this.routes[0] = this._buildPorao(st1);

    // Fase 4a do Plano 5: Térreo (parcial) — Ballroom + Hall de Entrada.
    // Só 2 das 6 zonas do térreo nesta fase — routes[1] cobre só essas 2 por
    // enquanto, mesmo espírito iterativo do porão (placeholder → real).
    this._buildBallroomHall();

    // Fase 4b do Plano 5: Térreo (resto) — Galeria de Arte Leste, Biblioteca
    // Oeste, Corredor Central, Banheiro de Visitas. Substitui de novo
    // routes[1] (agora as 6 zonas do térreo, laço fechado sem beco sem
    // saída).
    this.routes[1] = this._buildTerreoResto();

    // Fase 5 do Plano 5: 1º Andar (Quarto Principal, Quarto de Hóspedes,
    // Storage, Banheiro de Luxo) + passagem secreta 9.2 (Hóspedes ↔ Storage).
    // Substitui o placeholder retangular de routes[2].
    this._secretPassages = [];
    this.routes[2] = this._build1oAndar();

    // Fase 6 do Plano 5: Ático (Sótão + Telhado) + claraboia sobre o
    // Ballroom (poço vertical já aberto nas lajes acima, via
    // slabWithGaps). Substitui o placeholder retangular de routes[3].
    this.routes[3] = this._buildAtico();

    // Fase 7 do Plano 5: iluminação por zona — ver comentário de arquitetura
    // no início de _buildZoneLighting() pra por que isto NÃO é a leitura
    // literal da especificação (PointLight/SpotLight coloridas por zona).
    this._buildZoneLighting();

    // Modo Caçador jogável: alvos nascem nos 4 domínios desde o início (não
    // só térreo+andar-de-cima como mansão/fábrica) — ver Game._spawnHunterTargets.
    this.huntTargetRouteIndices = [0, 1, 2, 3];

    // Materializa oclusores/colisores de câmera — mesmo passo final de
    // _build()/_buildFactoryLevel(), repetido aqui porque este layout não
    // passa por nenhum dos dois.
    this.occluders = this.climbables.concat(this._slabs);
    this.cameraColliders = this.climbables.concat(this._slabs);
  }

  // Sala genérica da mansão-casco (adaptada de _buildFactoryRoom: mesmas
  // closures de porta partida em 2 segmentos, mesma convenção n=cz-hd/
  // s=cz+hd/w=cx-hw/e=cx+hw) — parametrizada por nome de material (Chameleon
  // Manor reaproveita materiais existentes de textures.js por zona temática,
  // não uma paleta de textura própria) e `baseY` (piso do domínio vertical:
  // porão/térreo/1º andar têm Y de piso diferentes, ao contrário da mansão/
  // fábrica que só operam em y=0).
  // `skip` (Fase 5): paredes ausentes daqui — nem cheias nem com vão de
  // porta normal — porque outro método monta essa parede à parte (ex.:
  // _buildSecretPassage9_2, que precisa da própria divisão em segmentos pra
  // encaixar o painel móvel; se _buildManorRoom também desenhasse essa
  // parede, ela ficaria SEMPRE sólida por baixo do painel, e a passagem
  // nunca abriria de verdade).
  _buildManorRoom(cx, cz, w, d, color, doors, { matName = 'boiserie', door = DOOR_MIN, baseY = 0, h = CM_GROUND_Y - CM_BASEMENT_Y, skip = [] } = {}) {
    const hw = w / 2, hd = d / 2, t = CM_T;
    const mt = this._mat(matName);
    const opts = { roughness: mt.roughness, metalness: mt.metalness, map: mt.map, normalMap: mt.normalMap, normalScale: mt.normalScale };
    const rep2 = (len) => ({ x: Math.max(1, len / 3), y: Math.max(1, h / 3) });
    const cy = baseY + h / 2;

    const wallAlongX = (zPos, hasDoor) => {
      if (!hasDoor) { this._addBox(w, h, t, color, cx, cy, zPos, { ...opts, mapRepeat: rep2(w) }); return; }
      const seg = (w - door) / 2;
      if (seg <= 0.2) return;
      this._addBox(seg, h, t, color, cx - (door / 2 + seg / 2), cy, zPos, { ...opts, mapRepeat: rep2(seg) });
      this._addBox(seg, h, t, color, cx + (door / 2 + seg / 2), cy, zPos, { ...opts, mapRepeat: rep2(seg) });
    };
    const wallAlongZ = (xPos, hasDoor) => {
      if (!hasDoor) { this._addBox(t, h, d, color, xPos, cy, cz, { ...opts, mapRepeat: rep2(d) }); return; }
      const seg = (d - door) / 2;
      if (seg <= 0.2) return;
      this._addBox(t, h, seg, color, xPos, cy, cz - (door / 2 + seg / 2), { ...opts, mapRepeat: rep2(seg) });
      this._addBox(t, h, seg, color, xPos, cy, cz + (door / 2 + seg / 2), { ...opts, mapRepeat: rep2(seg) });
    };

    if (!skip.includes('n')) wallAlongX(cz - hd, doors.includes('n'));
    if (!skip.includes('s')) wallAlongX(cz + hd, doors.includes('s'));
    if (!skip.includes('w')) wallAlongZ(cx - hw, doors.includes('w'));
    if (!skip.includes('e')) wallAlongZ(cx + hw, doors.includes('e'));

    const doorPts = [];
    if (doors.includes('n')) doorPts.push({ x: cx, z: cz - hd });
    if (doors.includes('s')) doorPts.push({ x: cx, z: cz + hd });
    if (doors.includes('w')) doorPts.push({ x: cx - hw, z: cz });
    if (doors.includes('e')) doorPts.push({ x: cx + hw, z: cz });
    return { center: { x: cx, z: cz }, doors: doorPts, w, d };
  }

  // Fase 3 do Plano 5 — Porão real: Cozinha Industrial, Adega e Área de
  // Serviço, ligadas num laço sem beco sem saída (hub das escadas `st1` →
  // Cozinha → Adega → Área de Serviço → de volta ao hub pelo chão aberto do
  // porão) — regra de topologia da skill de level design (Seeker/
  // ChameleonTarget não têm pathfinding, só bigodes reativos + rota em loop).
  // Hero spots da especificação localizados aqui: S5 (3 caixas de papelão,
  // canto sul da Cozinha) e A4 (fileira de barris, lado leste da Adega).
  _buildPorao(st1) {
    const baseY = CM_BASEMENT_Y, h = CM_GROUND_Y - CM_BASEMENT_Y;

    this._buildManorRoom(-40, 0, 16, 16, CHAMELEON.azulejoAzul, ['n', 'e'], { matName: 'metal', baseY, h });     // Cozinha Industrial
    this._buildManorRoom(-10, 0, 16, 16, CHAMELEON.concreto, ['w', 's'], { matName: 'concrete', baseY, h });     // Adega
    this._buildManorRoom(-10, 25, 14, 12, CHAMELEON.concreto, ['n', 'w'], { matName: 'concrete', baseY, h });    // Área de Serviço

    // Hero spot S5: 3 caixas de papelão no canto sul da Cozinha — mesmo
    // padrão de caixa-esconderijo já provado na Fábrica (_addBox pequena,
    // seekerPass:true: sólida pro jogador, mas o Seeker desliza por cima do
    // desvio em vez de travar contra ela).
    const crate = (x, z, s) => this._addBox(s, s, s, CHAMELEON.carvalho, x, baseY + s / 2, z, { roughness: 0.85, seekerPass: true });
    crate(-36, 5, 1.0);
    crate(-34.7, 5.3, 0.9);
    crate(-35.5, 6.2, 0.85);

    // Hero spot A4: fileira de barris no lado leste da Adega — cilindro
    // visual + solid/climbable adicionados manualmente (mesmo tratamento que
    // _addBox dá de graça, mas _addCylinder não: ver Level.js:376-388, essa
    // função só empurra pra `colorables`, nunca pra `climbables`/`solids`).
    const barrel = (x, z) => {
      const mesh = this._addCylinder(0.5, 1.3, CHAMELEON.madeiraEscura, x, z, { y: baseY + 0.65 });
      mesh.userData.climbable = true;
      this.climbables.push(mesh);
      this._addSolid(1.0, 1.3, 1.0, x, baseY + 0.65, z, { seekerPass: true });
    };
    barrel(-3.5, -4);
    barrel(-3.5, -1);
    barrel(-3.5, 2);
    barrel(-3.5, 5);

    // Rota tecendo pelas 3 salas, de volta ao hub das escadas — substitui o
    // placeholder retangular de routes[0] em _buildChameleonManor().
    return [
      wp(st1.cx, st1.z1 + 4),               // hub das escadas (fora do vão físico dos degraus)
      wp(-40, -8),                          // porta norte da Cozinha
      wp(-40, 0),                           // centro da Cozinha
      wp(-32, 0),                           // porta leste da Cozinha
      wp(-18, 0),                           // porta oeste da Adega
      wp(-10, 0),                           // centro da Adega
      wp(-10, 8),                           // porta sul da Adega
      wp(-10, 19),                          // porta norte da Área de Serviço
      wp(-10, 25),                          // centro da Área de Serviço
      wp(-17, 25),                          // porta oeste da Área de Serviço
      wp(-30, 20),                          // corredor aberto de volta ao hub
      // Fase 8 (achado por simulação de 10min, não pelo sweep raso de 20-25
      // amostras/segmento das fases anteriores — ver nota em docs/_log.md):
      // o segmento direto (-30,20)→hub cortava a parede sul da Cozinha
      // (x∈[-48,-32], z=8) numa janela de t estreita (~0,016 em 20 amostras
      // ninguém caía dentro) — o Caçador ficava preso deslizando ao longo
      // dela por minutos. `wp(-30,-18)` mantém x=-30 (a leste da Cozinha,
      // que só vai até x=-32) até já estar ao norte da parede (z=-8..8) antes
      // de virar pro hub.
      wp(-30, -18),
    ];
  }

  // Fase 4a do Plano 5 — Térreo (parcial): Ballroom + Hall de Entrada. Só 2
  // das 6 zonas do térreo nesta fase — routes[1] cobre só essas 2 por
  // enquanto (sem beco sem saída), e a Fase 4b substitui de novo por uma
  // rota estendida quando Galeria/Biblioteca/Corredor/Banheiro existirem.
  // Ao contrário do porão, o térreo já tem baseY=CM_GROUND_Y=0 — mesma
  // convenção da mansão/fábrica — então os helpers existentes
  // (_buildPillar/_buildChandelier/_buildRug/_buildPedestalPiece) funcionam
  // direto, sem parâmetro de altura extra.
  _buildBallroomHall() {
    const ballH = CM_FLOOR1_Y - CM_GROUND_Y; // pé-direito do térreo (4.5m)

    this._buildManorRoom(0, -8, 36, 24, CHAMELEON.marmore, ['s', 'w', 'e'], { matName: 'marble', h: ballH }); // Ballroom
    this._buildManorRoom(0, 18, 20, 16, CHAMELEON.carvalho, ['n', 's'], { matName: 'wood', h: ballH });       // Hall de Entrada

    // Lustre central, sobre o vão livre do salão (não sobre o pilar central
    // — ver abaixo — pra não sobrepor as duas malhas no mesmo eixo vertical).
    this._buildChandelier(0, -8, ballH - 1.4);

    // 5 pilares de moldura em anel (grandiosidade) + 1 pilar central — hero
    // spot S3 ("lado interno do pilar central", Seeker gira ao redor):
    // deslocado do centro geométrico do salão pra não colidir com o lustre,
    // e é ao REDOR dele (não do centro vazio) que o loop de patrulha (mais
    // abaixo) circula — aproximação do "gira 360°" da especificação sem
    // inventar um estado novo de IA (Seeker não tem "girar no lugar").
    const ringR = 10, ringCx = 0, ringCz = -8;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this._buildPillar(ringCx + Math.cos(a) * ringR, ringCz + Math.sin(a) * ringR, ballH - 0.3);
    }
    const pillarX = 0, pillarZ = -13; // hero S3
    this._buildPillar(pillarX, pillarZ, ballH - 0.3);

    // Hero spot A1 ("Cortina do Ballroom... atrás de cortina leste"): painel
    // grudável/colorável (não _deco — precisa ocluir de verdade pra "atrás
    // da cortina" funcionar), afastado 0.6m da parede leste pra sobrar vão
    // pro jogador se encaixar atrás. z=-2 (não z do pilar/porta leste, cz=-8
    // — evita sentar bem na frente do vão que a Fase 4b vai ligar à Galeria).
    this._addBox(1.6, 3.5, 0.3, CHAMELEON.vermelho, 17.4, 1.75, -2, { roughness: 0.9 });

    // Hero spot B1 ("Sob a mesa de centro"): mesa decorativa (_deco, sem
    // colisão — mesmo tratamento do tapete persa da mansão, "esconderijo"
    // por cor/pose, não por enclausuramento físico real).
    this._deco(new THREE.CylinderGeometry(1.2, 1.2, 0.06, 20), CHAMELEON.marmore, 0, 0.7, -3, { cast: true });
    for (const [lx, lz] of [[-1.0, -3.9], [1.0, -3.9], [-1.0, -2.1], [1.0, -2.1]])
      this._deco(new THREE.BoxGeometry(0.06, 0.7, 0.06), CHAMELEON.carvalho, lx, 0.35, lz, { colorable: false });

    // Hero spot A3 ("Tapete do Hall... centro do tapete vermelho, Deitado").
    this._buildRug(0, 18, 6, 10, 0.02, CHAMELEON.vermelho);

    // Hero spot B6 ("Estatueta do Hall... base da estatueta abstrata").
    this._buildPedestalPiece(6, 14, 0);

    // Rota: laço apertado (raio ~2m) ao redor do pilar central (hero S3,
    // aproximação do "gira 360°" do salão) → porta sul do Ballroom → centro
    // do Hall (perto do tapete/estatueta) → fecha o laço de volta ao início
    // (segmento reto atravessa as duas portas alinhadas em x=0, verificado
    // por simulação headless).
    const pr = 2;
    const hex = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push(wp(pillarX + Math.cos(a) * pr, pillarZ + Math.sin(a) * pr));
    }
    return [
      ...hex,
      wp(0, 4),   // porta sul do Ballroom
      wp(0, 18),  // centro do Hall
    ];
  }

  // Fase 4b do Plano 5 — Térreo (resto): Galeria de Arte Leste, Biblioteca
  // Oeste, Corredor Central, Banheiro de Visitas. Primeiro consumidor REAL da
  // amostragem por pixel da Fase 1 (painel de lombadas, listras, azulejo
  // hexagonal) — até aqui só existia como plumbing testado isoladamente.
  // Galeria/Biblioteca são "becos" de 1 porta só a partir do Ballroom — não é
  // o beco-sem-saída que a regra de topologia proíbe (aquela é sobre o
  // Seeker/ChameleonTarget travarem fisicamente numa quina; entrar e sair
  // pela MESMA porta é patrulha normal, não travamento).
  _buildTerreoResto() {
    const ballH = CM_FLOOR1_Y - CM_GROUND_Y; // mesmo pé-direito do térreo (4.5m)

    // Galeria de Arte Leste — porta oeste alinhada com a porta leste do
    // Ballroom (x=18), 2m de vão aberto entre as duas.
    this._buildManorRoom(37, -8, 34, 20, CHAMELEON.salvia, ['w'], { matName: 'drywall', h: ballH });
    // 24 quadros: 9 na parede norte, 9 na sul, 6 na leste (a oeste tem porta).
    for (let i = 0; i < 9; i++) {
      const x = 22 + i * 3.75;
      this._buildPainting(x, 1.7, -17.7, { x: 0, z: 1 }, 1.0, 1.3);
      this._buildPainting(x, 1.7, 1.7, { x: 0, z: -1 }, 1.0, 1.3);
    }
    for (let i = 0; i < 6; i++) {
      const z = -16 + i * 3.2;
      this._buildPainting(53.7, 1.7, z, { x: -1, z: 0 }, 1.0, 1.3);
    }
    // Hero A6 ("Vaso da Galeria... ao lado do vaso grande, parede sul").
    this._buildPlant(30, 1.2, 0);
    this._buildPlant(48, -16.5, 0);

    // Biblioteca Oeste — porta leste alinhada com a porta oeste do Ballroom
    // (x=-18), 2m de vão aberto.
    this._buildManorRoom(-37, -8, 34, 20, CHAMELEON.carvalho, ['e'], { matName: 'wood', h: ballH });
    // 3 estantes comuns (colorable:false, padrão já existente na mansão) +
    // 1 hero S1 (painel pixelColorable dedicado, ver abaixo).
    // z=1 (não 2, a própria parede) — mesmo recuo de ~1m usado nos outros
    // usos de _buildBookshelf na mansão (a caixa fica à FRENTE da parede,
    // não embutida nela).
    this._buildBookshelf(-50, 1, { x: 0, z: -1 });
    this._buildBookshelf(-38, 1, { x: 0, z: -1 });
    this._buildBookshelf(-30, 1, { x: 0, z: -1 });
    // Hero S1 ("Lombada de Livro... entre fileiras, prateleira 3, Crouch"):
    // a MESMA estante-base (climbable, pra grudar) + um painel pixelColorable
    // extra 3cm mais à frente que o painel decorativo embutido em
    // _buildBookshelf (colorable:false) — fica na frente no raycast de
    // _surfaceBehindZone sem precisar tocar aquele helper (usado 4x na
    // mansão, sempre colorable:false; mudar lá arriscaria regressão).
    const s1x = -44, s1z = 1, s1dir = { x: 0, z: -1 };
    this._buildBookshelf(s1x, s1z, s1dir);
    {
      const bs = this._mat('bookSpines');
      const off = 0.5 / 2 + 0.05; // > os 0,02 do painel embutido — vence o raycast
      const tex = bs.map.clone(); tex.needsUpdate = true;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2 * 0.92, 2.8 * 0.82),
        new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: tex })
      );
      mesh.position.set(s1x + s1dir.x * off, 2.8 * 0.52, s1z + s1dir.z * off);
      mesh.rotation.y = this._facing(s1dir);
      mesh.receiveShadow = true;
      mesh.userData.colorable = true;
      const src = this._buildPixelSource(bs.map, null);
      if (src) { mesh.userData.pixelColorable = true; mesh.userData.pixelSource = src; }
      this.scene.add(mesh);
      this.colorables.push(mesh);
    }

    // Corredor Central — porta norte alinhada com a porta sul do Hall
    // (z=26), 2m de vão aberto; porta leste liga direto ao Banheiro.
    this._buildManorRoom(0, 32, 14, 8, CHAMELEON.carvalho, ['n', 'e'], { matName: 'wood', h: ballH });
    // Padrão de listras pixelColorable (parede sul, sem porta): painel
    // grande e proeminente — a MESMA lógica do painel do S1 acima (mesh
    // dedicado, colorable+pixelColorable, cor final já no canvas).
    this._addStripedPanel(0, 1.7, 35.65, { x: 0, z: -1 }, 10, 3);

    // Banheiro de Visitas — porta oeste alinhada com a porta leste do
    // Corredor (x=7), 1m de vão aberto.
    this._buildManorRoom(13, 32, 10, 10, CHAMELEON.marmore, ['w'], { matName: 'marble', h: ballH });
    // Padrão de azulejo hexagonal pixelColorable (parede norte, sem porta).
    this._addHexPanel(13, 1.7, 27.35, { x: 0, z: 1 }, 8, 3);

    // Rota: laço fechado tecendo pelas 6 zonas do térreo — hexágono do
    // Ballroom (gira 360°) → Biblioteca (beco, entra/sai) → Galeria (beco,
    // entra/sai) → Hall → Corredor → Banheiro (beco, entra/sai) → fecha de
    // volta ao hexágono (mesmo segmento reto já verificado por simulação na
    // Fase 4a, que atravessa as portas Ballroom/Hall alinhadas em x=0).
    const pr = 2, pillarX = 0, pillarZ = -13;
    const hex = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push(wp(pillarX + Math.cos(a) * pr, pillarZ + Math.sin(a) * pr));
    }
    return [
      ...hex,
      wp(-18, -8),  // porta oeste do Ballroom
      wp(-37, -8),  // centro da Biblioteca (passa pela porta leste dela)
      wp(-18, -8),  // volta pela mesma porta
      wp(0, -11),   // atravessa o salão desviando do pilar em anel (10,-8)
      wp(18, -8),   // porta leste do Ballroom
      wp(37, -8),   // centro da Galeria (passa pela porta oeste dela)
      wp(18, -8),   // volta pela mesma porta
      wp(14, 3),    // desvia da parede leste E do pilar em anel (3.09,1.51)
      wp(0, 3),     // alinha em x=0 antes de entrar na porta (evita raspar a quina)
      wp(0, 4),     // porta sul do Ballroom
      wp(0, 18),    // centro do Hall
      wp(0, 32),    // centro do Corredor (passa pelas portas Hall/Corredor)
      wp(13, 32),   // centro do Banheiro (passa pela porta leste/oeste)
      wp(0, 32),    // volta pela mesma porta
      wp(0, 18),    // volta ao centro do Hall
    ];
  }

  // Painel pixelColorable de listras (Corredor Central, Fase 4b) — mesh
  // dedicado (não _deco: precisa de userData.pixelSource, que só _addBox
  // monta hoje). `dir` aponta pra fora da parede, igual _buildPainting.
  _addStripedPanel(x, y, z, dir, w, h) {
    const tex = stripeTexture(CHAMELEON.listraClara, CHAMELEON.listraEscura, { stripes: 10 });
    const clone = tex.clone(); clone.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: clone })
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = this._facing(dir);
    mesh.receiveShadow = true;
    mesh.userData.colorable = true;
    const src = this._buildPixelSource(tex, null);
    if (src) { mesh.userData.pixelColorable = true; mesh.userData.pixelSource = src; }
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  // Painel pixelColorable de azulejo hexagonal (Banheiro de Visitas, Fase
  // 4b; reutilizado com cores próprias pelo hero S4 do Banheiro de Luxo,
  // Fase 5) — mesmo tratamento do painel de listras acima. `tileColor`/
  // `groutColor` default nos valores já usados na Fase 4b (call site de lá
  // continua idêntico).
  _addHexPanel(x, y, z, dir, w, h, tileColor = CHAMELEON.azulejoBanheiro, groutColor = CHAMELEON.concreto) {
    const tex = hexTileTexture(tileColor, groutColor, { hexR: 14 });
    const clone = tex.clone(); clone.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: clone })
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = this._facing(dir);
    mesh.receiveShadow = true;
    mesh.userData.colorable = true;
    const src = this._buildPixelSource(tex, null);
    if (src) { mesh.userData.pixelColorable = true; mesh.userData.pixelSource = src; }
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  // Fase 5 do Plano 5 — 1º Andar: Quarto Principal, Quarto de Hóspedes,
  // Storage, Banheiro de Luxo + passagem secreta 9.2 (Hóspedes ↔ Storage).
  // Adaptação de escopo: a passagem 9.1 da especificação (Biblioteca → Hall,
  // térreo) foi DEIXADA DE FORA — no layout real construído nas Fases 4a/4b
  // esses dois cômodos não são vizinhos (ficam em lados opostos do Ballroom),
  // então um "painel secreto" ali exigiria um túnel novo sem relação com
  // nenhuma parede existente, não uma passagem de verdade. A 9.2 (Hóspedes ↔
  // Storage) already fica dentro do MESMO andar sendo construído agora — os
  // dois cômodos são vizinhos por design, então é essa que valida o mecanismo
  // de verdade.
  _build1oAndar() {
    const baseY = CM_FLOOR1_Y, h = CM_ATTIC_Y - CM_FLOOR1_Y;

    // Quarto Principal — hero B2 ("Cama do Quarto... atrás da cabeceira").
    this._buildManorRoom(-35, -8, 28, 20, CHAMELEON.floral, ['s', 'e'], { matName: 'drywall', h, baseY });
    this._buildBed(-35, -15, MANSION.porcelana);

    // Quarto de Hóspedes — só porta norte; a parede leste é CUSTOM (não
    // _buildManorRoom): 2 segmentos fixos + o painel móvel da passagem 9.2,
    // no lugar de uma porta normal.
    this._buildManorRoom(-35, 20, 28, 16, CHAMELEON.azulejoAzul, ['n'], { matName: 'drywall', h, baseY, skip: ['e'] });
    this._buildSecretPassage9_2(baseY, h);

    // Storage — porta oeste (só alcançável de fora pela passagem secreta ou
    // contornando por fora; ver rota). Hero B3 ("Tecidos do Storage").
    this._buildManorRoom(-11, 20, 16, 16, CHAMELEON.carvalho, ['w'], { matName: 'wood', h, baseY });
    const crateB3 = (x, z, s) => this._addBox(s, s, s, CHAMELEON.dourado, x, baseY + s / 2, z, { roughness: 0.85, seekerPass: true });
    crateB3(-8, 24, 0.9);
    crateB3(-6.5, 25, 0.8);
    crateB3(-14, 15, 0.85);

    // Banheiro de Luxo — hero S4 ("Azulejo... parede entre banheira e
    // espelho, tile_black"). Painel pixelColorable dedicado (mesmo padrão
    // hexagonal da Fase 4b, cor azulejoPreto em vez de azulejoBanheiro — o
    // hero S4 pede tile_black explicitamente, diferente do S-tier já feito).
    this._buildManorRoom(25, -8, 20, 16, CHAMELEON.marmore, ['w'], { matName: 'marble', h, baseY });
    // Espelho e painel na MESMA parede leste (sólida — a porta é a oeste) —
    // "entre banheira e espelho" da spec, adaptado: painel ao lado do
    // espelho na única parede cheia disponível, não na parede da porta.
    this._buildMirror(34.65, baseY + 2.2, -8, { x: -1, z: 0 }, 1.4, 2.0);
    this._addHexPanel(34.65, baseY + 1.9, -3, { x: -1, z: 0 }, 3, 2.6, CHAMELEON.azulejoPreto);

    // Rota: QP (hero B2) → Banheiro (hero S4) → QP → QH (gatilho da
    // passagem) → contorna por FORA (o Seeker nunca abre a passagem — ela só
    // responde ao botão Escalar do jogador) → Storage (hero B3) → fecha o
    // laço de volta a QP.
    return [
      wp(-35, -8),   // centro do Quarto Principal
      wp(-21, -8),   // porta leste do QP
      // Desvia do vão da claraboia (Fase 6: x∈[-3,3], z∈[-11,-5], nas lajes
      // FLOOR1_Y e ATTIC_Y) — sem isso o trajeto reto QP↔Banheiro atravessa
      // o buraco bem em z=-8.
      wp(-3, -8),
      wp(-3, -3),
      wp(3, -3),
      wp(3, -8),
      wp(25, -8),    // centro do Banheiro (passa pela porta oeste dele)
      wp(3, -8),
      wp(3, -3),
      wp(-3, -3),
      wp(-3, -8),
      wp(-21, -8),   // volta pela porta do QP
      wp(-35, -8),   // volta ao centro do QP
      wp(-35, 2),    // porta sul do QP
      wp(-35, 20),   // centro do Quarto de Hóspedes (gatilho da passagem 9.2)
      wp(-35, 12),   // porta norte (NUNCA pela passagem secreta)
      wp(-35, 10),   // limpa a parede antes de virar (evita raspar a quina)
      wp(-20, 10),   // contorna por fora, ao norte dos dois cômodos
      wp(-20, 20),   // alinha em x=-20 (fora da parede oeste do Storage) antes de entrar
      wp(-19, 20),   // porta oeste do Storage
      wp(-11, 20),   // centro do Storage (hero B3)
      wp(-19, 20),   // retraça de volta (fecha o laço pelo mesmo caminho seguro)
      wp(-20, 20),
      wp(-20, 10),
      wp(-35, 10),
      wp(-35, 12),   // porta norte do QH
    ];
  }

  // Passagem secreta 9.2 (Plano 5, Fase 5): parede leste do Quarto de
  // Hóspedes, vão de 1,6m centrado em z=20. 2 segmentos fixos (norte/sul do
  // vão) via _addBox normal + 1 painel MÓVEL (mesma aparência — cor/material
  // idênticos, "pista sutil" da spec fica só no papel-de-parede meio
  // desbotado, sem malha nova pra isso). Desliza (não gira 90° como a spec
  // literal pede — mesmo princípio de adaptação já usado no resto do plano:
  // a 9.1 da própria spec já usa "desliza", e girar de verdade exigiria um
  // pivô fora do centro que este projeto não tem infra pra montar barato)
  // 1,6m pra dentro do segmento sul, ficando "engavetado" dentro da parede.
  _buildSecretPassage9_2(baseY, h) {
    const cx = -21, cz = 20, gapW = 1.6, wallLen = 16; // parede leste do QH (d=16)
    const hd = wallLen / 2;
    const gz0 = cz - gapW / 2, gz1 = cz + gapW / 2;
    const wd = this._mat('wood');
    const opts = { roughness: wd.roughness, metalness: 0, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale };
    const segN = (gz0 - (cz - hd));
    const segS = ((cz + hd) - gz1);
    this._addBox(CM_T, h, segN, CHAMELEON.azulejoAzul, cx, baseY + h / 2, cz - hd + segN / 2, { ...opts, mapRepeat: { x: 1, y: Math.max(1, h / 3) } });
    this._addBox(CM_T, h, segS, CHAMELEON.azulejoAzul, cx, baseY + h / 2, cz + hd - segS / 2, { ...opts, mapRepeat: { x: 1, y: Math.max(1, h / 3) } });

    const closedPos = new THREE.Vector3(cx, baseY + h / 2, cz);
    const openPos = new THREE.Vector3(cx, baseY + h / 2, cz + gapW); // engaveta dentro do segmento sul
    // _addBox já chama _addSolid por dentro (mesh climbable/colorável/sólido
    // normal, aparência idêntica aos 2 segmentos fixos acima) — o Box3 que
    // ele cria é sempre o ÚLTIMO empurrado em `this.solids`, então pegamos a
    // referência dali em vez de duplicar a criação do solid.
    const mesh = this._addBox(CM_T, h, gapW, CHAMELEON.azulejoAzul, closedPos.x, closedPos.y, closedPos.z, {
      ...opts, mapRepeat: { x: 1, y: Math.max(1, h / 3) },
    });
    const box = this.solids[this.solids.length - 1];

    this._secretPassages.push({
      mesh, box, closedPos, openPos,
      boxSize: new THREE.Vector3(CM_T, h, gapW),
      state: 'closed', progress: 0, cooldownUntil: 0, duration: 0.9,
      triggerPos: new THREE.Vector3(cx + 1.2, baseY + 1, cz),
      triggerRadius: 2.2,
    });
  }

  // Fase 6 do Plano 5 — Ático: Sótão Aberto + Telhado (sem sala fechada —
  // é o domínio menos visitado do Caçador na spec, "Muito Baixa"/5%). Hero
  // A5 (trave de madeira, canto noroeste) e B5 (chaminé). A claraboia em si
  // (vidro emissivo, mesmo truque de _buildWindow, NÃO MeshPhysicalMaterial
  // — decisão de arquitetura do plano) fica aqui: uma placa horizontal logo
  // abaixo do telhado, tampando o poço vertical por cima; o poço em si
  // (visão ático→Ballroom) já foi aberto nas lajes por slabWithGaps, em
  // _buildChameleonManor.
  _buildAtico() {
    const baseY = CM_ATTIC_Y, h = CM_ROOF_Y - CM_ATTIC_Y;

    // Claraboia: vidro frio emissivo (mesma receita de _buildWindow) tampando
    // o poço por cima — climbable/colorável:false, mas ENTRA em climbables
    // (portanto em occluders) de propósito: "vidro... mas oclusor" da spec.
    this._addBox(6, 0.15, 6, 0x0d1622, 0, CM_ROOF_Y - 0.4, -8, {
      colorable: false, roughness: 0.15, metalness: 0.1,
      emissive: 0x6fa8d8, emissiveIntensity: 0.5,
    });

    // Hero A5 ("Teto do Ático... trave de madeira, canto noroeste, Flat/
    // Climb — Seeker raramente olha pra cima"): viga rente ao telhado baixo.
    this._addBox(10, 0.3, 0.5, CHAMELEON.madeiraEscura, -42, baseY + h - 0.4, -30, { roughness: 0.9 });

    // Hero B5 ("Chaminé do Ático... lateral, concrete_gray, Stand/Flat —
    // exposto ao céu"): estrutura vertical atravessando o telhado.
    this._addBox(1.4, h + 1.0, 1.4, CHAMELEON.concreto, 40, baseY + h / 2, 15, { roughness: 1.0 });

    // Baús/caixas espalhados (madeira envelhecida) — densidade barata do
    // sótão, sem sala fechada.
    const trunk = (x, z) => this._addBox(1.1, 0.7, 0.7, CHAMELEON.madeiraEscura, x, baseY + 0.35, z, { roughness: 0.9, seekerPass: true });
    trunk(-35, 15); trunk(-33.5, 16); trunk(30, -25); trunk(45, -10); trunk(-45, 10);

    // Rota: laço amplo pelo sótão, desviando do vão da claraboia (x∈[-3,3],
    // z∈[-11,-5] — a MESMA laje serve de piso do ático, então o buraco
    // também existe aqui) e do desembarque da escada (x≈0, z∈[20,28]).
    return [
      wp(-40, -30),  // perto da trave (hero A5)
      wp(-40, 10),
      wp(-20, 10),
      wp(-20, -20),
      wp(-6, -20),
      wp(-6, -3),    // desvia do vão da claraboia por fora (oeste/sul)
      wp(6, -3),
      wp(6, -20),
      wp(20, -20),
      wp(20, 10),
      wp(37, 15),    // perto da chaminé (hero B5, em 40,15 — 2m de folga do corpo dela)
      wp(20, 33),    // contorna o desembarque da escada (x≈0, z∈[20,28]) por fora
      wp(-20, 33),
      wp(-40, 10),
    ];
  }

  // Fase 7 do Plano 5 — Iluminação por zona. NÃO é a leitura literal da
  // especificação (PointLight/SpotLight coloridas por cômodo): este projeto
  // já tem uma decisão de arquitetura anterior e deliberada contra isso —
  // 2 motivos reais, não estéticos:
  //   1. Game.js:_addLights() já documenta "cena CLARA e legível... nada de
  //      âmbar de penumbra" — o jogo INTEIRO usa 1 luz-chave branca +
  //      hemisfério/ambiente neutros, a mesma para os 5 layouts.
  //   2. A camuflagem inteira depende de hex == cor percebida (é por isso que
  //      toda paleta deste plano passa pelo script sRGB) — uma PointLight
  //      colorida por cima tingiria o MeshToonMaterial e quebraria essa
  //      garantia bem debaixo da mecânica central do jogo.
  //   3. (achado nesta sessão) Seeker.js:352 documenta que uma mecânica de
  //      "penumbra afeta alcance de visão" já existiu E FOI REMOVIDA — outra
  //      Fase 7, de um plano anterior (mansão). `this.fixtures`/`lightAt()`
  //      continuam no código (nada os lê mais), só porque candelabros/
  //      lustres/arandelas ainda os registram por hábito.
  // Adaptação: "iluminação por zona" vira variação ATMOSFÉRICA barata que já
  // é o padrão do resto do jogo — luminárias emissivas decorativas (chama/
  // lâmpada, cor própria, NÃO afeta outros materiais) + registro em
  // `fixtures` (consistência de dados com o resto do mapa, custo zero de
  // GPU). "≤8 luzes dinâmicas simultâneas" do plano é sobre THREE.Light de
  // verdade — como não uso nenhuma aqui, o orçamento nem se aplica (0 << 8).
  _buildZoneLighting() {
    // Porão — luz industrial fria: 3 lâmpadas suspensas (cor fria, mesmo
    // tom de 0xA0C4FF da spec), 1 por sala.
    const industrialLamp = (x, z) => {
      const y = CM_GROUND_Y - 0.5;
      const bulb = this._deco(new THREE.SphereGeometry(0.09, 8, 8), 0x0a0e14, x, y, z, {
        colorable: false, emissive: 0xa0c4ff, emissiveIntensity: 1.3,
      });
      this._deco(new THREE.ConeGeometry(0.22, 0.18, 12, 1, true), CHAMELEON.concreto, x, y + 0.14, z, {
        colorable: false, metalness: 0.4, roughness: 0.5,
      });
      this._flames.push({ mat: bulb.material, phase: Math.random() * 6.28, base: 1.3 });
      this._addFixture(x, y, z, 6, 0.5);
    };
    industrialLamp(-40, 0);   // Cozinha Industrial
    industrialLamp(-10, 0);   // Adega
    industrialLamp(-10, 25);  // Área de Serviço

    // Ballroom — 2 arandelas auxiliares nas paredes laterais (o lustre
    // central já registra fixture própria em _buildBallroomHall).
    this._buildSconce(-17.4, 2.4, -13);
    this._buildSconce(17.4, 2.4, -13);

    // Galeria — 4 arandelas cobrindo os 24 quadros em lotes (mesma proporção
    // sugerida pela spec: "4 SpotLights cobrem 24 quadros em batches").
    this._buildSconce(30, 2.6, -17.4);
    this._buildSconce(48, 2.6, -17.4);
    this._buildSconce(30, 2.6, 1.4);
    this._buildSconce(48, 2.6, 1.4);

    // Ático — luz natural filtrada pela claraboia (já emissiva desde a Fase
    // 6): só registra a fixture, sem malha nova.
    this._addFixture(0, CM_ROOF_Y - 0.4, -8, 8, 0.6);
  }

  _addCeiling() {
    const y = WALL_H;
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshToonMaterial({ color: 0xece7db, gradientMap: toonGradient(), side: THREE.FrontSide })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = y;
    ceil.receiveShadow = true;
    this.scene.add(ceil);
    // Rosácea de gesso (anel de boiserie) ao redor do lustre central.
    this._deco(new THREE.TorusGeometry(1.4, 0.12, 8, 24), 0xe4ddcd, 0, y - 0.06, 0, {
      rx: Math.PI / 2, colorable: false, roughness: 1.0,
    });
  }

  // ── ALA 1 — SALÃO PRINCIPAL (pé-direito duplo) ──────────────────────────────
  // Salão central com pilares de mármore, lustre; biblioteca e sala de estar nos
  // cantos. Um só Caçador — rota pelo anel interno.
  _buildGrandHall() {
    // 4 pilares de mármore emoldurando o salão (grudáveis, altos).
    for (const [px, pz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) this._buildPillar(px, pz);
    this._buildChandelier(0, 0);
    this._buildChandelier(-7, 7); this._buildChandelier(7, 7);
    this._buildRug(0, 0, 8, 8);

    // Biblioteca (canto NW): azul prússia, estantes nas paredes.
    const bib = this._buildRoom(-8.5, -8.5, 7, 7, MANSION.prussia, { doors: ['s', 'e'] });
    this._buildBookshelf(-11, -9, { x: 1, z: 0 });
    this._buildBookshelf(-9, -11, { x: 0, z: 1 });
    this._buildArmchair(-7.5, -7.5, MANSION.bordo);
    this._buildRug(-8.5, -8.5, 4, 3);

    // Sala de estar (canto NE): verde sálvia, poltronas + aparador.
    const estar = this._buildRoom(8.5, -8.5, 7, 7, MANSION.salvia, { doors: ['s', 'w'] });
    this._buildArmchair(9.5, -9.5, MANSION.bordo);
    this._buildSideboard(11, -8.5);
    this._buildPainting(8.5, 2.2, -11.7, { x: 0, z: 1 }, 1.6, 2.0);

    this._collectDoors(bib, estar);
    // Arandelas nas paredes de perímetro + espelhos ornamentados no salão.
    for (const [sx, sz] of [[-HALF + 0.5, 0], [HALF - 0.5, 0], [0, -HALF + 0.5]]) this._buildSconce(sx, 3.2, sz);
    this._buildMirror(HALF - 0.35, 2.4, 3, { x: -1, z: 0 }, 1.4, 2.2);
    this._buildMirror(-(HALF - 0.35), 2.4, 3, { x: 1, z: 0 }, 1.4, 2.2);
    this._buildPainting(-2.5, 2.4, -(HALF - 0.35), { x: 0, z: 1 }, 1.5, 1.9);
    this._buildPainting(2.5, 2.4, -(HALF - 0.35), { x: 0, z: 1 }, 1.5, 1.9);

    this.spawn.set(-6, 0, 8);   // canto SW aberto (cômodos ficam ao norte); longe da escada em x=0
    // Rota 0 = TÉRREO, rota 1 = andares altos (ver _setRoutes): um Caçador por
    // domínio. Um só Caçador não cobre 3 níveis — media 1% do 2º andar em 120 s.
    // Evita o eixo x=0 em |z|∈[5,9.6] (pés das escadarias) e os pilares em (±4,±4).
    this._setRoutes([
      wp(0, 0), wp(7, 3), wp(9.5, 8), wp(3, 9), wp(-3, 9), wp(-9.5, 8),
      wp(-9.5, 3), wp(-3.5, -6), wp(3.5, -6),
    ]);
  }

  // ── ALA 2 — CORREDOR DE QUARTOS ─────────────────────────────────────────────
  // Corredor central de 3,5 m com quartos dos dois lados. Quinas próximas exigem
  // reação rápida; o anel externo mantém a rota navegável.
  _buildBedroomWing() {
    // Paredes que definem um corredor central em Z (vão 3,5 m).
    const t = 0.5, cor = 1.75; // meia-largura do corredor
    this._addWall(t, ROOM_H, 14, -cor, ROOM_H / 2, 0, MANSION.porcelana);
    this._addWall(t, ROOM_H, 14, cor, ROOM_H / 2, 0, MANSION.porcelana);

    // Quartos nos quatro cantos (azul porcelana / bordô), vãos para o corredor.
    const q1 = this._buildRoom(-8, -8, 7, 7, MANSION.porcelana, { doors: ['s', 'e'] });
    this._buildBed(-9, -8, MANSION.porcelana);
    this._buildWardrobe(-10.5, -10.5);

    const q2 = this._buildRoom(8, -8, 7, 7, MANSION.bordo, { doors: ['s', 'w'] });
    this._buildBed(9, -8, MANSION.bordo);
    this._buildSideboard(10.5, -6.5);

    const q3 = this._buildRoom(-8, 8, 7, 7, MANSION.bordo, { doors: ['n', 'e'] });
    this._buildBed(-9, 8, MANSION.bordo);
    this._buildWardrobe(-10.5, 10.5);

    const q4 = this._buildRoom(8, 8, 7, 7, MANSION.porcelana, { doors: ['n', 'w'] });
    this._buildBed(9, 8, MANSION.porcelana);
    this._buildSideboard(10.5, 6.5);

    this._collectDoors(q1, q2, q3, q4);
    for (const sz of [-4, 4]) { this._buildSconce(-cor - 0.02, 2.6, sz); this._buildSconce(cor + 0.02, 2.6, sz); }
    // Lustres sobre o corredor (era a única ala sem nenhum) — o vão central é
    // aberto até o teto, então eles pendem bem acima das divisórias.
    this._buildChandelier(0, -8.5); this._buildChandelier(0, 8.5);
    // Espelhos altos nas paredes do corredor: alongam o enfileiramento e captam
    // o brilho das arandelas (o truque clássico de corredor de mansão).
    for (const sz of [-1.5, 1.5]) {
      this._buildMirror(cor + 0.03, 1.9, sz, { x: 1, z: 0 }, 0.9, 2.0);
      this._buildMirror(-cor - 0.03, 1.9, sz, { x: -1, z: 0 }, 0.9, 2.0);
    }
    // (o pé da escadaria norte ocupa x=0, z≈-5 → nada de mobília no eixo aqui)

    this.spawn.set(-1.2, 0, -6);   // boca norte do corredor (livre)
    // Térreo: corredor central (x≈0, livre entre as paredes em ±1.75) de ponta a
    // ponta, passando pelas QUATRO portas de quarto. Espiar da porta cobre quase
    // todo o quarto (alcance 7.5 m) e sai muito mais barato, em tempo de volta,
    // do que entrar fundo em cada um — com 4 quartos, entrar deixava 77% do
    // térreo nunca visto em 60 s.
    this._setRoutes([
      wp(0, -6), wp(0, -8.5), wp(-4.5, -8), wp(0, -8.5), wp(4.5, -8), wp(0, -8.5),
      wp(0, 0), wp(0, 6), wp(0, 8.5), wp(-4.5, 8), wp(0, 8.5), wp(4.5, 8), wp(0, 8.5),
    ]);
  }

  // ── ALA 3 — GALERIA + SALÃO DE FESTAS ───────────────────────────────────────
  // Galeria de quadros (paredes centrais) + salão aberto. 2 Caçadores em rotas
  // cruzadas forçam o uso constante da camuflagem.
  _buildGalleryWing() {
    // Paredes-galeria centrais (roxo ametista) cobertas de quadros dos dois lados.
    this._addWall(9, ROOM_H + 0.6, 0.5, 0, (ROOM_H + 0.6) / 2, -3.5, MANSION.ametista);
    this._addWall(9, ROOM_H + 0.6, 0.5, 0, (ROOM_H + 0.6) / 2, 3.5, MANSION.ametista);
    for (const zx of [-3.5, 3.5]) {
      const dir = { x: 0, z: zx < 0 ? -1 : 1 };
      for (const px of [-3, 0, 3]) this._buildPainting(px, 2.0, zx + dir.z * 0.28, dir, 1.6, 2.0);
    }

    // Pilares de mármore ladeando a galeria + lustres.
    for (const [px, pz] of [[-7, 0], [7, 0]]) this._buildPillar(px, pz);
    this._buildChandelier(-6, -7); this._buildChandelier(6, 7);
    this._buildRug(0, 0, 7, 4);

    // Estúdio (canto): verde sálvia + aparadores.
    const estudio = this._buildRoom(-8.5, 8.5, 7, 7, MANSION.salvia, { doors: ['n', 'e'] });
    this._buildSideboard(-10.5, 8.5);
    this._buildArmchair(-7.5, 9.5, MANSION.bordo);

    const almox = this._buildRoom(8.5, -8.5, 7, 7, MANSION.carvalho, { doors: ['s', 'w'] });
    this._buildWardrobe(10.5, -10.5);
    this._buildBookshelf(9, -6.5, { x: 0, z: 1 });

    this._collectDoors(estudio, almox);
    for (const [sx, sz] of [[-HALF + 0.5, -6], [HALF - 0.5, 6]]) this._buildSconce(sx, 3.2, sz);
    // Galeria: mais telas-herói nas paredes centrais e espelhos altos nas laterais.
    for (const zx of [-3.5, 3.5]) {
      const dir = { x: 0, z: zx < 0 ? -1 : 1 };
      for (const px of [-4.2, 4.2]) this._buildPainting(px, 2.0, zx + dir.z * 0.28, dir, 1.1, 1.4);
    }
    this._buildMirror(HALF - 0.35, 2.5, -2, { x: -1, z: 0 }, 1.4, 2.4);
    this._buildMirror(-(HALF - 0.35), 2.5, 2, { x: 1, z: 0 }, 1.4, 2.4);

    this.spawn.set(-6, 0, -8);  // NW aberto; fora do eixo x=0 (pé da escadaria norte)
    // Perímetro do TÉRREO (antes era um quadrado de 3 m no canto NE, que deixava o
    // andar inteiro sem vigilância). Desvia dos cômodos NW/SE, dos pilares em
    // (±7,0) e do eixo x=0 nos pés das escadarias.
    this._setRoutes([
      wp(2.5, 7), wp(7, 7), wp(9.5, 2), wp(9.5, -2), wp(2.5, -7),
      wp(-2.5, -7), wp(-9.5, -2), wp(-9.5, 2), wp(-2.5, 7),
    ]);
  }

  // ── ESPALHAMENTO PROCEDURAL ─────────────────────────────────────────────────
  _scatterProps() {
    const rand = mulberry32((this.layout * 0x9e3779b1) >>> 0);
    const range = (a, b) => a + rand() * (b - a);
    // Densidade proporcional à área: com a pegada maior (HALF>12.5) planta mais
    // peças para o térreo não ficar vazio (contagens originais calibradas p/ HALF=12.5).
    const dens = (HALF * HALF) / (12.5 * 12.5);
    const nFurn = Math.round(5 * dens), nChest = Math.round(8 * dens), nOrn = Math.round(10 * dens);
    const pick = (arr) => arr[(rand() * arr.length) | 0];

    const margin = 2.2;
    const AREA = HALF - margin;
    const BAND_MIN = HALF - 4;
    const BAND_MAX = HALF - margin;

    const placed = [{ x: this.spawn.x, z: this.spawn.z, r: 3.5 }];
    for (const route of this.routes) for (const w of route) placed.push({ x: w.x, z: w.z, r: 2.6 });
    for (const d of this._roomDoors) placed.push({ x: d.x, z: d.z, r: 1.8 });

    const isClear = (x, z, rad) => {
      for (const box of this.solids) {
        if (box.max.x - box.min.x > HALF && box.max.z - box.min.z > HALF) continue; // pula o chão
        if (x + rad > box.min.x && x - rad < box.max.x &&
            z + rad > box.min.z && z - rad < box.max.z) return false;
      }
      for (const p of placed) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz < (rad + p.r) * (rad + p.r)) return false;
      }
      return true;
    };
    const sample = (nearWall) => {
      if (nearWall) {
        const along = (rand() * 2 - 1) * AREA;
        const off = range(BAND_MIN, BAND_MAX) * (rand() < 0.5 ? -1 : 1);
        return rand() < 0.5 ? { x: off, z: along } : { x: along, z: off };
      }
      return { x: (rand() * 2 - 1) * AREA, z: (rand() * 2 - 1) * AREA };
    };
    const findSpot = (rad, nearWall) => {
      for (let i = 0; i < 30; i++) {
        const p = sample(nearWall);
        if (isClear(p.x, p.z, rad + 0.5)) return p;
      }
      return null;
    };

    // Mobília da mansão espalhada: corpos grudáveis coloridos + detalhes.
    const furniture = [
      { r: 1.3, make: (x, z) => this._buildWardrobe(x, z, pick([MANSION.ebano, MANSION.carvalho])) },
      { r: 1.3, make: (x, z) => this._buildBookshelf(x, z, { x: 0, z: 1 }, MANSION.ebano) },
      { r: 1.3, make: (x, z) => this._buildArmchair(x, z, pick([MANSION.bordo, MANSION.prussia, MANSION.ametista])) },
      { r: 1.3, make: (x, z) => this._buildSideboard(x, z, MANSION.carvalho) },
    ];
    for (let i = 0; i < nFurn; i++) {
      const f = furniture[i % furniture.length];
      const p = findSpot(f.r, i < 3);
      if (!p) continue;
      f.make(p.x, p.z);
      placed.push({ x: p.x, z: p.z, r: f.r + 0.4 });
    }

    // ~8 caixas/baús grudáveis (cores de assinatura) — esconderijos + oclusores.
    const wd = this._mat('wood');
    const chestOpts = { roughness: wd.roughness, metalness: 0, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale };
    for (let i = 0; i < nChest; i++) {
      const w = range(0.9, 1.6), d = range(0.9, 1.6), h = range(1.0, 2.6);
      const rad = Math.hypot(w, d) / 2;
      const p = findSpot(rad, i < 4);
      if (!p) continue;
      this._addBox(w, h, d, pick(SIGNATURE), p.x, h / 2, p.z, { ...chestOpts, mapRepeat: { x: 1, y: Math.max(1, h / 2) } });
      placed.push({ x: p.x, z: p.z, r: rad });
    }

    // ~10 ornamentos (pedestais/vasos/cones) — densidade e cores de disfarce.
    for (let i = 0; i < nOrn; i++) {
      const p = findSpot(0.6, i < 4);
      if (!p) continue;
      const roll = rand();
      if (roll < 0.5) this._buildPedestalPiece(p.x, p.z, (rand() * 2) | 0);
      else if (roll < 0.8) this._addCylinder(range(0.35, 0.6), range(1.2, 2.2), pick(SIGNATURE), p.x, p.z, { cast: false });
      else this._buildRug(p.x, p.z, range(2.5, 4), range(1.8, 3));
      placed.push({ x: p.x, z: p.z, r: 1.0 });
    }
  }
}

// Aplica repeat próprio a uma textura compartilhada sem afetar as demais malhas
// (o clone divide o Source → 1 upload de GPU). Retorna null se tex for null.
function rep(tex, rx, ry) {
  if (!tex) return null;
  const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return t;
}

// Clareia (k>0) ou escurece (k<0) uma cor mantendo o matiz.
function shade(hex, k) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + k, 0, 1));
  return c;
}

// PRNG determinístico (mulberry32): mesmo layout → mesma disposição de props.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
