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
// RADIUS + LENGTH/2, com SCALE=0.8 — Player.js:14-17). `Player.position` (o que viaja
// na rede) já é essa altura, não uma altura relativa ao chão — spawns/avatares remotos
// usam isto para não ficar somando a mesma correção duas vezes (bug real, corrigido:
// RemotePlayer chegou a renderizar avatares flutuando 2×GROUND_Y acima do chão).
//
// NÃO pode importar de Player.js (regra de ouro deste arquivo, ver cabeçalho) — então
// este valor é uma CÓPIA manual e precisa ser recalculado à mão sempre que `SCALE`
// mudar em Player.js (mesma pegadinha documentada em FollowCamera.js:4-9, onde SCALE
// subiu duas vezes — 0.5→0.65→0.8 — sem que quem dependia dele fosse atualizado
// junto: aqui, e em ChameleonTarget.js/RemotePlayer.js's HEIGHT, ficaram presos no
// valor de SCALE=0.5 por duas rodadas de aumento até serem padronizados de volta).
export const GROUND_Y = 0.72;

// Buffer de interpolação de entidades (spec §1: 50-100ms). Renderizamos os avatares
// remotos ATRASADOS neste tanto, para sempre ter dois snapshots entre os quais
// interpolar — é o que tira o solavanco quando um pacote atrasa.
export const INTERP_DELAY_MS = 100;

// Se o servidor não vê input de um cliente por este tempo, considera-o desconectado.
// 20s dá folga pro keepalive de 3s do Net.js (ver Net.js) sobreviver a uma aba em
// segundo plano sendo throttlada pelo navegador, sem deixar uma sessão morta ocupando
// a sala (MAX_PLAYERS=2, server/room.js) por tempo demais.
export const CLIENT_TIMEOUT_MS = 20000;

// Quanto tempo a sala segura a VAGA (papel, munição, estado eliminado) de um
// cliente que caiu antes de dar a vaga como perdida de vez. Cobre tanto uma queda
// de wifi rápida (aba viva, WS reconecta sozinho) quanto o navegador matando a aba
// em segundo plano e recarregando do zero (sessão persistida em sessionStorage,
// ver Net.js). Contado a partir do ÚLTIMO input visto, não de quando o servidor
// percebeu — uma morte silenciosa (sem close limpo) só é percebida depois de
// CLIENT_TIMEOUT_MS, então contar a partir de "agora" desperdiçaria metade da
// janela em algo que o cliente já não está fazendo há tempo.
export const RECONNECT_GRACE_MS = 30000;

// Lobby/matchmaking (docs/PLANO_LOBBY_COUNTDOWN.md): janela de espera ADICIONAL entre
// "sala formada" (1 Caçador + o 1º Camaleão) e a partida ficar realmente ativa (Caçador
// pode atirar, o relógio de MATCH_DURATION_S começa a valer). Não desconta dos 180s de
// caçada — `room.js` arma `_matchStartAt` no FUTURO (`Date.now() + LOBBY_COUNTDOWN_MS`)
// em vez de instantâneo; enquanto esse timestamp não chega, o tempo decorrido da
// partida (calculado contra ele) é negativo, então o fim-por-tempo nunca dispara sozinho.
export const LOBBY_COUNTDOWN_MS = 12000;

// Servidor autoritativo em produção (Render.com — docs/PLANO_MULTIPLAYER.md, seção
// "Hospedagem"). Usado por Game.js._wsUrl() como fallback quando a página não está
// em localhost/LAN e não há `?ws=` explícito na URL — o cliente hospedado (Vercel)
// não tem como adivinhar o host do servidor sozinho, já que moram em domínios
// diferentes e o servidor não escuta a porta 8787 publicamente.
export const PROD_WS_URL = 'wss://esconde-ou-morre-server.onrender.com';

