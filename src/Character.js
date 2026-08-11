import * as THREE from 'three';

// Constrói um "art toy" de vinil (estilo Pop Mart / Meccha Chameleon): cabeça
// redonda grande, corpo gelatinoso e sem traços, braços e pernas atarracados,
// sem dedos. Acabamento fosco. TODAS as partes compartilham UM material (passado
// pelo chamador) — assim a camuflagem/cor tinge o boneco inteiro de uma vez e o
// brilho (emissive) reluz por igual.
//
// A figura fica centrada na origem no eixo vertical (altura = local Y), com a
// "frente" em +Z e os pés em -height/2. Braços e pernas ficam em PIVÔS no ombro/
// quadril, para o animador de caminhada (Gait) balançá-los como um passo humano.
// Cabeça, torso e braços vão num grupo `upper` que recebe o bob e a inclinação.
//
// Retorna o grupo, medidas da cabeça (p/ posicionar olhos/visor) e o `rig` com as
// juntas animáveis.
export function buildHumanoid(material, height = 1, { castShadow = true } = {}) {
  const H = height;
  const g = new THREE.Group();
  const mk = (geo) => { const m = new THREE.Mesh(geo, material); m.castShadow = castShadow; return m; };

  // Tronco superior (cabeça + torso + ombros): recebe bob/inclinação da passada.
  const upper = new THREE.Group();
  g.add(upper);

  // Cabeça redonda (grande, proporção chibi): topo em +0.5H.
  const headR = 0.24 * H;
  const headY = 0.5 * H - headR;
  const head = mk(new THREE.SphereGeometry(headR, 24, 18));
  head.position.y = headY;
  upper.add(head);

  // Torso gelatinoso: cápsula rechonchuda que se funde à cabeça e às pernas.
  const torsoR = 0.26 * H, torsoL = 0.20 * H;
  const torso = mk(new THREE.CapsuleGeometry(torsoR, torsoL, 8, 20));
  torso.position.y = -0.02 * H;
  upper.add(torso);

  // Pernas atarracadas (bípede): cada uma pendurada num PIVÔ no quadril, para
  // balançar em torno do topo (passo). Pés apoiados em -0.5H quando em repouso.
  const legR = 0.115 * H, legL = 0.12 * H;
  const legHalf = legL / 2 + legR;
  const hipY = -0.5 * H + 2 * legHalf;
  const legX = 0.12 * H;
  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * legX, hipY, 0);
    const leg = mk(new THREE.CapsuleGeometry(legR, legL, 6, 12));
    leg.position.y = -legHalf; // pendura a partir do quadril
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }

  // Braços atarracados (sem mãos/dedos): pivô no ombro, dentro do `upper` para
  // acompanhar bob/inclinação. Abertura lateral base + balanço em contrafase.
  const armR = 0.10 * H, armL = 0.14 * H;
  const armHalf = armL / 2 + armR;
  const shoulderY = 0.08 * H + armHalf;
  const armX = 0.28 * H;
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * armX, shoulderY, 0);
    pivot.rotation.z = sx * -0.20; // leve abertura para os lados (pose de repouso)
    const arm = mk(new THREE.CapsuleGeometry(armR, armL, 6, 12));
    arm.position.y = -armHalf;
    pivot.add(arm);
    upper.add(pivot);
    arms.push(pivot);
  }

  return { group: g, headR, headY, rig: { upper, legs, arms, height: H } };
}

const MAX_STEP_RATE = 15; // rad/s: teto da cadência (evita "perna em câmera rápida")

// Animador de caminhada procedural. Balança pernas/braços, faz o tronco subir e
// descer (bob) e inclinar levemente para a frente. A fase avança pela DISTÂNCIA
// percorrida (não pelo tempo), então os passos acompanham o deslocamento real e
// os pés quase não escorregam. Em repouso, relaxa numa respiração sutil.
export class Gait {
  constructor(rig, opts = {}) {
    this.rig = rig;
    this.phase = opts.phase || 0;
    this.amp = 0; // 0..1: intensidade da caminhada (suavizada)
    this.crouch = 0; // 0..1: quanto está agachado (pose aplicada no fim de update)
    this.t = 0;
    this.strideLen = opts.strideLen != null ? opts.strideLen : rig.height * 0.85;
    this.swing = opts.swing != null ? opts.swing : 0.7;     // balanço das pernas (rad)
    this.armSwing = opts.armSwing != null ? opts.armSwing : 0.55;
  }

  // dt em s; dist = distância percorrida neste frame (m).
  update(dt, dist) {
    this.t += dt;
    const moving = dist > 1e-4;
    this.amp += ((moving ? 1 : 0) - this.amp) * Math.min(1, 8 * dt);

    // Avança a fase pelo deslocamento (um passo por strideLen), com teto de cadência.
    this.phase += Math.min((dist / this.strideLen) * Math.PI, MAX_STEP_RATE * dt);

    const a = this.amp;
    const s = Math.sin(this.phase);
    const legs = this.rig.legs;
    const arms = this.rig.arms;

    // Pernas alternadas; braços em contrafase (oposto ao mesmo lado) + respiração.
    const legSwing = s * this.swing * a;
    legs[0].rotation.x = legSwing;
    legs[1].rotation.x = -legSwing;

    const idleArm = Math.sin(this.t * 2.0) * 0.06 * (1 - a); // leve sway parado
    const armSwing = s * this.armSwing * a;
    arms[0].rotation.x = -armSwing + idleArm;
    arms[1].rotation.x = armSwing + idleArm;

    // Bob vertical (2 batidas por ciclo) + inclinação para a frente (+Z local).
    const upper = this.rig.upper;
    const bob = Math.abs(Math.cos(this.phase)) - 0.5;         // -0.5..0.5
    const breath = Math.sin(this.t * 2.2) * 0.01 * this.rig.height * (1 - a);
    upper.position.y = bob * 0.06 * this.rig.height * a + breath;
    upper.rotation.x = -0.14 * a;

    // Pose de AGACHAR (aditiva sobre a caminhada): dobra os joelhos para a frente
    // e abre a base, afunda e inclina o tronco, recolhe os braços. Sem esmagar a
    // malha — lê como um humanoide se abaixando, não como um boneco achatado.
    const c = this.crouch;
    if (c > 1e-3) {
      const H = this.rig.height;
      upper.position.y -= 0.14 * H * c;   // tronco afunda em direção ao quadril
      upper.rotation.x -= 0.55 * c;       // inclina para a frente (hunch)
      legs[0].rotation.x -= 0.32 * c;     // coxas para a frente (joelhos dobrando)
      legs[1].rotation.x -= 0.32 * c;
      legs[0].rotation.z = 0.22 * c;      // base mais aberta (agachamento) — SET (gait não mexe em z)
      legs[1].rotation.z = -0.22 * c;
      arms[0].rotation.x -= 0.28 * c;     // braços recolhem à frente (equilíbrio)
      arms[1].rotation.x -= 0.28 * c;
    } else {
      legs[0].rotation.z = 0;
      legs[1].rotation.z = 0;
    }
  }
}
