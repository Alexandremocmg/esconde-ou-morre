import { Game } from './Game.js';

// O jogo só arranca após um gesto do usuário — necessário para fullscreen
// e para a tentativa de travar a orientação em paisagem no mobile.
const overlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');

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
