import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wallpaperTexture, carpetTexture, ceilingTileTexture } from './textures.js';

// Constrói a sala de teste com primitivas.
// Marca cada malha com userData:
//   climbable = superfície onde o jogador pode grudar (paredes/blocos)
//   colorable = objeto cuja cor pode ser copiada pela camuflagem
const HALF = 40;      // meia-largura do piso (arena ampliada ×2 → piso 80×80)
const WALL_H = 8;
const ROUTE_Y = 1.1;  // altura dos waypoints (= EYE_Y do Caçador)
const ROOM_H = 4.2;   // altura das paredes de cômodo (abaixo do teto WALL_H=8)
const DOOR_MIN = 3.2; // vão mínimo de porta: o Caçador (BODY_R=0.6 + desvio) atravessa

// Paleta "Meccha Chameleon": cores saturadas para cômodos e props-herói. São os
// ALVOS FORTES de camuflagem — cada zona ganha uma cor de assinatura distinta, o
// que dá variedade visual e transforma "que cor viro" numa decisão de verdade.
const HERO_COLORS = [
  0x17c3b2, // teal
  0xe84393, // magenta
  0xf39c12, // laranja
  0x7d5fff, // roxo
  0x7bed9f, // lima
  0xff6b6b, // coral
  0x48dbfb, // céu
  0xfeca57, // âmbar
];

// Waypoint na altura de operação do Caçador.
function wp(x, z) { return new THREE.Vector3(x, ROUTE_Y, z); }

export class Level {
  constructor(scene, layout = 1) {
    this.scene = scene;
    this.layout = layout;
    this.climbables = []; // alvos do raycaster de latching (= oclusores de visão)
    this.colorables = []; // alvos do raycaster de camuflagem
    this.solids = [];     // AABBs (THREE.Box3) para colisão de topo/queda

    // Definidos por cada layout (usados por Player e Game):
    this.spawn = new THREE.Vector3(0, 0, 6);      // início do jogador (x,z; y = chão)
    this.routes = [];                             // rotas de patrulha (1 por Caçador)

    // Materiais animados no loop (zumbido/pisca-pisca) — preenchidos em _build.
    this._panels = [];    // painéis fluorescentes do teto (emissive pulsante)
    this._strobes = [];   // girofles dos carros de polícia: { mat, phase, color }
    this._roomDoors = []; // {x,z} dos vãos de cômodo → mantidos livres no espalhamento

    this._build();
  }

  get occluders() { return this.climbables; }

  // Anima os elementos luminosos do cenário (chamado por Game no loop):
  //  • painéis do teto zumbem de leve; • girofles piscam em vermelho/azul.
  update(t) {
    const buzz = 1 + 0.06 * Math.sin(t * 40) + 0.04 * Math.sin(t * 13.7);
    for (const m of this._panels) m.emissiveIntensity = 1.1 * buzz;
    for (const s of this._strobes) {
      const on = Math.sin(t * 6 + s.phase) > 0;
      s.mat.emissiveIntensity = on ? 2.2 : 0.05;
    }
  }

