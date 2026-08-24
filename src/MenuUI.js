import { signUp, signIn, signOut, getSession, onAuthStateChange, getProfile, getSurvivalRanking, getHunterRanking } from './Auth.js?v=2';

// Controla as 3 telas dentro de #start-overlay (main/mode/loading), os modais
// (Configurações, Como Jogar, "Em breve") e a conta de jogador (Plano 2, Fase A
// — Supabase Auth, ver Auth.js). Não sabe nada sobre Game.js — só alterna
// visibilidade de DOM e delega o início da partida pro callback
// `onModeChosen` passado por main.js (que já sabe extrair/chamar startGame()).
//
// #start-overlay continua sendo o único elemento que Game.js manipula
// (restartInPlace só faz classList.remove('hidden') nele) — por isso os
// listeners de #go-menu/#win-restart aqui são ADICIONAIS aos de Game.js, não
// substitutos: só resetam qual .menu-screen fica visível quando o jogador volta
// ao menu, sem duplicar a lógica de mostrar/esconder o overlay em si.

export function initMenuUI({ onModeChosen, onAuthChange } = {}) {
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

  // ---------- Modais (genérico, Plano 2 Fase A) ----------
  // Qualquer `<button data-modal-open="x">` abre `#x-modal` — não precisa mais
  // de um bloco de código por modal novo (era o caso antes: settings/how/soon
  // cada um hardcoded). `.menu-modal` cobre fechar-por-fora e o ✕
  // (`[data-modal-close]`) automaticamente pra qualquer modal que existir no
  // DOM, incluindo os que este arquivo nunca chega a mencionar pelo nome.
  function openModal(modal) { if (modal) modal.classList.remove('hidden'); }
  function closeModal(modal) { if (modal) modal.classList.add('hidden'); }

  for (const btn of document.querySelectorAll('[data-modal-open]')) {
    btn.addEventListener('click', () => openModal(document.getElementById(`${btn.dataset.modalOpen}-modal`)));
  }

  // "Em breve" continua um caso especial: um único modal reaproveitado por
  // vários botões, com o título trocado na hora (ver index.html [data-soon]).
  const soonModal = document.getElementById('soon-modal');
  const soonTitle = document.getElementById('soon-title');
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
  for (const modal of document.querySelectorAll('.menu-modal')) {
    modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(modal); });
  }

  // ---------- Conta (Plano 2, Fase A — docs/PLANO_CONTAS.md) ----------
  const authModal = document.getElementById('auth-modal');
  if (authModal) {
    const authChip = document.getElementById('auth-chip');
    const loggedOutEl = document.getElementById('auth-logged-out');
    const loggedInEl = document.getElementById('auth-logged-in');
    const usernameDisplay = document.getElementById('auth-username-display');
    const authForm = document.getElementById('auth-form');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const authUsername = document.getElementById('auth-username');
    const authSubmit = document.getElementById('auth-submit');
    const authMsg = document.getElementById('auth-msg');
    const authSignout = document.getElementById('auth-signout');
    const authTabs = authModal.querySelectorAll('.auth-tab');

    let mode = 'signin';
    const setMode = (next) => {
      mode = next;
      authTabs.forEach((t) => t.classList.toggle('on', t.dataset.authTab === mode));
      authUsername.classList.toggle('hidden', mode !== 'signup');
      authSubmit.textContent = mode === 'signup' ? 'Criar Conta' : 'Entrar';
      authMsg.textContent = '';
      authMsg.classList.remove('error');
    };
    authTabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.authTab)));

    // Reflete a sessão atual (chip com anel verde + qual bloco do modal
    // aparece). `onAuthStateChange` cobre login/logout/refresh de token —
    // não precisa recarregar a página nem reabrir o modal pra atualizar.
    const showLoggedState = (session) => {
      const logged = !!session;
      loggedOutEl.classList.toggle('hidden', logged);
      loggedInEl.classList.toggle('hidden', !logged);
      authChip.classList.toggle('on', logged);
      if (logged) {
        getProfile(session.user.id).then(({ profile }) => {
          usernameDisplay.textContent = profile ? profile.username : session.user.email;
        });
      } else {
        setMode('signin');
      }
      // Personalização (Fase D) precisa saber sessão logada/deslogada pra
      // sincronizar forma do corpo/nome com profiles — MenuUI é quem já
      // possui a assinatura de onAuthStateChange, não duplica em main.js.
      if (onAuthChange) onAuthChange(session);
    };
    getSession().then(({ session }) => showLoggedState(session));
    onAuthStateChange(showLoggedState);

    authForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      authSubmit.disabled = true;
      authMsg.textContent = '';
      authMsg.classList.remove('error');
      const email = authEmail.value.trim();
      const password = authPassword.value;
      const { data, error } = mode === 'signup'
        ? await signUp(email, password, authUsername.value.trim())
        : await signIn(email, password);
      authSubmit.disabled = false;
      if (error) {
        authMsg.textContent = error.message;
        authMsg.classList.add('error');
        return;
      }
      // Se o projeto exigir confirmação de e-mail, signUp() cria a conta mas
      // NÃO devolve sessão (`data.session` nulo) — sem isto o modal fechava
      // "com sucesso" e o jogador ficava sem entender por que não logou.
      if (mode === 'signup' && !data.session) {
        authMsg.textContent = 'Conta criada! Confirme seu e-mail (verifique a caixa de entrada) e entre depois.';
        authForm.reset();
        return;
      }
      authForm.reset();
      closeModal(authModal); // showLoggedState já roda via onAuthStateChange
    });

    if (authSignout) {
      authSignout.addEventListener('click', async () => {
        await signOut();
        closeModal(authModal);
      });
    }
  }

  // ---------- Ranking (Plano 2, Fase E — docs/PLANO_CONTAS.md) ----------
  const rankingModal = document.getElementById('ranking-modal');
  if (rankingModal) {
    const rankingList = document.getElementById('ranking-list');
    const rankingTabs = rankingModal.querySelectorAll('.auth-tab');
    let rankingLoadedTab = null;

    const formatDuration = (seconds) => {
      const s = Math.max(0, Math.round(seconds));
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}`;
    };

    const renderRanking = (rows, valueFn) => {
      rankingList.innerHTML = '';
      if (!rows.length) {
        rankingList.innerHTML = '<li class="ranking-empty">Ninguém no ranking ainda — jogue logado pra aparecer aqui!</li>';
        return;
      }
      for (let i = 0; i < rows.length; i++) {
        const li = document.createElement('li');
        li.className = 'ranking-row';
        const rank = document.createElement('span');
        rank.className = 'ranking-rank';
        rank.textContent = String(i + 1);
        const name = document.createElement('span');
        name.className = 'ranking-name';
        name.textContent = rows[i].username;
        const value = document.createElement('span');
        value.className = 'ranking-value';
        value.textContent = valueFn(rows[i]);
        li.append(rank, name, value);
        rankingList.appendChild(li);
      }
    };

    const loadTab = async (tab) => {
      rankingList.innerHTML = '<li class="ranking-empty">Carregando…</li>';
      if (tab === 'hunter') {
        renderRanking(await getHunterRanking(), (r) => `${r.wins} vitória${r.wins === 1 ? '' : 's'}`);
      } else {
        renderRanking(await getSurvivalRanking(), (r) => formatDuration(r.camo_time_seconds));
      }
      rankingLoadedTab = tab;
    };

    rankingTabs.forEach((t) => {
      t.addEventListener('click', () => {
        rankingTabs.forEach((b) => b.classList.toggle('on', b === t));
        loadTab(t.dataset.rankingTab);
      });
    });

    // Só busca dados quando o modal é realmente aberto (não no boot da
    // página) — reaproveita o mesmo clique que já abre o modal (padrão
    // genérico de modais acima), só que aqui também dispara a 1ª carga.
    for (const btn of document.querySelectorAll('[data-modal-open="ranking"]')) {
      btn.addEventListener('click', () => {
        if (!rankingLoadedTab) loadTab('survival');
      });
    }
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
