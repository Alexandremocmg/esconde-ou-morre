import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Constrói a sala de teste com primitivas.
// Marca cada malha com userData:
//   climbable = superfície onde o jogador pode grudar (paredes/blocos)
//   colorable = objeto cuja cor pode ser copiada pela camuflagem
const HALF = 20;      // meia-largura do piso
const WALL_H = 8;
const ROUTE_Y = 1.1;  // altura dos waypoints (= EYE_Y do Caçador)

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

    this._build();
  }

  get occluders() { return this.climbables; }

  _addSolid(w, h, d, x, y, z) {
    const box = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(w, h, d)
    );
    this.solids.push(box);
  }

  _addBox(w, h, d, color, x, y, z, { climbable = true, colorable = true } = {}) {
    // Bisel suave nas quinas para capturar melhor a luz. O raio é pequeno e
    // proporcional à menor dimensão (paredes finas, t=1, ganham chanfro discreto):
    // fica DENTRO da AABB de colisão e mantém faces planas com normais limpas —
    // o Latching/Raycaster continua caindo nas faces, não nos cantos arredondados.
    const radius = Math.min(0.22, 0.14 * Math.min(w, h, d));
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, radius),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 })
    );
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

  _build() {
    // Chão + paredes de perímetro são comuns a todos os layouts.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(HALF * 2, 1, HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 1.0 })
    );
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this._addSolid(HALF * 2, 1, HALF * 2, 0, -0.5, 0); // topo em y = 0

    // Paredes de perímetro (cores distintas para testar camuflagem)
    const t = 1; // espessura
    this._addBox(HALF * 2, WALL_H, t, 0xc0392b, 0, WALL_H / 2, -HALF); // fundo (vermelho)
    this._addBox(HALF * 2, WALL_H, t, 0x2980b9, 0, WALL_H / 2, HALF);  // frente (azul)
    this._addBox(t, WALL_H, HALF * 2, 0x27ae60, -HALF, WALL_H / 2, 0); // esquerda (verde)
    this._addBox(t, WALL_H, HALF * 2, 0xf39c12, HALF, WALL_H / 2, 0);  // direita (laranja)

    // Estrutura interna + spawn + rotas variam por estágio.
    if (this.layout === 2) this._buildMaze();
    else if (this.layout === 3) this._buildIslands();
    else this._buildOpen();
  }

  // Estágio 1 — Arena Aberta (layout clássico).
  _buildOpen() {
    this._addBox(4, 5, 4, 0x8e44ad, -8, 2.5, -6);  // roxo
    this._addBox(6, 3, 2, 0x16a085, 7, 1.5, -8);   // teal
    this._addBox(2, 6, 2, 0xe67e22, 9, 3, 6);      // pilar laranja
    this._addBox(5, 4, 5, 0x2c3e50, -9, 2, 8);     // grafite
    this._addBox(3, 7, 3, 0xd35400, 0, 3.5, 10);   // torre

    this._addSphere(1.2, 0xf1c40f, 4, 1.2, 2);
    this._addSphere(0.9, 0xe74c3c, -4, 0.9, -2);
    this._addSphere(1.0, 0x3498db, 12, 1.0, -2);

    this.spawn.set(0, 0, 6);
    this.routes = [
      [wp(-12, -12), wp(12, -12), wp(12, 12), wp(-12, 12), wp(0, 0)],
      [wp(12, 12), wp(-12, 12), wp(0, -2), wp(12, -12), wp(-12, -12)],
    ];
  }

  // Estágio 2 — Labirinto de Corredores. Estrutura interna (|x|,|z| < 12) forma
  // quinas próximas; um anel livre junto ao perímetro (|coord| ~14) mantém a rota
  // navegável. Exige reação rápida ao virar as esquinas.
  _buildMaze() {
    const H = 5;
    // Paredes internas (divisórias) formando corredores.
    this._addBox(1.5, H, 14, 0x8e44ad, -6, H / 2, -3); // vertical esq.-centro
    this._addBox(1.5, H, 14, 0x16a085, 6, H / 2, 3);   // vertical dir.-centro
    this._addBox(12, H, 1.5, 0x2980b9, 0, H / 2, -9);  // horizontal topo
    this._addBox(12, H, 1.5, 0xd35400, 0, H / 2, 9);   // horizontal base
    this._addBox(2, 6, 2, 0xe67e22, 0, 3, 0);          // pilar central
    this._addBox(3, 4, 3, 0x2c3e50, -10, 2, 10);       // bloco de canto
    this._addBox(3, 4, 3, 0xc0392b, 10, 2, -10);       // bloco de canto oposto

    this._addSphere(1.0, 0xf1c40f, -12, 1.0, -1);
    this._addSphere(0.9, 0x3498db, 12, 0.9, 1);

    this.spawn.set(-14, 0, 14); // canto do anel externo
    // Ronda pelo anel externo livre (cantos + meios das bordas) p/ cobertura
    // completa; o jogador usa o miolo do labirinto como cobertura.
    const ring = [
      wp(-14, -14), wp(0, -14), wp(14, -14), wp(14, 0),
      wp(14, 14), wp(0, 14), wp(-14, 14), wp(-14, 0),
    ];
    this.routes = [ring, ring.slice().reverse()];
  }

  // Estágio 3 — Ilhas Centrais. Blocos agrupados no meio, perímetro aberto;
  // 2 Caçadores em rotas cruzadas (ver Game.js) forçam o uso da camuflagem.
  _buildIslands() {
    this._addBox(4, 5, 4, 0x8e44ad, -4, 2.5, -4); // roxo
    this._addBox(4, 5, 4, 0x16a085, 4, 2.5, 4);   // teal
    this._addBox(4, 6, 4, 0xd35400, 4, 3, -4);    // laranja escuro
    this._addBox(4, 4, 4, 0x2c3e50, -4, 2, 4);    // grafite
    this._addBox(3, 7, 3, 0xe67e22, 0, 3.5, 0);   // torre central

    this._addSphere(1.1, 0xf1c40f, -8, 1.1, 0);
    this._addSphere(1.0, 0xe74c3c, 8, 1.0, 0);
    this._addSphere(0.9, 0x3498db, 0, 0.9, 8);

    this.spawn.set(0, 0, 16); // área aberta na frente
    // Rotas cruzadas: uma em sentido horário no perímetro, outra em diagonal
    // oposta — cobrem corredores diferentes ao redor das ilhas.
    this.routes = [
      [wp(-13, -13), wp(13, -13), wp(13, 13), wp(-13, 13)],
      [wp(13, 13), wp(-13, -13), wp(13, -13), wp(-13, 13)],
    ];
  }
}
