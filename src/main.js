import { Game } from './Game.js?v=26';
import { animationManager } from './AnimationManager.js?v=4';
import { initTunePanel } from './TunePanel.js?v=1';
import { initMenuUI, updateLoadingStages } from './MenuUI.js?v=4';
import { resolveWsUrl, hasResumableSession } from './Net.js?v=8';
import { getProfile, updateProfile } from './Auth.js?v=3';

// Painel de ajuste ao vivo (⚙️) — só aparece com ?tune=1 na URL, ver TunePanel.js.
initTunePanel();

const overlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const loaderFill = document.getElementById('loader-fill');
const loaderStatus = document.getElementById('loader-status');

// Seletor de forma (Fase 4, agora dentro de Personalização — Fase D do
// Plano 2): sessionStorage['eom-body'] continua sendo a fonte de verdade
// pro JOGO em si (Player.js só lê sessionStorage, nunca fala com o
// Supabase direto) — logado, a conta só empurra o valor pra sessionStorage
// (no login) e recebe de volta (no clique); deslogado funciona 100% local,
// como sempre funcionou.
let currentUserId = null;
const bodyPick = document.getElementById('body-pick');

function setBodyKind(kind, { persistAccount = true } = {}) {
  sessionStorage.setItem('eom-body', kind);
  if (bodyPick) {
    for (const b of bodyPick.querySelectorAll('button')) b.classList.toggle('on', b.dataset.kind === kind);
  }
  if (persistAccount && currentUserId) {
    updateProfile(currentUserId, { body_kind: kind }).catch(() => {});
  }
}

if (bodyPick) {
  setBodyKind(sessionStorage.getItem('eom-body') || 'toy', { persistAccount: false });
  for (const btn of bodyPick.querySelectorAll('button')) {
    btn.addEventListener('click', () => setBodyKind(btn.dataset.kind));
  }
}

// Nome de jogador (Fase D, Plano 2): só existe pra quem tem conta —
// profiles.username, usado depois no Ranking (Fase E). #custom-modal
// alterna qual dos dois blocos aparece conforme onAuthChange abaixo.
const customUsernameLoggedOut = document.getElementById('custom-username-logged-out');
const customUsernameLoggedIn = document.getElementById('custom-username-logged-in');
const customUsernameInput = document.getElementById('custom-username');
const customUsernameMsg = document.getElementById('custom-username-msg');

if (customUsernameInput) {
  customUsernameInput.addEventListener('change', async () => {
    if (!currentUserId) return;
    const value = customUsernameInput.value.trim();
    if (!value) return;
    const { error } = await updateProfile(currentUserId, { username: value });
    if (customUsernameMsg) {
      customUsernameMsg.textContent = error ? error.message : 'Salvo!';
      customUsernameMsg.classList.toggle('error', !!error);
    }
  });
}

// Chamado por MenuUI.js (que já possui a assinatura onAuthStateChange do
// Supabase) toda vez que login/logout/refresh de sessão acontece — inclusive
// na carga inicial da página. No login, puxa o profile e sincroniza forma do
// corpo + nome pra cá; no logout, só esconde o campo de nome (forma do corpo
// continua valendo localmente, sem precisar resetar pro padrão).
async function onAuthChange(session) {
  currentUserId = session ? session.user.id : null;
  if (customUsernameLoggedOut) customUsernameLoggedOut.classList.toggle('hidden', !!session);
  if (customUsernameLoggedIn) customUsernameLoggedIn.classList.toggle('hidden', !session);
  if (!session) return;
  const { profile } = await getProfile(session.user.id);
  if (!profile) return;
  if (customUsernameInput) customUsernameInput.value = profile.username || '';
  if (profile.body_kind) setBodyKind(profile.body_kind, { persistAccount: false });
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
      const roomInput = document.getElementById('room-code-input');
      if (btn.dataset.mode === 'online') {
        const code = (roomInput?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        if (code) sessionStorage.setItem('eom-room-code', code);
        else sessionStorage.removeItem('eom-room-code');
      } else {
        sessionStorage.removeItem('eom-room-code');
      }
      for (const b of modePick.querySelectorAll('button')) b.classList.toggle('on', b === btn);
    });
  }
}

// "Continuar Partida" (Fase B, Plano 2 — docs/PLANO_CONTAS.md §5): deliberadamente
// SEM conta. Só reaproveita a sessão que Net.js já guarda sozinho em
// sessionStorage pra decidir se mostra o atalho — habilitado só quando há uma
// sessão válida pra ESTE servidor (mesma checagem que Net.connect() já faria
// de qualquer forma; aqui é só pra saber se vale a pena mostrar o botão).
// Clicar simula escolher o card "Online": connect() dentro do Game novo tenta
// o rejoin sozinho (?rejoin=id:token), sem nenhum caminho novo de conexão.
const continueBtn = document.getElementById('continue-match-btn');
if (continueBtn) {
  if (hasResumableSession(resolveWsUrl())) {
    continueBtn.disabled = false;
    const sub = document.getElementById('continue-match-sub');
    if (sub) sub.textContent = 'Reconectar à sua última sala';
  }
  continueBtn.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    document.querySelector('#mode-pick button[data-mode="online"]')?.click();
  });
}

