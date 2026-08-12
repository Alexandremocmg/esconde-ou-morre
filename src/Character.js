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
// Fase 4 (+ manequim): fábrica de CORPOS selecionáveis (estilo Meccha Chameleon). `kind`:
//   'toy'      — art toy de vinil (cabeça redonda + torso gelatinoso + membros)
//   'mannequin'— pictograma macio (cabeça-bola + torso ovoide) com membros ARTICULADOS s/ emenda
//   'blob'     — massa arredondada achatada, membros-nub minúsculos (slime)
//   'cube'     — geométrico (cubos; arestas vivas casam com o contorno cel)
// Todas as formas mantêm o MESMO contrato de rig ({upper, legs[2], arms[2]}) para
// o Gait animar e o Player posicionar olhos por (headR, headY) — sem mexer nos
// chamadores.
//
// `materials` (P1 — pintura por zonas): pode ser UM THREE.Material (todas as partes
// iguais — o Caçador usa assim) OU `{ upper, lower }`, onde `lower` pinta as PERNAS
// e `upper` o resto (cabeça/tronco/braços/massa do blob). Assim o jogador pode ter
// pernas de uma cor (rodapé) e tronco de outra (parede).
export function buildBody(materials, height = 1, {
  castShadow = true, outline = false, outlineColor = 0x14181d, outlineScale = 1.07,
  kind = 'toy',
} = {}) {
  const H = height;
  const g = new THREE.Group();
  const matU = materials.isMaterial ? materials : materials.upper;
  const matL = materials.isMaterial ? materials : (materials.lower || materials.upper);
  // Contorno CEL (Fase 3a): inverted-hull. Casca da MESMA geometria, inflada e só
  // BackSide numa cor escura → borda de desenho barata, que segue a animação (é
  // filha da malha-base). Desligado por padrão: o jogador NÃO usa (borda fixa
  // denunciaria a camuflagem); o Caçador usa, para "saltar" como ameaça.
  const outlineMat = outline
    ? new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide })
    : null;
  const mk = (geo, mat = matU) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = castShadow;
    if (outlineMat) {
      const o = new THREE.Mesh(geo, outlineMat);
      o.scale.setScalar(outlineScale);
      o.castShadow = false;
      m.add(o); // filha: herda a pose/animação da parte
    }
    return m;
  };

  // Tronco superior (recebe bob/inclinação/crouch da passada).
  const upper = new THREE.Group();
  g.add(upper);

  // Cria um par esq/dir de membros num PIVÔ (o Gait balança por rotation.x).
  // parent='upper' → braços (acompanham o bob); parent='g' → pernas. restZ abre
  // lateralmente (pose de repouso dos braços). A geometria é compartilhada pelo par.
  const limbPair = (geo, mat, { y, x, hang, parent, restZ = 0 }) => {
    const pair = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * x, y, 0);
      if (restZ) pivot.rotation.z = sx * restZ;
      const m = mk(geo, mat);
      m.position.y = hang;
      pivot.add(m);
      (parent === 'upper' ? upper : g).add(pivot);
      pair.push(pivot);
    }
    return pair;
  };

  // Membro HUMANOIDE de 2 segmentos com junta SEM EMENDA (sem esferas de junta): as
  // calotas das cápsulas se sobrepõem (0.8·r), então ao dobrar o joelho/cotovelo lê
  // como uma dobra orgânica, não como peças soltas. O pé/mão cai EXATAMENTE em `endY`
  // (comprimento derivado), evitando afundar no chão. Retorna [tops[2], seconds[2]]:
  // tops = quadril/ombro (o Gait balança); seconds = joelho/cotovelo (a flexão dobra).
  const limb2 = (mat, { x, topY, endY, r, parent, restZ = 0 }) => {
    const seg = Math.max(0.02, (topY - endY - 3.04 * r) / 2); // comprimento de cada cilindro
    const tops = [], seconds = [];
    for (const sx of [-1, 1]) {
      const top = new THREE.Group();
      top.position.set(sx * x, topY, 0);
      if (restZ) top.rotation.z = sx * restZ;
      const up = mk(new THREE.CapsuleGeometry(r, seg, 6, 12), mat);
      up.position.y = -(seg / 2 + r);
      top.add(up);
      const second = new THREE.Group();
      second.position.y = -(seg + 1.2 * r);                   // sobe 0.8·r → calotas se fundem
      const lo = mk(new THREE.CapsuleGeometry(r * 0.92, seg, 6, 12), mat);
      lo.position.y = -(seg / 2 + r * 0.92);
      second.add(lo);
      top.add(second);
      (parent === 'upper' ? upper : g).add(top);
      tops.push(top); seconds.push(second);
    }
    return [tops, seconds];
  };

  let headR, headY, legs, arms, shins = null, forearms = null;

  if (kind === 'mannequin') {
    // Pictograma MACIO como o modelo original do Meccha: cabeça-bola grande + torso
    // ovoide único. Braços/pernas agora ARTICULADOS (joelho/cotovelo) mas sem emenda
    // visível → andar humanoide de verdade.
    headR = 0.20 * H; headY = 0.5 * H - headR * 0.85;
    const head = mk(new THREE.SphereGeometry(headR, 24, 18));
    head.position.y = headY; upper.add(head);                       // cabeça-bola
    const torso = mk(new THREE.CapsuleGeometry(0.19 * H, 0.24 * H, 8, 18));
    torso.position.y = 0.02 * H; upper.add(torso);                  // torso ovoide único
    [legs, shins] = limb2(matL, { x: 0.10 * H, topY: -0.06 * H, endY: -0.5 * H, r: 0.075 * H, parent: 'g' });
    [arms, forearms] = limb2(matU, { x: 0.19 * H, topY: 0.16 * H, endY: -0.12 * H, r: 0.06 * H, parent: 'upper', restZ: -0.12 });
  } else if (kind === 'blob') {
    const R = 0.36 * H;
    const blob = mk(new THREE.SphereGeometry(R, 24, 18));
    blob.position.y = -0.08 * H;
    blob.scale.set(1.06, 0.92, 1.0); // achatado, mais largo (gelatinoso)
    upper.add(blob);
    headR = 0.30 * H; headY = 0.14 * H; // olhos no alto-frente da massa
    legs = limbPair(new THREE.SphereGeometry(0.10 * H, 12, 10), matL,
      { y: -0.40 * H, x: 0.14 * H, hang: -0.02 * H, parent: 'g' });
    arms = limbPair(new THREE.SphereGeometry(0.09 * H, 12, 10), matU,
      { y: 0.02 * H, x: 0.34 * H, hang: -0.02 * H, parent: 'upper' });
  } else if (kind === 'cube') {
    const head = mk(new THREE.BoxGeometry(0.40 * H, 0.34 * H, 0.38 * H));
    const hY = 0.5 * H - 0.17 * H;
    head.position.y = hY;
    upper.add(head);
    const torso = mk(new THREE.BoxGeometry(0.5 * H, 0.5 * H, 0.45 * H));
    torso.position.y = -0.08 * H;
    upper.add(torso);
    headR = 0.20 * H; headY = hY;
    legs = limbPair(new THREE.BoxGeometry(0.15 * H, 0.18 * H, 0.15 * H), matL,
      { y: -0.33 * H, x: 0.13 * H, hang: -0.09 * H, parent: 'g' });
    arms = limbPair(new THREE.BoxGeometry(0.13 * H, 0.18 * H, 0.13 * H), matU,
      { y: 0.05 * H, x: 0.30 * H, hang: -0.09 * H, parent: 'upper', restZ: -0.12 });
  } else {
    // 'toy' (padrão) — art toy chibi, agora com joelho/cotovelo articulados (sem emenda).
    headR = 0.24 * H; headY = 0.5 * H - headR;
    const head = mk(new THREE.SphereGeometry(headR, 24, 18));
    head.position.y = headY;
    upper.add(head);
    const torso = mk(new THREE.CapsuleGeometry(0.26 * H, 0.18 * H, 8, 20));
    torso.position.y = -0.02 * H;
    upper.add(torso);
    [legs, shins] = limb2(matL, { x: 0.12 * H, topY: -0.02 * H, endY: -0.5 * H, r: 0.09 * H, parent: 'g' });
    [arms, forearms] = limb2(matU, { x: 0.26 * H, topY: 0.16 * H, endY: -0.18 * H, r: 0.075 * H, parent: 'upper', restZ: -0.18 });
  }

  return { group: g, headR, headY, rig: { upper, legs, arms, height: H, shins, forearms } };
}