// Mesmo regex usado por Net.resolveWsUrl() (e antes só em Game.js._wsUrl()) pra
// decidir se o servidor mora no mesmo host/LAN (dev) ou em PROD_WS_URL (produção).
export const HOST_LOCAL_OU_LAN = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// ------------------------------------------------------------------ mensagens
// Cliente → servidor
export const C2S = {
  JOIN: 'join',       // { ammo?, infiniteAmmo? } — só lido se o servidor der o papel HUNTER a este socket
  INPUT: 'input',     // ver makeInputPayload
  FIRE: 'fire',       // { origin:{x,y,z}, dir:{x,y,z}, t }
  LEAVE: 'leave',
  REVIVE: 'revive',   // "jogar novamente" sem reconectar — ver room.js:_onRevive
  // Fase 4 do pincel 3D (ver src/UVPaint.js): lote de comandos de traço
  // acumulados localmente e mandados automaticamente (fim de cada traço +
  // throttle de ~250ms durante um traço longo, ver Game.js:_flushAndSendPaint
  // — não por-tick, ao contrário de INPUT). Decisão já tomada na avaliação
  // da spec: manda uma LISTA DE COMANDOS, não pixels — "cor nunca vai pela
  // rede como pixels" continua valendo (ver docs/PLANO_MULTIPLAYER.md).
  PAINT: 'paint',     // { strokes: [{d, u, v, c, r}, ...] } — ver makePaintStroke
};