// "Instalar Aplicativo" (Fase C, Plano 2): o Chrome/Android/Edge dispara
// `beforeinstallprompt` quando o app é instalável — precisa `preventDefault()`
// e guardar o evento pra chamar `.prompt()` depois, dentro de um gesto do
// usuário (o clique no botão), já que o navegador só permite usar isso uma
// vez e não fora de um gesto. Sem esse evento (iOS Safari nunca tem; alguns
// navegadores desktop também não), o clique abre #install-modal com o passo
// a passo manual em vez de fingir que instalou.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

const installBtn = document.getElementById('install-btn');
const installSub = document.getElementById('install-sub');
const jaInstalado = () => {
  if (!installBtn) return;
  installBtn.disabled = true;
  if (installSub) installSub.textContent = 'Já instalado';
};
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
  jaInstalado();
}
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (installBtn.disabled) return;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else {
      document.getElementById('install-modal')?.classList.remove('hidden');
    }
  });
}
window.addEventListener('appinstalled', jaInstalado);

// Inicia o pré-carregamento de todas as animações 3D no boot da página.
// `wantsAutoStart` fica true quando o jogador já escolheu um modo (tela de
// loading do MenuUI está ativa) antes do carregamento terminar — nesse caso o
// próprio callback dispara startGame() ao chegar em 100%, em vez de esperar o
// clique no #start-btn (que agora só existe como fallback escondido).
let loadPercent = 0;
let wantsAutoStart = false;

animationManager.loadAll((percent, key) => {
  loadPercent = percent;
  if (loaderFill) loaderFill.style.width = `${percent}%`;
  if (loaderStatus) loaderStatus.textContent = `${percent}%`;
  updateLoadingStages(percent);

  if (percent >= 100 && startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = 'JOGAR';
    if (wantsAutoStart) {
      wantsAutoStart = false;
      // Pequeno atraso pra não cortar o "100%" instantaneamente da tela.
      setTimeout(startGame, 500);
    }
  }
});

let game = null;

// Em desenvolvimento (localhost/LAN ou ?debug), expõe o Game no console para
// inspecionar cena, ossos e estado sem precisar instrumentar o código a cada
// verificação. Fica fora quando servido de um domínio de verdade.
const EM_DESENVOLVIMENTO = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  .test(location.hostname) || new URLSearchParams(location.search).has('debug');

// Service worker do PWA (Fase C, Plano 2 — sw.js): só registra fora de dev,
// mesma flag acima — em dev o dev_server.py já garante JS/CSS sempre fresco
// via no-store, e um SW por cima disso reintroduziria cache obsoleto bem no
// cenário que esses headers existem pra evitar.
if (!EM_DESENVOLVIMENTO && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

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

// Extraído do listener do #start-btn (que agora é só um fallback escondido, ver
// index.html) pra também poder ser disparado automaticamente pelo fluxo novo de
// telas (MenuUI): escolha de modo → loading → jogo, sem exigir um segundo toque.
async function startGame() {
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
}

startBtn.addEventListener('click', () => {
  if (startBtn.disabled) return;
  startGame();
});

initMenuUI({
  // Chamado quando o jogador toca num card de modo (tela de Escolha de Modo já
  // avançou pra Loading nesse momento, ver MenuUI.js). Se o carregamento já
  // tiver terminado, dispara direto; senão, marca a flag lida no callback do
  // animationManager.loadAll acima.
  onModeChosen() {
    if (loadPercent >= 100) {
      setTimeout(startGame, 500);
    } else {
      wantsAutoStart = true;
    }
  },
  onAuthChange,
});

// Retomada automática após "Próximo estágio"/"Voltar ao Menu" em modo solo
// (Game.js:restartInPlace) — sem Level.dispose(), recalcular layout/
// dificuldade por estágio exige um reload de página inteira, e sem isto o
// jogador cairia de volta na tela de menu principal a cada avanço de fase em
// vez de continuar direto pro jogo. `?continue=1` (setado pelo próprio
// reload) simula o clique real no card do modo já salvo — mesmo padrão de
// "Continuar Partida" acima — disparando a mesma tela de loading e o mesmo
// onModeChosen() de sempre, sem caminho de boot novo. Precisa rodar DEPOIS
// de initMenuUI(): é o listener registrado lá (não o de cima, que só grava
// sessionStorage) que faz showScreen('loading') + chama onModeChosen() —
// clicar antes disso existir é o clique cair no vazio, tela nunca avança.
if (modePick && new URLSearchParams(location.search).has('continue')) {
  const rawSaved = sessionStorage.getItem('eom-mode');
  const saved = VALID_MODES.includes(rawSaved) ? rawSaved : null;
  document.querySelector(`#mode-pick button[data-mode="${saved}"]`)?.click();
}
