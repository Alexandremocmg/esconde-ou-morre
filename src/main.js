import { Game } from './Game.js?v=3';

// O jogo só arranca após um gesto do usuário — necessário para fullscreen
// e para a tentativa de travar a orientação em paisagem no mobile.
const overlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');

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

let game = null;

function boot() {
  if (game) return;
  const canvas = document.getElementById('scene');
  game = new Game(canvas);
  game.start();
}

async function enterImmersive() {
  const app = document.getElementById('app');
  // Fullscreen (ignora falhas em desktop/permite continuar)
  try {
    if (app.requestFullscreen) await app.requestFullscreen();
  } catch (_) { /* ok */ }
  // Trava landscape onde suportado (só funciona em fullscreen no mobile)
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (_) { /* desktop/iOS não suportam — segue mesmo assim */ }
}

startBtn.addEventListener('click', async () => {
  overlay.classList.add('hidden');
  // Inicia jogo + áudio SÍNCRONO, ainda dentro do gesto do clique: garante que
  // o AudioContext seja retomado (política de autoplay dos navegadores).
  boot();
  // Fullscreen / lock de orientação vêm depois (podem falhar sem quebrar o jogo).
  await enterImmersive();
});