// Servidor → cliente
export const S2C = {
  WELCOME: 'welcome',     // { id, role, spawn, layout, matchDuration, players[], token, eliminated, matchStartAt }
  SNAPSHOT: 'snapshot',   // { t, players[], matchStartAt }
  PLAYER_JOIN: 'playerJoin',
  PLAYER_LEAVE: 'playerLeave',
  SHOT: 'shot',           // resultado do disparo (broadcast): { hunterId, hit, targetId, from, to }
  FIRE_DENIED: 'fireDenied', // só para o atirador: { reason, nextFireAt }
  PLAYER_HIT: 'playerHit',   // { targetId, hunterId }
  MATCH_OVER: 'matchOver',   // { winner: 'hunter'|'chameleons', reason }
  PLAYER_PAINT: 'playerPaint', // { id, strokes[] } — repasse do C2S.PAINT de outro jogador
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

// Munição padrão do Caçador quando o JOIN não chega ou vem inválido — mesmo valor do
// <option selected> em index.html. Autoritativa no servidor pelo mesmo motivo do
// cooldown acima: "as duas abas nunca podem divergir sobre o resultado" (ver
// room.js:1-10) — client-only deixaria o Caçador trapacear com munição infinita, e
// pior, as duas pontas poderiam discordar sobre se a partida acabou por falta de água.
export const HUNTER_AMMO_DEFAULT = 5;

// Tolerância de validação do servidor. O cliente mira num alvo INTERPOLADO e atrasado
// (INTERP_DELAY_MS), enquanto o servidor valida contra a posição mais recente que
// conhece — então os dois nunca concordam ao pixel. Sem esta folga, tiros honestos
// seriam recusados. É o substituto barato do lag compensation/rewind da spec §3, que
// ficou fora do escopo da v1.
//
// Era 6° — bug real de balanceamento: o atraso que isto compensa é uma DISTÂNCIA fixa
// (INTERP_DELAY_MS=100ms × TUNE.moveSpeed≈8m/s ≈ 0,83m de deriva possível, não muda
// com a distância do tiro), mas a tolerância aqui é um ÂNGULO — o perdão em METROS
// que ele dá cresce com a distância (perdão = alcance × tan(ângulo)). A 5m já dava
// ~0,55m de perdão (proporcional), mas a 15m (JET_RANGE) virava ~1,64m — quase o
// dobro do que precisava compensar, lido como "acertei sem estar mirando, de longe".
// 2.5° mantém folga suficiente na distância típica de engajamento e cai pra ~0,67m de
// perdão extra no alcance máximo — mais alinhado com a deriva real que existe pra compensar.
export const AIM_TOLERANCE_DEG = 2.5;

export const MATCH_DURATION_S = 180; // 3 min (spec §4: 3-5 min)

// Lobby maior (docs/PLANO_LOBBY_MULTIPLAYER.md): quantos Camaleões cabem na MESMA
// partida, além do único Caçador — a sala inteira é `1 + MAX_CHAMELEONS`. Vive aqui (e
// não só em room.js) porque room.js:_chameleonSpawn precisa dividir o círculo de spawns
// por este número, e o valor é conceitualmente uma constante de gameplay como as outras
// deste arquivo, não um detalhe interno do servidor.
export const MAX_CHAMELEONS = 4;

// Mapas elegíveis pro Online — cliente e servidor precisam SEMPRE concordar em qual
// número de layout usar sem trocar mensagem nenhuma antes de construir a cena (o
// cliente monta o Level ANTES de conectar — Game.js). Level.js é função pura do
// número do layout, com PRNG semeado (mulberry32): geometria/solids/cores batem entre
// clientes sem o servidor precisar rodar Level.js (que depende de canvas/DOM e não
// roda em Node).
export const ONLINE_LAYOUTS = [1, 4]; // 1 = mansão (salão), 4 = fábrica abandonada

// Escolhe o layout do Online por ROTAÇÃO DETERMINÍSTICA de relógio, não por decisão
// do servidor comunicada numa mensagem — a alternativa (servidor sorteia por sala,
// cliente espera o `welcome` antes de montar o Level) exigiria adiar a construção de
// Level/Player/câmera/HUD pro modo Online, mexendo em código que TODOS os modos
// compartilham no construtor de Game.js, sem cobertura de teste ao vivo em
// multiplayer real — risco desproporcional ao ganho. Em vez disso, os dois lados
// calculam o MESMO valor de forma pura, na hora, sem round-trip: dá pra chamar tanto
// no `new Game()` (síncrono, antes de conectar) quanto em `room.js` (a qualquer
// momento). Troca a cada hora cheia (UTC) — ambos os lados usam `Date.now()`, que já
// é UTC internamente, então não há fuso a sincronizar.
//
// Risco aceito (mesmo espírito do "Débito 1" já documentado pro movimento forjável):
// se dois jogadores da MESMA sala conectarem bem na virada da hora (janela de
// milissegundos), podem calcular valores diferentes e desincronizar a geometria —
// extremamente raro (a janela de formação de sala inteira, LOBBY_COUNTDOWN_MS, é
// 12s; a virada de hora é 1 instante em 3600s) e sem impacto de segurança/dados, só
// visual, autocorrige na sessão seguinte.
export function onlineLayoutFor(now = Date.now()) {
  const hourBucket = Math.floor(now / 3600000);
  return ONLINE_LAYOUTS[hourBucket % ONLINE_LAYOUTS.length];
}

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

// Fase 4 do pincel 3D — validado tanto no cliente (antes de
// empacotar) quanto no servidor (room.js:_handlePaint, nunca confia só no
// cliente). Um traço "vira uma vida inteira" bem rápido (uma sessão de
// pintura contínua facilmente passa de centenas de pontos) — o teto existe
// pra um cliente malicioso não mandar payloads gigantes, não porque um
// traço legítimo costume chegar perto disso.
export const MAX_PAINT_STROKES_PER_MSG = 400;

// Um comando de traço: `d` (down) marca o INÍCIO de um traço novo — o
// receptor só interpola (liga com uma linha) entre pontos consecutivos que
// NÃO começam um traço novo, senão um pulo entre dois traços separados sairia
// como um risco reto ligando os dois (mesmo motivo do corte por distância em
// UVPaint.js:strokeBetween, que só entra em jogo localmente). `u`/`v` são a
// coordenada UV do carimbo (0-1); `r` é o raio como FRAÇÃO da textura (não
// pixels — independe do tamanho de textura que o receptor usa).
export function makePaintStroke({ down, uv, colorHex, radiusFrac }) {
  return { d: down ? 1 : 0, u: round3(uv.x), v: round3(uv.y), c: colorHex, r: round3(radiusFrac) };
}
