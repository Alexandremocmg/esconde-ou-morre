import { Game } from './Game.js';
import { animationManager } from './AnimationManager.js';

const overlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const loaderFill = document.getElementById('loader-fill');
const loaderStatus = document.getElementById('loader-status');

// Seletor de forma (Fase 4): persiste 'eom-body' e realça o botão escolhido.
const bodyPick = document.getElementById('body-pick');
if (bodyPick) {
  const saved = sessionStorage.getItem('eom-body') || 'toy';
  for (const btn of bodyPick.querySelectorAll('button')) {
    btn.classList.toggle('on', btn.dataset.kind === saved);
    btn.addEventListener('click', () => {
      sessionStorage.setItem('eom-body', btn.dataset.kind);
      for (const b of bodyPick.querySelectorAll('button')) b.classList.toggle('on', b === btn);
    });
  }
}

// Seletor de modo: Camaleão (padrão, foge/camufla), Caçador (jogável, mira e atira
// nos Camaleões-alvo) ou Online (multiplayer — docs/PLANO_MULTIPLAYER.md). Mesmo
// padrão do seletor de forma acima.
const VALID_MODES = ['chameleon', 'hunter', 'online'];
const modePick = document.getElementById('mode-pick');
if (modePick) {
  const rawSaved = sessionStorage.getItem('eom-mode');
  const saved = VALID_MODES.includes(rawSaved) ? rawSaved : 'chameleon';
  for (const btn of modePick.querySelectorAll('button')) {
    btn.classList.toggle('on', btn.dataset.mode === saved);
    btn.addEventListener('click', () => {
      sessionStorage.setItem('eom-mode', btn.dataset.mode);
      for (const b of modePick.querySelectorAll('button')) b.classList.toggle('on', b === btn);
    });
  }
}

// Inicia o pré-carregamento de todas as animações 3D no boot da página
animationManager.loadAll((percent, key) => {
  if (loaderFill) loaderFill.style.width = `${percent}%`;
  if (loaderStatus) {
    if (percent < 100) {
      loaderStatus.textContent = `Carregando modelos e animações 3D... ${percent}%`;
    } else {
      loaderStatus.textContent = '✅ Tudo pronto! Clique em JOGAR.';
    }
  }

  if (percent >= 100 && startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = 'JOGAR';
  }
});

let game = null;

// Em desenvolvimento (localhost/LAN ou ?debug), expõe o Game no console para
// inspecionar cena, ossos e estado sem precisar instrumentar o código a cada
// verificação. Fica fora quando servido de um domínio de verdade.
const EM_DESENVOLVIMENTO = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  .test(location.hostname) || new URLSearchParams(location.search).has('debug');

function boot() {
  if (game) return;
  const canvas = document.getElementById('scene');
  game = new Game(canvas);
  if (EM_DESENVOLVIMENTO) window.game = game;
  game.start();
}

async function enterImmersive() {
  const app = document.getElementById('app');
  try {
    if (app.requestFullscreen) await app.requestFullscreen();
  } catch (_) { /* ok */ }
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (_) { /* ok */ }
}

startBtn.addEventListener('click', async () => {
  if (startBtn.disabled) return;
  // O modo (Camaleão/Caçador/Online) só é lido no construtor do Game — trocar de
  // modo depois de já ter jogado exige recarregar a página, já que o Game
  // não tem um dispose() para desmontar o loop de render/cena anterior.
  const rawMode = sessionStorage.getItem('eom-mode');
  const selectedMode = VALID_MODES.includes(rawMode) ? rawMode : 'chameleon';
  if (game && game.mode !== selectedMode) {
    location.reload();
    return;
  }
  overlay.classList.add('hidden');
  if (game) {
    game.restartInPlace(false, false);
  } else {
    boot();
  }
  await enterImmersive();
});
