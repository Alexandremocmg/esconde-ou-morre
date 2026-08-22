// Controla as 3 telas dentro de #start-overlay (main/mode/loading) e os modais
// (Configurações, Como Jogar, "Em breve"). Não sabe nada sobre Game.js — só
// alterna visibilidade de DOM e delega o início da partida pro callback
// `onModeChosen` passado por main.js (que já sabe extrair/chamar startGame()).
//
// #start-overlay continua sendo o único elemento que Game.js manipula
// (restartInPlace só faz classList.remove('hidden') nele) — por isso os
// listeners de #go-menu/#win-restart aqui são ADICIONAIS aos de Game.js, não
// substitutos: só resetam qual .menu-screen fica visível quando o jogador volta
// ao menu, sem duplicar a lógica de mostrar/esconder o overlay em si.

export function initMenuUI({ onModeChosen } = {}) {
  const overlay = document.getElementById('start-overlay');
  if (!overlay) return;

  const screens = overlay.querySelectorAll('.menu-screen');

  function showScreen(name) {
    overlay.dataset.screen = name;
    for (const el of screens) {
      el.classList.toggle('active', el.dataset.screenName === name);
    }
  }

  // ---------- Navegação entre telas ----------
  const playBtn = document.getElementById('menu-play-btn');
  if (playBtn) playBtn.addEventListener('click', () => showScreen('mode'));

  const backBtn = document.getElementById('mode-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => showScreen('main'));

  // Cards de modo: o listener que grava sessionStorage['eom-mode'] já existe em
  // main.js (lê button[data-mode] dentro de #mode-pick, que continua igual).
  // Aqui só avançamos pra tela de loading e dependemos disso ter rodado antes,
  // já que os listeners são registrados na ordem em que os módulos importam —
  // main.js registra o dele antes de chamar initMenuUI().
  const modePick = document.getElementById('mode-pick');
  if (modePick) {
    for (const btn of modePick.querySelectorAll('button[data-mode]')) {
      btn.addEventListener('click', () => {
        showScreen('loading');
        if (onModeChosen) onModeChosen();
      });
    }
  }

  // ---------- Modais ----------
  function openModal(modal) { if (modal) modal.classList.remove('hidden'); }
  function closeModal(modal) { if (modal) modal.classList.add('hidden'); }

  const settingsModal = document.getElementById('settings-modal');
  const howModal = document.getElementById('how-modal');
  const soonModal = document.getElementById('soon-modal');
  const soonTitle = document.getElementById('soon-title');

  for (const btn of document.querySelectorAll('.open-settings')) {
    btn.addEventListener('click', () => openModal(settingsModal));
  }
  for (const btn of document.querySelectorAll('.open-how')) {
    btn.addEventListener('click', () => openModal(howModal));
  }
  for (const btn of document.querySelectorAll('[data-soon]')) {
    btn.addEventListener('click', () => {
      if (soonTitle) soonTitle.textContent = btn.dataset.soon;
      openModal(soonModal);
    });
  }
  for (const btn of document.querySelectorAll('[data-modal-close]')) {
    btn.addEventListener('click', () => closeModal(btn.closest('.menu-modal')));
  }
  // Fecha clicando no fundo escuro (fora do cartão), não no cartão em si.
  for (const modal of [settingsModal, howModal, soonModal]) {
    if (!modal) continue;
    modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(modal); });
  }

  // ---------- Voltar ao menu principal (Game Over / Vitória) ----------
  // Listener adicional aos de Game.js (que só cuidam de #start-overlay em si).
  const goMenuBtn = document.getElementById('go-menu');
  if (goMenuBtn) goMenuBtn.addEventListener('click', () => showScreen('main'));
  const winRestartBtn = document.getElementById('win-restart');
  if (winRestartBtn) winRestartBtn.addEventListener('click', () => showScreen('main'));

  return { showScreen };
}

// Mapeia o % de carregamento pras 5 legendas cosméticas da tela de loading
// (puramente decorativo — não reflete etapas reais do carregamento, que hoje é
// só o download dos 2 GLB via AnimationManager).
const STAGE_THRESHOLDS = [0, 20, 40, 60, 80];

export function updateLoadingStages(percent) {
  const stageEls = document.querySelectorAll('#screen-loading .stage-ic');
  let activeIndex = 0;
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (percent >= STAGE_THRESHOLDS[i]) activeIndex = i;
  }
  stageEls.forEach((el, i) => el.classList.toggle('active', i <= activeIndex));
}
