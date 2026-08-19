import * as THREE from 'three';

// Gerenciador de efeitos transitórios (juice). Mantém um pool de "anéis" que
// expandem e desvanecem — usado ao trocar de cor (camuflar) e ao grudar na parede.
const POOL = 8;
const LIFE = 0.55;          // s de vida de cada pulso
const START_SCALE = 0.4;
const END_SCALE = 2.6;
const BEAM_LIFE = 0.14;      // s de vida do traço instantâneo do jato de água (Effects.waterJetBeam)

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
    // Pool de gotas de água (jato + respingo de impacto). 48 (era 24): o jato sozinho
    // já usa até 14 e o respingo de impacto soma mais 10 — precisa de folga pra dois
    // tiros seguidos ainda se sobreporem sem gotas faltando no pool.
    this.waterDrops = [];
    const dropGeo = new THREE.SphereGeometry(0.11, 6, 6); // era 0.08 — quase invisível a distância
    const dropMat = new THREE.MeshBasicMaterial({
      color: 0x59c1e8, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(dropGeo, dropMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.waterDrops.push({ mesh, t: 0, life: 0.3, vel: new THREE.Vector3(), alive: false });
    }

    // Traço instantâneo do cano até o alvo (era só as gotas espalhadas — muito esparsas
    // pra ler como "um jato", sobretudo à distância/em movimento). Cilindro fino
    // esticado ao longo do trajeto inteiro, aditivo, sumindo rápido — leitura imediata
    // de "onde o tiro passou" no mesmo frame do disparo, antes mesmo das gotas viajarem.
    // CylinderGeometry nasce com o eixo ao longo de Y, de -0.5 a +0.5 — desloca pra
    // 0..1 (base na origem) pra `mesh.scale.y = distância` esticar o comprimento certo
    // a partir de `fromPos` (mesmo truque de orientar via quaternion já usado no braço
    // em 1ª pessoa do Caçador — ver Game.js:_buildHunterViewArm/capsuleBetween).
    this.beams = [];
    const beamGeo = new THREE.CylinderGeometry(0.035, 0.06, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0);
    const BEAM_POOL = 4;
    for (let i = 0; i < BEAM_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbfe9ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.beams.push({ mesh, mat, t: 0, alive: false });
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

  // Jato de água pressurizada do Caçador até o alvo (de fromPos até toPos). Antes era
  // só 4 gotinhas de 0.08 espalhadas ao longo do trajeto — lia como "algumas manchas
  // piscando", não como um jato. Agora: um TRAÇO instantâneo cobrindo o trajeto inteiro
  // (leitura imediata, no mesmo frame do disparo) + mais gotas maiores viajando atrás
  // dele + um respingo de impacto se acertou.
  waterJetBeam(fromPos, toPos, hitTarget = false) {
    const dir = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = dir.length();
    if (dist < 0.1) return;
    dir.normalize();

    // Traço instantâneo: cobre o trajeto inteiro já no primeiro frame, então dá pra
    // ver de onde o tiro saiu e onde bateu mesmo que ninguém esteja olhando bem na
    // hora — as gotas viajando levam alguns frames pra "desenhar" o mesmo caminho.
    const beam = this.beams.find((b) => !b.alive) || this.beams[0];
    beam.alive = true;
    beam.t = 0;
    beam.mesh.visible = true;
    beam.mesh.position.copy(fromPos);
    beam.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    beam.mesh.scale.set(1, dist, 1);
    beam.mat.color.setHex(hitTarget ? 0x59c1e8 : 0x9fdcf7);
    beam.mat.opacity = 0.75;

    const count = 12; // era 4 — muito esparso pra ler como um jato contínuo
    for (let i = 0; i < count; i++) {
      const drop = this.waterDrops.find(d => !d.alive);
      if (!drop) break;
      drop.alive = true;
      drop.t = 0;
      drop.life = 0.35 + Math.random() * 0.2;
      drop.mesh.visible = true;
      // Posiciona ao longo do trajeto com leve espalhamento
      const offset = (i / count) * dist;
      drop.mesh.position.copy(fromPos).addScaledVector(dir, offset);
      drop.mesh.position.x += (Math.random() - 0.5) * 0.12;
      drop.mesh.position.y += (Math.random() - 0.5) * 0.12;
      drop.mesh.position.z += (Math.random() - 0.5) * 0.12;
      drop.vel.copy(dir).multiplyScalar(12 + Math.random() * 6);
      drop.mesh.material.color.setHex(hitTarget ? 0x59c1e8 : 0x88d4f2);
      drop.mesh.material.opacity = 0.9;
      drop.mesh.scale.setScalar(1);
    }

    // Respingo de impacto: só quando acertou — marca o ponto de acerto com um estouro
    // de gotas pra fora em todas as direções, distinto da viagem em linha reta acima.
    if (hitTarget) {
      const splashCount = 10;
      for (let i = 0; i < splashCount; i++) {
        const drop = this.waterDrops.find(d => !d.alive);
        if (!drop) break;
        drop.alive = true;
        drop.t = 0;
        drop.life = 0.25 + Math.random() * 0.15;
        drop.mesh.visible = true;
        drop.mesh.position.copy(toPos);
        drop.mesh.scale.setScalar(0.7);
        // Direção aleatória num hemisfério voltado pra "fora" do trajeto (não pra
        // dentro do alvo) — vetor aleatório na esfera, empurrado pra longe de `dir`.
        const rnd = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
        drop.vel.copy(rnd).addScaledVector(dir, -0.3).normalize().multiplyScalar(4 + Math.random() * 3);
        drop.mesh.material.color.setHex(0x59c1e8);
        drop.mesh.material.opacity = 0.9;
      }
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
      d.mesh.material.opacity = 0.9 * (1 - k);
    }

    // Traço instantâneo do jato: some rápido (BEAM_LIFE) — só precisa durar o
    // suficiente pro olho pegar "por onde o tiro passou" no instante do disparo.
    for (const b of this.beams) {
      if (!b.alive) continue;
      b.t += dt;
      const k = b.t / BEAM_LIFE;
      if (k >= 1) {
        b.alive = false;
        b.mesh.visible = false;
        b.mat.opacity = 0;
        continue;
      }
      b.mat.opacity = 0.75 * (1 - k);
    }
  }
}
