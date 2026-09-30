import * as THREE from 'three';
import { Level } from './Level.js?v=25';
import { Player } from './Player.js?v=8';
import { Seeker, WAYPOINTS_ALT } from './Seeker.js?v=6';
import { ChameleonTarget } from './ChameleonTarget.js?v=10';
import { FollowCamera } from './FollowCamera.js?v=3';
import { HunterCamera } from './HunterCamera.js?v=3';
import { Joystick } from './Joystick.js?v=3';
import { Effects } from './Effects.js?v=3';
import { Audio } from './Audio.js?v=3';
import { animationManager } from './AnimationManager.js?v=4';
import { Net, resolveWsUrl } from './Net.js?v=8';
import { RemotePlayer } from './RemotePlayer.js?v=6';
// Fase E do Plano 2 (docs/PLANO_CONTAS.md): primeiro (e único) ponto onde
// Game.js sabe algo sobre conta de jogador — só pra reportar resultado de
// partida pro Ranking. `reportMatchResult` já no-opa sozinho sem sessão
// logada, então não precisa de nenhum estado de auth aqui.
import { reportMatchResult, bumpMissionProgress } from './Auth.js?v=3';
import {
  onlineLayoutFor,
  JET_RANGE,
  HUNTER_AIM_HALF_ANGLE_DEG,
  HUNTER_FIRE_COOLDOWN_MS,
  HUNTER_MISS_COOLDOWN_MS,
  makeInputPayload,
  S2C,
  ROLE,
} from './net/protocol.js?v=8';

// Mira do Caçador jogável (Game.fireHunterShot): cone de mira a partir do
// centro da câmera, não pixel-perfect — evita o problema de raycast contra o
// SkinnedMesh animado (a malha usa a BIND POSE no raycast, ver o comentário
// grande em fireWaterJet mais abaixo). Mesma técnica: posição conhecida do
// alvo + checagem de oclusão contra paredes.
//
// HUNTER_AIM_HALF_ANGLE_DEG/HUNTER_FIRE_COOLDOWN_MS/HUNTER_MISS_COOLDOWN_MS/JET_RANGE
// vêm de net/protocol.js — o servidor do modo online (docs/PLANO_MULTIPLAYER.md)
// precisa dos MESMOS valores para validar o disparo, então moram num só lugar.
const HUNTER_AIM_HALF_ANGLE = THREE.MathUtils.degToRad(HUNTER_AIM_HALF_ANGLE_DEG); // ~18° de cone total
const HUNTER_TARGET_COUNT = 6;
// Mesmos números do SpotLight de _addHunterFlashlight() — o cone de "avistamento"
// que a IA dos alvos usa pra saber se o Caçador está olhando pra eles (Plano 3,
// docs/MECANICA_CACADOR_VISAO.md §3) é o mesmo cone da lanterna, não o de mira.
// FOV da câmera de 3ª pessoa. HunterCamera troca o FOV da MESMA câmera pra 80° e
// FollowCamera não o restaura — então quem volta de Caçador pra Camaleão na
// rotação do Online (_teardownHunterRig) precisa repor este valor na mão.
const DEFAULT_CAMERA_FOV = 60;
const HUNTER_FLASHLIGHT_RANGE = 14;
const HUNTER_FLASHLIGHT_ANGLE_DEG = 28;

