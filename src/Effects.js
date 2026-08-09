import * as THREE from 'three';

// Gerenciador de efeitos transitórios (juice). Mantém um pool de "anéis" que
// expandem e desvanecem — usado ao trocar de cor (camuflar) e ao grudar na parede.
const POOL = 8;
const LIFE = 0.55;          // s de vida de cada pulso
const START_SCALE = 0.4;
const END_SCALE = 2.6;

export class Effects {
  constructor(scene) {
    this.pool = [];
    this._next = 0;

    // Anel fino (torus achatado) reutilizado por todos os pulsos.
    const geo = new THREE.TorusGeometry(1, 0.06, 8, 32);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, mat, t: 0, alive: false });
    }
  }

  // Dispara um pulso na posição dada, com a cor informada.
  pulse(position, color = 0xffffff) {
    const p = this.pool[this._next];
    this._next = (this._next + 1) % this.pool.length;
    p.alive = true;
    p.t = 0;
    p.mesh.visible = true;
    p.mesh.position.copy(position);
    p.mat.color.set(color);
  }

  update(dt, camera) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.t += dt;
      const k = p.t / LIFE;
      if (k >= 1) {
        p.alive = false;
        p.mesh.visible = false;
        p.mat.opacity = 0;
        continue;
      }
      const s = START_SCALE + (END_SCALE - START_SCALE) * k;
      p.mesh.scale.setScalar(s);
      p.mat.opacity = 0.55 * (1 - k);
      // Encara a câmera para o anel ficar sempre legível.
      if (camera) p.mesh.quaternion.copy(camera.quaternion);
    }
  }
}
