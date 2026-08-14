// Painel de AJUSTE ao vivo do boneco (animação e poses). Existe para o ajuste
// fino ser feito jogando, não a cada rodada de código: os valores tomam efeito no
// mesmo quadro e ficam salvos no navegador (localStorage), então sobrevivem ao
// reload. O botão de abrir fica escondido num canto para não atrapalhar o jogo.
//
// Os padrões abaixo são os calibrados até agora (ver comentários em Player.js).

const KEY = 'eom-tune';

export const TUNE = {
  clip: 'run1',      // qual clipe de corrida: run1 = RunFast, run2 = Run_02
  strideGain: 2.0,   // cadência: maior = passada mais longa, pernas mais lentas.
                     // O clipe "Andar" tem passada ~2,3x menor que a corrida, então
                     // pede um valor mais alto (~4,5) para não ficar frenético.
  headUp: 0.5,       // ergue pescoço/cabeça na corrida (0 = clipe cru)
  armDrop: 0.32,     // parado: baixa os braços da A-pose
  idleRate: 3.5,     // suavidade da transição correndo ↔ parado (menor = mais lento)
  breath: 0.006,     // amplitude da respiração parado
  crouch: 0.5,       // quanto encolhe ao agachar
  mix: true,         // misturar andar↔correr por velocidade (natural) ou usar 1 clipe
  walkAt: 1.8,       // velocidade em que a mistura é 100% ANDAR
  runAt: 6.0,        // velocidade em que a mistura é 100% CORRER
  mixRate: 3.0,      // suavidade da mistura (menor = troca mais gradual)
};

const SPEC = [
  { k: 'strideGain', label: 'Cadência (passada)', min: 0.8, max: 6, step: 0.05 },
  { k: 'headUp', label: 'Cabeça erguida', min: 0, max: 1, step: 0.05 },
  { k: 'armDrop', label: 'Braços parado', min: -0.6, max: 0.9, step: 0.02 },
  { k: 'idleRate', label: 'Suavidade parar', min: 1, max: 10, step: 0.25 },
  { k: 'breath', label: 'Respiração', min: 0, max: 0.02, step: 0.001 },
  { k: 'crouch', label: 'Agachar', min: 0, max: 1, step: 0.05 },
  { k: 'walkAt', label: 'Vel. p/ andar', min: 0.2, max: 5, step: 0.1 },
  { k: 'runAt', label: 'Vel. p/ correr', min: 1, max: 9, step: 0.1 },
  { k: 'mixRate', label: 'Suavidade mistura', min: 0.5, max: 10, step: 0.25 },
];

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(TUNE)) if (saved[k] !== undefined) TUNE[k] = saved[k];
  } catch (_) { /* valores padrão */ }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(TUNE)); } catch (_) { /* ok */ }
}

// onClip: chamado quando o usuário troca o clipe de corrida.
export function initTuner({ onClip } = {}) {
  load();

  const btn = document.createElement('button');
  btn.id = 'tune-btn';
  btn.type = 'button';
  btn.textContent = '⚙';
  btn.title = 'Ajustes do boneco';

  const panel = document.createElement('div');
  panel.id = 'tune-panel';
  panel.className = 'hidden';

  const head = document.createElement('div');
  head.className = 'tune-head';
  head.innerHTML = '<b>Ajustes do boneco</b>';
  panel.appendChild(head);

  // Escolha do clipe de corrida.
  const clipRow = document.createElement('div');
  clipRow.className = 'tune-clip';
  for (const [id, name] of [['walk', 'Andar'], ['run1', 'RunFast'], ['run2', 'Run_02']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.className = TUNE.clip === id ? 'on' : '';
    b.addEventListener('click', () => {
      TUNE.clip = id; save();
      for (const el of clipRow.children) el.classList.toggle('on', el === b);
      onClip && onClip(id);
    });
    clipRow.appendChild(b);
  }
  panel.appendChild(clipRow);

  // Mistura andar↔correr: com ela ligada, os botões acima escolhem só o clipe de
  // CORRIDA (o andar entra sozinho nas velocidades baixas).
  const mixRow = document.createElement('div');
  mixRow.className = 'tune-clip';
  const mixBtn = document.createElement('button');
  mixBtn.type = 'button';
  const paintMix = () => {
    mixBtn.textContent = TUNE.mix ? 'Mistura: LIGADA' : 'Mistura: desligada';
    mixBtn.classList.toggle('on', TUNE.mix);
  };
  mixBtn.addEventListener('click', () => { TUNE.mix = !TUNE.mix; save(); paintMix(); });
  paintMix();
  mixRow.appendChild(mixBtn);
  panel.appendChild(mixRow);

  const rows = {};
  for (const s of SPEC) {
    const row = document.createElement('label');
    row.className = 'tune-row';
    const name = document.createElement('span');
    name.textContent = s.label;
    const val = document.createElement('i');
    val.textContent = (+TUNE[s.k]).toFixed(2);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = s.min; input.max = s.max; input.step = s.step; input.value = TUNE[s.k];
    input.addEventListener('input', () => {
      TUNE[s.k] = parseFloat(input.value);
      val.textContent = (+TUNE[s.k]).toFixed(2);
      save();
    });
    row.append(name, val, input);
    panel.appendChild(row);
    rows[s.k] = { input, val };
  }

  const foot = document.createElement('div');
  foot.className = 'tune-foot';
  const reset = document.createElement('button');
  reset.type = 'button'; reset.textContent = 'Padrão';
  reset.addEventListener('click', () => {
    const d = { clip: 'run1', strideGain: 2.0, headUp: 0.5, armDrop: 0.32, idleRate: 3.5,
      breath: 0.006, crouch: 0.5, mix: true, walkAt: 1.8, runAt: 6.0, mixRate: 3.0 };
    Object.assign(TUNE, d); save();
    for (const s of SPEC) { rows[s.k].input.value = TUNE[s.k]; rows[s.k].val.textContent = (+TUNE[s.k]).toFixed(2); }
    for (const el of clipRow.children) el.classList.toggle('on', el.textContent === 'RunFast');
    paintMix();
    onClip && onClip(TUNE.clip);
  });
  // Mostra os números para o usuário poder ditar os valores finais.
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'Ver valores';
  const out = document.createElement('textarea');
  out.className = 'tune-out hidden'; out.readOnly = true;
  copy.addEventListener('click', () => {
    out.value = JSON.stringify(TUNE, null, 1);
    out.classList.toggle('hidden');
  });
  foot.append(reset, copy);
  panel.append(foot, out);

  btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  document.getElementById('app').append(btn, panel);
  return TUNE;
}
