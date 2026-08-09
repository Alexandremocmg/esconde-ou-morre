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
const BASE_SURVIVE = 45;      // s de sobrevivência no estágio 1
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

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Cena
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e13);
    this.scene.fog = new THREE.Fog(0x0b0e13, 28, 60);

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

    this.level = new Level(this.scene);
    this.player = new Player(this.scene, this.level);
    this.effects = new Effects(this.scene);
    this.audio = new Audio();

    // Caçadores. O primeiro sempre existe; um segundo (rota alternada, cor
    // distinta) entra a partir do estágio SECOND_SEEKER_STAGE.
    this.seekers = [
      new Seeker(this.scene, this.level, this.player, () => this._gameOver(), { difficulty }),
    ];
    if (this.stage >= SECOND_SEEKER_STAGE) {
      this.seekers.push(new Seeker(this.scene, this.level, this.player, () => this._gameOver(), {
        difficulty, waypoints: WAYPOINTS_ALT, color: 0xb01ecb,
      }));
    }

    this.follow = new FollowCamera(this.camera);
    this.joystick = new Joystick();

    // Estado de feedback (evita disparar sons repetidos no mesmo segundo)
    this._prevState = this.player.state;
    this._heartTimer = 0;
    this._lastWinTick = -1;

    // Raycaster de camuflagem (toque)
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._setupTapCamouflage();

    // HUD
    this._badge = document.getElementById('state-badge');
    this._chip = document.querySelector('#color-chip span');
    this._gameoverEl = document.getElementById('gameover');
    this._victoryEl = document.getElementById('victory');
    this._vignette = document.getElementById('vignette');

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
    // Céu/solo mais contido para o Sol dominar e revelar volume dos blocos.
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x241c14, 0.5));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.1));

    // Sol principal: mais forte e com sombras suaves e nítidas.
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
    sun.position.set(16, 24, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 3;               // borda suave (PCFSoftShadowMap)
    const s = 28;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    // Luz de contorno (rim) fria do lado oposto: separa os blocos do fundo,
    // dando profundidade 3D. Sem sombra para não pesar.
    const rim = new THREE.DirectionalLight(0x5a7bd8, 0.35);
    rim.position.set(-14, 10, -12);
    this.scene.add(rim);
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
      // Juice: pulso na cor copiada.
      this.effects.pulse(this.player.position, hit.object.material.color);
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

      // Juice: pulso ao GRUDAR na parede (transição chão → parede).
      if (this._prevState === 'grounded' && this.player.state === 'latched') {
        this.effects.pulse(this.player.position, 0x9fe8ff);
      }
      this._prevState = this.player.state;

      // Cronômetro da partida
      this.elapsed += dt;
      if (this.player.isCamouflaged()) this.camoTime += dt;

      this._updateFeedback(dt);

      if (this.elapsed >= this.surviveTime) this._win();
    }
    this.effects.update(dt, this.camera);
    this.follow.update(dt, this.player);
    this._updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  // Feedback de tensão: vinheta + som quando falta pouco para vencer OU quando
  // um Caçador está prestes a capturar (< WARN_WINDOW s).
  _updateFeedback(dt) {
    const remaining = this.surviveTime - this.elapsed;
    const camo = this.player.isCamouflaged();

    // Menor tempo estimado até captura entre todos os Caçadores.
    let catchIn = Infinity;
    if (!camo) {
      for (const s of this.seekers) catchIn = Math.min(catchIn, s.timeToCatch(this.player.position));
    }
    const danger = catchIn < WARN_WINDOW;
    const almost = !danger && remaining <= WARN_WINDOW && remaining > 0;

    // Vinheta (perigo tem prioridade sobre "quase vencendo").
    if (this._vignette) {
      this._vignette.classList.toggle('danger', danger);
      this._vignette.classList.toggle('almost', almost);
    }

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
    if (this._vignette) this._vignette.classList.remove('danger', 'almost');
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
