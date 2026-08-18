// Teste de acerto do jato de água — COMPARTILHADO entre cliente e servidor.
//
// Sem imports (ver o cabeçalho de protocol.js). Opera sobre vetores simples
// `{x, y, z}` em vez de THREE.Vector3 justamente para poder rodar nos dois lados: é o
// que garante que o servidor e o cliente nunca discordem sobre "isso foi acerto?".
//
// A mira do Caçador é por CONE, não raycast pixel-perfect contra a malha — a malha é
// um SkinnedMesh animado e o raycast do three usa a BIND POSE, o que dá acertos
// errados (ver o comentário em Game.fireHunterShot). Então: posição conhecida do alvo
// + ângulo em relação à direção da mira.

// Deslocamento vertical do ponto de mira: o `position` do avatar fica nos pés/base, e
// mirar na base faz o jogador ter que apontar para o chão. Sobe para o tronco.
const AIM_UP_Y = 0.3;

// Alvos dentro do cone e do alcance, ORDENADOS do mais bem mirado para o menos
// (maior cosseno = menor ângulo em relação ao centro da mira).
//
// Devolve uma lista em vez de só o melhor de propósito: o CLIENTE ainda precisa
// descartar alvos atrás de parede (raycast de oclusão contra a geometria, que este
// módulo não pode fazer por não importar three), então ele percorre a lista e fica com
// o primeiro que estiver visível. O SERVIDOR, na v1, usa direto o primeiro.
//
//   origin     {x,y,z} — de onde parte a mira (posição da câmera)
//   dir        {x,y,z} — direção da mira, JÁ NORMALIZADA
//   candidates [{ id, pos:{x,y,z} }]
//   opts       { range, halfAngleDeg }
export function coneCandidates(origin, dir, candidates, opts) {
  const range = opts.range;
  const cosHalf = Math.cos((opts.halfAngleDeg * Math.PI) / 180);
  const out = [];

  for (const c of candidates) {
    const tx = c.pos.x - origin.x;
    const ty = c.pos.y + AIM_UP_Y - origin.y;
    const tz = c.pos.z - origin.z;

    const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (dist > range || dist < 1e-3) continue;

    const inv = 1 / dist;
    const cos = dir.x * tx * inv + dir.y * ty * inv + dir.z * tz * inv;
    if (cos < cosHalf) continue;

    out.push({ id: c.id, cos, dist, pos: c.pos });
  }

  out.sort((a, b) => b.cos - a.cos);
  return out;
}

// Normaliza um {x,y,z} (devolve um novo objeto). Vetor nulo vira "para frente" em -Z,
// que é a convenção de frente da câmera no three.
export function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-6) return { x: 0, y: 0, z: -1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
