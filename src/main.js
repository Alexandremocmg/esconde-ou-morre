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

function boot() {
  if (game) return;
  const canvas = document.getElementById('scene');
  game = new Game(canvas);
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
  overlay.classList.add('hidden');
  boot();
  await enterImmersive();
});
