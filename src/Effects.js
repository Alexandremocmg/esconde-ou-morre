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
    // Pool de gotas de água (jato + respingos)
    this.waterDrops = [];
    const dropGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const dropMat = new THREE.MeshBasicMaterial({
      color: 0x59c1e8, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(dropGeo, dropMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.waterDrops.push({ mesh, t: 0, life: 0.3, vel: new THREE.Vector3(), alive: false });
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

  // Jato de água pressurizada do Caçador até o alvo (de fromPos até toPos)
  waterJetBeam(fromPos, toPos, hitTarget = false) {
    const count = 4;
    const dir = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = dir.length();
    if (dist < 0.1) return;
    dir.normalize();

    for (let i = 0; i < count; i++) {
      const drop = this.waterDrops.find(d => !d.alive);
      if (!drop) break;
      drop.alive = true;
      drop.t = 0;
      drop.life = 0.25 + Math.random() * 0.15;
      drop.mesh.visible = true;
      // Posiciona ao longo do trajeto com leve espalhamento
      const offset = (i / count) * dist;
      drop.mesh.position.copy(fromPos).addScaledVector(dir, offset);
      drop.mesh.position.x += (Math.random() - 0.5) * 0.12;
      drop.mesh.position.y += (Math.random() - 0.5) * 0.12;
      drop.mesh.position.z += (Math.random() - 0.5) * 0.12;
      drop.vel.copy(dir).multiplyScalar(12 + Math.random() * 6);
      drop.mesh.material.color.setHex(hitTarget ? 0x59c1e8 : 0x88d4f2);
      drop.mesh.material.opacity = 0.85;
    }
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

    // Atualiza gotas do jato de água
    for (const d of this.waterDrops) {
      if (!d.alive) continue;
      d.t += dt;
      const k = d.t / d.life;
      if (k >= 1) {
        d.alive = false;
        d.mesh.visible = false;
        d.mesh.material.opacity = 0;
        continue;
      }
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.material.opacity = 0.85 * (1 - k);
    }
  }
}
