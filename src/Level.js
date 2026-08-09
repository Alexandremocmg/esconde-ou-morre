import * as THREE from 'three';

// Constrói a sala de teste com primitivas.
// Marca cada malha com userData:
//   climbable = superfície onde o jogador pode grudar (paredes/blocos)
//   colorable = objeto cuja cor pode ser copiada pela camuflagem
export class Level {
  constructor(scene) {
    this.scene = scene;
    this.climbables = []; // alvos do raycaster de latching (= oclusores de visão)
    this.colorables = []; // alvos do raycaster de camuflagem
    this.solids = [];     // AABBs (THREE.Box3) para colisão de topo/queda
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
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
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
    const HALF = 20; // meia-largura do piso
    const WALL_H = 8;

    // Chão (não é colorável nem grudável)
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

    // Blocos internos coloridos (paredes/obstáculos para escalar e camuflar)
    this._addBox(4, 5, 4, 0x8e44ad, -8, 2.5, -6);  // roxo
    this._addBox(6, 3, 2, 0x16a085, 7, 1.5, -8);   // teal
    this._addBox(2, 6, 2, 0xe67e22, 9, 3, 6);      // pilar laranja
    this._addBox(5, 4, 5, 0x2c3e50, -9, 2, 8);     // grafite
    this._addBox(3, 7, 3, 0xd35400, 0, 3.5, 10);   // torre

    // Esferas decorativas coloridas (alvos extras de camuflagem)
    this._addSphere(1.2, 0xf1c40f, 4, 1.2, 2);   // amarelo
    this._addSphere(0.9, 0xe74c3c, -4, 0.9, -2);  // vermelho vivo
    this._addSphere(1.0, 0x3498db, 12, 1.0, -2);  // azul claro
  }
}
