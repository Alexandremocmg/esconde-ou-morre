import * as THREE from 'three';
import { Level } from './Level.js';
import { Player } from './Player.js';
import { Seeker, WAYPOINTS_ALT } from './Seeker.js';
import { FollowCamera } from './FollowCamera.js';
import { Joystick } from './Joystick.js';
import { Effects } from './Effects.js';
import { Audio } from './Audio.js';
import { ColorPicker } from './ColorPicker.js';

// Partida (Fase 4): objetivo = sobreviver ao Caçador até o tempo acabar.
const BASE_SURVIVE = 60;      // s de sobrevivência no estágio 1
const SURVIVE_PER_STAGE = 15; // s adicionais por estágio
const DIFF_PER_STAGE = 0.12;  // incremento de dificuldade por estágio (velocidade do Caçador)
// A mansão tem 3 níveis: um Caçador só não cobre nenhum deles direito (medido:
// ~1% do 2º andar em 120 s). Desde o estágio 1 há um por DOMÍNIO — térreo e
// andares altos — e um 3º (térreo, sentido oposto) a partir do estágio 3.
const THIRD_SEEKER_STAGE = 3;
const WARN_WINDOW = 5;        // s de antecedência para o feedback de perigo / quase-vitória

// Formata segundos como m:ss.
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;

    // Detecção de GPU mobile: ponteiro grosso (touch) OU tela curta. Usada para
    // limitar pixel ratio e resolução de sombra — evita a queda de FPS relatada
    // em aparelhos intermediários (sombra 2048² em tempo real é cara em mobile).
    this.isMobile = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || Math.min(window.innerWidth, window.innerHeight) < 540;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Look TOON (estilo Meccha Chameleon): sem tone mapping, para as cores chapadas
    // saírem "cruas". ACES comprimia highlights e dessaturava — o oposto do hand-drawn.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Cena — ambiente CLARO e legível (party game), não mais penumbra de terror.
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeaf0f5);
    // Fog claro e distante: só suaviza o horizonte, sem fechar a cena. A leitura
    // clara é a assinatura do look toon (ao contrário da penumbra anterior).
    this.scene.fog = new THREE.Fog(0xeaf0f5, 40, 120);

    // Câmera (proporção landscape de celular; ajustada no resize)
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);

    this._addLights();

    // Estágio atual (persiste entre reloads para permitir progressão).
    this.stage = Math.max(1, parseInt(sessionStorage.getItem('eom-stage') || '1', 10) || 1);
    this.surviveTime = BASE_SURVIVE + (this.stage - 1) * SURVIVE_PER_STAGE;
    const difficulty = 1 + (this.stage - 1) * DIFF_PER_STAGE;

    // Estado da partida
    this.over = false;   // pego pelo Caçador
    this.won = false;    // objetivo concluído
    this.elapsed = 0;    // tempo decorrido na fase
    this.camoTime = 0;   // tempo total camuflado

    // Layout da arena por estágio (cicla a cada 3): 1=aberta, 2=labirinto, 3=ilhas.
    const layout = ((this.stage - 1) % 3) + 1;
    this.level = new Level(this.scene, layout, { mobile: this.isMobile });
    this.player = new Player(this.scene, this.level);
    this.effects = new Effects(this.scene);
    this.audio = new Audio();

    // Caçadores. O primeiro sempre existe; um segundo (rota cruzada, cor distinta)
    // entra a partir do estágio THIRD_SEEKER_STAGE. As rotas vêm do layout.
    const routes = this.level.routes;
    const routeY = this.level.routeY || [];
    const mkSeeker = (i, color) => new Seeker(
      this.scene, this.level, this.player, () => this._gameOver(),
      { difficulty, waypoints: routes[i] || WAYPOINTS_ALT, startY: routeY[i], color }
    );
    // 0 = térreo; 1 = andares altos (nasce no 2º andar); 2 = térreo em sentido oposto.
    this.seekers = [mkSeeker(0), mkSeeker(1, 0xb01ecb)];
    if (this.stage >= THIRD_SEEKER_STAGE) this.seekers.push(mkSeeker(2, 0xd88a1a));

    this.follow = new FollowCamera(this.camera);
    this.joystick = new Joystick();

    // Estado de feedback (evita disparar sons repetidos no mesmo segundo)
    this._prevState = this.player.state;
    this._heartTimer = 0;
    this._lastWinTick = -1;
    this._spotted = false; // borda de subida da detecção (para som + UI de alerta)

    // Controles de ação (botões) + olhar (arrasto na metade direita da tela).
    this._btnLatch = document.getElementById('btn-latch');
    this._btnPaint = document.getElementById('btn-paint');
    this._btnPalette = document.getElementById('btn-palette');
    this._btnCrouch = document.getElementById('btn-crouch');
    // Roda de cor (Fase 5b): ajuste fino do disfarce sobre o conta-gotas.
    this.colorPicker = new ColorPicker({ onChange: (c) => this.player.setCamouflage(c) });
    this._setupControls();

    // Oclusão da câmera: blocos entre a câmera e o jogador desvanecem para não
    // esconder o personagem (ex.: grudado na face traseira de um bloco).
    this._occRay = new THREE.Raycaster();
    this._occDir = new THREE.Vector3();
    this._occFaded = new Set(); // materiais atualmente esmaecidos

    // HUD
    this._badge = document.getElementById('state-badge');
    this._penumbraEl = document.getElementById('penumbra-badge');
    this._chip = document.querySelector('#color-chip span');
    this._gameoverEl = document.getElementById('gameover');
    this._victoryEl = document.getElementById('victory');
    this._vignette = document.getElementById('vignette');
    this._alertEl = document.getElementById('alert');

    // Placar da partida
    this._elStage = document.getElementById('stage-num');
    this._elElapsed = document.getElementById('timer-elapsed');
    this._elGoal = document.getElementById('timer-goal');
    this._elCamo = document.getElementById('timer-camo');
    this._elFill = document.getElementById('timer-fill');
    if (this._elStage) this._elStage.textContent = String(this.stage);
    if (this._elGoal) this._elGoal.textContent = fmtTime(this.surviveTime);

    // Botões da tela de vitória
    const nextBtn = document.getElementById('win-next');
    const restartBtn = document.getElementById('win-restart');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      sessionStorage.setItem('eom-stage', String(this.stage + 1));
      location.reload();
    });
    if (restartBtn) restartBtn.addEventListener('click', () => {
      sessionStorage.setItem('eom-stage', '1');
      location.reload();
    });

    this._clock = new THREE.Clock();
    this._resize();
    window.addEventListener('resize', this._resize);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', this._resize);
    }
  }

  _addLights() {
    // Iluminação TOON: clara e plana. O cel-shading quer sombra própria mínima e
    // leitura de cor honesta (a camuflagem depende de LER a cor da superfície).
    // Céu branco, solo neutro claro — nada de âmbar de penumbra.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ea, 0.95));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Luz-chave branca e estável: único caster de sombra (perf). Contraste baixo,
    // borda suave — a sombra é sutil, o look cel não depende dela.
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(5, 18, 3);
    key.castShadow = !this.isMobile;       // mobile: sem sombra (o cel dispensa)
    const shadowRes = 2048;
    key.shadow.mapSize.set(shadowRes, shadowRes);
    key.shadow.radius = 3;                 // borda suave (PCFSoftShadowMap)
    const s = 15;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 42;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
  }

  // Fiação dos controles: botões de ação e a área de olhar (arrasto → câmera).
  _setupControls() {
    // Botões: um toque (pointerdown) dispara a ação. stopPropagation evita que o
    // toque também conte como arrasto de olhar no look-zone que fica atrás.
    const press = (el, fn) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.over || this.won) return;
        fn();
      }, { passive: false });
    };
    press(this._btnLatch, () => this.player.toggleLatch(this.camera));
    press(this._btnCrouch, () => this.player.toggleCrouch());
    press(this._btnPaint, () => {
      const color = this.player.sampleColor(this.camera); // conta-gotas mirado (Fase 5a)
      if (color) {
        this.effects.pulse(this.player.position, color);
        this.audio.paint();
        if (this.colorPicker.open) this.colorPicker.show(color); // re-semeia a roda aberta
      }
    });
    // Abre/fecha a roda de cor, semeando com a cor atual do disfarce (Fase 5b).
    press(this._btnPalette, () => this.colorPicker.toggle(this.player.targetColor));

    // Olhar: arrasto na metade direita. Segue o padrão do Joystick (pointerId
    // próprio; move/up no window) para não conflitar com o joystick esquerdo.
    const zone = document.getElementById('look-zone');
    if (zone) {
      let id = null, lx = 0, ly = 0;
      zone.addEventListener('pointerdown', (e) => {
        if (id !== null) return;
        e.preventDefault();
        id = e.pointerId; lx = e.clientX; ly = e.clientY;
      }, { passive: false });
      window.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        e.preventDefault();
        this.follow.addLook(e.clientX - lx, e.clientY - ly);
        lx = e.clientX; ly = e.clientY;
      }, { passive: false });
      const end = (e) => { if (e.pointerId === id) id = null; };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    }
  }

  start() {
    this.audio.resume(); // dentro do gesto do usuário (botão iniciar)
    this.renderer.setAnimationLoop(this._tick);
  }

  _tick = () => {
    const dt = Math.min(this._clock.getDelta(), 0.05); // clamp anti-tab-switch
    if (!this.over && !this.won) {
      this.player.update(dt, this.joystick.value, this.camera);
      for (const s of this.seekers) s.update(dt);

      // Juice: pulso + clique ao GRUDAR na parede (transição chão → parede).
      if (this._prevState === 'grounded' && this.player.state === 'latched') {
        this.effects.pulse(this.player.position, 0x9fe8ff);
        this.audio.latch();
      }
      this._prevState = this.player.state;

      // Cronômetro da partida
      this.elapsed += dt;
      if (this.player.isCamouflaged()) this.camoTime += dt;

      this._updateFeedback(dt);

      if (this.elapsed >= this.surviveTime) this._win();
    }
    const t = this._clock.elapsedTime;
    this.level.update?.(t);                 // girofles/painéis piscando
    this.effects.update(dt, this.camera);
    this.follow.update(dt, this.player, this.level.cameraColliders || this.level.climbables);
    this._updateOcclusion(dt);
    this._updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  // Desvanece blocos que ficam ENTRE a câmera e o jogador (e restaura os demais),
  // para o personagem nunca sumir atrás da própria geometria. Interpola opacidade
  // para não "piscar"; a colisão/latching ignoram material, então não são afetados.
  _updateOcclusion(dt) {
    const FADE = 0.3;                       // opacidade alvo do bloco oclusor
    const k = Math.min(1, 12 * dt);
    const dir = this._occDir.subVectors(this.player.position, this.camera.position);
    const dist = dir.length();
    dir.multiplyScalar(1 / Math.max(dist, 1e-3));
    this._occRay.set(this.camera.position, dir);
    this._occRay.far = Math.max(0, dist - 0.8); // não conta o bloco onde ele gruda
    const hits = this._occRay.intersectObjects(this.level.climbables, false);

    const nowFaded = new Set();
    for (const h of hits) nowFaded.add(h.object.material);
    for (const mat of nowFaded) {
      mat.transparent = true;
      mat.depthWrite = false;               // deixa o jogador aparecer através
      mat.opacity += (FADE - mat.opacity) * k;
      this._occFaded.add(mat);
    }
    // Restaura os que deixaram de ocluir (delete-durante-iteração é seguro em Set).
    for (const mat of this._occFaded) {
      if (nowFaded.has(mat)) continue;
      mat.opacity += (1 - mat.opacity) * k;
      if (mat.opacity > 0.985) {
        mat.opacity = 1;
        mat.transparent = false;
        mat.depthWrite = true;
        this._occFaded.delete(mat);
      }
    }
  }

  // Feedback de tensão: vinheta + som quando falta pouco para vencer OU quando
  // um Caçador está prestes a capturar (< WARN_WINDOW s). Alerta de DETECÇÃO
  // (spotted) dispara assim que um Caçador te vê sem camuflagem — antes do perigo.
  _updateFeedback(dt) {
    const remaining = this.surviveTime - this.elapsed;
    const camo = this.player.isCamouflaged();

    // Detecção: algum Caçador te enxerga AGORA (na vista e sem camuflagem)?
    let spotted = false;
    let catchIn = Infinity;
    if (!camo) {
      for (const s of this.seekers) {
        if (s.validTarget) spotted = true;
        catchIn = Math.min(catchIn, s.timeToCatch(this.player.position));
      }
    }
    const danger = catchIn < WARN_WINDOW;
    const almost = !danger && remaining <= WARN_WINDOW && remaining > 0;

    // Som de alerta só na BORDA de subida (evita repetir a cada frame).
    if (spotted && !this._spotted) this.audio.alert();
    this._spotted = spotted;

    // Vinheta: perigo (iminente) > detecção (visto) > quase vencendo.
    if (this._vignette) {
      this._vignette.classList.toggle('danger', danger);
      this._vignette.classList.toggle('spotted', spotted && !danger);
      this._vignette.classList.toggle('almost', almost && !spotted);
    }
    // Ícone de exclamação enquanto detectado (mesmo antes do perigo iminente).
    if (this._alertEl) this._alertEl.classList.toggle('show', spotted);

    // Áudio de perigo: batida cuja cadência acelera conforme a ameaça aumenta.
    if (danger) {
      const intensity = 1 - Math.max(0, catchIn) / WARN_WINDOW; // 0..1
      this._heartTimer -= dt;
      if (this._heartTimer <= 0) {
        this.audio.heartbeat(intensity);
        this._heartTimer = 0.55 - 0.32 * intensity; // 0.55s longe → ~0.23s perto
      }
    } else {
      this._heartTimer = 0;
    }

    // Áudio de contagem regressiva para a vitória: um bip por segundo.
    if (almost) {
      const sec = Math.ceil(remaining);
      if (sec !== this._lastWinTick) {
        this.audio.countdown(sec);
        this._lastWinTick = sec;
      }
    } else {
      this._lastWinTick = -1;
    }
  }

  _clearVignette() {
    if (this._vignette) this._vignette.classList.remove('danger', 'almost', 'spotted');
    if (this._alertEl) this._alertEl.classList.remove('show');
    this._spotted = false;
  }

  _updateHud() {
    const camo = this.player.isCamouflaged();
    const latched = this.player.state === 'latched';
    this._badge.textContent = camo ? 'CAMUFLADO' : (latched ? 'PAREDE' : (this.player.crouched ? 'AGACHADO' : 'CHÃO'));
    this._badge.classList.toggle('latched', latched && !camo);
    this._badge.classList.toggle('camo', camo);
    this._chip.style.background = `#${this.player.material.color.getHexString()}`;

    // Botões: rótulo/realce de Grudar↔Soltar e destaque do Agachar ativo.
    if (this._btnLatch) {
      this._btnLatch.classList.toggle('on', latched);
      const lbl = this._btnLatch.querySelector('.lbl');
      if (lbl) lbl.textContent = latched ? 'Soltar' : 'Grudar';
    }
    if (this._btnCrouch) this._btnCrouch.classList.toggle('on', this.player.crouched);

    // Penumbra: badge quando a luz na posição do jogador está baixa (o Caçador
    // enxerga de mais perto ali). Limiar 0.5 → "meia-luz ou menos".
    if (this._penumbraEl) {
      const light = this.level.lightAt ? this.level.lightAt(this.player.position) : 1;
      this._penumbraEl.classList.toggle('show', light < 0.5 && !camo);
    }

    // Placar: tempo decorrido (limitado à meta) e tempo camuflado
    const shown = Math.min(this.elapsed, this.surviveTime);
    if (this._elElapsed) this._elElapsed.textContent = fmtTime(shown);
    if (this._elCamo) this._elCamo.textContent = `🫥 ${fmtTime(this.camoTime)}`;
    if (this._elFill) {
      const pct = this.surviveTime > 0 ? (shown / this.surviveTime) * 100 : 0;
      this._elFill.style.width = `${Math.min(100, pct)}%`;
    }
  }

  _gameOver() {
    if (this.won || this.over) return; // já venceu / já acabou neste frame
    this.over = true;
    this._clearVignette();
    this.audio.caught();
    if (this._gameoverEl) this._gameoverEl.classList.add('show');
  }

  _win() {
    if (this.won || this.over) return;
    this.won = true;
    this._clearVignette();
    this.audio.win();

    const winTime = document.getElementById('win-time');
    const winCamo = document.getElementById('win-camo');
    const winPct = document.getElementById('win-camo-pct');
    if (winTime) winTime.textContent = fmtTime(this.surviveTime);
    if (winCamo) winCamo.textContent = fmtTime(this.camoTime);
    if (winPct) {
      const pct = this.surviveTime > 0 ? Math.round((this.camoTime / this.surviveTime) * 100) : 0;
      winPct.textContent = `${Math.min(100, pct)}%`;
    }
    if (this._victoryEl) this._victoryEl.classList.add('show');
  }

  _resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