// Alias legado: o Caçador (e o padrão) usam o art toy.
export function buildHumanoid(material, height = 1, opts = {}) {
  return buildBody(material, height, { ...opts, kind: opts.kind || 'toy' });
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
    this.swing = opts.swing != null ? opts.swing : 0.82;    // balanço das pernas (rad) — passada mais humana
    this.armSwing = opts.armSwing != null ? opts.armSwing : 0.66;
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
    upper.position.y = bob * 0.075 * this.rig.height * a + breath;
    upper.rotation.x = -0.16 * a;
    // Andar mais HUMANO: transferência de peso (sway lateral do tronco, 1 por passada)
    // + leve rolagem — as pernas ficam plantadas (estão em `g`) e o tronco balança.
    upper.position.x = s * 0.035 * this.rig.height * a;
    upper.rotation.z = -s * 0.07 * a;

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

    // Flexão de JOELHO/COTOVELO (humanoides articulados: toy/manequim). Guardada por
    // presença → blob/cube (rígidos) ignoram. O joelho dobra na fase em que a perna
    // vem à frente (cos(ph)>0, o pé sobe/tuca) — dá o andar humano em vez de "robótico".
    const shins = this.rig.shins, fore = this.rig.forearms;
    if (shins) {
      for (let i = 0; i < 2; i++) {
        const ph = this.phase + i * Math.PI;
        shins[i].rotation.x = 0.05 + 0.7 * a * Math.max(0, Math.cos(ph)) + 0.9 * c; // +X = dobra p/ trás
      }
    }
    if (fore) {
      for (let i = 0; i < 2; i++) {
        const ph = this.phase + i * Math.PI + Math.PI;
        fore[i].rotation.x = -(0.12 + 0.22 * a * Math.max(0, Math.cos(ph)) + 0.35 * c); // −X = antebraço à frente
      }
    }
  }
}
