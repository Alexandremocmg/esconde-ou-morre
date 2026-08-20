// Painel de ajuste ao vivo (⚙️) pros parâmetros de TUNE (Tuning.js) — deadzone/
// curva/knee do joystick, giro e velocidade do boneco. Só existe com `?tune=1`
// na URL (nunca aparece pra um jogador normal): o botão/painel do index.html
// ficam com `display:none` por padrão (ver css/style.css) e só `initTunePanel`
// os liga, e só depois de conferir a query string.
//
// Objetivo: parar o ciclo de "chuta um número, faz deploy, joga, erra de
// novo" — o usuário ajusta ao vivo jogando de verdade (inclusive no celular,
// contra a build de produção) e depois passa os valores que sentiram certo
// pra virarem o novo padrão no código.
import { TUNE, TUNE_SPEC, saveTune, resetTune } from './Tuning.js?v=1';

export function initTunePanel() {
  const enabled = new URLSearchParams(location.search).get('tune') === '1';
  const btn = document.getElementById('tune-btn');
  const panel = document.getElementById('tune-panel');
  if (!btn || !panel) return;
  if (!enabled) return; // fica com display:none do CSS — nunca aparece sem o parâmetro

  btn.style.display = 'flex';

  const rows = TUNE_SPEC.map(({ key, label, min, max, step }) => `
    <div class="tune-row">
      <label for="tune-${key}">${label}</label>
      <input type="range" id="tune-${key}" min="${min}" max="${max}" step="${step}" value="${TUNE[key]}">
      <span class="tune-val" id="tune-${key}-val">${TUNE[key]}</span>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="tune-header">
      <strong>Ajustes (ao vivo)</strong>
      <button type="button" id="tune-close" aria-label="Fechar">✕</button>
    </div>
    ${rows}
    <div class="tune-footer">
      <button type="button" id="tune-reset">Resetar padrão</button>
      <button type="button" id="tune-copy">Copiar valores</button>
    </div>
    <pre id="tune-readout"></pre>
  `;

  const readout = panel.querySelector('#tune-readout');
  const updateReadout = () => {
    readout.textContent = TUNE_SPEC.map(({ key }) => `${key}: ${TUNE[key]}`).join('\n');
  };
  updateReadout();

  for (const { key } of TUNE_SPEC) {
    const input = panel.querySelector(`#tune-${key}`);
    const val = panel.querySelector(`#tune-${key}-val`);
    input.addEventListener('input', () => {
      TUNE[key] = parseFloat(input.value);
      val.textContent = TUNE[key];
      updateReadout();
      saveTune(); // persiste a cada mudança — sobrevive a reload no meio do teste
    });
  }

  panel.querySelector('#tune-reset').addEventListener('click', () => {
    resetTune();
    for (const { key } of TUNE_SPEC) {
      panel.querySelector(`#tune-${key}`).value = TUNE[key];
      panel.querySelector(`#tune-${key}-val`).textContent = TUNE[key];
    }
    updateReadout();
  });

  panel.querySelector('#tune-copy').addEventListener('click', async () => {
    const text = TUNE_SPEC.map(({ key }) => `${key}: ${TUNE[key]}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      panel.querySelector('#tune-copy').textContent = 'Copiado!';
      setTimeout(() => { panel.querySelector('#tune-copy').textContent = 'Copiar valores'; }, 1200);
    } catch (_) { /* clipboard indisponível (ex.: sem HTTPS) — o <pre> já mostra os valores */ }
  });

  panel.querySelector('#tune-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  btn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
  });
}
