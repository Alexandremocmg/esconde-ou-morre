import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materialMaps, toonGradient } from './textures.js';

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
const HALF = 12.5;     // meia-largura do piso (mansão 25×25 por andar)
const WALL_H = 7.8;    // pé-direito do salão (triplo); teto do salão em WALL_H
const ROOM_H = 3.2;    // altura das paredes de cômodo (abaixo da laje do 2º andar)
const ROOM2_H = 2.4;   // altura das divisórias dos quartos do 2º andar (sobre a laje)
const ROUTE_Y = 1.1;   // altura dos waypoints (= EYE_Y do Caçador)
const DOOR_MIN = 3.2;  // vão mínimo de porta: o Caçador (BODY_R=0.6 + desvio) atravessa
const FLOOR2_Y = 3.4;  // topo da laje do 2º andar (anel de quartos sobre o hall)
const MEZZ3_Y = 5.2;   // topo da sacada (3º nível) sobre a faixa W — "varanda dupla"
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

    // Materiais animados no loop (bruxuleio de velas) — preenchidos em _build.
    this._flames = [];    // { mat, phase, base } chamas emissivas que tremulam
    this._roomDoors = []; // {x,z} dos vãos de cômodo → mantidos livres no espalhamento

    this._build();
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
  // penumbra sem custo de luz real). Chamado por Game no loop.
  update(t) {
    for (const f of this._flames) {
      const flick = f.base * (1 + 0.10 * Math.sin(t * 11 + f.phase) + 0.06 * Math.sin(t * 27 + f.phase * 1.7));
      f.mat.emissiveIntensity = flick;
    }
  }

  _addSolid(w, h, d, x, y, z) {
    const box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(w, h, d)
    );
    this.solids.push(box);
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
  _addBox(w, h, d, color, x, y, z, {
    climbable = true, colorable = true,
    map = null, mapRepeat = null, roughness = 0.85, metalness = 0.0,
    normalMap = null, normalScale = 1,
    emissive = null, emissiveIntensity = 0,
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
    this.scene.add(mesh);
    if (climbable) this.climbables.push(mesh);
    if (colorable) this.colorables.push(mesh);
    this._addSolid(w, h, d, x, y, z);
    return mesh;
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
  _buildArmchair(x, z, color = MANSION.bordo) {
    const ve = this._mat('velvet');
    const vopts = { roughness: ve.roughness, metalness: 0, map: ve.map, normalMap: ve.normalMap, normalScale: ve.normalScale };
    this._addBox(1.5, 1.0, 0.3, color, x, 0.7, z - 0.45, vopts); // encosto (grudável)
    this._deco(new THREE.BoxGeometry(1.5, 0.4, 0.9), shade(color, -0.05), x, 0.35, z, { roughness: 0.95 });
    for (const sx of [-1, 1])
      this._deco(new THREE.BoxGeometry(0.24, 0.6, 0.95), shade(color, -0.1), x + sx * 0.63, 0.5, z, { roughness: 0.95 });
    this._deco(new THREE.BoxGeometry(1.05, 0.2, 0.75), shade(color, 0.12), x, 0.62, z, {}); // almofada
  }

  // Aparador de carvalho: corpo grudável + tampo de mármore + item de latão.
  _buildSideboard(x, z, color = MANSION.carvalho) {
    const wd = this._mat('wood');
    this._addBox(1.9, 1.0, 0.7, color, x, 0.5, z, {
      roughness: wd.roughness, metalness: 0,
      map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale,
    });
    this._deco(new THREE.BoxGeometry(2.0, 0.08, 0.8), MANSION.marmore, x, 1.04, z, { roughness: 0.25 });
    // Candelabro de latão (com chama emissiva bruxuleante) sobre o aparador.
    this._buildCandelabra(x, 1.1, z);
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
    // Tela a óleo.
    const oil = this._mat('oilPaint', { normals: false });
    this._deco(new THREE.PlaneGeometry(w, h), 0xffffff, x + dir.x * 0.1, y, z + dir.z * 0.1, {
      rot, map: oil.map, roughness: oil.roughness, colorable: false,
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
  _buildPedestalPiece(x, z, kind = 0) {
    this._deco(new THREE.CylinderGeometry(0.28, 0.32, 1.0, 16), MANSION.carvalho, x, 0.5, z, { cast: true });
    if (kind === 0) this._deco(new THREE.SphereGeometry(0.32, 16, 12), MANSION.marmore, x, 1.2, z, { roughness: 0.25, cast: true }); // busto/urna
    else this._deco(new THREE.ConeGeometry(0.3, 0.7, 14), MANSION.latao, x, 1.35, z, { metalness: 0.5, roughness: 0.35, cast: true }); // chama/obelisco
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
    // Corrimão lateral acompanhando a inclinação.
    const rise = topY - baseY, run = Math.abs(z1 - z0);
    this._deco(new THREE.BoxGeometry(0.08, 0.1, Math.hypot(run, rise)), MANSION.latao,
      cx - width / 2 - 0.05, (baseY + topY) / 2 + 0.9, (z0 + z1) / 2,
      { colorable: false, rx: Math.sign(z1 - z0) * -Math.atan2(rise, run), metalness: 0.5 });
    return { bot: wp(cx, z0), top: wp(cx, z1) };
  }

  // Mezanino-varanda: anel de laje no perímetro (y=FLOOR2_Y) sobre o hall aberto,
  // escadaria no canto SE, guarda-corpo e arandelas. Compartilhado pelos 3 layouts.
  // Define this._stairBot/_stairTop/_balcony para as rotas montarem a patrulha vertical.
  _buildMezzanine() {
    const DEPTH = 3.5, IN = HALF - DEPTH, CTR = HALF - DEPTH / 2; // borda interna |coord|=9
    // Faixas do anel (3.5 m de profundidade): fecham o vão até a escada (z≥9) e dão
    // margem ao corte de canto do Caçador. N/S largura total, E/W entre elas.
    this._addSlab(HALF * 2, DEPTH, 0, -CTR, FLOOR2_Y); // N (z∈[-12.5,-9])
    this._addSlab(HALF * 2, DEPTH, 0, CTR, FLOOR2_Y);  // S (z∈[9,12.5])
    this._addSlab(DEPTH, IN * 2, CTR, 0, FLOOR2_Y);    // E (x∈[9,12.5])
    this._addSlab(DEPTH, IN * 2, -CTR, 0, FLOOR2_Y);   // W

    // Guarda-corpo (deco baixo) na borda interna — só visual, não bloqueia.
    const railY = FLOOR2_Y + 0.5;
    const railMat = { colorable: false, roughness: 0.4, metalness: 0.5 };
    this._deco(new THREE.BoxGeometry(IN * 2, 0.1, 0.08), MANSION.latao, 0, railY, -IN, railMat);
    this._deco(new THREE.BoxGeometry(IN * 2, 0.1, 0.08), MANSION.latao, 0, railY, IN, railMat);
    this._deco(new THREE.BoxGeometry(0.08, 0.1, IN * 2), MANSION.latao, -IN, railY, 0, railMat);
    this._deco(new THREE.BoxGeometry(0.08, 0.1, IN * 2), MANSION.latao, IN, railY, 0, railMat);

    // ESCADARIA SUL (x=0): térreo → 2º andar, sobe em +z de z=5 até z=9.6, onde
    // sobrepõe a faixa S (z≥9) — SEM vão. x=0 é livre no térreo dos 3 layouts.
    const sS = this._addStairFlight(0, 3, 5, 9.6, 0, FLOOR2_Y, 20);
    // ESCADARIA NORTE (x=0): rota alternativa, espelhada. Sem ela, a escada única
    // era um gargalo — jogador e Caçador sempre no mesmo ponto de subida.
    const sN = this._addStairFlight(0, 3, -5, -9.6, 0, FLOOR2_Y, 20);
    this._stairBot = sS.bot; this._stairTop = wp(0, 9.3);
    this._stairBotN = sN.bot; this._stairTopN = wp(0, -9.3);

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
    for (const a of [-8.5, 8.5]) {       // E/W: |z|=8.5 evita a passagem elevada
      this._buildWindow(HALF - 0.35, wy, a, { x: -1, z: 0 });      // (sacada + lances, |z|<6.5)
      this._buildWindow(-(HALF - 0.35), wy, a, { x: 1, z: 0 });    // e as divisórias em |z|=7.55
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
    // atravessar o piso). Game._updateOcclusion continua usando climbables direto.
    this.occluders = this.climbables.concat(this._slabs);
    this.cameraColliders = this.climbables.concat(this._slabs);
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
    for (let i = 0; i < 5; i++) {
      const f = furniture[i % furniture.length];
      const p = findSpot(f.r, i < 3);
      if (!p) continue;
      f.make(p.x, p.z);
      placed.push({ x: p.x, z: p.z, r: f.r + 0.4 });
    }

    // ~8 caixas/baús grudáveis (cores de assinatura) — esconderijos + oclusores.
    const wd = this._mat('wood');
    const chestOpts = { roughness: wd.roughness, metalness: 0, map: wd.map, normalMap: wd.normalMap, normalScale: wd.normalScale };
    for (let i = 0; i < 8; i++) {
      const w = range(0.9, 1.6), d = range(0.9, 1.6), h = range(1.0, 2.6);
      const rad = Math.hypot(w, d) / 2;
      const p = findSpot(rad, i < 4);
      if (!p) continue;
      this._addBox(w, h, d, pick(SIGNATURE), p.x, h / 2, p.z, { ...chestOpts, mapRepeat: { x: 1, y: Math.max(1, h / 2) } });
      placed.push({ x: p.x, z: p.z, r: rad });
    }

    // ~10 ornamentos (pedestais/vasos/cones) — densidade e cores de disfarce.
    for (let i = 0; i < 10; i++) {
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
