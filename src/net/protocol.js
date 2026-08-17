// Protocolo de rede — COMPARTILHADO entre o cliente (navegador) e o servidor (Node).
//
// Regra de ouro deste arquivo e do hittest.js ao lado: **nenhum import**. Nem `three`,
// nem DOM, nem nada de Node. É o que permite que os dois lados carreguem exatamente o
// mesmo arquivo e nunca divirjam sobre o formato do fio ou sobre as constantes de
// gameplay. Se algo aqui precisar de `three`, está no arquivo errado.
//
// Ver docs/PLANO_MULTIPLAYER.md (fatia vertical v1).

// ---------------------------------------------------------------- transporte
export const PROTOCOL_VERSION = 1;

export const TICK_HZ = 20;              // taxa de snapshot do servidor (spec: 20-30 Hz)
export const TICK_MS = 1000 / TICK_HZ;

// Altura do CENTRO da cápsula acima do chão — mesma constante de Player.js (GROUND_Y =
// RADIUS + LENGTH/2, com SCALE=0.5). `Player.position` (o que viaja na rede) já é essa
// altura, não uma altura relativa ao chão — spawns/avatares remotos usam isto para não
// ficar somando a mesma correção duas vezes (bug real, corrigido: RemotePlayer chegou a
// renderizar avatares flutuando 2×GROUND_Y acima do chão).
export const GROUND_Y = 0.45;

// Buffer de interpolação de entidades (spec §1: 50-100ms). Renderizamos os avatares
// remotos ATRASADOS neste tanto, para sempre ter dois snapshots entre os quais
// interpolar — é o que tira o solavanco quando um pacote atrasa.
export const INTERP_DELAY_MS = 100;

// Se o servidor não vê input de um cliente por este tempo, considera-o desconectado.
// 20s dá folga pro keepalive de 3s do Net.js (ver Net.js) sobreviver a uma aba em
// segundo plano sendo throttlada pelo navegador, sem deixar uma sessão morta ocupando
// a sala (MAX_PLAYERS=2, server/room.js) por tempo demais.
export const CLIENT_TIMEOUT_MS = 20000;

// ------------------------------------------------------------------ mensagens
// Cliente → servidor
export const C2S = {
  JOIN: 'join',       // { name }
  INPUT: 'input',     // ver makeInputPayload
  FIRE: 'fire',       // { origin:{x,y,z}, dir:{x,y,z}, t }
  LEAVE: 'leave',
};

// Servidor → cliente
export const S2C = {
  WELCOME: 'welcome',     // { id, role, spawn, layout, players[] }
  SNAPSHOT: 'snapshot',   // { t, players[] }
  PLAYER_JOIN: 'playerJoin',
  PLAYER_LEAVE: 'playerLeave',
  SHOT: 'shot',           // resultado do disparo (broadcast): { hunterId, hit, targetId, from, to }
  FIRE_DENIED: 'fireDenied', // só para o atirador: { reason, nextFireAt }
  PLAYER_HIT: 'playerHit',   // { targetId, hunterId }
  MATCH_OVER: 'matchOver',   // { winner: 'hunter'|'chameleons', reason }
};

export const ROLE = {
  HUNTER: 'hunter',
  CHAMELEON: 'chameleon',
};

// ------------------------------------------------------- constantes de gameplay
// Estas nasceram inline em Game.js e agora moram aqui porque o SERVIDOR precisa das
// mesmas para validar o disparo. Game.js as importa daqui — não duplique os valores.
export const JET_RANGE = 15;                  // alcance do jato de água (m)
export const HUNTER_AIM_HALF_ANGLE_DEG = 9;   // ~18° de cone total
export const HUNTER_FIRE_COOLDOWN_MS = 300;
export const HUNTER_MISS_COOLDOWN_MS = 2600;  // penalidade de bomba de pressão ao errar

// Tolerância de validação do servidor. O cliente mira num alvo INTERPOLADO e atrasado
// (INTERP_DELAY_MS), enquanto o servidor valida contra a posição mais recente que
// conhece — então os dois nunca concordam ao pixel. Sem esta folga, tiros honestos
// seriam recusados. É o substituto barato do lag compensation/rewind da spec §3, que
// ficou fora do escopo da v1.
export const AIM_TOLERANCE_DEG = 6;

export const MATCH_DURATION_S = 180; // 3 min (spec §4: 3-5 min)

// Layout fixo da v1 — os dois clientes carregam o MESMO número de layout. Level.js é
// função pura dele, com PRNG semeado (mulberry32, Level.js:1162): geometria/solids/
// cores batem entre clientes sem o servidor precisar rodar Level.js (que depende de
// canvas/DOM e não roda em Node). Lobby com escolha de layout fica para depois.
export const FIXED_LAYOUT = 1;

// Empacota o estado que um cliente envia por tick. Só o que o servidor ou os outros
// jogadores precisam: nada de estado derivado (o clipe de animação, por exemplo, é
// recalculado no destino a partir daqui — ver RemotePlayer.js).
//
// `yaw` NÃO é decorativo: o movimento do jogador é relativo à câmera
// (Player._updateGrounded usa camera.getWorldDirection), então sem o yaw não dá para
// reproduzir a direção do movimento do lado de cá.
export function makeInputPayload({ pos, yaw, state, crouched, prone, statue, moving, color }) {
  return {
    p: [round3(pos.x), round3(pos.y), round3(pos.z)],
    y: round3(yaw),
    s: state,          // 'grounded' | 'latched'
    c: crouched ? 1 : 0,
    r: prone ? 1 : 0,
    k: statue ? 1 : 0, // "locked" (spec §2: isLocked)
    m: moving ? 1 : 0,
    col: color,        // hex das 2 zonas: [upperHex, lowerHex]
  };
}

// 3 casas decimais = precisão de milímetro. Corta o payload quase pela metade em JSON
// sem nenhum efeito visível (os avatares ainda são interpolados no destino).
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