  _addSolid(w, h, d, x, y, z) {
    const box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(w, h, d)
    );
    this.solids.push(box);
  }

  _addBox(w, h, d, color, x, y, z, {
    climbable = true, colorable = true,
    map = null, mapRepeat = null, roughness = 0.85, metalness = 0.0,
    emissive = null, emissiveIntensity = 0,
  } = {}) {
    // Bisel suave nas quinas para capturar melhor a luz. O raio é pequeno e
    // proporcional à menor dimensão (paredes finas, t=1, ganham chanfro discreto):
    // fica DENTRO da AABB de colisão e mantém faces planas com normais limpas —
    // o Latching/Raycaster continua caindo nas faces, não nos cantos arredondados.
    const radius = Math.min(0.22, 0.14 * Math.min(w, h, d));
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    if (emissive !== null) { mat.emissive = new THREE.Color(emissive); mat.emissiveIntensity = emissiveIntensity; }
    if (map) {
      // Clona a textura compartilhada para dar repeat próprio (por dimensão) sem
      // afetar as outras malhas que usam a mesma textura cacheada.
      const tex = map.clone();
      tex.needsUpdate = true;
      if (mapRepeat) tex.repeat.set(mapRepeat.x, mapRepeat.y);
      mat.map = tex;
    }
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.climbable = climbable;
    mesh.userData.colorable = colorable;
    this.scene.add(mesh);
    if (climbable) this.climbables.push(mesh);
    if (colorable) this.colorables.push(mesh);
    this._addSolid(w, h, d, x, y, z);
    return mesh;
  }

  // Parede amarelo-monótono com papel de parede oitentista. A cor (alvo de
  // camuflagem) é o amarelo desbotado; a textura clara só adiciona padrão/desgaste.
  // Grudável + colorável + sólida, como qualquer parede.
  _addWall(w, h, d, x, y, z) {
    const repeat = { x: Math.max(0.5, Math.max(w, d) / 4), y: Math.max(0.5, h / 3.5) };
    return this._addBox(w, h, d, 0xcbbf82, x, y, z, {
      map: wallpaperTexture(), mapRepeat: repeat, roughness: 0.95,
    });
  }

  _addSphere(r, color, x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 32, 24),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.colorable = true; // esferas só para camuflagem, não para grudar
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  // Cilindro decorativo: só camuflagem (colorable), NÃO grudável e sem AABB —
  // adiciona densidade visual e cores de disfarce sem alterar colisão/latching.
  _addCylinder(r, h, color, x, z, castShadow = true) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 20),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.colorable = true;
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  // Cone decorativo: mesmas regras do cilindro (colorable, não grudável).
  _addCone(r, h, color, x, z, castShadow = true) {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 22),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.colorable = true;
    this.scene.add(mesh);
    this.colorables.push(mesh);
    return mesh;
  }

  // Detalhe decorativo genérico posicionado livremente (qualquer geometria).
  // Sem AABB e não-grudável; colorável por padrão (alvo de camuflagem). Usado
  // pelos props temáticos para peças que não bloqueiam (cadeiras, malas, bolos…).
  _deco(geo, color, x, y, z, {
    rot = 0, rx = 0, cast = false, colorable = true,
    emissive = null, emissiveIntensity = 0, roughness = 0.7, metalness = 0.05,
  } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    if (emissive !== null) { mat.emissive = new THREE.Color(emissive); mat.emissiveIntensity = emissiveIntensity; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    mesh.rotation.x = rx;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    if (colorable) { mesh.userData.colorable = true; this.colorables.push(mesh); }
    this.scene.add(mesh);
    return mesh;
  }

  // ── CÔMODOS ("cabines" de camuflagem) ───────────────────────────────────────
  // Constrói um cômodo PASSÁVEL: 4 paredes coloridas grudáveis com vãos de porta
  // largos (o Caçador não tem pathfinding — becos fechados deixariam o jogador se
  // trancar). A cor de assinatura é um alvo forte de camuflagem. Retorna o centro
  // e os pontos de porta (para o espalhador manter livre). `doors` usa 'n','s',
  // 'e','w' (n=-z, s=+z, w=-x, e=+x); o padrão deixa dois lados opostos abertos.
  _buildRoom(cx, cz, w, d, color, { doors = ['s', 'n'], door = DOOR_MIN, h = ROOM_H, boxOpts = {} } = {}) {
    const hw = w / 2, hd = d / 2, t = 0.6;
    const mat = { roughness: 0.75, metalness: 0.06, ...boxOpts };

    // Parede ao longo de X (lados N/S), opcionalmente partida por um vão central.
    const wallAlongX = (zPos, hasDoor) => {
      if (!hasDoor) return void this._addBox(w, h, t, color, cx, h / 2, zPos, mat);
      const seg = (w - door) / 2;
      if (seg <= 0.2) return; // vão maior que a parede → lado totalmente aberto
      this._addBox(seg, h, t, color, cx - (door / 2 + seg / 2), h / 2, zPos, mat);
      this._addBox(seg, h, t, color, cx + (door / 2 + seg / 2), h / 2, zPos, mat);
    };
    // Parede ao longo de Z (lados W/E).
    const wallAlongZ = (xPos, hasDoor) => {
      if (!hasDoor) return void this._addBox(t, h, d, color, xPos, h / 2, cz, mat);
      const seg = (d - door) / 2;
      if (seg <= 0.2) return;
      this._addBox(t, h, seg, color, xPos, h / 2, cz - (door / 2 + seg / 2), mat);
      this._addBox(t, h, seg, color, xPos, h / 2, cz + (door / 2 + seg / 2), mat);
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

  // Registra os vãos de porta dos cômodos (para o espalhador não bloqueá-los) e o
  // centro (também mantido livre — evita entulhar a passagem interna).
  _collectDoors(...rooms) {
    for (const r of rooms) {
      for (const d of r.doors) this._roomDoors.push({ x: d.x, z: d.z });
      this._roomDoors.push({ x: r.center.x, z: r.center.z });
    }
  }

  // ── PROPS TEMÁTICOS ("Meccha Chameleon") ────────────────────────────────────
  // Cada zona compõe partes grudáveis/sólidas via _addBox e detalhes via _deco.
  // Cores temáticas distintas mantêm a variedade de alvos de camuflagem.

  // Máquina de refrigerante encostada na parede: corpo vivo grudável + painel
  // frontal emissivo. `dir` (unitário em x/z) aponta a frente iluminada.
  _buildVendingMachine(x, z, color, dir = { x: 0, z: 1 }) {
    const w = 2, h = 3.2, d = 1.1;
    this._addBox(w, h, d, color, x, h / 2, z, { roughness: 0.45, metalness: 0.15 });
    // Painel frontal (vidro do refrigerante) emissivo, na face indicada por dir.
    const alongX = Math.abs(dir.z) >= Math.abs(dir.x);
    const pw = (alongX ? w : d) * 0.68;
    const off = (alongX ? d : w) / 2 + 0.03;
    this._deco(new THREE.PlaneGeometry(pw, h * 0.62), 0x1a2a30,
      x + dir.x * off, h * 0.56, z + dir.z * off, {
        rot: alongX ? (dir.z < 0 ? Math.PI : 0) : (dir.x < 0 ? -Math.PI / 2 : Math.PI / 2),
        emissive: 0x8fd8ff, emissiveIntensity: 0.9, colorable: false, roughness: 0.3,
      });
  }

  // Canto entulhado: armários de arquivo (metal, grudáveis) + escada de alumínio
  // + cadeiras de escritório pretas empilhadas (decorativas, pretas = camuflagem).
  _buildChairCluster(x, z) {
    const alum = 0xc9ccd0, black = 0x141414;
    // Armários de arquivo em cores de assinatura (alvos de camuflagem altos).
    this._addBox(1.2, 2.4, 0.9, 0x17c3b2, x, 1.2, z, { roughness: 0.5, metalness: 0.3 });
    this._addBox(1.2, 1.8, 0.9, 0xff6b6b, x + 1.3, 0.9, z + 0.2, { roughness: 0.5, metalness: 0.3 });
    this._addBox(0.5, 3.0, 0.5, alum, x - 1.1, 1.5, z - 0.6, { roughness: 0.4, metalness: 0.4 }); // escada
    // Pilha de 3 cadeiras pretas (assento + encosto + pé).
    for (let i = 0; i < 3; i++) {
      const cx = x + 0.4 + i * 0.35, cz = z - 1.6 - i * 0.2, cy = 0.5 + i * 0.55;
      this._deco(new THREE.BoxGeometry(0.7, 0.18, 0.7), black, cx, cy, cz, { rot: i * 0.7, cast: true });
      this._deco(new THREE.BoxGeometry(0.7, 0.7, 0.14), black, cx, cy + 0.42, cz - 0.28, { rot: i * 0.7 });
      this._deco(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), black, cx, cy - 0.3, cz);
    }
  }

  // Lavanderia improvisada: fileira de lavadoras brancas grudáveis, com visor
  // escuro; cercadas por sacos de lixo pretos e pilha de malas coloridas.
  _buildLaundryZone(x, z) {
    const white = 0xeae7e0;
    for (let i = 0; i < 3; i++) {
      const wx = x + i * 1.9;
      this._addBox(1.7, 1.9, 1.6, white, wx, 0.95, z, { roughness: 0.4, metalness: 0.2 });
      // Visor circular escuro na frente (+z).
      this._deco(new THREE.CircleGeometry(0.45, 20), 0x20242a, wx, 1.05, z + 0.81, {
        emissive: 0x0a0c10, emissiveIntensity: 0.2, colorable: false,
      });
    }
    // Sacos de lixo pretos (esferas achatadas) — o esconderijo clássico.
    const bags = [[-1.4, 1.2], [-1.0, -1.1], [5.6, 0.9], [5.9, -1.0], [2.2, 1.9]];
    for (const [bx, bz] of bags) {
      const s = this._addSphere(0.55 + Math.random() * 0.2, 0x141414, x + bx, 0.5, z + bz);
      s.scale.y = 0.8;
    }
    // Pilha de malas coloridas (decorativas).
    const cases = [0xc0392b, 0x2980b9, 0x27ae60];
    cases.forEach((c, i) => this._deco(new THREE.BoxGeometry(1.0, 0.5, 0.7), c,
      x + 2 + i * 0.2, 0.25 + i * 0.5, z + 2.4, { rot: i * 0.4, cast: true }));
  }

  // Corredor de festa surreal: mesas compridas grudáveis, bexigas caídas
  // multicoloridas (vários alvos de camuflagem) e bolos pela metade em pratinhos.
  _buildBirthdayCorridor(x, z, len = 10) {
    // Duas mesas compridas com toalha colorida (grudáveis, apoio real).
    this._addBox(len, 0.9, 1.3, 0xe84393, x, 0.45, z, { roughness: 0.7 });
    this._addBox(len, 0.9, 1.3, 0x48dbfb, x, 0.45, z + 3, { roughness: 0.7 });
    const balloon = [0xe84393, 0x3498db, 0xf1c40f, 0x27ae60, 0xe74c3c, 0x9b59b6];
    for (let i = 0; i < len; i += 1.6) {
      const bx = x - len / 2 + i + 0.6;
      const c = balloon[(i * 1.3) % balloon.length | 0];
      // Bexigas caídas (chão) e algumas flutuando baixo.
      this._addSphere(0.4, c, bx, 0.4, z + 1.9 + (Math.random() - 0.5));
      if (i % 3 === 0) this._addSphere(0.45, balloon[(i) % balloon.length | 0], bx, 1.3, z + 3.6);
    }
    // Bolos pela metade + pratinhos sobre a mesa.
    for (let i = 0; i < 3; i++) {
      const cx = x - 3 + i * 3;
      this._deco(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16), 0xf5f5f0, cx, 0.94, z, {}); // prato
      this._deco(new THREE.CylinderGeometry(0.32, 0.35, 0.3, 16, 1, false, 0, Math.PI * 1.3),
        0xf7d9e3, cx, 1.11, z, { cast: true }); // bolo com fatia faltando
    }
  }

  // Rodovia quebrada: laje de asfalto elevada (apoio grudável), carros de polícia
  // abandonados e girofles piscando (registrados em this._strobes).
  _buildBrokenHighway(x, z) {
    this._addBox(12, 0.6, 8, 0x2b2b2e, x, 0.3, z, { roughness: 0.95 }); // laje de asfalto
    // Faixa central amarela (decorativa, sobre a laje).
    for (let i = -4; i <= 4; i += 2) {
      this._deco(new THREE.BoxGeometry(1.0, 0.02, 0.25), 0xd9c559, x + i, 0.61, z, {});
    }
    // Dois carros de polícia (corpo grudável branco + teto + girofle).
    const cars = [[-3, -1.5, 0.3], [3.5, 1.8, -0.6]];
    for (const [cx, cz, rot] of cars) {
      const px = x + cx, pz = z + cz;
      this._addBox(3.0, 1.0, 1.5, 0xe6e7ea, px, 1.1, pz, { roughness: 0.4, metalness: 0.2 }); // corpo
      this._deco(new THREE.BoxGeometry(1.6, 0.7, 1.4), 0x1d2733, px, 1.95, pz, { rot, cast: true }); // cabine
      this._deco(new THREE.BoxGeometry(1.2, 0.2, 0.5), 0x101216, px, 2.4, pz, { rot }); // barra de luz
      // Girofles vermelho/azul em contrafase.
      const red = this._deco(new THREE.BoxGeometry(0.5, 0.22, 0.5), 0x6a0d0d, px - 0.32, 2.45, pz,
        { rot, emissive: 0xff2222, emissiveIntensity: 2.2, colorable: false });
      const blue = this._deco(new THREE.BoxGeometry(0.5, 0.22, 0.5), 0x0d1c6a, px + 0.32, 2.45, pz,
        { rot, emissive: 0x2255ff, emissiveIntensity: 0.05, colorable: false });
      this._strobes.push({ mat: red.material, phase: 0 });
      this._strobes.push({ mat: blue.material, phase: Math.PI });
    }
  }

  // ── MOBÍLIA REALISTA ────────────────────────────────────────────────────────
  // Cada peça monta um objeto reconhecível a partir de primitivas. O CORPO
  // dominante é grudável e colorido (via _addBox) → alvo real de camuflagem; os
  // detalhes vão em _deco (não-grudáveis). Assim grudar no corpo casa com a cor
  // que se vê, sem mudar a mecânica.

  // Geladeira/armário alto: ótimo alvo (superfície vertical ampla e grudável).
  _buildFridge(x, z, color) {
    this._addBox(1.1, 2.6, 1.0, color, x, 1.3, z, { roughness: 0.4, metalness: 0.22 });
    // Divisória das portas + puxadores (na frente +z).
    this._deco(new THREE.BoxGeometry(1.02, 0.04, 0.02), shade(color, -0.25), x, 1.55, z + 0.51, {});
    for (const sy of [0.9, 1.9]) {
      this._deco(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), 0x20242a, x + 0.36, sy, z + 0.53,
        { colorable: false });
    }
  }

  // Estante/prateleira: corpo grudável + prateleiras e alguns itens coloridos
  // (itens são deco = cores extras de disfarce, não-grudáveis).
  _buildShelf(x, z, color) {
    this._addBox(1.8, 2.4, 0.6, color, x, 1.2, z, { roughness: 0.75 });
    const dark = shade(color, -0.28);
    for (let i = 0; i < 3; i++) {
      const sy = 0.7 + i * 0.7;
      this._deco(new THREE.BoxGeometry(1.7, 0.06, 0.62), dark, x, sy, z, {});
      // Itens sobre a prateleira (livros/caixas).
      for (let k = -1; k <= 1; k++) {
        if (Math.random() < 0.35) continue;
        const c = HERO_COLORS[(Math.abs(x + z + i + k) * 3 | 0) % HERO_COLORS.length];
        this._deco(new THREE.BoxGeometry(0.34, 0.4, 0.4), c, x + k * 0.5, sy + 0.26, z, { cast: false });
      }
    }
  }

  // Pilha de caixotes coloridos: cada caixote é grudável numa cor de assinatura
  // diferente — herói de camuflagem (várias cores próximas para escolher).
  _buildCrates(x, z, seed = 0) {
    const c = (i) => HERO_COLORS[(seed + i) % HERO_COLORS.length];
    this._addBox(1.1, 1.1, 1.1, c(0), x, 0.55, z, { roughness: 0.7 });
    this._addBox(1.0, 1.0, 1.0, c(2), x + 0.12, 1.6, z - 0.08, { roughness: 0.7 });
    this._addBox(0.95, 0.95, 0.95, c(4), x - 0.35, 0.48, z + 0.95, { roughness: 0.7 });
    // Sulcos das ripas (deco escuro) na caixa de baixo.
    this._deco(new THREE.BoxGeometry(1.12, 0.05, 0.05), shade(c(0), -0.3), x, 0.75, z + 0.56, {});
  }

  // Sofá: encosto colorido grudável (alvo vertical) + assento/braços/almofadas deco.
  _buildSofa(x, z, color) {
    this._addBox(2.2, 0.95, 0.3, color, x, 0.62, z - 0.5, { roughness: 0.9 }); // encosto (grudável)
    this._deco(new THREE.BoxGeometry(2.2, 0.4, 0.95), shade(color, -0.06), x, 0.32, z + 0.05, { roughness: 0.95 });
    for (const sx of [-1, 1]) {
      this._deco(new THREE.BoxGeometry(0.28, 0.62, 1.05), shade(color, -0.1), x + sx * 1.05, 0.44, z, { roughness: 0.95 });
    }
    for (const sx of [-1, 1]) {
      this._deco(new THREE.BoxGeometry(0.9, 0.18, 0.8), shade(color, 0.12), x + sx * 0.55, 0.58, z + 0.05, {});
    }
  }

  // Conjunto de mesa: tampo colorido grudável + monitor emissivo + cadeira deco.
  _buildDeskSet(x, z, color) {
    this._addBox(1.9, 0.85, 0.95, color, x, 0.42, z, { roughness: 0.6 }); // mesa (grudável)
    // Monitor (base + tela emissiva azulada).
    this._deco(new THREE.CylinderGeometry(0.12, 0.16, 0.18, 12), 0x1b1e24, x, 0.94, z - 0.15, { colorable: false });
    this._deco(new THREE.BoxGeometry(0.9, 0.55, 0.06), 0x0c0f14, x, 1.28, z - 0.2,
      { colorable: false, emissive: 0x2a4a6a, emissiveIntensity: 0.5 });
    // Cadeira (assento + encosto + pé), à frente da mesa.
    const cc = shade(color, -0.15);
    this._deco(new THREE.BoxGeometry(0.6, 0.14, 0.6), cc, x, 0.5, z + 0.85, { cast: true });
    this._deco(new THREE.BoxGeometry(0.6, 0.6, 0.12), cc, x, 0.82, z + 1.12, {});
    this._deco(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), 0x20242a, x, 0.25, z + 0.85, { colorable: false });
  }

  // Planta de vaso: vaso (terracota, colorável) + folhagem verde (deco).
  _buildPlant(x, z) {
    this._addCylinder(0.28, 0.5, 0xb5651d, x, z, false); // vaso (só colorável)
    this._deco(new THREE.SphereGeometry(0.5, 12, 10), 0x2f8f4e, x, 0.95, z, { cast: false });
    this._deco(new THREE.ConeGeometry(0.4, 0.7, 10), 0x35a05a, x, 1.35, z, { cast: false });
  }

  // Luminária de pé: haste + cúpula emissiva quente (spill de cor, sem custo de luz real).
  _buildLamp(x, z) {
    this._deco(new THREE.CylinderGeometry(0.05, 0.08, 2.0, 10), 0x2a2d33, x, 1.0, z, { colorable: false });
    this._deco(new THREE.ConeGeometry(0.42, 0.5, 14, 1, true), 0x3a2e18, x, 2.15, z,
      { colorable: false, emissive: 0xffcf8a, emissiveIntensity: 1.4 });
  }

  // Tapete: placa fina colorida no chão (colorável, não bloqueia) — cor no piso.
  _buildRug(x, z, color, w = 3, d = 2) {
    this._deco(new THREE.BoxGeometry(w, 0.04, d), color, x, 0.03, z, { roughness: 1.0 });
  }

  _build() {
    // Piso: carpete corporativo úmido (textura escura dirige a cor → material.color
    // branco). Não é colorável (não vira alvo de camuflagem), então cor livre.
    const carpet = carpetTexture().clone();
    carpet.needsUpdate = true;
    carpet.repeat.set(16, 16);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(HALF * 2, 1, HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: carpet, roughness: 1.0 })
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this._addSolid(HALF * 2, 1, HALF * 2, 0, -0.5, 0); // topo em y = 0

    // Paredes de perímetro: amarelo-monótono com papel de parede oitentista.
    const t = 1; // espessura
    this._addWall(HALF * 2, WALL_H, t, 0, WALL_H / 2, -HALF); // fundo
    this._addWall(HALF * 2, WALL_H, t, 0, WALL_H / 2, HALF);  // frente
    this._addWall(t, WALL_H, HALF * 2, -HALF, WALL_H / 2, 0); // esquerda
    this._addWall(t, WALL_H, HALF * 2, HALF, WALL_H / 2, 0);  // direita

    // Falso teto de gesso (puramente visual — acima das paredes, sem colisão).
    this._addCeiling();

    // Estrutura interna + spawn + rotas variam por estágio.
    if (this.layout === 2) this._buildMaze();
    else if (this.layout === 3) this._buildIslands();
    else this._buildOpen();

    // Densidade procedural: espalha clutter temático pela arena ampliada (depende
    // de spawn/routes já definidos pelo layout para respeitar as zonas livres).
    this._scatterProps();
  }

  // Falso teto: placas de gesso removíveis (algumas faltando) + painéis
  // fluorescentes emissivos. Fica ACIMA de WALL_H, virado para baixo, SEM AABB
  // e não-climbable/colorable → não prende o jogador nem entra nos raycasters.
  _addCeiling() {
    const y = WALL_H + 0.5;
    const tiles = ceilingTileTexture().clone();
    tiles.needsUpdate = true;
    tiles.repeat.set(HALF / 2, HALF / 2); // uma placa a cada ~4 unidades
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, HALF * 2),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, map: tiles, roughness: 1.0, side: THREE.FrontSide,
      })
    );
    ceil.rotation.x = Math.PI / 2;   // normal virada para baixo
    ceil.position.y = y;
    ceil.receiveShadow = true;
    this.scene.add(ceil);

    // Painéis fluorescentes embutidos: retângulos emissivos esverdeados. O brilho
    // acompanha o zumbido geral (registrados em this._panels, pulsados em update()).
    const PANEL_XZ = [
      [-20, -20], [20, -20], [-20, 20], [20, 20], [0, 0], [-14, 12], [14, -12],
    ];
    for (const [px, pz] of PANEL_XZ) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 1.4),
        new THREE.MeshStandardMaterial({
          color: 0x2a2c22, emissive: 0xdfeab0, emissiveIntensity: 1.1,
          roughness: 1.0,
        })
      );
      panel.rotation.x = Math.PI / 2;
      panel.position.set(px, y - 0.06, pz);
      this.scene.add(panel);
      this._panels.push(panel.material);
    }
  }

  // Estágio 1 — Arena Aberta. Zonas: cômodos coloridos + vending + cluster de cadeiras.
  _buildOpen() {
    // Partições/pilares de escritório (cobertura) — papel de parede amarelo.
    this._addWall(4, 5, 1, -8, 2.5, -6);
    this._addWall(1, 5, 6, 8, 2.5, -7);
    this._addWall(3, 7, 3, 0, 3.5, 10);   // pilar central
    this._addWall(5, 4, 1.2, -9, 2, 8);

    // Cômodos passáveis coloridos (cabines de camuflagem). Vãos em lados opostos
    // para o Caçador atravessar; cada um com sua cor de assinatura + mobília. Ficam
    // no interior, longe do anel de patrulha (|coord|~24) e dos waypoints centrais.
    const sala = this._buildRoom(-15, -14, 12, 11, 0x17c3b2, { doors: ['s', 'e'] }); // sala teal
    this._buildSofa(-15, -16, 0x17c3b2);
    this._buildDeskSet(-18, -12, 0x48dbfb);
    this._buildRug(-15, -14, 0x0f8f82, 5, 3.5);
    this._buildLamp(-18, -16, 0);

    const copa = this._buildRoom(16, -15, 11, 10, 0xf39c12, { doors: ['w', 'n'] }); // copa laranja
    this._buildFridge(18, -17, 0xf39c12);
    this._buildShelf(14, -17, 0xfeca57);
    this._buildPlant(18, -12);

    this._collectDoors(sala, copa);

    // Zona: máquinas de refrigerante encostadas nas paredes (esconderijo apelativo).
    this._buildVendingMachine(-12, -HALF + 1.5, 0x7d5fff, { x: 0, z: 1 });
    this._buildVendingMachine(-7, -HALF + 1.5, 0xff6b6b, { x: 0, z: 1 });
    this._buildVendingMachine(-HALF + 1.5, 6, 0x7bed9f, { x: 1, z: 0 });

    // Zona: canto entulhado de cadeiras e armários de arquivo coloridos.
    this._buildChairCluster(14, 14);
    this._buildCrates(20, 16, 1);

    this.spawn.set(0, 0, 0.15 * HALF);
    // Rotas relativas a HALF para acompanharem a arena ampliada (perímetro interno).
    const r = 0.6 * HALF;
    this.routes = [
      [wp(-r, -r), wp(r, -r), wp(r, r), wp(-r, r), wp(0, 0)],
      [wp(r, r), wp(-r, r), wp(0, -0.1 * HALF), wp(r, -r), wp(-r, -r)],
    ];
  }

  // Estágio 2 — Labirinto de Corredores. Estrutura interna (|x|,|z| < 12) forma
  // quinas próximas; um anel livre junto ao perímetro (|coord| ~14) mantém a rota
  // navegável. Exige reação rápida ao virar as esquinas.
  _buildMaze() {
    const H = 5;
    // Divisórias internas (papel de parede amarelo) formando corredores.
    this._addWall(1.5, H, 14, -6, H / 2, -3); // vertical esq.-centro
    this._addWall(1.5, H, 14, 6, H / 2, 3);   // vertical dir.-centro
    this._addWall(12, H, 1.5, 0, H / 2, -9);  // horizontal topo
    this._addWall(12, H, 1.5, 0, H / 2, 9);   // horizontal base
    this._addWall(2, 6, 2, 0, 3, 0);          // pilar central
    this._addWall(3, 4, 3, -10, 2, 10);       // bloco de canto
    this._addWall(3, 4, 3, 10, 2, -10);       // bloco de canto oposto

    // Cômodos coloridos na faixa intermediária (entre o miolo do labirinto e o
    // anel de patrulha), com vãos passáveis. Cores de assinatura distintas.
    const quarto = this._buildRoom(-20, 18, 10, 9, 0x7d5fff, { doors: ['s', 'e'] }); // quarto roxo
    this._buildSofa(-20, 16, 0x7d5fff);
    this._buildShelf(-23, 20, 0xe84393);
    this._buildLamp(-17, 20, 0);
    this._buildRug(-20, 18, 0x4b3b9e, 4.5, 3);

    const oficina = this._buildRoom(20, -18, 10, 9, 0xff6b6b, { doors: ['w', 'n'] }); // oficina coral
    this._buildCrates(21, -20, 3);
    this._buildFridge(17, -20, 0xff6b6b);
    this._buildDeskSet(22, -15, 0xfeca57);

    this._collectDoors(quarto, oficina);

    // Zona: lavanderia improvisada num braço do labirinto.
    this._buildLaundryZone(9, 14);
    // Zona: corredor de festa surreal ao longo de x, na faixa inferior.
    this._buildBirthdayCorridor(-2, -15, 12);

    const r = 0.7 * HALF;
    this.spawn.set(-r, 0, r); // canto do anel externo
    // Ronda pelo anel externo livre (cantos + meios das bordas) p/ cobertura
    // completa; o jogador usa o miolo do labirinto como cobertura.
    const ring = [
      wp(-r, -r), wp(0, -r), wp(r, -r), wp(r, 0),
      wp(r, r), wp(0, r), wp(-r, r), wp(-r, 0),
    ];
    this.routes = [ring, ring.slice().reverse()];
  }

  // Estágio 3 — Ilhas Centrais. Blocos agrupados no meio, perímetro aberto;
  // 2 Caçadores em rotas cruzadas (ver Game.js) forçam o uso da camuflagem.
  _buildIslands() {
    // Ilhas centrais como blocos de escritório (papel de parede amarelo).
    this._addWall(4, 5, 4, -4, 2.5, -4);
    this._addWall(4, 5, 4, 4, 2.5, 4);
    this._addWall(4, 6, 4, 4, 3, -4);
    this._addWall(4, 4, 4, -4, 2, 4);
    this._addWall(3, 7, 3, 0, 3.5, 0);   // torre central

    // Cômodos coloridos nos cantos internos (entre as ilhas e o anel de patrulha),
    // vãos passáveis — reforçam a necessidade de camuflar entre 2 Caçadores.
    const estudio = this._buildRoom(-16, 17, 10, 9, 0x48dbfb, { doors: ['s', 'e'] }); // estúdio céu
    this._buildSofa(-16, 15, 0x48dbfb);
    this._buildShelf(-19, 19, 0x17c3b2);
    this._buildRug(-16, 17, 0x2a8fb0, 4.5, 3);

    const almox = this._buildRoom(16, 17, 10, 9, 0x7bed9f, { doors: ['w', 'n'] }); // almoxarifado lima
    this._buildCrates(17, 15, 5);
    this._buildFridge(13, 19, 0x7bed9f);
    this._buildLamp(19, 15, 0);

    this._collectDoors(estudio, almox);

    // Zona: rodovia quebrada com carros de polícia e girofles (set piece lateral).
    this._buildBrokenHighway(-15, 0);
    // Zona: máquinas de refrigerante encostadas no perímetro.
    this._buildVendingMachine(8, -HALF + 1.5, 0xf39c12, { x: 0, z: 1 });
    this._buildVendingMachine(HALF - 1.5, -6, 0x7d5fff, { x: -1, z: 0 });

    this.spawn.set(0, 0, 0.8 * HALF); // área aberta na frente
    // Rotas cruzadas: uma em sentido horário no perímetro, outra em diagonal
    // oposta — cobrem corredores diferentes ao redor das ilhas.
    const r = 0.65 * HALF;
    this.routes = [
      [wp(-r, -r), wp(r, -r), wp(r, r), wp(-r, r)],
      [wp(r, r), wp(-r, -r), wp(r, -r), wp(-r, r)],
    ];
  }

  // Espalha props preenchendo a arena ampliada:
  //  • MOBÍLIA realista (geladeira/estante/sofá/mesa/caixotes) com corpo grudável
  //    colorido → esconderijos reais e alvos fortes de camuflagem.
  //  • ~16 CAIXAS grudáveis (via _addBox) → mais esconderijos + oclusores de visão.
  //  • DECORATIVOS (cilindros/cones/esferas) e detalhes de realismo (plantas,
  //    luminárias, tapetes) → densidade e cores de camuflagem, sem bloquear.
  // PRNG seedado por layout → disposição reproduzível por estágio.
  _scatterProps() {
    const rand = mulberry32((this.layout * 0x9e3779b1) >>> 0);
    const range = (a, b) => a + rand() * (b - a);
    const pick = (arr) => arr[(rand() * arr.length) | 0];

    // Paleta: neutros realistas (preto-lixo, branco/cinza-máquina, marrom-madeira)
    // + toda a paleta viva Meccha Chameleon (HERO_COLORS) para muitos alvos de cor.
    const PALETTE = [
      0x141414, 0x1c1c1e, 0x2b2b2e,             // pretos/asfalto
      0xeae7e0, 0xd8d6c8, 0x8a8f96, 0xc9ccd0,   // brancos/cinzas de máquina/metal
      0x6b4e2e, 0xb98a5a, 0x8c6d3f,             // marrons de mala/caixa/madeira
      ...HERO_COLORS,                           // vivos saturados (zonas/props herói)
    ];

    const margin = 3;                 // afastamento das paredes de perímetro
    const AREA = HALF - margin;       // faixa útil de espalhamento
    const BAND_MIN = HALF - 6;        // faixa "perto das paredes"
    const BAND_MAX = HALF - margin;

    // Zonas livres iniciais: spawn e cada waypoint (evita encurralar o Caçador).
    const placed = [{ x: this.spawn.x, z: this.spawn.z, r: 4 }];
    for (const route of this.routes) {
      for (const w of route) placed.push({ x: w.x, z: w.z, r: 3 });
    }
    // Vãos de porta e centros de cômodo: mantidos livres para não entulhar a
    // passagem (senão o Caçador ficaria preso e o jogador se trancaria).
    for (const d of this._roomDoors) placed.push({ x: d.x, z: d.z, r: 2.2 });

    // Livre se não sobrepõe sólidos existentes (paredes de perímetro, blocos
    // estruturais e caixas já espalhadas) nem as zonas/decorativos já colocados.
    const isClear = (x, z, rad) => {
      for (const box of this.solids) {
        // pula o chão (cobre toda a arena nos dois eixos)
        if (box.max.x - box.min.x > HALF && box.max.z - box.min.z > HALF) continue;
        if (x + rad > box.min.x && x - rad < box.max.x &&
            z + rad > box.min.z && z - rad < box.max.z) return false;
      }
      for (const p of placed) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz < (rad + p.r) * (rad + p.r)) return false;
      }
      return true;
    };

    // Candidato: nearWall força a faixa junto ao perímetro (num eixo aleatório).
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
        if (isClear(p.x, p.z, rad + 0.6)) return p;
      }
      return null;
    };

    // Mobília realista espalhada: corpo grudável colorido + detalhes. Cada tipo
    // reserva um raio nominal; alterna para variedade. Alguns encostam nas paredes.
    const furniture = [
      { r: 1.9, make: (x, z) => this._buildCrates(x, z, (rand() * 8) | 0) },
      { r: 1.2, make: (x, z) => this._buildFridge(x, z, pick(HERO_COLORS)) },
      { r: 1.3, make: (x, z) => this._buildShelf(x, z, pick(HERO_COLORS)) },
      { r: 1.7, make: (x, z) => this._buildSofa(x, z, pick(HERO_COLORS)) },
      { r: 1.7, make: (x, z) => this._buildDeskSet(x, z, pick(HERO_COLORS)) },
    ];
    for (let i = 0; i < 8; i++) {
      const f = furniture[i % furniture.length];
      const p = findSpot(f.r, i < 3);
      if (!p) continue;
      f.make(p.x, p.z);
      placed.push({ x: p.x, z: p.z, r: f.r + 0.4 });
    }

    // ~16 caixas grudáveis; parte forçada para junto das paredes.
    for (let i = 0; i < 16; i++) {
      const w = range(1.0, 2.5), d = range(1.0, 2.5), h = range(1.5, 4.0);
      const rad = Math.hypot(w, d) / 2;
      const p = findSpot(rad, i < 6);
      if (!p) continue;
      this._addBox(w, h, d, pick(PALETTE), p.x, h / 2, p.z);
      placed.push({ x: p.x, z: p.z, r: rad });
    }

    // ~20 decorativos alternando cilindro / cone / esfera.
    for (let i = 0; i < 20; i++) {
      const kind = i % 3;
      const nearWall = i < 8;
      let rad, h;
      if (kind === 0) { rad = range(0.4, 1.0); h = range(1.5, 3.5); }
      else if (kind === 1) { rad = range(0.6, 1.2); h = range(1.5, 3.0); }
      else { rad = range(0.5, 1.1); h = 0; }
      const p = findSpot(rad, nearWall);
      if (!p) continue;
      const color = pick(PALETTE);
      const cast = h >= 2.5;           // só os maiores projetam sombra (perf mobile)
      if (kind === 0) this._addCylinder(rad, h, color, p.x, p.z, cast);
      else if (kind === 1) this._addCone(rad, h, color, p.x, p.z, cast);
      else this._addSphere(rad, color, p.x, rad, p.z);
      placed.push({ x: p.x, z: p.z, r: rad });
    }

    // Detalhes de realismo só-coloráveis (não bloqueiam): plantas, luminárias que
    // lançam brilho quente, e tapetes coloridos no chão. Densidade + cor ambiente.
    for (let i = 0; i < 6; i++) {
      const p = findSpot(0.7, i < 2);
      if (!p) continue;
      const roll = rand();
      if (roll < 0.5) this._buildPlant(p.x, p.z);
      else if (roll < 0.8) this._buildLamp(p.x, p.z);
      else this._buildRug(p.x, p.z, pick(HERO_COLORS));
      placed.push({ x: p.x, z: p.z, r: 1.0 });
    }
  }
}

// Clareia (k>0) ou escurece (k<0) uma cor mantendo o matiz — usado para derivar
// detalhes (almofadas, sulcos, cadeiras) a partir da cor de assinatura do prop.
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
