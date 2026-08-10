import * as THREE from 'three';
import { Level } from './Level.js';
import { Player } from './Player.js';
import { Seeker, WAYPOINTS_ALT } from './Seeker.js';
import { FollowCamera } from './FollowCamera.js';
import { Joystick } from './Joystick.js';
import { Effects } from './Effects.js';
import { Audio } from './Audio.js';

const TAP_MAX_MS = 300;   // duração máx. de um toque para contar como "tap"
const TAP_MAX_MOVE = 12;  // px de deslocamento máx. para ainda ser um tap

// Partida (Fase 4): objetivo = sobreviver ao Caçador até o tempo acabar.
const BASE_SURVIVE = 60;      // s de sobrevivência no estágio 1
const SURVIVE_PER_STAGE = 15; // s adicionais por estágio
const DIFF_PER_STAGE = 0.12;  // incremento de dificuldade por estágio (velocidade do Caçador)
const SECOND_SEEKER_STAGE = 3; // a partir deste estágio, entra um 2º Caçador
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
    // Grada o amarelo-doentio sem estourar os props brilhosos (vending/girofles).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposição um pouco maior: deixa as cores saturadas dos cômodos/props herói
    // "estourarem" sem lavar o amarelo-doentio do perímetro.
    this.renderer.toneMappingExposure = 1.05;

    // Cena — atmosfera "Backrooms" (escritório decadente, fluorescente).
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x191708);
    // Fog amarelo-doentio, afrouxado um pouco (início mais distante) para não
    // dessaturar os cômodos coloridos de perto — ainda fecha o horizonte.
    this.scene.fog = new THREE.Fog(0xb9b183, 30, 88);

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
    this.level = new Level(this.scene, layout);
    this.player = new Player(this.scene, this.level);
    this.effects = new Effects(this.scene);
    this.audio = new Audio();

    // Caçadores. O primeiro sempre existe; um segundo (rota cruzada, cor distinta)
    // entra a partir do estágio SECOND_SEEKER_STAGE. As rotas vêm do layout.
    const routes = this.level.routes;
    this.seekers = [
      new Seeker(this.scene, this.level, this.player, () => this._gameOver(), {
        difficulty, waypoints: routes[0],
      }),
    ];
    if (this.stage >= SECOND_SEEKER_STAGE) {
      this.seekers.push(new Seeker(this.scene, this.level, this.player, () => this._gameOver(), {
        difficulty, waypoints: routes[1] || WAYPOINTS_ALT, color: 0xb01ecb,
      }));
    }

    this.follow = new FollowCamera(this.camera);
    this.joystick = new Joystick();

    // Estado de feedback (evita disparar sons repetidos no mesmo segundo)
    this._prevState = this.player.state;
    this._heartTimer = 0;
    this._lastWinTick = -1;
    this._spotted = false; // borda de subida da detecção (para som + UI de alerta)

    // Raycaster de camuflagem (toque)
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._setupTapCamouflage();

    // Oclusão da câmera: blocos entre a câmera e o jogador desvanecem para não
    // esconder o personagem (ex.: grudado na face traseira de um bloco).
    this._occRay = new THREE.Raycaster();
    this._occDir = new THREE.Vector3();
    this._occFaded = new Set(); // materiais atualmente esmaecidos

    // HUD
    this._badge = document.getElementById('state-badge');
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
    // Fluorescente deprimente: preenchimento difuso pálido esverdeado, achatado
    // (sombra chapada de escritório). Céu verde-creme, solo verde-oliva.
    this.scene.add(new THREE.HemisphereLight(0xf2f5df, 0x3a3826, 0.75));
    this.scene.add(new THREE.AmbientLight(0xe8f0d8, 0.35));

    // "Painel" cenital: luminária embutida quase vertical, branco-pálido frio.
    // Único caster de sombra (perf) → quinas com sombra curta e dura, sem calor.
    const fluor = new THREE.DirectionalLight(0xeaf3d6, 0.9);
    fluor.position.set(6, 30, 4);
    fluor.castShadow = true;
    const shadowRes = this.isMobile ? 1024 : 2048; // metade da resolução em mobile
    fluor.shadow.mapSize.set(shadowRes, shadowRes);
    fluor.shadow.radius = 3;               // borda suave (PCFSoftShadowMap)
    // Frustum de sombra alargado p/ cobrir a arena ampliada (HALF=40).
    const s = 42;
    fluor.shadow.camera.left = -s;
    fluor.shadow.camera.right = s;
    fluor.shadow.camera.top = s;
    fluor.shadow.camera.bottom = -s;
    fluor.shadow.camera.near = 1;
    fluor.shadow.camera.far = 90;
    fluor.shadow.bias = -0.0004;
    this.scene.add(fluor);

    // Referência p/ o zumbido/flicker fluorescente no loop.
    this._fluor = fluor;
    this._fluorBase = fluor.intensity;
  }

  // Zumbido fluorescente: leve tremor de intensidade + "piscadas" ocasionais.
  _fluorFlicker(t) {
    if (!this._fluor) return;
    let k = 1 + 0.04 * Math.sin(t * 90) + 0.02 * Math.sin(t * 37.3);
    // Queda breve e rara (a lâmpada "falha" por um instante).
    if (Math.sin(t * 11.0) > 0.995 || Math.random() < 0.006) k *= 0.55;
    this._fluor.intensity = this._fluorBase * k;
  }

  _setupTapCamouflage() {
    let downX = 0, downY = 0, downT = 0, downId = null;

    this.canvas.addEventListener('pointerdown', (e) => {
      downId = e.pointerId;
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId !== downId) return;
      downId = null;
      const dt = performance.now() - downT;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dt > TAP_MAX_MS || moved > TAP_MAX_MOVE) return; // foi arrasto, não tap
      if (this.player.state !== 'latched') return;          // só camufla grudado
      this._tryCamouflage(e.clientX, e.clientY);
    });
  }

  _tryCamouflage(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._ray.setFromCamera(this._ndc, this.camera);
    const hit = this._ray.intersectObjects(this.level.colorables, false)[0];
    if (hit && hit.object.material && hit.object.material.color) {
      this.player.setCamouflage(hit.object.material.color);
      // Juice: pulso + pop na cor copiada.
      this.effects.pulse(this.player.position, hit.object.material.color);
      this.audio.paint();
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
    this._fluorFlicker(t);
    this.level.update?.(t);                 // girofles/painéis piscando
    this.effects.update(dt, this.camera);
    this.follow.update(dt, this.player, this.level.climbables);
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
    this._badge.textContent = camo ? 'CAMUFLADO' : (latched ? 'PAREDE' : 'CHÃO');
    this._badge.classList.toggle('latched', latched && !camo);
    this._badge.classList.toggle('camo', camo);
    this._chip.style.background = `#${this.player.material.color.getHexString()}`;

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
