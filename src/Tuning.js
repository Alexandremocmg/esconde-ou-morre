// Painel de ajuste ao vivo (⚙️, ?tune=1 na URL) — os parâmetros de
// movimento/giro dependem de SENSAÇÃO jogando de verdade, não dá pra acertar
// só olhando número/rodando teste headless (já levou duas rodadas de chute
// errado nesta sessão: primeiro "corrida ficou lenta", depois "ainda lenta
// e o giro podia ser mais devagar"). TUNE é um objeto MUTÁVEL — Joystick.js/
// Player.js leem os campos TODO frame (nunca uma cópia congelada num const
// de módulo), então o painel muda o jogo na hora, sem build nem reload.
// Persistido em localStorage pra sobreviver a reload/fechar aba no meio de
// um teste no celular.

const STORAGE_KEY = 'eom-tune-v1';

// Valores encontrados pelo usuário testando ao vivo (painel ⚙️, jogando de
// verdade) — servem de novo padrão E de referência caso o reset seja usado.
// Histórico: deadzone/curve começaram em 0.12/2 (primeira rodada, só
// matemática sem playtesting) — 0.04/2.3 leram melhor na prática. moveSpeed
// subiu de 7.0 pra 8.25: Seeker.js:PLAYER_GROUND_SPEED (constante própria,
// não lê TUNE) ainda assume 7.0 pro "teto de justiça" da perseguição — com
// 8.25 o Camaleão ficou proporcionalmente mais rápido que antes em relação
// ao Caçador-IA, não é só sensação de movimento isolado.
const DEFAULTS = {
  deadzone: 0.04,
  curve: 2.3,
  knee: 0.85,
  turnSpeed: 4,
  moveSpeed: 8.25,
};

export const TUNE = { ...DEFAULTS };

// Descreve os controles do painel (label/faixa) sem acoplar a UI aos nomes
// internos espalhados por Joystick.js/Player.js.
export const TUNE_SPEC = [
  { key: 'deadzone', label: 'Zona morta do joystick', min: 0, max: 0.4, step: 0.01 },
  { key: 'curve', label: 'Curva de resposta (potência)', min: 1, max: 4, step: 0.1 },
  { key: 'knee', label: 'Knee (% do curso p/ veloc. máxima)', min: 0.3, max: 1, step: 0.01 },
  { key: 'turnSpeed', label: 'Giro do boneco (TURN_SPEED)', min: 1, max: 12, step: 0.25 },
  { key: 'moveSpeed', label: 'Velocidade máxima (m/s)', min: 3, max: 10, step: 0.25 },
];

export function loadTune() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const { key } of TUNE_SPEC) {
      if (Number.isFinite(saved[key])) TUNE[key] = saved[key];
    }
  } catch (_) { /* localStorage indisponível ou JSON inválido — segue com DEFAULTS */ }
}

export function saveTune() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(TUNE)); } catch (_) {}
}

export function resetTune() {
  Object.assign(TUNE, DEFAULTS);
  saveTune();
}

loadTune();