// Scanner / Visão Reveladora (Fase 3, docs/MECANICA_CACADOR_VISAO.md §3). MVP "ping
// simplificado": desde o Plano 3, os ChameleonTarget já têm comportamento próprio
// (vagueiam/fogem/recolorem, ChameleonTarget.js), mas o pulso continua revelando
// direção/distância de todo alvo vivo dentro do alcance, sem diferenciar bem/mal
// camuflado — decisão de escopo consciente, não mais falta de sinal nos alvos.
const SCANNER_RANGE = 8;          // m — raio do pulso pedido
const SCANNER_DURATION_MS = 3000; // duração do pulso ativo
const SCANNER_COOLDOWN_MS = 20000; // recarga entre usos

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

    // Inicia o carregamento em segundo plano das animações FBX
    animationManager.loadAll();

    // Detecção de GPU mobile: ponteiro grosso (touch) OU tela curta. Usada para
    // limitar pixel ratio e resolução de sombra — evita a queda de FPS relatada
    // em aparelhos intermediários (sombra 2048² em tempo real é cara em mobile).
    this.isMobile = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || Math.min(window.innerWidth, window.innerHeight) < 540;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this._qualityPixelRatio = Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2);
    this._qualityElapsed = 0;
    this._qualityFrames = 0;
    this._qualityReduced = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Look TOON (estilo Meccha Chameleon): sem tone mapping, para as cores chapadas
    // saírem "cruas". ACES comprimia highlights e dessaturava — o oposto do hand-drawn.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Cena — ambiente CLARO e legível (party game), não mais penumbra de terror.
    this.scene = new THREE.Scene();
    // Fundo: céu toon GERADO (assets/sky.jpg) — preenche a tela atrás da geometria.
    const sky = new THREE.TextureLoader().load('assets/sky.jpg');
    sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = sky;
    // Fog claro e distante casado ao tom do céu: suaviza o horizonte onde a
    // geometria some, sem descolar da arte do fundo. Leitura clara = assinatura toon.
    this.scene.fog = new THREE.Fog(0xe3e9ee, 40, 120);

    // Câmera (proporção landscape de celular; ajustada no resize)
    this.camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA_FOV, 16 / 9, 0.1, 200);
    // Filha da cena: inofensivo (câmera não renderiza como objeto) e habilita pendurar
    // lanterna/arma-viewmodel do Caçador como filhos dela (ver HunterCamera/_addHunterFlashlight).
    this.scene.add(this.camera);

    // Modo da partida: 'chameleon' (padrão, fuja/camufle-se do Caçador IA), 'hunter'
    // (Caçador jogável, mira e atira nos Camaleões-alvo) ou 'online' (multiplayer —
    // docs/PLANO_MULTIPLAYER.md: servidor autoritativo decide papel/tiro/fim de
    // partida; ver _connectOnline()). Escolhido no menu inicial (#mode-pick em
    // index.html), persistido em 'eom-mode' (ver main.js).
    const savedMode = sessionStorage.getItem('eom-mode');
    this.mode = (savedMode === 'hunter' || savedMode === 'online') ? savedMode : 'chameleon';
    document.body.classList.toggle('mode-hunter', this.mode === 'hunter');
    document.body.classList.toggle('mode-online', this.mode === 'online');

    // Estágio atual (persiste entre reloads para permitir progressão). Atalho de
    // teste `?stage=N` (ex.: ?stage=5 pra ir direto ao Chameleon Manor sem
    // progredir pelos 4 anteriores) tem prioridade sobre o valor salvo, mas não
    // é persistido — um reload sem o parâmetro volta ao progresso normal salvo
    // em sessionStorage (mesmo mecanismo manual já documentado em
    // net/occluders.js:96, só que como parâmetro de URL em vez de console).
    const stageParam = parseInt(new URLSearchParams(location.search).get('stage'), 10);
    this.stage = stageParam > 0
      ? stageParam
      : Math.max(1, parseInt(sessionStorage.getItem('eom-stage') || '1', 10) || 1);
    this.surviveTime = BASE_SURVIVE + (this.stage - 1) * SURVIVE_PER_STAGE;
    const difficulty = 1 + (this.stage - 1) * DIFF_PER_STAGE;

    // Estado da partida
    this.over = false;   // pego pelo Caçador (ou: Camaleões escaparam, no modo Caçador)
    this.won = false;    // objetivo concluído
    this.elapsed = 0;    // tempo decorrido na fase
    this.camoTime = 0;   // tempo total camuflado (só faz sentido no modo Camaleão)

    // Layout da arena por estágio (cicla a cada 5): 1=salão, 2=quartos, 3=galeria,
    // 4=fábrica abandonada, 5=Chameleon Manor (mansão 4 níveis, casco próprio —
    // ver Level.js:_buildFactoryLevel/_buildChameleonManor). Online usa
    // `onlineLayoutFor()` (protocol.js) escolhe um mapa inicial de forma síncrona;
    // o WELCOME do servidor confirma a sala e pode pedir uma recriação imediata
    // caso o relógio local tenha escolhido outro layout.
    // Em uma reconexão, o layout salvo pela última sala tem prioridade sobre o
    // relógio local. O primeiro WELCOME confirma esse valor e corrige a cena se
    // dois aparelhos tiverem atravessado a virada de hora em momentos diferentes.
    const savedOnlineLayout = this.mode === 'online'
      ? parseInt(sessionStorage.getItem('eom-online-layout') || '', 10)
      : NaN;
    const layout = this.mode === 'online'
      ? ([1, 4, 5].includes(savedOnlineLayout) ? savedOnlineLayout : onlineLayoutFor())
      : ((this.stage - 1) % 5) + 1;
    this._onlineLayout = layout;
    this.level = new Level(this.scene, layout, { mobile: this.isMobile });
    // Depois do Level (não antes, como era até aqui): o frustum da sombra
    // agora lê a geometria real de this.level.solids pra se dimensionar —
    // ver _addLights().
    this._addLights();
    this.player = new Player(this.scene, this.level, { isHunter: this.mode === 'hunter' });
    this.effects = new Effects(this.scene);
    this.audio = new Audio();

    // Regras de Munição do Caçador (Meccha Chameleon Spec). Lido ANTES dos blocos por
    // modo abaixo: o online manda isto pro servidor em _connectOnline() (chamado dentro
    // do bloco 'online' logo mais), e precisa que this.maxWaterAmmo/infiniteAmmo já
    // existam nesse momento — sem depender da ordem relativa a I/O real (o 'open' do
    // WebSocket só dispara depois que esta função síncrona termina, mas isso não devia
    // ser uma invariante implícita).
    const ammoSel = document.getElementById('ammo-select');
    const ammoOpt = ammoSel ? parseInt(ammoSel.value, 10) : 8;
    this.maxWaterAmmo = isNaN(ammoOpt) ? 8 : ammoOpt;
    this.waterAmmo = this.maxWaterAmmo;
    const infCheck = document.getElementById('infinite-ammo-toggle');
    this.infiniteAmmo = infCheck ? infCheck.checked : false;

    if (this.mode === 'hunter') {
      // Sem Caçador IA: quem persegue é o jogador. this.seekers fica vazio de
      // propósito — os laços que já iteram sobre ele (_tick, _updateFeedback)
      // simplesmente não fazem nada, sem precisar de guardas extras.
      this.seekers = [];
      this.targets = [];
      this._hunterViewAttached = false;
      this._hunterMuzzle = null;
      this._nextFireAt = 0;
      this._scannerActiveUntil = 0; // performance.now() em que o pulso atual termina (0 = inativo)
      this._scannerReadyAt = 0;     // performance.now() em que o próximo uso libera
      this._scannerDots = [];       // pool de elementos DOM do radar (reaproveitados)
      this._spawnHunterTargets();
      this._addHunterFlashlight();
    } else if (this.mode === 'online') {
      // Humanos remotos e IAs autoritativas usam RemotePlayer; seekers/targets
      // continuam exclusivos dos modos solo.
      this.seekers = [];
      this.targets = [];
      this.remotePlayers = new Map(); // id → RemotePlayer
      this.onlineRole = null;         // só sabido depois do 'welcome' do servidor
      this._nextFireAt = 0;
      this._onlineConnected = false;
      // Lobby maior (docs/PLANO_LOBBY_MULTIPLAYER.md §3.2): com N Camaleões, ser
      // eliminado não encerra mais a partida sozinho — sem este estado, o Camaleão
      // flagrado continuaria andando/camuflando localmente enquanto já sumiu (fundido
      // a escala 0) na tela de todo mundo. `true` congela o loop de update deste
      // cliente (ver _tick) até o MATCH_OVER de verdade chegar.
      this._eliminatedSpectating = false;
      // Matchmaking híbrido: deadline é o prazo reservado para pessoas; o início
      // fica em 0 até a sala lotar ou o servidor completar as vagas com IA.
      this._onlineMatchmakingDeadline = 0;
      this._onlineMatchStartAt = 0;
      this._lastLobbyCountdownShown = null; // dedupe: não reescrever o #hint a 20Hz
      this._hunterViewAttached = false; // reaproveitado por _updateHunterFPSRig() se o papel for Caçador
      this._hunterMuzzle = null;
      // Scanner (só usado se o papel acabar sendo Caçador — ver _tick). Mesmos
      // três campos que o bloco 'hunter' já tem: sem eles _updateScanner() quebra
      // em this._scannerDots[i] na primeira chamada.
      this._scannerActiveUntil = 0;
      this._scannerReadyAt = 0;
      this._scannerDots = [];
      this.net = new Net(this._wsUrl());
      this._connectOnline(); // assíncrono de propósito — não bloqueia o boot da cena
    } else {
      // Caçadores. O primeiro sempre existe; um segundo (rota cruzada, cor distinta)
      // entra a partir do estágio THIRD_SEEKER_STAGE. As rotas vêm do layout.
      const routes = this.level.routes;
      const routeY = this.level.routeY || [];
      const mkSeeker = (i, color, opts = {}) => new Seeker(
        this.scene, this.level, this.player, () => this._gameOver(),
        { difficulty, waypoints: routes[i] || WAYPOINTS_ALT, startY: routeY[i], color, ...opts }
      );
      if (this.level.layout === 5) {
        // Chameleon Manor (Plano 5): 4 domínios verticais físicos, 1 Seeker por
        // domínio DESDE O ESTÁGIO 1 — mesma correção que a Fase 6 de
        // docs/PLANO_MANSAO.md já validou pra 3 níveis ("sempre sobrava um nível
        // quase sem vigilância" quando o 2º/3º Caçador entrava tarde).
        //
        // Fase 8 (medido, não estimado): harness headless (Seeker real,
        // amostragem de 888 pontos/domínio, 120s = duração real do 1º
        // aparecimento deste mapa) mediu cobertura MUITO abaixo do baseline
        // da mansão (41-54%/90%+) com o visionRange padrão de 7.5m — óbvio
        // em retrospecto: salas deste mapa (Ballroom 36×24, Galeria 34×20)
        // são 5-10x maiores que qualquer cômodo da mansão. `opts.visionRange`
        // já existia desde a Fase 0 pra isso, mas nunca tinha sido ligado
        // aqui. CM_VISION_RANGE=16 sozinho: Porão 10,7%→19,8%, Térreo
        // 17,1%→35,4%, 1º Andar 18,8%→47,2%, Ático 32,6%→69,5% — melhora
        // grande, mas Porão/Térreo (6 e 3 salas cada) continuam abaixo do
        // piso da mansão com só 1 Seeker. Contingência do plano ("reescrever
        // a rota primeiro; só se insuficiente, somar um 2º Seeker") — a rota
        // já cobre todas as salas de cada domínio (não é o problema; é
        // alcance de visão x área), então: 2º Seeker (rota invertida, mesmo
        // alcance) nos 2 domínios com mais salas. Mapa não compete em
        // orçamento de malha com os outros 4 (285-303 malhas, meta ≤1500).
        const CM_VISION_RANGE = 16;
        const cmColors = [0xd21f1f, 0xb01ecb, 0xd88a1a, 0x1ecb8a];
        const cmColorsB = [0x8f1414, 0x7a1487, 0x8f5c12, 0x148f5c];
        this.seekers = routes.map((_, i) => mkSeeker(i, cmColors[i], { visionRange: CM_VISION_RANGE }));
        for (const i of [0, 1]) { // Porão (3 salas), Térreo (6 salas)
          this.seekers.push(mkSeeker(i, cmColorsB[i], {
            visionRange: CM_VISION_RANGE,
            waypoints: [...(routes[i] || [])].reverse(),
          }));
        }
      } else {
        // 0 = térreo; 1 = andares altos (nasce no 2º andar); 2 = térreo em sentido oposto.
        this.seekers = [mkSeeker(0), mkSeeker(1, 0xb01ecb)];
        if (this.stage >= THIRD_SEEKER_STAGE) this.seekers.push(mkSeeker(2, 0xd88a1a));
      }
    }

    // Placar com Atraso de 30 Segundos (Anti-Cheat Spec)
    this.scoreHistory = []; // { t, camoTime }
    this.delayedCamoTime = 0;

    // Câmera de acompanhamento: 1ª pessoa dedicada para o Caçador jogável (ver
    // docs/MECANICA_CACADOR_VISAO.md §1), 3ª pessoa para o Camaleão. Mesma interface
    // pública (addLook/addZoom/update/reset) — nenhuma outra chamada a this.follow.*
    // precisa saber qual das duas está ativa.
    this.follow = this.mode === 'hunter' ? new HunterCamera(this.camera) : new FollowCamera(this.camera);
    this.joystick = new Joystick();

    // Estado de feedback (evita disparar sons repetidos no mesmo segundo)
    this._prevState = this.player.state;
    this._heartTimer = 0;
    this._lastWinTick = -1;
    this._spotted = false; // borda de subida da detecção (para som + UI de alerta)
    this._wasCamo = false;  // borda de subida da camuflagem (stinger de sucesso)

    // Controles em arco Glassmorphism + menus radiais
    this._btnJump = document.getElementById('btn-jump');
    this._btnClimb = document.getElementById('btn-climb');
    this._btnPose = document.getElementById('btn-pose');
    this._btnPaint = document.getElementById('btn-paint');
    this._btnBrush = document.getElementById('btn-brush');
    this._btnFire = document.getElementById('btn-fire');
    this._btnScan = document.getElementById('btn-scan');
    this._radialPoseMenu = document.getElementById('radial-pose-menu');
    this._radialPaintMenu = document.getElementById('radial-paint-menu');
    this._setupControls();
    this._updateWaterAmmoHud();
    if (this.mode === 'hunter') this._updateTargetsHud();

    // Dica em jogo (topo da tela): difere por modo — o Camaleão foge/camufla,
    // o Caçador mira e atira. Texto do Camaleão fica fixo no HTML.
    const hint = document.getElementById('hint');
    if (hint && this.mode === 'hunter') {
      hint.textContent = 'Mire com a retícula e toque em 💦 para atirar. Encontre e acerte todos os Camaleões antes que o tempo ou a munição acabem.';
    } else if (hint && this.mode === 'online') {
      hint.textContent = 'Conectando à sala...'; // trocado por papel/instrução ao chegar o "welcome"
    }
    this._hintEl = hint;
    this._setupTutorial();

    // Oclusão da câmera: blocos entre a câmera e o jogador desvanecem para não
    // esconder o personagem (ex.: grudado na face traseira de um bloco).
    this._occRay = new THREE.Raycaster();
    this._occDir = new THREE.Vector3();
    this._occFaded = new Set(); // materiais atualmente esmaecidos

    // HUD
    this._badge = document.getElementById('state-badge');
    this._chip = document.querySelector('#color-chip span');
    this._gameoverEl = document.getElementById('gameover');
    this._gameoverMsg = document.getElementById('gameover-msg');
    this._gameoverMsgDefault = this._gameoverMsg ? this._gameoverMsg.textContent : '';
    this._victoryEl = document.getElementById('victory');
    this._victoryMsg = document.getElementById('victory-msg');
    this._victoryMsgDefault = this._victoryMsg ? this._victoryMsg.textContent : '';
    this._vignette = document.getElementById('vignette');
    this._alertEl = document.getElementById('alert');
    this._scannerRadar = document.getElementById('scanner-radar');
    this._scannerCdEl = document.getElementById('scanner-cd');
    this._scanDir = new THREE.Vector3();
    this._scanTo = new THREE.Vector3();

    // Placar da partida
    this._elStage = document.getElementById('stage-num');
    this._elElapsed = document.getElementById('timer-elapsed');
    this._elGoal = document.getElementById('timer-goal');
    this._elGoalCap = document.getElementById('timer-goal-cap');
    this._elCamo = document.getElementById('timer-camo');
    this._elFill = document.getElementById('timer-fill');
    if (this._elStage) this._elStage.textContent = String(this.stage);
    if (this._elGoal) this._elGoal.textContent = fmtTime(this.surviveTime);
    this._updateRoleHudText();

    // Botões da tela de Game Over e Vitória (Recomeço instantâneo sem recarregar 3D)
    const goRestart = document.getElementById('go-restart');
    const goMenu = document.getElementById('go-menu');
    const nextBtn = document.getElementById('win-next');
    const restartBtn = document.getElementById('win-restart');

    if (goRestart) goRestart.addEventListener('click', () => this.restartInPlace(false, false));
    if (goMenu) goMenu.addEventListener('click', () => this.restartInPlace(false, true));
    if (nextBtn) nextBtn.addEventListener('click', () => this.restartInPlace(true, false));
    if (restartBtn) restartBtn.addEventListener('click', () => this.restartInPlace(false, true));

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
    // Frustum ortográfico da sombra: s=15/far=42 cobre bem a planta ~29×29m
    // da mansão/fábrica (valor fixo, testado — layouts 1-4 continuam com
    // esses números exatos, zero mudança). O Chameleon Manor (layout 5) é
    // 120×80m, MUITO maior — com o valor fixo, a maior parte do piso (tudo
    // fora de ±15 do centro: Galeria, Biblioteca, Corredor, Porão inteiro...)
    // ficava fora do frustum, e THREE.js amostra a BORDA do shadow map pra
    // geometria fora dele — isso é o que aparecia como "linhas piscando" no
    // piso, um artefato de shadow map, não um problema de malha duplicada.
    // Só pra esse layout, deriva o tamanho da bounding box REAL de
    // `this.level.solids` (já populada pelo Level) em vez de outro número
    // fixo — acompanha sozinho se o mapa mudar de tamanho de novo.
    let s = 15, far = 42;
    if (this.level.layout === 5) {
      const bounds = new THREE.Box3();
      for (const box of this.level.solids) bounds.union(box);
      const size = bounds.getSize(new THREE.Vector3());
      s = Math.max(size.x, size.z) / 2 + 2;
      far = s * 2 + size.y + 10;
    }
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = far;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
  }

  // Lanterna do Caçador jogável (docs/MECANICA_CACADOR_VISAO.md §1): acoplada à câmera
  // como filha (this.scene.add(this.camera) no construtor já habilita isto — o alvo
  // (target) também filho, então os dois seguem a câmera sozinhos via updateMatrixWorld,
  // sem precisar sincronizar posição por frame). decay=2 é a atenuação quadrática nativa
  // do Three.js — mapeamento direto do pedido do briefing.
  _addHunterFlashlight() {
    const light = new THREE.SpotLight(
      0xfff2d0, 3.2, HUNTER_FLASHLIGHT_RANGE, THREE.MathUtils.degToRad(HUNTER_FLASHLIGHT_ANGLE_DEG), 0.4, 2
    );
    light.castShadow = !this.isMobile; // mesmo guard de custo da key light (perf mobile)
    if (light.castShadow) {
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0005;
    }
    light.target.position.set(0, 0, -1); // -Z local = pra frente da câmera
    this.camera.add(light);
    this.camera.add(light.target);
    this._hunterFlashlight = light;
  }

  // ------------------------------------------------------------ MODO ONLINE
  // Endereço do servidor autoritativo (docs/PLANO_MULTIPLAYER.md) — lógica movida
  // pra Net.resolveWsUrl() (Fase B, Plano 2) pra "Continuar Partida" no menu
  // principal poder checar sessão reaproveitável ANTES de um Game existir.
  _wsUrl() {
    return resolveWsUrl();
  }

  // Conecta à sala, resolve o papel (servidor decide) e liga os handlers de rede.
  // Roda em paralelo ao boot da cena (chamada no construtor sem await) — o jogador
  // aparece no spawn genérico do layout até o 'welcome' chegar e reposicioná-lo.
  async _connectOnline() {
    try {
      // ammo/infiniteAmmo só têm efeito se o servidor der o papel HUNTER a este
      // socket (room.js:_handleJoin ignora pra quem vira CHAMELEON) — mesma config
      // que o menu já lê pro Caçador solo, agora também autoritativa no online.
      const welcome = await this.net.connect({ ammo: this.maxWaterAmmo, infiniteAmmo: this.infiniteAmmo });
      this._onlineConnected = true;
      this.onlineRole = welcome.role;
      if (Number.isFinite(welcome.layout) && welcome.layout !== this._onlineLayout) {
        // A sala é autoritativa. Guardamos o layout e recriamos o cliente para
        // que Level, colisão, spawns e oclusores nasçam todos no mapa correto.
        sessionStorage.setItem('eom-online-layout', String(welcome.layout));
        location.reload();
        return;
      }
      sessionStorage.setItem('eom-online-layout', String(welcome.layout));
      // A duração autoritativa pertence à sala. O cliente começa com o valor
      // solo apenas para montar o HUD enquanto conecta; corrige assim que o
      // WELCOME chega para não exibir 1:00 numa rodada online de 3:00.
      if (Number.isFinite(welcome.matchDuration) && welcome.matchDuration > 0) {
        this.surviveTime = welcome.matchDuration;
        if (this._elGoal) this._elGoal.textContent = fmtTime(this.surviveTime);
      }
      this._onlineMatchmakingDeadline = welcome.matchmakingDeadline || 0;
      this._onlineMatchStartAt = welcome.matchStartAt || 0;
      this._onlinePhase = welcome.phase || (welcome.matchStartAt ? 'playing' : 'matchmaking');
      this._onlineRoundId = welcome.roundId || 1;
      this.player.isHunter = welcome.role === ROLE.HUNTER;
      this._updateRoleHudText();
      this.player.position.set(welcome.spawn.x, this.player.position.y, welcome.spawn.z);

      // Chrome de UI específico do papel Caçador (botão de tiro, munição, Scanner) —
      // mesmas classes CSS que o modo Caçador single-player usa.
      document.body.classList.toggle('online-hunter', this.onlineRole === ROLE.HUNTER);

      // Caçador no online usa a MESMA câmera 1ª pessoa do single-player — troca só
      // agora porque o papel só é conhecido depois do 'welcome'. É mais que estética:
      // a FollowCamera (3ª pessoa) sempre faz lookAt() no PRÓPRIO jogador, então
      // camera.getWorldDirection() usado em _fireOnline() sempre apontaria pra si
      // mesmo — a mira não funcionaria. Lanterna junto, mesma UX do modo Caçador.
      if (this.onlineRole === ROLE.HUNTER) {
        this.follow = new HunterCamera(this.camera);
        this._addHunterFlashlight();
      }

      for (const p of welcome.players) this._spawnRemotePlayer(p);
      // Reload/reconexão no meio de uma partida em que este Camaleão já tinha sido
      // flagrado antes de cair (docs/PLANO_LOBBY_MULTIPLAYER.md §3.2) — sem checar
      // isto, ele voltaria a andar normalmente, sem saber que já está fora até o
      // MATCH_OVER da partida inteira.
      if (this.onlineRole === ROLE.CHAMELEON && welcome.eliminated) {
        this._enterEliminatedSpectating();
      } else {
        this._updateOnlineHint(); // já sabe se entrou sozinho (welcome.players vazio) ou não
      }

      this.net.on(S2C.SNAPSHOT, (msg) => this._onSnapshot(msg));
      this.net.on(S2C.PLAYER_JOIN, (msg) => { this._spawnRemotePlayer(msg.player); this._updateOnlineHint(); });
      this.net.on(S2C.PLAYER_LEAVE, (msg) => { this._removeRemotePlayer(msg.id); this._updateOnlineHint(); });
      this.net.on(S2C.PLAYER_HIT, (msg) => this._onPlayerHit(msg));
      this.net.on(S2C.SHOT, (msg) => this._onShot(msg));
      this.net.on(S2C.FIRE_DENIED, (msg) => this._onFireDenied(msg));
      this.net.on(S2C.MATCH_OVER, (msg) => this._onMatchOver(msg));
      this.net.on(S2C.ROUND_RESET, (msg) => this._onRoundReset(msg));
      this.net.on(S2C.ROLE_CHANGED, (msg) => this._onRoleChanged(msg));
      // Fase 4 do pincel 3D — repasse de outro jogador (ver
      // server/room.js:_handlePaint). Só o RemotePlayer correspondente lê;
      // se ele ainda não existir por algum motivo (mensagem chegou antes do
      // PLAYER_JOIN, corrida improvável mas não impossível), ignora — não é
      // crítico perder um traço isolado, ao contrário de posição/tiro.
      this.net.on(S2C.PLAYER_PAINT, (msg) => {
        const rp = this.remotePlayers.get(msg.id);
        if (rp) rp.applyPaintStrokes(msg.strokes);
      });

      // Reconexão (Net.js): uma queda não encerra mais a partida na hora — o
      // próprio Net tenta reconectar sozinho (backoff, até RECONNECT_GRACE_MS) e
      // o servidor segura papel/munição/eliminado da sessão por esse tanto de
      // tempo (room.js:_onDisconnect/_purgeStale). Posição/câmera não são tocadas
      // aqui: numa reconexão na mesma página elas nunca pararam de rodar
      // localmente (Débito 1 — o cliente sempre se auto-simula, com ou sem rede);
      // e num reload de página completo, o construtor do Game já cuida disso do
      // zero antes mesmo deste handler existir.
      this.net.on('_reconnecting', () => {
        if (this._hintEl) this._hintEl.textContent = '🔄 Conexão perdida — reconectando...';
      });
      this.net.on('_reconnected', (msg) => this._onReconnected(msg));

      // Só chega aqui depois que Net.js DESISTIU de vez (grace period esgotado ou
      // fechamento explícito) — não mais na primeira queda, então isto agora
      // significa "reconexão não deu certo", não "internet piscou".
      this.net.on('_close', () => {
        if (!this.over && !this.won) this._gameOver('Conexão com o servidor perdida — não foi possível reconectar.');
      });
    } catch (err) {
      console.error('❌ Game: falha ao conectar no modo online', err);
      this._gameOver('Não foi possível conectar ao servidor. Verifique se ele está rodando (server/).');
    }
  }

  // Deixa explícito quando o jogador está SOZINHO na sala — sem isto, "conectado mas
  // sem ninguém pra ver" e "conectado e pareado" pareciam a mesma coisa na tela (era
  // exatamente o que causava a confusão de "entrei e não vi o outro jogador": as duas
  // pontas às vezes nunca chegaram a estar na sala AO MESMO TEMPO, e nada na UI avisava).
  _onReconnected(msg) {
    if (Number.isFinite(msg.layout) && msg.layout !== this._onlineLayout) {
      sessionStorage.setItem('eom-online-layout', String(msg.layout));
      location.reload();
      return;
    }
    const self = msg.self || msg;
    if (self.role && self.role !== this.onlineRole) {
      this._onRoleChanged({ player: self, spawn: self.pos || msg.spawn });
    }
    this._onlineMatchmakingDeadline = msg.matchmakingDeadline || 0;
    this._onlineMatchStartAt = msg.matchStartAt || 0;
    this._onlinePhase = msg.phase || this._onlinePhase;
    const changedRound = Number.isFinite(msg.roundId) && msg.roundId !== this._onlineRoundId;
    if (Number.isFinite(msg.roundId)) this._onlineRoundId = msg.roundId;

    const present = new Set((msg.players || []).map((p) => p.id));
    for (const [id] of this.remotePlayers) {
      if (!present.has(id)) this._removeRemotePlayer(id);
    }
    for (const p of msg.players || []) {
      let rp = this.remotePlayers.get(p.id);
      if (!rp) { this._spawnRemotePlayer(p); rp = this.remotePlayers.get(p.id); }
      if (rp) rp.pushSnapshot(p, Date.now());
    }
    if (changedRound && this._onlinePhase !== 'results') this.restartInPlace(false, false, true);
    const restoredPos = self.pos || msg.spawn;
    if (restoredPos && this.player) this.player.position.set(restoredPos.x, restoredPos.y, restoredPos.z);
    if (this.onlineRole === ROLE.CHAMELEON && self.eliminated) this._enterEliminatedSpectating();
    else this._updateOnlineHint();
  }

  _onRoundReset(msg) {
    this._onlinePhase = 'matchmaking';
    this._onlineRoundId = msg.roundId;
    this._onlineMatchmakingDeadline = msg.matchmakingDeadline || 0;
    this._onlineMatchStartAt = 0;
    for (const [id] of this.remotePlayers) this._removeRemotePlayer(id);
    // O Caçador rotaciona a cada revanche (server/room.js:_rotateHunter): o papel
    // novo vem neste mesmo pacote. Aplica ANTES de restartInPlace, que reseta a
    // câmera — senão ele resetaria a câmera do papel velho.
    const self = (msg.players || []).find((p) => p.id === this.net.id);
    if (self && self.role) this._applyOwnOnlineRole(self.role);
    this.restartInPlace(false, false, true);
    for (const p of msg.players || []) {
      if (p.id === this.net.id) this.player.position.set(p.pos.x, p.pos.y, p.pos.z);
      else this._spawnRemotePlayer(p);
    }
    this._waitingRematch = false;
    this._setRematchButtons(false);
    this._updateOnlineHint();
  }

  _onRoleChanged(msg) {
    const p = msg.player;
    if (!p) return;
    if (p.id !== this.net.id) {
      this._removeRemotePlayer(p.id);
      this._spawnRemotePlayer(p);
      return;
    }
    this._applyOwnOnlineRole(p.role);
    if (msg.spawn) this.player.position.set(msg.spawn.x, msg.spawn.y, msg.spawn.z);
    this._updateOnlineHint();
  }

  // Troca o PRÓPRIO papel no Online (promoção na busca, rotação entre rodadas,
  // correção depois de reconectar). Nos dois sentidos: a rotação é a primeira coisa
  // que rebaixa um Caçador — antes só existia promoção, então quem voltava a
  // Camaleão ficaria com a câmera em 1ª pessoa, a lanterna e a arma na tela.
  _applyOwnOnlineRole(role) {
    if (role === this.onlineRole) return;
    this.onlineRole = role;
    if (this.net) this.net.role = role;
    this.player.isHunter = role === ROLE.HUNTER;
    document.body.classList.toggle('online-hunter', this.player.isHunter);
    this._updateRoleHudText();
    if (this.player.isHunter) {
      this.follow = new HunterCamera(this.camera);
      this._addHunterFlashlight();
    } else {
      this._teardownHunterRig();
    }
  }

  // Desfaz tudo que o papel Caçador pendurou na câmera/cena: lanterna, arma e braço
  // em 1ª pessoa, corpo escondido, câmera e FOV. `_hunterViewAttached` volta a false
  // pra que uma nova promoção remonte o rig (_updateHunterFPSRig é lazy).
  _teardownHunterRig() {
    const light = this._hunterFlashlight;
    if (light) {
      this.camera.remove(light.target);
      this.camera.remove(light);
      light.dispose();
      this._hunterFlashlight = null;
    }
    if (this._hunterViewWeapon) {
      this.camera.remove(this._hunterViewWeapon); // geometria vem do protótipo compartilhado — não dá dispose
      this._hunterViewWeapon = null;
    }
    if (this._hunterViewArm) {
      this.camera.remove(this._hunterViewArm);
      // Geometrias do braço são nossas (capsuleBetween); o material é o do jogador — fica.
      this._hunterViewArm.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this._hunterViewArm = null;
    }
    this._hunterMuzzle = null;
    this._hunterViewAttached = false;
    if (this.player.animInstance) this.player.animInstance.group.visible = true;

    this.follow = new FollowCamera(this.camera);
    this.camera.fov = DEFAULT_CAMERA_FOV;
    this.camera.updateProjectionMatrix();
  }

  _setRematchButtons(waiting) {
    for (const id of ['go-restart', 'win-next']) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = waiting;
      if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
      button.textContent = waiting ? 'Aguardando jogadores…' : button.dataset.defaultText;
    }
  }

  _updateOnlineHint() {
    if (!this._hintEl) return;
    // Uma entrada/saída de outro Camaleão (PLAYER_JOIN/LEAVE) não pode apagar o aviso
    // de "você foi flagrado" — só o fim de partida de verdade (_win/_gameOver) muda o
    // que está na tela depois disso.
    if (this._eliminatedSpectating) return;
    if (this._onlineMatchmakingDeadline && !this._onlineMatchStartAt) return;
    if (this.remotePlayers.size === 0) {
      this._hintEl.textContent = '🔎 Procurando jogadores online...';
      return;
    }
    const bots = [...this.remotePlayers.values()].filter((p) => p.isBot).length;
    const team = bots ? ` · ${bots} IA${bots > 1 ? 's' : ''} na partida` : '';
    this._hintEl.textContent = this.onlineRole === ROLE.HUNTER
      ? `Modo Online — Caçador: encontre todos os Camaleões${team}.`
      : `Modo Online — Camaleão: pinte-se e se esconda${team}.`;
  }

  // Busca primeiro pessoas. O relógio exibido usa a hora do servidor; ao terminar,
  // o servidor cria apenas as IAs necessárias e envia a composição por snapshot.
  _updateLobbyCountdown(msg) {
    if (Number.isFinite(msg.matchmakingDeadline)) {
      this._onlineMatchmakingDeadline = msg.matchmakingDeadline;
    }
    if (Number.isFinite(msg.matchStartAt)) this._onlineMatchStartAt = msg.matchStartAt;
    if (!this._hintEl || this._eliminatedSpectating) return;

    const remainingMs = this._onlineMatchmakingDeadline - msg.t;
    if (!this._onlineMatchStartAt && this._onlineMatchmakingDeadline && remainingMs > 0) {
      const s = Math.ceil(remainingMs / 1000);
      const humans = 1 + msg.players.filter((p) => p.id !== this.net.id && !p.isBot).length;
      const key = `${s}:${humans}`;
      if (key !== this._lastLobbyCountdownShown) {
        this._lastLobbyCountdownShown = key;
        this._hintEl.textContent = `🔎 Procurando jogadores — ${s}s · ${humans}/5 online. As vagas restantes receberão IA.`;
      }
    } else if (this._lastLobbyCountdownShown !== null) {
      this._lastLobbyCountdownShown = null;
      this._updateOnlineHint();
    }
  }

  _spawnRemotePlayer(p) {
    if (this.remotePlayers.has(p.id)) return;
    const rp = new RemotePlayer(this.scene, p.id, p.role, p.pos, {
      isBot: !!p.isBot,
      name: p.name,
    });
    this.remotePlayers.set(p.id, rp);
    // Fase 4 do pincel 3D: só existe em welcome.players (ver
    // server/room.js, _publicStateFull) — quem já estava pintado antes deste
    // cliente entrar. PLAYER_JOIN usa _publicState puro (sem o campo), então
    // isto vira um no-op pra quem acabou de entrar sem nada pintado ainda.
    if (p.paintStrokes && p.paintStrokes.length) rp.applyPaintStrokes(p.paintStrokes);
  }

  _removeRemotePlayer(id) {
    const rp = this.remotePlayers.get(id);
    if (!rp) return;
    rp.destroy();
    this.remotePlayers.delete(id);
  }

  _onSnapshot(msg) {
    this._onlinePhase = msg.phase || this._onlinePhase;
    if (Number.isFinite(msg.roundId)) this._onlineRoundId = msg.roundId;
    this._updateLobbyCountdown(msg);
    if (this._onlineMatchStartAt && Number.isFinite(msg.t)) {
      this.elapsed = Math.max(0, (msg.t - this._onlineMatchStartAt) / 1000);
    }
    for (const p of msg.players) {
      if (p.id === this.net.id) {
        // Munição AUTORITATIVA: o servidor é quem decide de verdade (room.js:
        // _handleFire) — o decremento em _fireOnline() é só otimista, pra feedback
        // instantâneo. Este snapshot (até 50ms depois de cada tiro) corrige qualquer
        // divergência, mesmo padrão já usado pra posição/cooldown.
        if (this.onlineRole === ROLE.HUNTER) {
          this.waterAmmo = p.ammo;
          this.maxWaterAmmo = p.maxAmmo;
          this.infiniteAmmo = p.infiniteAmmo;
          this._updateWaterAmmoHud();
        }
        continue; // não aplica o resto do próprio snapshot em si mesmo
      }
      let rp = this.remotePlayers.get(p.id);
      if (!rp) { this._spawnRemotePlayer(p); rp = this.remotePlayers.get(p.id); }
      rp.pushSnapshot(p, msg.t);
    }
  }

  // Jato de água visível no Online (antes não existia NENHUM efeito 3D de tiro nesse
  // modo — só som pro próprio atirador e vinheta pra quem levava o tiro; o "jato saindo
  // da arma" que dá pra ver no Caçador solo nunca foi ligado aqui). O servidor é a
  // ÚNICA fonte do efeito (broadcast pra todo mundo, `room.js:_handleFire`) — ninguém
  // desenha nada otimisticamente antes disso chegar, então só existe UM jato por tiro,
  // igual pra quem atirou e pra quem só está vendo.
  _onShot(msg) {
    // `msg.from` é a câmera de quem atirou (ápice do cone validado, ver comentário em
    // _fireOnline) — desenhar o traço exatamente ali faz o jato nascer no centro da
    // tela, não na arma renderizada no canto (bug real: "o jato não parece sair do
    // cano da arma"). Só na TELA DE QUEM ATIROU dá pra corrigir isso de graça: o
    // viewmodel da arma só existe no cliente do próprio Caçador (1ª pessoa), então só
    // ele tem `_hunterMuzzle` pra substituir o ponto de partida sem mexer no que foi
    // validado. Pra quem só está assistindo o tiro de outro jogador, mantém `msg.from`
    // (aproximação aceitável, mesmo espírito do fim do traço numa errada em modo solo).
    let from = msg.from;
    if (msg.hunterId === this.net.id && this._hunterMuzzle) {
      this._tmpMuzzlePos = this._tmpMuzzlePos || new THREE.Vector3();
      this._hunterMuzzle.getWorldPosition(this._tmpMuzzlePos);
      from = this._tmpMuzzlePos;
    }
    this.effects.waterJetBeam(from, msg.to, !!msg.hit);
    // O atirador já ouviu o próprio waterBlast() na hora (_fireOnline, otimista) —
    // só toca de novo pra quem NÃO foi quem atirou, senão soa duplicado pro Caçador.
    if (msg.hunterId !== this.net.id) this.audio.waterBlast();
  }

  // Bug real corrigido: o servidor recusa um FIRE fora do cooldown DE VERDADE
  // (room.js:_handleFire), que depois de um ERRO é HUNTER_MISS_COOLDOWN_MS (2.6s),
  // bem mais longo que o cooldown otimista de 300ms que _fireOnline já arma sempre.
  // Sem ouvir isto, o cliente achava que já podia atirar de novo, mandava o FIRE, e o
  // servidor descartava em silêncio total (sem broadcast nenhum) — o jato simplesmente
  // não aparecia, sem nenhum aviso de por quê ("nem toda vez o jato saiu"). Reajusta
  // _nextFireAt pro valor real do servidor, convertendo de relógio: nextFireAt do
  // servidor é Date.now()-based (hora de parede), _nextFireAt do cliente é
  // performance.now()-based (monotônico desde a navegação) — dois relógios diferentes.
  _onFireDenied(msg) {
    if (!Number.isFinite(msg.nextFireAt)) return;
    const delayMs = msg.nextFireAt - Date.now();
    this._nextFireAt = Math.max(this._nextFireAt, performance.now() + Math.max(0, delayMs));
  }

  // O acerto em si já chega via snapshot (`eliminated`, lido por RemotePlayer) — este
  // handler é só o momento pontual (som/vibração), igual ao fireHunterShot local.
  _onPlayerHit(msg) {
    this.audio.waterSplash();
    if (msg.targetId === this.net.id) {
      if (navigator.vibrate) try { navigator.vibrate([30, 40, 30]); } catch (_) {}
      if (this._vignette) {
        this._vignette.classList.add('spotted');
        setTimeout(() => this._vignette && this._vignette.classList.remove('spotted'), 500);
      }
      // Lobby maior (docs/PLANO_LOBBY_MULTIPLAYER.md §3.2): com N Camaleões, ser
      // atingido não é mais garantia de fim de partida (MATCH_OVER só chega quando o
      // ÚLTIMO cai) — sem isto o Camaleão flagrado continuava jogando normalmente
      // enquanto já sumiu da tela de todo mundo. Não usa _gameOver()/this.over aqui
      // de propósito: aquilo mostraria a tela final ANTES do resultado real da
      // partida chegar via _onMatchOver, e bloquearia o _win()/_gameOver() de verdade
      // (os dois se recusam a rodar de novo quando this.over/this.won já é true).
      if (this.onlineRole === ROLE.CHAMELEON && !this.won && !this.over) {
        this._enterEliminatedSpectating();
      }
    }
  }

  // Congela o Camaleão local em modo espectador (docs/PLANO_LOBBY_MULTIPLAYER.md §3.2).
  // Dois chamadores: o momento em que o PLAYER_HIT chega ao vivo (_onPlayerHit) e o
  // caso de reload/reconexão no meio de uma partida em que este cliente JÁ estava
  // eliminado antes de cair (_connectOnline lê `welcome.eliminated` — sem isso o
  // Camaleão reconectado voltaria a andar normalmente, sem saber que já está fora).
  _enterEliminatedSpectating() {
    this._eliminatedSpectating = true;
    if (this._hintEl) {
      this._hintEl.textContent = '🫥 Você foi flagrado — aguardando o fim da partida...';
    }
  }

  _onMatchOver(msg) {
    this._onlinePhase = 'results';
    this._waitingRematch = false;
    this._setRematchButtons(false);
    const iAmHunter = this.onlineRole === ROLE.HUNTER;
    const iWon = (msg.winner === ROLE.HUNTER) === iAmHunter;
    if (iWon) this._win(msg.reason);
    else this._gameOver(msg.reason);
  }

  // Disparo do modo online: mesma mira por cone do modo Caçador single-player
  // (câmera → alvo), mas a DECISÃO de acerto é do servidor (net/hittest.js — o
  // MESMO módulo que Game.js usaria localmente). O cooldown aqui é só feedback
  // otimista de UI; quem manda de verdade é o servidor (room.js).
  _fireOnline() {
    if (this.over || this.won || this.onlineRole !== ROLE.HUNTER) return;
    // Durante a busca, o servidor já recusa FIRE; este gate também evita feedback
    // otimista e gasto visual de munição antes da partida ficar ativa.
    if (!this._onlineMatchStartAt || Date.now() < this._onlineMatchStartAt) return;
    if (!this.net || !this.net.connected) return;
    const now = performance.now();
    if (now < this._nextFireAt) return;
    this._nextFireAt = now + HUNTER_FIRE_COOLDOWN_MS;

    // Decremento OTIMISTA (feedback instantâneo) — o servidor é quem decide de
    // verdade (room.js:_handleFire) e o próximo SNAPSHOT corrige qualquer
    // divergência (ver _onSnapshot). Mesmo gate/ordem de fireHunterShot().
    if (!this.infiniteAmmo) {
      if (this.waterAmmo <= 0) { this.audio.emptyClick(); return; }
      this.waterAmmo--;
      this._updateWaterAmmoHud();
    }

    this.audio.waterBlast();
    if (this.player.triggerShootPose) this.player.triggerShootPose();

    // `origin` continua sendo a câmera, DE PROPÓSITO — é o ápice do cone que o
    // servidor usa pra decidir acerto (room.js:_handleFire → hittest.js:coneCandidates),
    // e a mira precisa ficar exatamente onde a retícula (centro da tela) aponta. Trocar
    // isto pela ponta do cano deslocaria o cone de verdade (~0.3-0.6m fora do eixo da
    // câmera) — inofensivo a longa distância, mas jogaria a mira fora perto do alvo. O
    // ajuste visual (fazer o jato PARECER sair da arma) é só cosmético — ver _onShot(),
    // que troca o ponto de partida do traço SÓ na tela de quem atirou, sem tocar no
    // que foi validado.
    const origin = this.camera.position;
    this._tmpFireDir = this._tmpFireDir || new THREE.Vector3();
    this.camera.getWorldDirection(this._tmpFireDir);
    this.net.sendFire(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: this._tmpFireDir.x, y: this._tmpFireDir.y, z: this._tmpFireDir.z },
    );
  }

  // Manda o estado do jogador local pro servidor (throttlado por Net.sendInput à
  // taxa de tick — não precisa gate aqui). "yaw" é a orientação do BONECO (pra onde
  // o RemotePlayer do outro lado deve olhar), não da câmera — Player._orientTo já
  // gira o objeto pra direção do movimento, então isto é só extrair o Y.
  _sendOnlineInput() {
    this._onlineEuler = this._onlineEuler || new THREE.Euler();
    this._onlineEuler.setFromQuaternion(this.player.object.quaternion, 'YXZ');

    const pos = this.player.position;
    const moved = this._onlinePrevPos
      ? this._onlinePrevPos.distanceTo(pos) > 1e-3
      : false;
    this._onlinePrevPos = (this._onlinePrevPos || new THREE.Vector3()).copy(pos);

    this.net.sendInput(makeInputPayload({
      pos,
      yaw: this._onlineEuler.y,
      state: this.player.state,
      crouched: this.player.crouched,
      prone: this.player.prone,
      statue: this.player.statue,
      moving: moved,
      color: [this.player.zones[0].mat.color.getHex(), this.player.zones[1].mat.color.getHex()],
    }));
  }

  // Fase 5: manda os traços do pincel livre acumulados desde o último envio
  // — sem botão de "Enviar" (ver _setupPaintPanel). Chamado em dois
  // gatilhos: na hora, quando um traço termina (toque solto), e a cada
  // ~250ms aqui em _tick enquanto um traço longo ainda está em andamento
  // (evita tanto lag em toques curtos quanto flood de mensagens num arrasto
  // contínuo). Sempre via flushPaintNetBuffer() (nunca lê o buffer sem
  // esvaziar): senão o próximo envio reenviaria os mesmos traços de novo.
  _flushAndSendPaint() {
    if (this.mode !== 'online' || !this.net || !this._onlineConnected) return;
    const buf = this.player._paintNetBuffer;
    if (!buf || !buf.length) return;
    this.net.sendPaintStrokes(this.player.flushPaintNetBuffer());
  }

  start() {
    this.audio.resume(); // dentro do gesto do usuário (botão iniciar)
    this.renderer.setAnimationLoop(this._tick);
  }

  _tick = () => {
    const rawDt = this._clock.getDelta();
    // Movimento recebe um intervalo limitado para não atravessar paredes num
    // engasgo. Relógio e medição usam o tempo real; um retorno longo de aba
    // oculta é tratado como pausa no solo.
    const dt = Math.min(rawDt, 0.05);
    const clockDt = rawDt > 0.5 ? 0 : rawDt;
    this._updateAdaptiveQuality(clockDt);
    if (!this.over && !this.won && !this._eliminatedSpectating && !this._tutorialActive) {
      this.player.update(dt, this.joystick.value, this.camera);
      for (const s of this.seekers) {
        s.update(dt);
        if (s.state === 'chase' && s.validTarget) {
          this.fireWaterJet(s, dt);
        }
      }

      if (this.mode === 'hunter') {
        this._updateHunterFPSRig();
        for (const t of this.targets) t.update(dt, this.camera);
        this._updateScanner(this.targets);
      }
      // Papel Caçador no modo online: mesma câmera 1ª pessoa/viewmodel do single-
      // player (ver _connectOnline, que troca this.follow pra HunterCamera assim
      // que o servidor confirma o papel) — sem isto a mira ficaria olhando pro
      // próprio corpo (câmera de 3ª pessoa sempre "lookAt" o próprio jogador).
      if (this.mode === 'online' && this.onlineRole === ROLE.HUNTER) {
        this._updateHunterFPSRig();
        // Scanner não precisa de dado extra do servidor: a posição de todo
        // RemotePlayer já chega a cada SNAPSHOT independente de camuflagem (ver
        // docs/PLANO_MULTIPLAYER.md — Interest Management fica fora de escopo).
        // Aqui é só a mesma affordance de radar do modo solo.
        this._updateScanner(
          [...this.remotePlayers.values()].filter((rp) => rp.role === ROLE.CHAMELEON)
        );
        this._updateOnlineTargetsHud();
      }

      if (this.mode === 'online') {
        for (const rp of this.remotePlayers.values()) rp.update(dt);
        if (this._onlineConnected) this._sendOnlineInput();
        // Fase 5: throttle periódico do envio automático do pincel (~250ms)
        // — o flush imediato de fim-de-traço já acontece em _setupPaintPanel;
        // isto só cobre um traço longo ainda em andamento.
        this._paintSendTimer = (this._paintSendTimer || 0) + dt;
        if (this._paintSendTimer >= 0.25) {
          this._paintSendTimer = 0;
          this._flushAndSendPaint();
        }
      }

      // Juice: pulso + clique ao GRUDAR na parede (transição chão → parede).
      if (this._prevState === 'grounded' && this.player.state === 'latched') {
        this.effects.pulse(this.player.position, 0x9fe8ff);
        this.audio.latch();
      }
      this._prevState = this.player.state;

      // No Online, o snapshot fixa o tempo pela hora autoritativa do servidor.
      // A busca por jogadores não consome os 180s da caçada.
      if (this.mode !== 'online') this.elapsed += clockDt;
      // Fase E (Ranking): faltava acumular pro Camaleão ONLINE — o badge
      // 🫥 e o Ranking de sobrevivência ficavam travados em 0:00 pra esse
      // papel (bug real, não decisão de escopo; só o solo já acumulava).
      if (this.mode === 'chameleon' || (this.mode === 'online' && this.onlineRole === ROLE.CHAMELEON)) {
        if (this.player.isCamouflaged()) this.camoTime += clockDt;

        // Atraso de 30s no Placar de Tempo Camuflado (Anti-Cheat Spec)
        this.scoreHistory.push({ t: this.elapsed, camoTime: this.camoTime });
        while (this.scoreHistory.length > 0 && (this.elapsed - this.scoreHistory[0].t) >= 30) {
          this.delayedCamoTime = this.scoreHistory.shift().camoTime;
        }
      }

      this._updateFeedback(dt);

      // Modo online: quem decide fim de partida é o SERVIDOR (_onMatchOver), nunca o
      // relógio local — os dois lados não têm por que concordar no milissegundo exato.
      if (this.mode !== 'online' && this.elapsed >= this.surviveTime) {
        if (this.mode === 'hunter') this._gameOver('O tempo acabou — os Camaleões que restaram escaparam.');
        else this._win();
      }
    }
    const t = this._clock.elapsedTime;
    this.level.update?.(t, dt);              // girofles/painéis piscando + passagens secretas
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
    // A folga de 0.8m só faz sentido GRUDADO (não contar o bloco onde ele gruda,
    // a ~RADIUS de distância do centro). Aplicada sempre, ela também cortava o
    // raio antes de testar um pilar/móvel que o jogador estivesse encostado NO
    // CHÃO (não grudado) a menos de 0.8m — o oclusor nunca era testado e o
    // personagem sumia 100% atrás dele (bug real, não falta de cobertura de alvo).
    // No chão, só uma folga mínima pra não autointersectar a própria cápsula.
    const skip = this.player.state === 'latched' ? 0.8 : 0.15;
    this._occRay.far = Math.max(0, dist - skip);
    // `occluders` (Level.js) = climbables + lajes do 2º andar — climbables sozinho
    // não bloqueava a visão entre andares no fade (via só a colisão de câmera).
    const hits = this._occRay.intersectObjects(this.level.occluders, false);

    const nowFaded = new Set();
    for (const h of hits) {
      if (!h.object || !h.object.material) continue;
      const mats = Array.isArray(h.object.material) ? h.object.material : [h.object.material];
      for (const m of mats) if (m) nowFaded.add(m);
    }

    for (const mat of nowFaded) {
      mat.transparent = true;
      mat.depthWrite = false;               // deixa o jogador aparecer através
      const curOpacity = Number.isFinite(mat.opacity) ? mat.opacity : 1.0;
      mat.opacity = THREE.MathUtils.clamp(curOpacity + (FADE - curOpacity) * k, FADE, 1.0);
      this._occFaded.add(mat);
    }

    // Restaura os que deixaram de ocluir (delete-durante-iteração é seguro em Set).
    for (const mat of Array.from(this._occFaded)) {
      if (nowFaded.has(mat)) continue;
      const curOpacity = Number.isFinite(mat.opacity) ? mat.opacity : FADE;
      const nextOpacity = curOpacity + (1 - curOpacity) * k;
      if (nextOpacity > 0.985) {
        mat.opacity = 1;
        mat.transparent = false;
        mat.depthWrite = true;
        this._occFaded.delete(mat);
      } else {
        mat.opacity = THREE.MathUtils.clamp(nextOpacity, FADE, 1.0);
      }
    }
  }

  // Feedback de tensão: vinheta + som quando falta pouco para vencer OU quando
  // um Caçador está prestes a capturar (< WARN_WINDOW s). Alerta de DETECÇÃO
  // (spotted) dispara assim que um Caçador te vê sem camuflagem — antes do perigo.
  _updateFeedback(dt) {
    const remaining = this.surviveTime - this.elapsed;
    const camo = this.player.isCamouflaged();

    // Stinger na BORDA de subida da camuflagem (acabou de "sumir" com sucesso).
    if (camo && !this._wasCamo) this.audio.camo();
    this._wasCamo = camo;

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

  _updateWaterAmmoHud() {
    const elCount = document.getElementById('ammo-count');
    const elMax = document.getElementById('ammo-max');
    const elBadge = document.getElementById('water-ammo-hud');
    if (elCount) elCount.textContent = this.infiniteAmmo ? '∞' : String(this.waterAmmo);
    if (elMax) elMax.textContent = this.infiniteAmmo ? '∞' : String(this.maxWaterAmmo);
    if (elBadge) {
      elBadge.classList.toggle('empty', !this.infiniteAmmo && this.waterAmmo <= 0);
    }
  }

  // ------------------------------------------------------ MODO CAÇADOR (jogável)
  // Espalha os Camaleões-alvo em pontos já validados pela IA do Seeker (routes
  // de patrulha, ver Level.js._setRoutes) — evita reinventar "onde é seguro
  // andar". Desde o Plano 3 os alvos vagueiam/fogem dentro da PRÓPRIA rota (não
  // há grafo de escadas entre routes[0]/térreo e routes[1]/andar de cima), por
  // isso guardamos de qual rota cada ponto veio, não só a posição.
  _spawnHunterTargets() {
    const routes = this.level.routes || [];
    const routeY = this.level.routeY || [];
    const points = [];
    // routes[i] guarda x/z de patrulha, mas o .y de cada waypoint é uma altura
    // GENÉRICA de rota (Level.js: ROUTE_Y) — não a altura real do andar. O
    // Seeker corrige isso ao vivo com _groundY() a cada frame; o alvo planta
    // na altura certa já de cara (routeY[i], a mesma usada como startY do
    // Seeker daquela rota — ver Level._setRoutes) e depois se corrige sozinho
    // ao vaguear/fugir (mesmo _groundY adaptado, ver Fase B do Plano 3).
    // `huntTargetRouteIndices` (Level.js, default [0,1]) deixa cada layout
    // escolher quantos/quais domínios recebem alvo — Chameleon Manor (Plano 5)
    // usa os 4 (porão/térreo/1º andar/ático), não só os 2 primeiros.
    for (const i of (this.level.huntTargetRouteIndices || [0, 1])) {
      const route = routes[i];
      if (!route) continue;
      const y = routeY[i] != null ? routeY[i] : undefined;
      for (const w of route) {
        points.push({ pos: y != null ? new THREE.Vector3(w.x, y, w.z) : w.clone(), routeIndex: i });
      }
    }
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    const count = Math.min(HUNTER_TARGET_COUNT, points.length);
    for (const t of this.targets) t.destroy();
    this.targets = [];
    // Recalculado aqui (não reaproveita a `difficulty` do construtor) porque
    // esta função roda de novo em restartInPlace ao avançar de estágio — sem
    // isso os alvos ficariam presos na dificuldade do estágio em que nasceram.
    const difficulty = 1 + (this.stage - 1) * DIFF_PER_STAGE;
    for (let i = 0; i < count; i++) {
      const { pos, routeIndex } = points[i];
      this.targets.push(new ChameleonTarget(this.scene, this.level, pos, {
        difficulty,
        waypoints: routes[routeIndex],
        spotRange: HUNTER_FLASHLIGHT_RANGE,
        spotHalfAngleDeg: HUNTER_FLASHLIGHT_ANGLE_DEG,
      }));
    }
  }

  // Lobby maior (docs/PLANO_LOBBY_MULTIPLAYER.md §3.4): mesma UI (#targets-count/
  // #targets-total) do Caçador solo, mas contando RemotePlayer de verdade em vez de
  // ChameleonTarget-boneco. O dado já vem em todo SNAPSHOT (rp.eliminated) — não
  // precisa de nada novo do servidor.
  _updateOnlineTargetsHud() {
    const chameleons = [...this.remotePlayers.values()].filter((rp) => rp.role === ROLE.CHAMELEON);
    const remaining = chameleons.filter((rp) => !rp.eliminated).length;
    const elCount = document.getElementById('targets-count');
    const elTotal = document.getElementById('targets-total');
    if (elCount) elCount.textContent = String(remaining);
    if (elTotal) elTotal.textContent = String(chameleons.length);
  }

  _updateTargetsHud() {
    const elCount = document.getElementById('targets-count');
    const elTotal = document.getElementById('targets-total');
    const remaining = this.targets.filter((t) => !t.eliminated).length;
    if (elCount) elCount.textContent = String(remaining);
    if (elTotal) elTotal.textContent = String(this.targets.length);
  }

  // Fase 1 da Visão do Caçador (docs/MECANICA_CACADOR_VISAO.md §1): em 1ª pessoa não faz
  // sentido ver o próprio boneco colado na câmera, então o corpo inteiro fica invisível
  // assim que o GLB terminar de carregar (mesmo padrão de lazy-attach do Seeker — ver
  // Seeker._attachBlaster e o comentário sobre a arma "pipocar" se anexada tarde demais;
  // em Three.js um filho não renderiza se o pai está invisible). No lugar, uma instância
  // própria da arma (createBlaster clona o protótipo — seguro chamar de novo) fica
  // pendurada na câmera como "viewmodel" ao estilo FPS clássico. this._hunterMuzzle
  // aponta pro cano dela — fireHunterShot() não muda.
  _updateHunterFPSRig() {
    if (this._hunterViewAttached || !this.player.animInstance) return;
    this._hunterViewAttached = true; // marca já: mesmo se a arma falhar, não tenta de novo

    this.player.animInstance.group.visible = false;

    const vm = animationManager.createBlaster();
    if (!vm) return;
    // createBlaster() normaliza a arma para ARMA_COMPRIMENTO (0.55) em unidades de MUNDO —
    // certo para pendurar num osso da mão distante, grande demais tão perto da câmera.
    // Encolhe para o viewmodel não dominar a tela. 0.62 (era 0.4): a arma pequena
    // demais lia como uma mancha indistinta no canto — aumentada até dar pra
    // reconhecer a forma do lançador sem tampar o centro da mira.
    vm.group.scale.multiplyScalar(0.62);
    vm.group.position.set(0.30, -0.28, -0.62);
    vm.group.rotation.set(0, Math.PI, 0); // cano apontando pra frente da câmera (-Z)
    this.camera.add(vm.group);
    this._hunterViewWeapon = vm.group; // guardado pra _teardownHunterRig poder tirar da câmera
    this._hunterMuzzle = vm.muzzle;

    this._buildHunterViewArm();
  }

  // Braço em 1ª pessoa segurando o lançador (docs/MECANICA_CACADOR_VISAO.md §1): antes
  // só a arma flutuava sozinha na câmera, sem mão nem antebraço — lia como um objeto
  // solto, não como algo empunhado. Duas cápsulas simples (mesmo estilo "art toy" sem
  // dedos de Character.js/buildBody) entrando do canto inferior direito até o punho da
  // arma. Reaproveita this.player.zones[0].mat (cor "upper" do próprio jogador) em vez
  // de um material novo: o braço fica com a MESMA cor de camuflagem que o resto do
  // corpo, e muda sozinho se o jogador repintar — é o mesmo objeto de material, não uma
  // cópia. Chamado uma única vez por _updateHunterFPSRig (mesma trava _hunterViewAttached).
  _buildHunterViewArm() {
    const mat = this.player.zones[0].mat;
    const arm = new THREE.Group();

    // Cápsula que preenche EXATAMENTE o segmento entre dois pontos em espaço da
    // câmera: comprimento do cilindro = distância menos as duas calotas, e
    // orientação = rotação de (0,1,0) — eixo nativo de CapsuleGeometry — até a
    // direção do segmento. Sem isto (cápsula de comprimento fixo só apontada na
    // direção certa) ela nunca alcança de fato o ponto de destino.
    const capsuleBetween = (from, to, radius) => {
      const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
      const dist = a.distanceTo(b);
      const len = Math.max(0.01, dist - 2 * radius);
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 4, 10), mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      arm.add(mesh);
      return mesh;
    };

    // Cotovelo fora de quadro (baixo-direita) → punho → empunhadura, por BAIXO do corpo
    // da arma (que fica em ~0.30,-0.28,-0.62 — _updateHunterFPSRig) pra não se misturar
    // visualmente com ela — separação em Y clara, não só profundidade.
    const elbow = [0.56, -0.58, -0.78];
    const wrist = [0.30, -0.40, -0.60];
    const grip = [0.20, -0.33, -0.50];
    capsuleBetween(elbow, wrist, 0.055);       // antebraço
    capsuleBetween(wrist, grip, 0.070);        // mão — curta e mais grossa, sem dedos

    arm.frustumCulled = false;
    this.camera.add(arm);
    this._hunterViewArm = arm;
  }

  // Disparo do Caçador jogável (botão 💦). Mira por cone a partir do centro da
  // câmera contra a posição CONHECIDA de cada alvo vivo (não raycast contra a
  // malha animada — ver o comentário grande em fireWaterJet sobre bind pose).
  fireHunterShot() {
    if (this.over || this.won) return;
    const now = performance.now();
    if (now < this._nextFireAt) return;
    this._nextFireAt = now + HUNTER_FIRE_COOLDOWN_MS;

    if (!this.infiniteAmmo) {
      if (this.waterAmmo <= 0) {
        this.audio.emptyClick();
        return;
      }
      this.waterAmmo--;
      this._updateWaterAmmoHud();
    }

    this.audio.waterBlast();
    if (this.player.triggerShootPose) this.player.triggerShootPose();

    const fromPos = new THREE.Vector3();
    if (this._hunterMuzzle) this._hunterMuzzle.getWorldPosition(fromPos);
    else fromPos.copy(this.camera.position);

    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const cosHalf = Math.cos(HUNTER_AIM_HALF_ANGLE);
    const up = new THREE.Vector3(0, 0.3, 0);

    let best = null, bestCos = -1, bestPos = null;
    for (const t of this.targets) {
      if (t.eliminated) continue;
      const targetPos = t.position.clone().add(up);
      const dist = this.camera.position.distanceTo(targetPos);
      if (dist > JET_RANGE || dist < 1e-3) continue;
      const dir = targetPos.clone().sub(this.camera.position).normalize();
      const cos = camDir.dot(dir);
      if (cos < cosHalf || cos <= bestCos) continue;
      // Oclusão: alguma parede/móvel entre a câmera e o alvo?
      const ray = new THREE.Raycaster(this.camera.position, dir, 0, Math.max(0, dist - 0.15));
      if (ray.intersectObjects(this.level.climbables, false).length > 0) continue;
      best = t; bestCos = cos; bestPos = targetPos;
    }

    const beamEnd = bestPos || fromPos.clone().addScaledVector(camDir, JET_RANGE);
    this.effects.waterJetBeam(fromPos, beamEnd, !!best);
    this.audio.waterSplash();

    if (best) {
      best.hit();
      this._updateTargetsHud();
      if (this.targets.every((t) => t.eliminated)) {
        this._win('Você encontrou e acertou todos os Camaleões!');
        return;
      }
    } else {
      // Errou: estica o cooldown (bomba de pressão) em vez do normal — desincentiva
      // atirar às cegas contra parede/objeto sem punir a munição de novo.
      this._nextFireAt = now + HUNTER_MISS_COOLDOWN_MS;
    }

    if (!this.infiniteAmmo && this.waterAmmo <= 0) {
      this._gameOver('Sem munição! Os Camaleões que restaram escaparam.');
    }
  }

  // Scanner do Caçador (botão 📡). Só liga o pulso se o cooldown já liberou — o resto
  // (revelar alvos, vinheta) acontece por frame em _updateScanner().
  activateScanner() {
    if (this.over || this.won) return;
    const now = performance.now();
    if (now < this._scannerReadyAt) {
      this.audio.emptyClick(); // reaproveita o "negado" já usado pra munição vazia
      return;
    }
    this._scannerActiveUntil = now + SCANNER_DURATION_MS;
    this._scannerReadyAt = now + SCANNER_COOLDOWN_MS;
    this.audio.camo(); // stinger de "ligou" — mesmo som usado ao entrar em camuflagem
    if (this._vignette) this._vignette.classList.add('scanning');
    if (this._scannerRadar) this._scannerRadar.classList.add('active');
  }

  // Por frame: desliga o pulso quando o tempo acaba, atualiza o badge de cooldown do HUD
  // e posiciona os pontos do radar (direção/distância dos alvos vivos em SCANNER_RANGE).
  // `targets` é qualquer lista de objetos com `.position`/`.eliminated` — os
  // ChameleonTarget do modo solo ou os RemotePlayer (papel Camaleão) do online,
  // já filtrados pelo chamador (ver _tick).
  _updateScanner(targets) {
    const now = performance.now();
    const active = now < this._scannerActiveUntil;

    if (!active) {
      if (this._vignette) this._vignette.classList.remove('scanning');
      if (this._scannerRadar) this._scannerRadar.classList.remove('active');
    }

    if (this._scannerCdEl) {
      const cd = this._scannerReadyAt - now;
      this._scannerCdEl.textContent = cd > 0 ? `${Math.ceil(cd / 1000)}s` : 'Pronto';
    }
    if (this._btnScan) this._btnScan.classList.toggle('cooling', now < this._scannerReadyAt);

    if (!active) return;

    // Bearing relativo ao "pra frente" da câmera (plano XZ) — 0 = à frente, ±π = atrás.
    const camDir = this.camera.getWorldDirection(this._scanDir).setY(0).normalize();
    const dial = 40; // raio do radar em CSS px (metade de #scanner-radar menos a margem do ponto)
    let i = 0;
    for (const t of targets) {
      if (t.eliminated) continue;
      const toT = this._scanTo.copy(t.position).sub(this.camera.position);
      const dist = Math.hypot(toT.x, toT.z);
      if (dist > SCANNER_RANGE) continue;

      const bearing = Math.atan2(
        camDir.x * toT.z - camDir.z * toT.x,
        camDir.x * toT.x + camDir.z * toT.z,
      );
      const r = (dist / SCANNER_RANGE) * dial;
      const x = 48 + Math.sin(bearing) * r;
      const y = 48 - Math.cos(bearing) * r;

      let dot = this._scannerDots[i];
      if (!dot) {
        dot = document.createElement('div');
        dot.className = 'scanner-dot';
        this._scannerRadar.appendChild(dot);
        this._scannerDots[i] = dot;
      }
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.display = 'block';
      i++;
    }
    for (; i < this._scannerDots.length; i++) this._scannerDots[i].style.display = 'none';
  }

  _updateHud() {
    const camo = this.player.isCamouflaged();
    const latched = this.player.state === 'latched';
    const reason = this.player.getCamouflageReason();
    this._badge.textContent = camo ? 'CAMUFLADO' : (latched ? (reason === 'color' ? 'COR ERRADA' : 'PAREDE') : (this.player.statue ? 'ESTÁTUA' : (this.player.crouched ? 'AGACHADO' : 'CHÃO')));
    this._badge.classList.toggle('latched', latched && !camo);
    this._badge.classList.toggle('camo', camo);
    this._badge.classList.toggle('mismatch', !camo && reason === 'color');
    this._chip.style.background = `#${this.player.material.color.getHexString()}`;
    this._updateRoleHudText();
    this._updateCamouflageHint(camo, reason, latched);

    // Botão Escalar: destaca quando próximo a uma parede/superfície
    if (this._btnClimb) {
      const nearWall = latched || (this.player.object.position.y > 0.5) || (this.player.statue);
      this._btnClimb.classList.toggle('near', nearWall);
      this._btnClimb.classList.toggle('active', latched);
    }

    // Botão Atirar: esmaece durante o cooldown (mais visível no penalty de erro — Fase 2).
    if (this._btnFire) {
      this._btnFire.classList.toggle('cooling', performance.now() < this._nextFireAt);
    }

    // Placar: tempo decorrido e tempo camuflado (com Atraso de 30s Anti-Cheat)
    const shown = Math.min(this.elapsed, this.surviveTime);
    if (this._elElapsed) this._elElapsed.textContent = fmtTime(shown);
    if (this._elCamo) {
      const hunter = this.mode === 'hunter' || (this.mode === 'online' && this.onlineRole === ROLE.HUNTER);
      this._elCamo.textContent = hunter
        ? `⏱ ${fmtTime(Math.max(0, this.surviveTime - this.elapsed))}`
        : `🫥 ${fmtTime(this.delayedCamoTime || 0)}`;
    }
    if (this._elFill) {
      const pct = this.surviveTime > 0 ? (shown / this.surviveTime) * 100 : 0;
      this._elFill.style.width = `${Math.min(100, pct)}%`;
    }
  }

  _updateAdaptiveQuality(dt) {
    if (!this.isMobile || this._qualityReduced) return;
    this._qualityElapsed += dt;
    this._qualityFrames++;
    if (this._qualityElapsed < 2) return;
    const fps = this._qualityFrames / this._qualityElapsed;
    this._qualityElapsed = 0;
    this._qualityFrames = 0;
    if (fps < 24 && this._qualityPixelRatio > 1) {
      this._qualityPixelRatio = 1;
      this.renderer.setPixelRatio(this._qualityPixelRatio);
      this._qualityReduced = true;
      if (this._hintEl && this.mode !== 'online') this._hintEl.textContent = '⚙️ Ajustando a qualidade para manter o jogo fluido.';
    }
  }

  _updateCamouflageHint(camo, reason, latched) {
    if (!this._hintEl || this.mode === 'hunter' || (this.mode === 'online' && this.onlineRole === ROLE.HUNTER)) return;
    if (this.mode === 'online' && (!this.onlineRole || this._eliminatedSpectating || !this._onlineMatchStartAt || this._onlineMatchStartAt > Date.now())) return;
    if (camo) this._hintEl.textContent = '🫥 CAMUFLADO — fique imóvel ou mude de esconderijo quando o Caçador se aproximar.';
    else if (reason === 'color') this._hintEl.textContent = '🎨 COR INCOMPATÍVEL — copie a superfície atrás de cada parte do corpo.';
    else if (reason === 'surface') this._hintEl.textContent = '🧱 SUPERFÍCIE INVÁLIDA — encoste numa parede colorida ou deite sobre um tapete.';
    else this._hintEl.textContent = '🧱 GRUDE NUMA SUPERFÍCIE — só apoiado você pode ficar camuflado.';
  }

  _setupTutorial() {
    if (this.mode === 'online') return;
    const el = document.getElementById('tutorial');
    const text = document.getElementById('tutorial-text');
    const next = document.getElementById('tutorial-next');
    const skip = document.getElementById('tutorial-skip');
    if (!el || !text || !next || !skip) return;
    const key = `eom-tutorial-${this.mode}`;
    if (sessionStorage.getItem(key) === '1') return;
    const steps = this.mode === 'hunter'
      ? ['Encontre um Camaleão no cenário.', 'Mire com a retícula e toque em 💦 para disparar.', 'Use o Scanner 📡 perto de você e acerte todos antes que a água acabe.']
      : ['Mire numa parede ou tapete e toque em 🎨 para copiar a cor.', 'Toque em 🧱 para grudar na superfície colorida.', 'Quando o indicador mostrar CAMUFLADO, fique imóvel e sobreviva.'];
    let index = 0;
    const render = () => {
      text.textContent = steps[index];
      next.textContent = index === steps.length - 1 ? 'Começar' : 'Próximo';
    };
    const finish = () => {
      sessionStorage.setItem(key, '1');
      el.classList.add('hidden');
      this._tutorialActive = false;
      // Descarta o tempo que o relógio acumulou enquanto a instrução estava aberta.
      this._clock.getDelta();
    };
    next.addEventListener('click', () => { if (index === steps.length - 1) finish(); else { index++; render(); } });
    skip.addEventListener('click', finish);
    render();
    this._tutorialActive = true;
    el.classList.remove('hidden');
  }

  _updateRoleHudText() {
    const hunter = this.mode === 'hunter' || (this.mode === 'online' && this.onlineRole === ROLE.HUNTER);
    const camo = !hunter;
    if (this._elGoalCap) this._elGoalCap.textContent = hunter ? 'encontre todos' : 'sobreviva';
    if (this._elCamo) {
      this._elCamo.title = hunter ? 'Tempo restante da partida' : 'Tempo total camuflado (Atualizado a cada 30s)';
      if (hunter) this._elCamo.textContent = `⏱ ${fmtTime(Math.max(0, this.surviveTime - this.elapsed))}`;
    }
    const hint = this.mode === 'online' ? null : document.getElementById('hint');
    if (hint) hint.textContent = hunter
      ? 'Mire com a retícula e toque em 💦 para atirar. Encontre e acerte todos os Camaleões antes que a água acabe.'
      : 'Mire numa superfície e toque em 🎨 para sugar a cor. Grude numa superfície da mesma cor para se camuflar. Sobreviva ao Caçador vermelho.';
  }

  fireWaterJet(seeker, dt) {
    if (this.over || this.won) return;

    // Cooldown entre rajadas
    seeker._shotCooldown = (seeker._shotCooldown || 0) - dt;
    if (seeker._shotCooldown > 0) return;
    seeker._shotCooldown = 0.25; // 4 disparos por segundo em rajada

    if (!this.infiniteAmmo) {
      if (this.waterAmmo <= 0) {
        this.audio.emptyClick();
        this._updateWaterAmmoHud();
        // Bug real (Fase E, Ranking): isto é uma VITÓRIA do Camaleão, não
        // derrota — chamava _gameOver() pela mensagem, o que marcava
        // `this.over=true`/`this.won=false` (e reportaria pro Ranking como
        // partida perdida). _win() é quem mostra a tela de Vitória corretamente.
        this._win("Vitória dos Camaleões! O Caçador ficou sem água.");
        return;
      }
      this.waterAmmo--;
      this._updateWaterAmmoHud();
    }

    this.audio.waterBlast();
    seeker.triggerShootPose && seeker.triggerShootPose();

    // Origem = boca do cano DE VERDADE (marcador preso à arma, que por sua vez
    // acompanha o osso da mão). Antes era um offset fixo sobre o grupo lógico —
    // o jato saía do meio do corpo, e o comentário dizia "bocal" sem ser.
    const fromPos = new THREE.Vector3();
    if (seeker._muzzle) seeker._muzzle.getWorldPosition(fromPos);
    else fromPos.copy(seeker.group.position).add(new THREE.Vector3(0, 1.2, 0));
    const targetPos = this.player.position.clone().add(new THREE.Vector3(0, 0.5, 0));

    // Acerto = jogador no alcance E sem parede na frente.
    //
    // NÃO se testa o corpo do jogador por raycast: ele é um SkinnedMesh, e o
    // raycast do Three.js usa a BIND POSE (no nosso GLB, centrada na origem e com
    // metade abaixo do piso), não a pose animada — o tiro passava por cima do
    // jogador e "acertava" a parede atrás. O código antigo escondia isso porque
    // tratava "não acertei nada" como acerto. Testar oclusão contra as paredes é
    // mais barato e não depende da malha deformada.
    const dir = new THREE.Vector3().subVectors(targetPos, fromPos).normalize();
    const distAlvo = fromPos.distanceTo(targetPos);
    let hitPlayer = false;
    if (distAlvo <= JET_RANGE) {
      const ray = new THREE.Raycaster(fromPos, dir, 0, Math.max(0, distAlvo - 0.15));
      hitPlayer = ray.intersectObjects(this.level.climbables, false).length === 0;
    }

    this.effects.waterJetBeam(fromPos, targetPos, hitPlayer);

    if (hitPlayer) {
      this.audio.waterSplash();
      const remain = this.player.washPaint(dt * 3.0);
      if (remain < 0.08) {
        this._gameOver("O Caçador lavou toda a sua tinta com o jato de água!");
      }
    } else {
      this.audio.waterSplash();
    }

    // Se a munição acabou e não acertou um Camaleão para vencer, Vitória dos Camaleões!
    // (mesmo bug do outro ponto acima — _win(), não _gameOver(), ver comentário lá).
    if (!this.infiniteAmmo && this.waterAmmo <= 0 && !hitPlayer) {
      this._win("Vitória dos Camaleões! O Caçador ficou sem água.");
    }
  }

  // Pincel Livre por UV (Fase 5) — abre pelo "PINCEL" no centro do menu
  // radial de #btn-paint (segurar o botão antigo), não por um ícone
  // próprio na barra: reaproveita o que já existia ali (ver index.html).
  // #btn-paint continua fazendo sample-color de 2 zonas no toque rápido,
  // sem nenhuma mudança. Abrir/fechar o painel também liga/desliga os
  // listeners de pintura no `canvas` (evita que qualquer toque na cena
  // tente pintar o tempo todo — só enquanto o painel está mesmo aberto).
  // Enquanto aberto, junto some joystick/look-zone (classe `painting-active`
  // no body, ver style.css): pintura exige toque direto na tela, sem
  // competir pelos controles normais.
  _setupPaintPanel() {
    if (!this.player || !this._btnBrush) return;

    const painel = document.getElementById('paint-debug-panel');
    if (!painel) return;

    const canvas = this.renderer.domElement;
    let pintando = false;
    let aberto = false;
    let corAtual = '#2ec4b6';
    let raioAtual = 22;
    let modoContaGotas = false;
    let xrayLigado = false;
    let primeiroTracoReportado = false; // missão "Artista" (Fase F) — só conta 1x
    const historico = []; // últimas cores amostradas pelo conta-gotas (máx. 3), só deste painel

    // ---- Tamanho do pincel ----
    const sizeInput = document.getElementById('pdp-size');
    const sizeVal = document.getElementById('pdp-size-val');
    sizeInput.addEventListener('input', () => {
      raioAtual = Number(sizeInput.value);
      sizeVal.textContent = `${raioAtual}px`;
    });

    // ---- Paleta fixa ----
    const swatches = painel.querySelectorAll('#pdp-swatches .pdp-swatch');
    const selecionarCor = (hex, origem) => {
      corAtual = hex;
      swatches.forEach((b) => b.classList.toggle('on', b === origem));
      // O emissivo usa a cor de pincel atual — reaplica se já houver brilho ligado.
      if (emissiveAtual > 0) this.player.setEmissive(corAtual, emissiveAtual);
    };
    swatches.forEach((btn) => {
      btn.addEventListener('click', () => selecionarCor(btn.dataset.color, btn));
    });

    // ---- Emissivo (Fase 3) ----
    let emissiveAtual = 0;
    const emissiveInput = document.getElementById('pdp-emissive');
    const emissiveVal = document.getElementById('pdp-emissive-val');
    emissiveInput.addEventListener('input', () => {
      emissiveAtual = Number(emissiveInput.value) / 100;
      emissiveVal.textContent = `${emissiveInput.value}%`;
      this.player.setEmissive(corAtual, emissiveAtual);
    });

    // ---- Histórico de amostras (conta-gotas) ----
    const historyEl = document.getElementById('pdp-history');
    const renderHistorico = () => {
      historyEl.innerHTML = '';
      for (const hex of historico) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pdp-swatch';
        b.style.background = hex;
        b.dataset.color = hex;
        b.addEventListener('click', () => selecionarCor(hex, null));
        historyEl.appendChild(b);
      }
    };

    // ---- Conta-gotas: só extrai a cor do ambiente mirado, não pinta nada
    // sozinho nem mexe na camuflagem de verdade (ver Player.sampleEnvironmentColor) ----
    const eyedropBtn = document.getElementById('pdp-eyedrop');
    eyedropBtn.addEventListener('click', () => {
      modoContaGotas = !modoContaGotas;
      eyedropBtn.classList.toggle('active', modoContaGotas);
    });

    // ---- Desfazer / Limpar ----
    document.getElementById('pdp-undo').addEventListener('click', () => this.player.paintUndo());
    document.getElementById('pdp-clear').addEventListener('click', () => this.player.paintClear());

    // ---- Raio-X ----
    const xrayBtn = document.getElementById('pdp-xray');
    xrayBtn.addEventListener('click', () => {
      xrayLigado = !xrayLigado;
      xrayBtn.classList.toggle('active', xrayLigado);
      this.player.setXray(xrayLigado);
    });

    const pintarEm = (e, down) => {
      this.player.paintAtScreenPoint(this.camera, this.renderer, e.clientX, e.clientY, {
        down, colorHex: corAtual, radiusPx: raioAtual,
      });
    };

    const onPointerDown = (e) => {
      if (modoContaGotas) {
        const hex = this.player.sampleEnvironmentColor(this.camera);
        if (hex) {
          selecionarCor(hex, null);
          historico.unshift(hex);
          if (historico.length > 3) historico.length = 3;
          renderHistorico();
        }
        modoContaGotas = false;
        eyedropBtn.classList.remove('active');
        return;
      }
      pintando = true;
      pintarEm(e, true);
      // Missão "Artista" (Fase F): 1ª vez que o traço é iniciado nesta
      // sessão — bumpMissionProgress() já é seguro de chamar de novo em
      // sessões futuras (para sozinho ao bater goal_count=1), este flag
      // só evita mandar rede a cada toque na MESMA sessão.
      if (!primeiroTracoReportado) {
        primeiroTracoReportado = true;
        bumpMissionProgress('first_paint', 1);
      }
    };
    const onPointerMove = (e) => {
      if (!pintando) return;
      pintarEm(e, false);
    };
    // Fase 5: envio automático — sem botão de "Enviar". Manda o que
    // acumulou assim que o traço termina, em vez de esperar o throttle
    // periódico do _tick (ver _flushAndSendPaint) — toques curtos saem na
    // hora, e o throttle só existe pra não inundar a rede num arrasto longo.
    const onPointerUp = () => {
      if (!pintando) return;
      pintando = false;
      this.player.paintStrokeEnd();
      this._flushAndSendPaint();
    };

    // Abre no toque do "PINCEL" — o centro de #radial-paint-menu, que já
    // existia como rótulo estático e virou o gatilho de verdade (ver
    // index.html). A textura só nasce aqui (ensurePaintTexture) — a maioria
    // dos Camaleões nunca abre o pincel. Fecha o menu radial antigo (cores
    // recentes + Fosco/Brilhante) ao abrir: os dois painéis não competem
    // pela mesma área da tela.
    const abrirPainel = () => {
      if (aberto) return;
      aberto = true;
      this.player.ensurePaintTexture();
      document.body.classList.add('painting-active');
      if (this._radialPaintMenu) this._radialPaintMenu.classList.add('hidden');
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
    // Fecha pelo ✕ do painel (#pdp-close) — o "PINCEL" que abre fica dentro
    // do menu radial antigo, que já está escondido enquanto este painel
    // está aberto, então não dá pra reusar o mesmo botão pra fechar.
    const fecharPainel = () => {
      if (!aberto) return;
      aberto = false;
      document.body.classList.remove('painting-active');
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      pintando = false;
      modoContaGotas = false;
      eyedropBtn.classList.remove('active');
    };

    this._btnBrush.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
      abrirPainel();
    });
    const closeBtn = document.getElementById('pdp-close');
    if (closeBtn) closeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); fecharPainel(); });
  }

  _setupControls() {
    this._setupPaintPanel();

    const lookZone = document.getElementById('look-zone');
    let activePointers = new Map();
    let prevPinchDist = 0;

    if (lookZone) {
      lookZone.addEventListener('pointerdown', (e) => {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 2) {
          const pts = Array.from(activePointers.values());
          prevPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        }
      });

      window.addEventListener('pointermove', (e) => {
        if (!activePointers.has(e.pointerId)) return;
        const prev = activePointers.get(e.pointerId);
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size === 1 && this.follow) {
          this.follow.addLook(dx, dy);
        } else if (activePointers.size === 2 && this.follow) {
          const pts = Array.from(activePointers.values());
          const currDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (prevPinchDist > 0) {
            const zoomDelta = (prevPinchDist - currDist) * 0.015;
            this.follow.addZoom(zoomDelta);
          }
          prevPinchDist = currDist;
        }
      });

      const clearPointer = (e) => {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) prevPinchDist = 0;
      };
      window.addEventListener('pointerup', clearPointer);
      window.addEventListener('pointercancel', clearPointer);
    }

    // Botões e Menus Radiais
    const setupLongPress = (btn, onTap, onHold) => {
      let timer = null;
      let held = false;

      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        held = false;
        btn.classList.add('active');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
        timer = setTimeout(() => {
          held = true;
          onHold();
        }, 250);
      });

      const cancel = (e) => {
        btn.classList.remove('active');
        if (timer) { clearTimeout(timer); timer = null; }
        if (!held) {
          onTap();
        }
      };

      btn.addEventListener('pointerup', cancel);
      btn.addEventListener('pointercancel', (e) => {
        btn.classList.remove('active');
        if (timer) { clearTimeout(timer); timer = null; }
      });
    };

    if (this._btnJump) {
      this._btnJump.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.player.jump();
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
      });
    }

    if (this._btnFire) {
      this._btnFire.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.mode === 'online') this._fireOnline();
        else this.fireHunterShot();
        if (navigator.vibrate) try { navigator.vibrate(14); } catch (_) {}
      });
    }

    if (this._btnScan) {
      this._btnScan.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.activateScanner();
        if (navigator.vibrate) try { navigator.vibrate(14); } catch (_) {}
      });
    }

    if (this._btnClimb) {
      this._btnClimb.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // Passagens secretas (Fase 5, Plano 5): mesmo botão Escalar, mas
        // intercepta ANTES de toggleLatch — perto de um painel, o toque
        // abre/fecha a passagem em vez de grudar na parede. Longe de
        // qualquer passagem, trySecretPassage devolve false e o
        // comportamento de sempre (toggleLatch) segue normal.
        if (!this.level.trySecretPassage?.(this.player.object.position)) {
          this.player.toggleLatch(this.camera);
        }
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
      });
    }

    if (this._btnPaint) {
      setupLongPress(
        this._btnPaint,
        () => {
          this.player.sampleQuickMatch(this.camera);
        },
        () => {
          if (this._radialPaintMenu) this._radialPaintMenu.classList.toggle('hidden');
          if (navigator.vibrate) try { navigator.vibrate(18); } catch (_) {}
        }
      );
    }

    if (this._btnPose) {
      setupLongPress(
        this._btnPose,
        () => {
          this.player.setPose('lock');
        },
        () => {
          if (this._radialPoseMenu) this._radialPoseMenu.classList.toggle('hidden');
          if (navigator.vibrate) try { navigator.vibrate(18); } catch (_) {}
        }
      );
    }

    // Handlers do Menu Radial de Poses
    if (this._radialPoseMenu) {
      const items = this._radialPoseMenu.querySelectorAll('.radial-item');
      items.forEach((item) => {
        item.addEventListener('click', () => {
          const pose = item.dataset.pose;
          this.player.setPose(pose);
          this._radialPoseMenu.classList.add('hidden');
        });
      });
    }

    // Handlers do Menu Radial de Pintura Avançada
    if (this._radialPaintMenu) {
      const chips = this._radialPaintMenu.querySelectorAll('.p-chip');
      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const colorHex = chip.dataset.color || '#eef0f2';
          this.player.setCamouflage(new THREE.Color(colorHex));
          this._radialPaintMenu.classList.add('hidden');
        });
      });

      const finishBtns = this._radialPaintMenu.querySelectorAll('.finish-btn');
      finishBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          finishBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.player.setFinish(btn.dataset.finish);
        });
      });
    }
  }

  // Ranking (Fase E, Plano 2) — único chokepoint por resultado (todo
  // _gameOver/_win de qualquer modo passa por aqui, ver docs/PLANO_CONTAS.md
  // §4). `reportMatchResult` já não-opa sozinho sem sessão logada. Ignora a
  // rara falha de conexão Online antes do `welcome` chegar (`onlineRole`
  // ainda nulo) — nenhuma partida de verdade aconteceu pra valer a pena
  // registrar.
  _reportMatchResult(won) {
    if (this.mode === 'online' && !this.onlineRole) return;
    const dbMode = this.mode === 'online' ? `online_${this.onlineRole}` : this.mode;
    reportMatchResult({ mode: dbMode, won, camoTimeSeconds: this.camoTime });

    // Missões (Fase F) — mesmo chokepoint, mesma ressalva client-reported.
    // "papel" (não "modo exato") pra bater com as categorias do Ranking:
    // solo e Online do mesmo papel contam pra mesma missão.
    if (this.mode === 'online') bumpMissionProgress('play_online', 1);
    if (won) {
      const role = this.mode === 'online' ? this.onlineRole : this.mode;
      if (role === ROLE.CHAMELEON) bumpMissionProgress('survive_3', 1);
      else if (role === ROLE.HUNTER) bumpMissionProgress('hunter_win', 1);
    }
  }

  _gameOver(msg) {
    if (this.won || this.over) return;
    this._reportMatchResult(false);
    this.over = true;
    this._clearVignette();
    this.audio.caught();
    if (this._gameoverMsg && msg) this._gameoverMsg.textContent = msg;
    if (this._gameoverEl) this._gameoverEl.classList.add('show');
  }

  _win(msg) {
    if (this.won || this.over) return;
    this._reportMatchResult(true);
    this.won = true;
    this._clearVignette();
    this.audio.win();

    const winTime = document.getElementById('win-time');
    const winCamo = document.getElementById('win-camo');
    const winPct = document.getElementById('win-camo-pct');
    if (winTime) winTime.textContent = fmtTime(Math.min(this.elapsed, this.surviveTime));
    if (winCamo) winCamo.textContent = fmtTime(this.camoTime);
    if (winPct) {
      const pct = this.surviveTime > 0 ? Math.round((this.camoTime / this.surviveTime) * 100) : 0;
      winPct.textContent = `${Math.min(100, pct)}%`;
    }
    if (this._victoryMsg && msg) this._victoryMsg.textContent = msg;
    if (this._victoryEl) this._victoryEl.classList.add('show');
  }

  restartInPlace(nextStage = false, backToMenu = false, serverConfirmed = false) {
    if (this.mode === 'online' && backToMenu) {
      if (this.net) this.net.close();
      const url = new URL(location.href);
      url.searchParams.delete('continue');
      location.href = url.toString();
      return;
    }
    if (this.mode === 'online' && !backToMenu && !serverConfirmed) {
      if (!this._waitingRematch && this.net) {
        this._waitingRematch = true;
        this.net.sendRevive();
        this._setRematchButtons(true);
      }
      return;
    }
    if (nextStage) {
      this.stage++;
    } else if (backToMenu) {
      this.stage = 1;
    }
    sessionStorage.setItem('eom-stage', String(this.stage));

    // Layout/surviveTime/nº de Seekers/dificuldade são todos calculados só
    // no construtor a partir de `this.stage` (linhas ~127-153) — mudar
    // `this.stage` aqui nunca os recalculava. Bug real: "Próximo estágio"
    // incrementava o número no HUD, mas o mapa, o timer e a dificuldade
    // continuavam os do estágio anterior pra sempre (o Chameleon Manor, por
    // exemplo, nunca aparecia jogando normal — só via `?stage=5` direto).
    // Não existe Level.dispose() (reconstruir o nível in-place vazaria
    // memória de GPU), então um reload é o jeito seguro de recalcular tudo
    // do zero lendo `sessionStorage['eom-stage']` — mesmo padrão que
    // main.js:startGame() já usa pra trocar de MODO. Fora do Online: lá o
    // layout é fixo por SALA (server/room.js:_layout), não por estágio —
    // recarregar forçaria reconexão e poderia trocar a sala/o layout no
    // meio de uma sequência de partidas com o mesmo grupo.
    if ((nextStage || backToMenu) && this.mode !== 'online') {
      const url = new URL(location.href);
      url.searchParams.delete('stage'); // senão o reload reaplicaria o valor antigo pra sempre
      if (nextStage) {
        // `continue=1`: main.js clica sozinho no card do modo salvo assim que
        // a página recarrega, senão o jogador cairia de volta no menu
        // principal a cada "Próximo estágio" em vez de continuar direto pro
        // jogo. NÃO usar em backToMenu: "Voltar ao Menu"/"Recomeçar" já
        // mostram a tela principal de propósito (MenuUI.js:284-287) — pular
        // isso e cair direto numa partida nova ignoraria o clique do jogador.
        url.searchParams.set('continue', '1');
      } else {
        url.searchParams.delete('continue');
      }
      location.href = url.toString();
      return;
    }

    if (this._elStage) this._elStage.textContent = String(this.stage);

    this.elapsed = 0;
    this.camoTime = 0;
    this.delayedCamoTime = 0;
    this.scoreHistory = [];
    this.over = false;
    this.won = false;
    this._eliminatedSpectating = false;
    this._lastLobbyCountdownShown = null; // evita flash de texto velho — _onRevive reinicia na hora (sem contagem)
    this._heartTimer = 0;
    this._lastWinTick = -1;

    // Atualiza configurações de munição do Caçador
    const ammoSel = document.getElementById('ammo-select');
    const ammoOpt = ammoSel ? parseInt(ammoSel.value, 10) : 8;
    this.maxWaterAmmo = isNaN(ammoOpt) ? 8 : ammoOpt;
    this.waterAmmo = this.maxWaterAmmo;
    const infCheck = document.getElementById('infinite-ammo-toggle');
    this.infiniteAmmo = infCheck ? infCheck.checked : false;

    this._clearVignette();
    if (this._gameoverEl) this._gameoverEl.classList.remove('show');
    if (this._victoryEl) this._victoryEl.classList.remove('show');
    this._updateWaterAmmoHud();

    // Reset camera orientation and distance
    if (this.follow && this.follow.reset) {
      this.follow.reset();
    }

    // Reset player position and state in memory
    if (this.player && this.player.reset) {
      this.player.reset();
    }

    // Reset seekers positions and AI state in memory
    if (this.seekers) {
      for (const s of this.seekers) {
        if (s.reset) s.reset();
      }
    }

    // Modo online: avisa o servidor que a partida recomeça (room.js:_onRevive) — sem
    // isto, `eliminated`/`_over` ficavam presos em true no servidor pra sempre (só
    // zeravam quando a sala esvaziava), e o avatar do Camaleão eliminado continuava
    // sumido na tela do Caçador na rodada seguinte (RemotePlayer.js funde a escala a
    // zero e sem este aviso nunca soube que devia voltar).
    if (this.mode === 'online' && this.net) {
      for (const rp of this.remotePlayers.values()) {
        rp.eliminated = false;
        rp._fade = 0;
        rp.group.scale.setScalar(1);
      }
      this._updateOnlineHint(); // volta pro texto normal — _eliminatedSpectating já foi zerado acima
      // Mesmo reset do Scanner que o bloco 'hunter' já faz abaixo — o online
      // reusa a mesma UI/estado (ver _tick), então precisa do mesmo cuidado.
      this._scannerActiveUntil = 0;
      this._scannerReadyAt = 0;
      if (this._vignette) this._vignette.classList.remove('scanning');
      if (this._scannerRadar) this._scannerRadar.classList.remove('active');
    }

    // Modo Caçador jogável: replanta os Camaleões-alvo. NÃO zera _hunterViewAttached/
    // _hunterMuzzle aqui — o viewmodel já é filho da câmera (que sobrevive ao restart) e
    // zerar o flag reanexaria uma 2ª arma na câmera a cada reinício (empilhando modelos).
    if (this.mode === 'hunter') {
      this._nextFireAt = 0;
      this._scannerActiveUntil = 0;
      this._scannerReadyAt = 0;
      if (this._vignette) this._vignette.classList.remove('scanning');
      if (this._scannerRadar) this._scannerRadar.classList.remove('active');
      this._spawnHunterTargets();
      this._updateTargetsHud();
    }
    if (this._gameoverMsg) this._gameoverMsg.textContent = this._gameoverMsgDefault;
    if (this._victoryMsg) this._victoryMsg.textContent = this._victoryMsgDefault;

    const menu = document.getElementById('start-overlay');
    if (menu) {
      if (backToMenu) menu.classList.remove('hidden');
      else menu.classList.add('hidden');
    }

    this._updateHud();
  }

  _resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
