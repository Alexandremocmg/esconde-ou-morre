import * as THREE from 'three';
import { buildBody, Gait } from './Character.js?v=3';
import { toonGradient, toonGradientGloss } from './textures.js?v=4';
import { animationManager } from './AnimationManager.js?v=4';
import { TUNE } from './Tuning.js?v=1';
import { createPaintTexture, strokeBetween, clearTexture, raycastAnimatedSkinnedMesh } from './UVPaint.js?v=1';
import { makePaintStroke, MAX_PAINT_STROKES_PER_MSG } from './net/protocol.js?v=6';

const PAINT_THROTTLE_MS = 1000 / 45; // ~45 atualizações de textura por segundo (dentro dos 30-60 alvo)

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0); // amostra/checagem do chão na pose deitada (P3c)

// Parâmetros de tuning
// SCALE reduz o personagem inteiro de forma coerente: as dimensões físicas e os
// offsets visuais derivam dele, então colisão/latching/olhos/cauda encolhem juntos
// (evita o descasamento que object.scale causaria com as constantes de colisão).
const SCALE = 0.8;                  // tamanho do boneco (colisão/latch/olhos derivam daqui)
const RADIUS = 0.45 * SCALE;
const LENGTH = 0.9 * SCALE;         // parte cilíndrica da cápsula
const HALF_EXTENT = RADIUS + LENGTH / 2;
const GROUND_Y = HALF_EXTENT;       // altura do centro quando no chão
// O clipe 'prone' já deita o corpo inteiro sozinho — mas a pose baixa o
// personagem SEM abaixar a raiz (root) do próprio clipe: medido por osso
// (mixamorigHips/Foot/Head), a altura do MUNDO durante 'prone' fica ~0,6-0,66
// mesmo com o offset -GROUND_Y do grupo aplicado (que só é correto pra pose
// EM PÉ, pés em y=0) — por isso "flutua" ~0,6m acima do piso. Compensação
// extra SÓ enquanto prone (ver update()); medido visualmente, não é o osso
// mais baixo exato (deixa uma folga pequena de propósito).
const PRONE_DROP = 0.60;
// Deitado GRUDADO NA PAREDE (leque): a cápsula fica a RADIUS da parede (preciso
// pra colisão), mas o clipe 'prone' não preenche essa distância toda — sobra
// uma folga visível entre o corpo e a superfície. Só o grupo visual é puxado
// pra mais perto (offset em X local, que mapeia pra ±wallNormal quando faceDir
// é tangencial — ver _updateLatched); a física/latch continuam em RADIUS.
// Valor calibrado visualmente (ver memória de verificação); ajustar se o
// clipe 'prone' mudar.
const WALL_PRONE_PULL = 0.13;
// Velocidades NÃO escalam: MOVE_SPEED é o teto de justiça do Caçador
// (PLAYER_GROUND_SPEED em Seeker.js, valor fixo lá — não lê TUNE). Menor +
// mesma velocidade = mais ágil.
// MOVE_SPEED agora vive em TUNE.moveSpeed (Tuning.js) — lido AO VIVO nos
// pontos de uso abaixo, não copiado aqui, pro painel de ajuste (⚙️, ?tune=1)
// poder mudar sem reload. CLIMB_SPEED continua fixo (fora do escopo do
// feedback que motivou o painel — só "corrida"/"giro" foram citados).
const CLIMB_SPEED = 5.5;            // m/s na parede
const GRAVITY = 22.0;
const STEP_UP = 0.30;              // degrau máximo que o jogador sobe andando (escadaria da mansão: ~0.17/degrau)
const LATCH_BTN_REACH = RADIUS + 0.7;       // alcance do botão Grudar (grudar é manual — ver toggleLatch)
const CROUCH_SPEED_MULT = 0.5;              // velocidade ao agachar (trade-off: mais furtivo, mais lento)
const PIN_PROBE = 0.6 * SCALE;      // origem da sonda de re-pin, à frente da superfície
const PIN_RANGE = PIN_PROBE + RADIUS + 0.4 * SCALE; // alcance máx. antes de soltar
// Só superfícies "escaláveis" seguram o jogador: paredes verticais e topos. Uma
// face virada para BAIXO (fundo de móvel, barriga de laje) deixaria o boneco
// pendurado de cabeça para baixo — e a câmera, que fica na direção da normal,
// mergulharia para dentro do piso (tela preta). Ver docs/PLANO_MANSAO.md.
const MIN_LATCH_NY = -0.3;
// Margem de segurança antes da borda REAL (AABB) de uma parede grudável, nas duas
// direções tangenciais (não na normal — essa é a espessura, onde o personagem já
// fica afastado por RADIUS). Dois motivos pra este valor (não só o raio do bisel
// arredondado, ~0.22 no máximo — Level.js:200, `Math.min(0.22, ...)`):
// 1) Sem folga NENHUMA, mover ao longo da parede podia CONTORNAR o bisel da
//    PRÓPRIA caixa (RoundedBoxGeometry) e grudar na face de FORA dela, ejetando o
//    personagem da mansão num canto (bug real).
// 2) Com folga pequena (~0.25), o personagem ainda ficava embutido na espessura da
//    parede PERPENDICULAR (0.6m, `t` em Level.js) antes do canto disparar a busca —
//    a sonda de virar o canto então partia de DENTRO da parede adjacente, achando a
//    face de FORA dela em vez da face de dentro (mesmo sintoma, outra causa).
// 0.7 > espessura de parede (0.6) garante que o personagem para ANTES de sequer
// tocar a parede perpendicular — a sonda de canto (abaixo) sempre parte de espaço
// aberto de verdade.
const EDGE_MARGIN = 0.7;
// TURN_SPEED (suavização de rotação — menor = giro mais suave/lento) agora
// vive em TUNE.turnSpeed (Tuning.js), lido ao vivo em _orientTo — mesmo
// motivo do MOVE_SPEED acima. Usado como taxa em 1 - exp(-TURN_SPEED*dt):
// independente de FPS (tempo até ~95% de convergência = ln(0.05)/-TURN_SPEED).
const COLOR_LERP = 10;              // suavização da troca de cor (camuflagem)
const PUPIL_MAX = 0.075 * SCALE;    // deslocamento máx. da pupila (olhar)
const EYE_LERP = 12;                // suavização do olhar

// Histerese: entra em camuflagem com folga apertada e só sai quando a cor se
// afasta bem mais. Evita o badge/detecção "piscarem" no limiar durante o lerp.
const CAMO_ENTER = 0.07; // diferença máx. por canal para PASSAR a camuflado
const CAMO_EXIT = 0.13;  // diferença por canal para DEIXAR de estar camuflado

// Transferência sRGB (linear → sRGB). THREE.Color guarda valores LINEARES (color
// management ligado desde r152), e o espaço linear COMPRIME os tons escuros: duas
// cores visivelmente diferentes de mansão (couro marrom vs. bordô) ficavam a
// ~0.05 em linear e passavam por camuflagem válida. Comparar no espaço em que o
// jogador VÊ as cores é a métrica correta — e sobe a menor distância da paleta
// da mansão de 0.036 (linear) para 0.161 (sRGB). Ver docs/PLANO_MANSAO.md §1.
function toSRGB(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export class Player {
  constructor(scene, level, opts = {}) {
    this.level = level;
    this.climbables = level.climbables;
    this.state = 'grounded'; // 'grounded' | 'latched'
    this._camo = false;      // estado de camuflagem com histerese
    this._glow = 0;          // relógio do brilho pulsante ao camuflar
    this.crouched = false;   // agachado (o Caçador lê isto p/ reduzir o alcance de visão)
    this._crouchT = 0;       // transição suavizada de agachamento (0..1)
    this.prone = false;      // deitado no chão (P3c): camufla contra o TAPETE embaixo
    this._manualPose = null; // pose escolhida no leque (setPose); sobrevive enquanto
                              // parado — some ao andar/escalar (ver update())

    // Modo Caçador jogável (Game.js): reaproveita a física/câmera do Camaleão
    // para o avatar do Caçador, só trocando a prioridade de animação (pose de
    // tiro) via triggerShootPose(). Não afeta o Camaleão (isHunter fica false).
    this.isHunter = !!opts.isHunter;
    this._shootHold = 0;

    this.velocity = new THREE.Vector3();
    this.wallNormal = new THREE.Vector3(0, 0, 1);
    this.latchedObject = null; // superfície atual (para checagem de camuflagem)
    this._relatchCd = 0;       // tempo (s) de bloqueio de re-latch após soltar

    // Grupo raiz: movemos/rotacionamos isto. Início vem do layout (level.spawn).
    this.object = new THREE.Group();
    const s = level.spawn;
    this.object.position.set(s ? s.x : 0, GROUND_Y, s ? s.z : 6);

    // P1 — ZONAS de cor: o corpo tem 2 zonas independentes — `upper` (cabeça/tronco/
    // braços) e `lower` (pernas) — cada uma com material + pele (CanvasTexture, P2) +
    // alvo de cor próprios. Assim o jogador casa RODAPÉ (lower) e PAREDE (upper) numa
    // tacada só. Base BRANCA na pele → mapa branco × color = cor sólida (a métrica de
    // camuflagem por color segue honesta). `y` = altura local da zona (âncora dos
    // raycasts de amostra/checagem).
    const H = HALF_EXTENT * 2; // altura total = extensão vertical da cápsula de colisão
    const BASE = 0xeef0f2;     // branco art toy (a camuflagem tinge por cima)
    const makeZone = (name, y) => {
      const skin = document.createElement('canvas');
      skin.width = skin.height = 128;
      const skinCtx = skin.getContext('2d');
      skinCtx.fillStyle = '#fff'; skinCtx.fillRect(0, 0, 128, 128);
      const skinTex = new THREE.CanvasTexture(skin);
      skinTex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshToonMaterial({ color: BASE, gradientMap: toonGradient(), map: skinTex });
      return { name, y, mat, target: new THREE.Color(BASE), skin, skinCtx, skinTex };
    };
    this.zones = [makeZone('upper', 0.12 * H), makeZone('lower', -0.30 * H)];

    let kind = 'toy';
    try { kind = sessionStorage.getItem('eom-body') || 'toy'; } catch (_) {}
    const toy = buildBody({ upper: this.zones[0].mat, lower: this.zones[1].mat }, H, { kind });
    this.toy = toy;
    this.animInstance = null;
    this.playerHeight = H;

    this.object.add(toy.group);

    // Fase 5: textura do pincel livre nasce sob demanda (ver ensurePaintTexture,
    // chamado por Game.js na primeira abertura do painel) — a maioria dos
    // Camaleões nunca abre o pincel, então não paga o custo do canvas 512² à toa.
    this.paintTexture = null;
    this._lastPaintUV = null;
    this._lastPaintUpdate = 0;
    // Fase 4 (rede): comandos de traço acumulados localmente desde o último
    // flushPaintNetBuffer() — ver esse método e Game.js (_flushAndSendPaint,
    // enviado automaticamente, sem botão).
    this._paintNetBuffer = [];

    if (animationManager.isLoaded) {
      const inst = animationManager.createInstance({ upper: this.zones[0].mat, lower: this.zones[1].mat }, H);
      if (inst) {
        toy.group.visible = false;
        // Desloca o modelo FBX para baixo de modo que os pés (y=0 no espaço FBX)
        // coincidam com o chão quando o object do jogador está em GROUND_Y.
        inst.group.position.y = -GROUND_Y;
        this.object.add(inst.group);
        this.animInstance = inst;
        if (this.paintTexture) inst.setPaintTexture(this.paintTexture.texture);
      }
    } else {
      this._checkAnimInstance();
    }

    // Caminhada procedural: pernas/braços balançam e o corpo bobeia/inclina,
    // sincronizados com a distância percorrida (ver Gait em Character.js).
    this.gait = new Gait(toy.rig, { strideLen: H * 0.85 });
    this._prevPos = this.object.position.clone();

    // Olhos sutis na face frontal da cabeça (local +Z): dois pontinhos escuros que
    // deslizam na direção do joystick — dão vida e uma dica de direção, mantendo o
    // ar minimalista do brinquedo. Vão no tronco (`upper`) p/ acompanharem o bob.
    const EYE_X = toy.headR * 0.40;
    const EYE_Y = toy.headY + toy.headR * 0.08;
    const EYE_Z = toy.headR * 0.86;
    const pupilMat = new THREE.MeshToonMaterial({ color: 0x14181d, gradientMap: toonGradient() });
    this._pupils = [];
    this._pupilOffset = { x: 0, y: 0 }; // deslocamento suavizado (local X/Y)
    this._eyeHide = 0;                   // 0..1: quanto as pupilas estão escondidas (P3a)
    for (const sx of [-1, 1]) {
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(toy.headR * 0.16, 14, 10), pupilMat);
      pupil.userData.base = new THREE.Vector3(sx * EYE_X, EYE_Y, EYE_Z);
      pupil.position.copy(pupil.userData.base);
      pupil.scale.z = 0.6; // achata contra a cabeça
      toy.rig.upper.add(pupil);
      this._pupils.push(pupil);
    }
    this._t = 0; // relógio p/ articulação dos olhos

    scene.add(this.object);

    // reutilizáveis (evita alocação no loop)
    this._raycaster = new THREE.Raycaster();
    this._tmpDir = new THREE.Vector3();
    this._tmpV = new THREE.Vector3();
    this._tmpMat = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._axX = new THREE.Vector3();
    this._axY = new THREE.Vector3();
    this._axZ = new THREE.Vector3();
    // Amostragem por pixel (Plano 5, Fase 1): cor reutilizável (evita alocar um
    // THREE.Color por raycast) + cache de isCamouflaged() por frame — com até 4
    // Seekers no Chameleon Manor chamando isCamouflaged() no mesmo frame, calcular
    // 1x e reaproveitar evita 4x o trabalho (raycast + amostragem de pixel) por tick.
    this._pixelColorTmp = new THREE.Color();
    this._frameTick = 0;
    this._camoFrame = -1;
    this._camoValue = false;
    // Extensão REAL (AABB) da parede atualmente grudada — cacheada por objeto, só
    // recalculada quando `latchedObject` muda (ver _updateLatched). Usada pra travar
    // o personagem antes do BISEL arredondado da própria caixa (RoundedBoxGeometry).
    this._latchedBounds = new THREE.Box3();
    this._latchedBoundsObj = null;
  }

  reset() {
    this.state = 'grounded';
    this.prone = false;
    this.crouched = false;
    this.statue = false;
    this._manualPose = null;
    this.isJumping = false;
    this.latchedObject = null;
    this.object.position.set(0, GROUND_Y, 6);
    this.object.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this._camo = false;
    this._eyeHide = 0;
    this._glow = 0;
    this._shootHold = 0;
    const BASE = 0xeef0f2;
    for (const z of this.zones) {
      z.mat.color.setHex(BASE);
      z.target.setHex(BASE);
      this._clearZone(z);
    }
  }

  // Lava a tinta do corpo do jogador com o jato de água do Caçador.
  // Retorna a proporção de tinta restante (0..1).
  washPaint(dt) {
    const BASE_COLOR = new THREE.Color(0xeef0f2);
    const speed = Math.min(1, 2.0 * dt);
    let totalDist = 0;
    for (const z of this.zones) {
      z.mat.color.lerp(BASE_COLOR, speed);
      z.target.lerp(BASE_COLOR, speed);
      // THREE.Color não tem distanceTo — calcula manualmente com deltas RGB
      const dr = z.mat.color.r - BASE_COLOR.r;
      const dg = z.mat.color.g - BASE_COLOR.g;
      const db = z.mat.color.b - BASE_COLOR.b;
      totalDist += Math.sqrt(dr * dr + dg * dg + db * db);
    }
    // Normaliza: distância máxima possível no espaço RGB = sqrt(3) ≈ 1.73
    return totalDist / (this.zones.length * 1.732);
  }

  // Chamado pelo Game a cada disparo do Caçador jogável: segura a pose de tiro
  // por um instante (mesma ideia do Seeker._shootHold, ver Seeker.js).
  triggerShootPose(dur = 0.35) {
    this._shootHold = dur;
  }

  get position() { return this.object.position; }

  // Compat: alguns lugares (HUD, roda de cor) leem a zona primária (upper).
  get material() { return this.zones[0].mat; }
  get targetColor() { return this.zones[0].target; }

  // Direção de escalada (para cima na parede) — usada pela câmera.
  get climbUp() {
    return this._tangentUp(this.wallNormal, this._axY);
  }

  // Aplica uma cor SÓLIDA em TODAS as zonas e limpa as estampas (P2)
  setCamouflage(color) {
    for (const z of this.zones) { z.target.copy(color); this._clearZone(z); }
    if (color && color.getHexString) this._saveColorHistory(color.getHexString());
  }

  // Amostragem Rápida (Quick Match): amostra a cor da superfície em frente ou abaixo
  sampleQuickMatch(camera) {
    let sampledColor = null;
    if (camera) {
      this._raycaster.setFromCamera({ x: 0, y: 0 }, camera);
      this._raycaster.far = 15;
      const hits = this._raycaster.intersectObjects(this.level.colorables, false);
      if (hits.length > 0) {
        sampledColor = this._pixelColorAt(hits[0]) || (hits[0].object.material ? hits[0].object.material.color : null);
      }
    }

    if (!sampledColor) {
      const floor = this._surfaceBelowColor();
      if (floor) sampledColor = floor;
    }

    if (sampledColor) {
      this.setCamouflage(sampledColor);
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {}
      return true;
    }
    return false;
  }

  _saveColorHistory(hexStr) {
    try {
      let hist = JSON.parse(sessionStorage.getItem('eom-color-history') || '[]');
      const fullHex = '#' + hexStr.toLowerCase();
      hist = hist.filter(c => c !== fullHex);
      hist.unshift(fullHex);
      if (hist.length > 4) hist = hist.slice(0, 4);
      sessionStorage.setItem('eom-color-history', JSON.stringify(hist));
      this._updateUIHistoryChips(hist);
    } catch (_) {}
  }

  _updateUIHistoryChips(hist) {
    const container = document.getElementById('paint-history-chips');
    if (!container) return;
    const chips = container.querySelectorAll('.p-chip');
    hist.forEach((colorHex, idx) => {
      if (chips[idx]) {
        chips[idx].style.background = colorHex;
        chips[idx].dataset.color = colorHex;
      }
    });
  }

  // roughness/metalness são inertes no MeshToonMaterial (sem PBR, o
  // sombreamento vem só do gradientMap cel) — escrever neles não muda nada
  // na tela, e o boneco PRIMITIVO (dono das zonas) fica invisível assim que
  // o GLB anima. Efeito de verdade: trocar o LUT do cel shading (mais banda
  // = highlight concentrado, lê como brilhante) nas zonas E no personagem
  // animado — ver textures.js (toonGradientGloss) e AnimationManager.js
  // (setGradientMap).
  setFinish(finish) {
    const isGloss = finish === 'gloss';
    const tex = isGloss ? toonGradientGloss() : toonGradient();
    for (const z of this.zones) {
      z.mat.gradientMap = tex;
      z.mat.needsUpdate = true;
    }
    if (this.animInstance) this.animInstance.setGradientMap(tex);
  }

  setPose(poseName) {
    this.statue = (poseName === 'lock');
    if (this.statue) {
      this.prone = false;
      this.crouched = false;
      if (navigator.vibrate) try { navigator.vibrate(20); } catch (_) {}
      return;
    }

    if (poseName === 'prone') {
      // No chão: this.prone=true faz update() rotear pra _updateProne e tocar
      // o clipe 'prone' (que já É uma pose deitada de corpo inteiro — não
      // precisa de tombo/rotação extra por cima, ver docs/PLANO_PARIDADE.md).
      // Grudado na parede: NÃO mexer em prone/state — setar this.prone=true
      // aqui faria update() rotear pra _updateProne (que nunca chama
      // _orientTo/re-pin da parede) em vez de _updateLatched, e o jogador
      // travava, preso, sem o joystick conseguir soltar dali (bug real
      // verificado no deployment de produção, commit bad75ce). O clipe
      // 'prone' toca do mesmo jeito via _manualPose logo abaixo — a física
      // de escalada continua rodando normal, e o personagem sai da pose
      // sozinho ao voltar a mexer o joystick.
      if (this.state === 'grounded') { this.prone = true; this.crouched = false; }
    } else if (poseName === 'crouch') {
      this.crouched = true;
      this.prone = false;
    } else if (poseName === 'hide' || poseName === 'climb') {
      this.prone = false;
      this.crouched = false;
    } else {
      this.prone = false;
      this.crouched = false;
    }

    // Guarda a escolha: update() a respeita enquanto o jogador ficar parado
    // (inclusive grudado na parede, onde o automático sempre tocaria climb/hide)
    // — some sozinha assim que ele volta a se mover.
    this._manualPose = poseName;

    if (this.animInstance && this.animInstance.actions[poseName]) {
      this.animInstance.playAnimation(poseName);
    }
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
  }

  // Pinta a pele de UMA zona de branco (mapa branco × color = cor sólida).
  _clearZone(z) {
    z.skinCtx.fillStyle = '#fff';
    z.skinCtx.fillRect(0, 0, z.skin.width, z.skin.height);
    z.skinTex.needsUpdate = true;
  }

  // Carimba a estampa de uma superfície na pele de UMA zona. `map` é o Texture da
  // superfície (seu `.image` é o canvas do padrão). Sem map → pele branca (sólida).
  _stampZone(z, map) {
    const img = map && map.image;
    z.skinCtx.fillStyle = '#fff';
    z.skinCtx.fillRect(0, 0, z.skin.width, z.skin.height);
    if (img) { try { z.skinCtx.drawImage(img, 0, 0, z.skin.width, z.skin.height); } catch (_) { /* ok */ } }
    z.skinTex.needsUpdate = true;
  }

  // Amostra a cor de um pixel EXATO de uma superfície com padrão procedural
  // (Level.js: userData.pixelColorable) — em vez da cor média/sólida de
  // material.color. `hit.uv` é o ponto exato do raycast em espaço UV local;
  // pixelSource.repeatX/Y reflete o MESMO repeat que a textura usa nesse mesh
  // específico (superfícies grandes tileiam o padrão — sem isso a amostra
  // pegaria sempre o pixel (0,0) do padrão-base, ignorando a repetição real).
  // Cache de pixels montado 1x em Level.js na criação do objeto — nunca por
  // frame: getImageData() do canvas inteiro seria caro demais pra chamar a
  // cada raycast.
  // Retorna um THREE.Color REUTILIZADO (não clone) — leia o valor imediatamente,
  // não guarde a referência entre frames (mesmo cuidado que outros _tmp* daqui).
  _pixelColorAt(hit) {
    const obj = hit.object;
    const src = obj.userData.pixelColorable ? obj.userData.pixelSource : null;
    if (!src || !hit.uv) return null;
    let u = (hit.uv.x * src.repeatX) % 1; if (u < 0) u += 1;
    let v = (hit.uv.y * src.repeatY) % 1; if (v < 0) v += 1;
    const px = Math.min(src.width - 1, Math.max(0, Math.floor(u * src.width)));
    // Flip de V: UV cresce pra cima, canvas cresce pra baixo — mesma fórmula
    // já usada em UVPaint.js/paintAtScreenPoint pra essa conversão.
    const py = Math.min(src.height - 1, Math.max(0, Math.floor((1 - v) * src.height)));
    const i = (py * src.width + px) * 4;
    // getImageData devolve bytes sRGB; THREE.Color guarda LINEAR (ver toSRGB
    // acima) — sem esta conversão, a cor amostrada ficaria sistematicamente
    // "clara/lavada" comparada a uma cor de material.color equivalente.
    return this._pixelColorTmp
      .setRGB(src.data[i] / 255, src.data[i + 1] / 255, src.data[i + 2] / 255)
      .convertSRGBToLinear();
  }

  // Camuflado quando TODAS as zonas batem com a superfície correspondente:
  //  • grudado (P1): cada zona vs. a superfície ATRÁS dela (rodapé/parede);
  //  • deitado (P3c): todas as zonas vs. o TAPETE embaixo ("virar tapete").
  // Camuflado = pior zona dentro do limiar. sRGB (toSRGB) + histerese (_camo).
  // Cacheado por frame (_frameTick, incrementado 1x no início de update()):
  // até 4 Seekers (Chameleon Manor) podem chamar isto no mesmo tick — computar
  // 1x e reaproveitar evita recalcular o mesmo raycast+amostragem 4x.
  isCamouflaged() {
    if (this._camoFrame === this._frameTick) return this._camoValue;
    this._camoFrame = this._frameTick;
    return (this._camoValue = this._computeCamouflaged());
  }

  _computeCamouflaged() {
    let surfFor;
    if (this.prone) {
      const floor = this._surfaceBelowColor();
      if (!floor) { this._camo = false; this._camoReason = 'surface'; return false; } // fora de tapete → exposto
      surfFor = () => floor;
    } else if (this.state === 'latched' && this.latchedObject) {
      surfFor = (z) => this._surfaceBehindZone(z);
    } else {
      this._camo = false; this._camoReason = 'support'; return false;
    }
    let maxDiff = 0;
    for (const z of this.zones) {
      const surf = surfFor(z);
      if (!surf) { this._camo = false; this._camoReason = 'surface'; return false; }
      const c = z.mat.color;
      const d = Math.max(
        Math.abs(toSRGB(c.r) - toSRGB(surf.r)),
        Math.abs(toSRGB(c.g) - toSRGB(surf.g)),
        Math.abs(toSRGB(c.b) - toSRGB(surf.b))
      );
      if (d > maxDiff) maxDiff = d;
    }
    if (this._camo) {
      if (maxDiff > CAMO_EXIT) { this._camo = false; this._camoReason = 'color'; }
    } else if (maxDiff < CAMO_ENTER) {
      this._camo = true; this._camoReason = 'ok';
    } else {
      this._camoReason = 'color';
    }
    return this._camo;
  }

  getCamouflageReason() {
    this.isCamouflaged();
    return this._camoReason || 'support';
  }

  // Cor da superfície colorável logo ATRÁS de uma zona (raycast −normal a partir da
  // âncora). Fallback: a própria superfície grudada. Habilita o bi-tom.
  _surfaceBehindZone(z) {
    const origin = this._zoneAnchor(z, this._tmpV);
    const back = this._axZ.copy(this.wallNormal).multiplyScalar(-1);
    this._raycaster.set(origin, back);
    this._raycaster.far = RADIUS + 0.6;
    const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
    if (hit) {
      const pixel = this._pixelColorAt(hit);
      if (pixel) return pixel;
      if (hit.object.material) return hit.object.material.color;
    }
    return this.latchedObject.material ? this.latchedObject.material.color : null;
  }

  // Ponto de mundo na altura local de uma zona (âncora dos raycasts). Respeita a
  // orientação atual (grudado: sobe/desce ao longo da parede).
  _zoneAnchor(z, out) {
    this.object.updateWorldMatrix(true, false);
    return this.object.localToWorld(out.set(0, z.y, 0));
  }

  _checkAnimInstance() {
    if (this.animInstance || !animationManager.isLoaded) return;
    const inst = animationManager.createInstance({ upper: this.zones[0].mat, lower: this.zones[1].mat }, this.playerHeight);
    if (inst) {
      if (this.toy && this.toy.group) {
        this.object.remove(this.toy.group);
      }
      // Desloca o modelo FBX para baixo de modo que os pés (y=0 no espaço FBX)
      // coincidam com o chão quando o object do jogador está em GROUND_Y.
      inst.group.position.y = -GROUND_Y;
      this.object.add(inst.group);
      this.animInstance = inst;
      if (this.paintTexture) inst.setPaintTexture(this.paintTexture.texture);
    }
  }

  // Fase 5: cria a textura do pincel livre na primeira abertura do painel
  // (Game.js, clique em #btn-brush) em vez de sempre no construtor — a
  // maioria dos Camaleões nunca pinta. Como isto pode acontecer DEPOIS do
  // GLB já ter carregado (diferente da Fase 1, que criava tudo no
  // construtor antes de qualquer coisa), aplica na animInstance na hora em
  // vez de confiar em _checkAnimInstance (que só roda essa ligação na
  // CRIAÇÃO da instância, não depois).
  ensurePaintTexture() {
    if (!this.paintTexture) {
      this.paintTexture = createPaintTexture();
      if (this.animInstance) this.animInstance.setPaintTexture(this.paintTexture.texture);
    }
    return this.paintTexture;
  }

  // Pincel livre: raycast da câmera através de um ponto de
  // tela (clientX/Y) contra a MALHA DO PRÓPRIO PERSONAGEM — equivalente ao
  // "Raycast da câmera até o Collider do avatar" da spec original, só que em
  // Three.js o resultado da interseção já vem com `.uv` prontinho (não
  // precisa de nenhuma conversão extra tipo o Hit.TextureCoordinate do
  // Unreal). `down` marca o início de um traço nesse toque específico —
  // sem isso o primeiro carimbo de cada novo traço tentaria interpolar a
  // partir do último ponto do traço ANTERIOR (rabisco fantasma ligando os
  // dois toques).
  paintAtScreenPoint(camera, renderer, clientX, clientY, { down = false, colorHex = '#2ec4b6', radiusPx = 22 } = {}) {
    if (!this.paintTexture || !this.animInstance || !this.animInstance.skinnedMesh) return false;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);

    // Descarte barato antes do raycast manual (pesado — percorre os ~12k
    // triângulos, ver UVPaint.js): esfera aproximada do personagem, centrada
    // em this.position (já é o centro vertical da cápsula — GROUND_Y é a
    // metade da altura, ver HALF_EXTENT), raio maior que HALF_EXTENT pra
    // cobrir braços erguidos/pose animada sem folga excessiva.
    const centro = this._tmpV.copy(this.position);
    if (this._raycaster.ray.distanceSqToPoint(centro) > (HALF_EXTENT * 1.6) ** 2) {
      this._lastPaintUV = null;
      return false;
    }

    const hit = raycastAnimatedSkinnedMesh(this._raycaster, this.animInstance.skinnedMesh);
    if (!hit) { this._lastPaintUV = null; return false; }

    const { ctx, texture } = this.paintTexture;
    if (down || !this._lastPaintUV) {
      if (down) this.paintUndoPush();
      ctx.fillStyle = colorHex;
      ctx.beginPath();
      ctx.arc(hit.uv.x * ctx.canvas.width, (1 - hit.uv.y) * ctx.canvas.height, radiusPx, 0, Math.PI * 2);
      ctx.fill();
    } else {
      strokeBetween(ctx, this._lastPaintUV, hit.uv, colorHex, radiusPx);
    }
    this._lastPaintUV = hit.uv.clone();

    // Fase 4 (rede): acumula o comando LOCALMENTE — nada é mandado ainda,
    // isso só acontece no flush (ver flushPaintNetBuffer). Corta pela frente
    // (mais antigo primeiro) se passar do teto de validação do servidor —
    // uma sessão de pintura longa perder o INÍCIO é bem menos ruim do que
    // travar o flush por estourar o limite.
    this._paintNetBuffer.push(makePaintStroke({
      down, uv: hit.uv, colorHex, radiusFrac: radiusPx / ctx.canvas.width,
    }));
    if (this._paintNetBuffer.length > MAX_PAINT_STROKES_PER_MSG) {
      this._paintNetBuffer.splice(0, this._paintNetBuffer.length - MAX_PAINT_STROKES_PER_MSG);
    }

    // Throttle (30-60/s, ver PAINT_THROTTLE_MS): o carimbo no canvas 2D
    // acontece toda vez, só o upload da textura pra GPU (needsUpdate) é que
    // fica limitado — é o `texture.needsUpdate=true` que é caro, não o
    // `ctx.arc`/`fill` em si.
    const now = performance.now();
    if (now - this._lastPaintUpdate >= PAINT_THROTTLE_MS) {
      texture.needsUpdate = true;
      this._lastPaintUpdate = now;
    }
    return true;
  }

  paintStrokeEnd() {
    this._lastPaintUV = null;
  }

  paintClear() {
    if (!this.paintTexture) return;
    clearTexture(this.paintTexture.ctx);
    this.paintTexture.texture.needsUpdate = true;
    this._paintUndoStack = [];
  }

  // Fase 4 (rede) — devolve e ESVAZIA o buffer acumulado desde o último
  // flush. Quem chama (Game.js) decide o que fazer com o resultado (mandar
  // por net.sendPaintStrokes se estiver em modo Online; fora dele, o buffer
  // só fica se acumulando sem uso — sem custo real, é só um array).
  flushPaintNetBuffer() {
    const strokes = this._paintNetBuffer;
    this._paintNetBuffer = [];
    return strokes;
  }

  // Pilha de Undo do pincel: um snapshot (ImageData) por traço, empurrado no
  // início (down:true) de cada um. Deliberadamente simples (pixels, não vetor
  // de comandos) porque é só desfazer local — a Fase 4 (rede) manda uma
  // LISTA de comandos, não pixels, então essa pilha não precisa (e não deve)
  // virar a fonte de verdade.
  paintUndoPush() {
    if (!this.paintTexture) return;
    const { ctx, canvas } = this.paintTexture;
    if (!this._paintUndoStack) this._paintUndoStack = [];
    this._paintUndoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (this._paintUndoStack.length > 20) this._paintUndoStack.shift();
  }

  paintUndo() {
    if (!this.paintTexture || !this._paintUndoStack || !this._paintUndoStack.length) return false;
    const snapshot = this._paintUndoStack.pop();
    this.paintTexture.ctx.putImageData(snapshot, 0, 0);
    this.paintTexture.texture.needsUpdate = true;
    this._lastPaintUV = null;
    return true;
  }

  setXray(enabled) {
    if (this.animInstance && this.animInstance.setXray) this.animInstance.setXray(enabled);
  }

  // Canal emissivo do pincel livre. `intensity` em 0..1; `colorHex`
  // normalmente é a cor de pincel selecionada no painel.
  setEmissive(colorHex, intensity) {
    if (!this.animInstance || !this.animInstance.setEmissive) return;
    this._tmpEmissive = this._tmpEmissive || new THREE.Color();
    this._tmpEmissive.set(colorHex);
    this.animInstance.setEmissive(this._tmpEmissive, intensity);
  }

  // Conta-gotas do painel de teste (Fase 2): SÓ extrai a cor renderizada da
  // superfície mirada — ao contrário de `sampleColor`/`_stampZone` (a
  // camuflagem de verdade), não copia a imagem da textura da superfície pra
  // lugar nenhum nem mexe nas zonas de camuflagem. Bate com a intenção da
  // spec original: exigir a habilidade de pintura do jogador, não deixar
  // copiar um padrão pronto.
  sampleEnvironmentColor(camera) {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    this._raycaster.far = 15;
    const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
    if (!hit || !hit.object.material || !hit.object.material.color) return null;
    return '#' + hit.object.material.color.getHexString();
  }

  update(dt, joy, camera) {
    this._checkAnimInstance();
    this._frameTick++; // invalida o cache de isCamouflaged() deste frame (ver isCamouflaged)

    if (this.prone) this._updateProne(dt, joy);
    else if (this.state === 'grounded') this._updateGrounded(dt, joy, camera);
    else this._updateLatched(dt, joy);

    this._animateFace(dt, joy);

    // Lerp de cor da camuflagem — por zona (P1).
    const k = Math.min(1, COLOR_LERP * dt);
    for (const z of this.zones) z.mat.color.lerp(z.target, k);

    // Brilho pulsante quando totalmente camuflado (feedback de sucesso): cada zona
    // emite na própria cor do disfarce, então só "reluz" sem mudar o tom.
    const camo = this.isCamouflaged();
    if (camo) {
      this._glow += dt;
      const gi = 0.16 + 0.12 * Math.sin(this._glow * 6);
      for (const z of this.zones) { z.mat.emissive.copy(z.mat.color); z.mat.emissiveIntensity = gi; }
    } else {
      for (const z of this.zones) z.mat.emissiveIntensity = 0;
      this._glow = 0;
    }

    // P3a: pupilas SOMEM ao camuflar (os olhos pretos denunciariam o disfarce).
    // Escala suavizada → 0; volta ao normal (z achatado 0.6) ao sair da camuflagem.
    this._eyeHide += ((camo ? 1 : 0) - this._eyeHide) * Math.min(1, 8 * dt);
    const es = 1 - this._eyeHide;
    for (const p of this._pupils) p.scale.set(es, es, 0.6 * es);

    // Caminhada: a fase avança pela distância REAL percorrida (chão ou parede),
    // ignorando saltos de latch/teleporte para não disparar um passo fantasma.
    let dist = this.object.position.distanceTo(this._prevPos);
    dist = Math.min(dist, TUNE.moveSpeed * dt * 1.6);
    this._prevPos.copy(this.object.position);
    // Quão perto da velocidade máxima o jogador está DE VERDADE neste frame
    // (0..1) — usado abaixo pra escalar o timeScale do clipe de corrida/escalada,
    // senão as pernas animam na cadência cheia mesmo com o corpo mal saindo do
    // lugar (bug real: "corre e parece que não sai do lugar", joystick em
    // deflexão parcial). Base em DISTÂNCIA REAL percorrida, não no
    // speedScale "pretendido" de _updateGrounded — assim também reage certo
    // se colisão contra parede reduzir o deslocamento de verdade.
    const speedRatio = Math.min(1, dist / Math.max(1e-6, TUNE.moveSpeed * dt));

    if (this.animInstance) {
      const moving = dist > 1e-3;
      // Caçador jogável: pose de tiro tem prioridade por uma janela curta após
      // o disparo (Game.fireHunterShot → triggerShootPose). No Camaleão,
      // isHunter é sempre false e este ramo nunca entra — zero mudança de
      // comportamento fora do modo Caçador.
      this._shootHold = Math.max(0, this._shootHold - dt);
      // Pose manual (leque) cancela sozinha ao andar/escalar — sem isto o
      // jogador ficaria "preso" na última pose escolhida mesmo se movimento.
      if (moving) this._manualPose = null;
      // Congela a pose atual (mixer.update(0), não avança o clipe) em vez de
      // trocar de animação — usado só pro caso "grudado e parado" abaixo, pra
      // parar exatamente no gesto de escalar em vez de tocar 'hide' (que lia
      // como "deitado"). NÃO usar action.paused=true aqui: o mixer para de
      // reescrever os ossos e o próximo playAnimation() mistura sobre um
      // resultado congelado — some da câmera some, mas o pulo de pose "salta"
      // (ver docs/PIPELINE_PERSONAGEM.md / memória player-glb-model).
      let freeze = false;

      if (this.isHunter && this._shootHold > 0 && this.animInstance.actions['shoot']) {
        this.animInstance.playAnimation('shoot');
      } else if (this.isJumping || this.velocity.y > 0.5) {
        this.animInstance.playAnimation('jump');
      } else if (this._manualPose && this.animInstance.actions[this._manualPose]) {
        // Grudado na parede e parado, o automático (linha abaixo) sempre tocaria
        // climb — checar isto ANTES é o que faz a pose do leque "grudar".
        this.animInstance.playAnimation(this._manualPose);
      } else if (this.state === 'latched') {
        // Sempre o clipe de escalada — parado, só CONGELA o quadro em vez de
        // trocar pra 'hide' (a descida em Y embutida nesse clipe lia como o
        // personagem deitando contra a parede).
        this.animInstance.playAnimation('climb');
        freeze = !moving;
        // Movendo na parede: mesma correção de timeScale do 'run' abaixo —
        // sem isto as mãos "escalam" na cadência cheia mesmo deslizando devagar.
        if (moving && this.animInstance.actions.climb) {
          this.animInstance.actions.climb.timeScale = Math.max(0.15, speedRatio);
        }
      } else if (this.prone) {
        this.animInstance.playAnimation('prone');
      } else if (this.crouched) {
        this.animInstance.playAnimation('crouch');
      } else if (moving) {
        const runClip = this.isHunter && this.animInstance.actions['rifleRun'] ? 'rifleRun' : 'run';
        this.animInstance.playAnimation(runClip);
        // Bug real corrigido: o clipe sempre tocava na cadência cheia (timeScale
        // 1 implícito) mesmo com o corpo mal se deslocando em deflexão parcial
        // do joystick — lia como "correndo sem sair do lugar". Piso de 0.15 pra
        // não virar uma pose quase congelada bem no limite da deadzone.
        const runAction = this.animInstance.actions[runClip];
        if (runAction) runAction.timeScale = Math.max(0.15, speedRatio);
      } else {
        this.animInstance.playAnimation('idle');
      }
      this.animInstance.setColor(this.zones[0].mat.color);
      this.animInstance.update(freeze ? 0 : dt);
      // Deitado no chão: baixa o grupo visual extra (PRONE_DROP, ver acima) pra
      // compensar a raiz do clipe 'prone' — sem isto o personagem fica flutuando
      // no ar. Reescrito todo frame (idempotente); volta ao offset normal assim
      // que sai de prone.
      const wallFlat = this.state === 'latched' && this._manualPose === 'prone';
      this.animInstance.group.position.y = this.prone ? -GROUND_Y - PRONE_DROP : -GROUND_Y;
      // Deitado grudado na parede: puxa o grupo visual em X local pra reduzir a
      // folga entre o corpo e a superfície (ver WALL_PRONE_PULL acima).
      this.animInstance.group.position.x = wallFlat ? WALL_PRONE_PULL : 0;
    } else {
      this.gait.update(dt, dist);
      this._crouchT += ((this.crouched ? 1 : 0) - this._crouchT) * Math.min(1, 10 * dt);
      this.gait.crouch = this._crouchT;
    }
  }

  // Articulação da face: as pupilas deslizam na direção do joystick, dando vida
  // ao boneco mesmo parado ou grudado.
  _animateFace(dt, joy) {
    this._t += dt;

    const tx = THREE.MathUtils.clamp(joy.x, -1, 1) * PUPIL_MAX;
    const ty = THREE.MathUtils.clamp(joy.y, -1, 1) * PUPIL_MAX;
    const k = Math.min(1, EYE_LERP * dt);
    this._pupilOffset.x += (tx - this._pupilOffset.x) * k;
    this._pupilOffset.y += (ty - this._pupilOffset.y) * k;
    for (const p of this._pupils) {
      p.position.x = p.userData.base.x + this._pupilOffset.x;
      p.position.y = p.userData.base.y + this._pupilOffset.y;
    }
  }

  // ---------------------------------------------------------------- GROUNDED
  _updateGrounded(dt, joy, camera) {
    // Direção de movimento relativa à câmera, projetada no plano XZ.
    const fwd = camera.getWorldDirection(this._tmpDir).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = this._axX.copy(fwd).cross(WORLD_UP).normalize();

    const move = this._axZ.set(0, 0, 0)
      .addScaledVector(right, joy.x)
      .addScaledVector(fwd, joy.y);
    // Magnitude ANTES de normalizar: Joystick.js já entrega deadzone+curva
    // aplicadas em joy.x/y, então rawLen (0..1) É o controle analógico de
    // velocidade — antes disso a direção sempre virava corrida máxima, sem
    // microajuste fino possível perto de quinas.
    const rawLen = move.length();
    const moving = rawLen > 1e-4;
    const speedScale = moving ? Math.min(1, rawLen) : 0;
    if (moving) move.normalize();

    // Cooldown de re-latch: após soltar da parede, deixa o cd correr (usado só
    // para o auto-detach ao descer; grudar agora é manual — ver toggleLatch).
    if (this._relatchCd > 0) this._relatchCd -= dt;

    // Movimento horizontal (grudar NÃO é mais automático: andar rente à parede
    // não cola mais; use o botão Grudar). Agachado anda mais devagar.
    const speed = TUNE.moveSpeed * (this.crouched ? CROUCH_SPEED_MULT : 1) * speedScale;
    if (moving) this.position.addScaledVector(move, speed * dt);

    // Colisão horizontal: empurra a cápsula para fora das paredes/móveis e desliza
    // ao longo delas (antes, era o auto-latch que impedia atravessar a parede).
    this._resolveHorizontal();

    // Gravidade + colisão de topo AABB (chão e topo de blocos)
    this._resolveVertical(dt);

    // Orienta a cápsula para a direção do movimento (Y do mundo = "cima").
    if (moving) {
      this._orientTo(WORLD_UP, move, dt);
    }
  }

  // ----------------------------------------------------------------- LATCHED
  _updateLatched(dt, joy) {
    const N = this.wallNormal;                 // normal da parede (para fora)
    const up = this._tangentUp(N, this._axY);  // "cima" ao longo da parede
    const side = this._axX.copy(up).cross(N).normalize(); // "direita" na parede

    // AABB real da parede atual, cacheada por objeto (só recalcula ao trocar de
    // parede) — usada abaixo pra travar ANTES do bisel arredondado da própria caixa.
    if (this.latchedObject && this._latchedBoundsObj !== this.latchedObject) {
      this._latchedBounds.setFromObject(this.latchedObject);
      this._latchedBoundsObj = this.latchedObject;
    }
    const boundsValid = this._latchedBoundsObj === this.latchedObject;

    // Move no plano da parede
    const move = this._axZ.set(0, 0, 0)
      .addScaledVector(side, joy.x)
      .addScaledVector(up, joy.y);
    const rawLen = move.length(); // mesmo controle analógico de _updateGrounded — ajuda a
    let hitEdge = false;
    if (rawLen > 1e-4) {          // travar poses de camuflagem/posicionar rente a quinas na parede
      const speedScale = Math.min(1, rawLen);
      move.normalize();
      this.position.addScaledVector(move, CLIMB_SPEED * speedScale * dt);

      // Trava nas duas direções TANGENCIAIS (não na normal — essa é a espessura da
      // parede, onde o personagem já fica afastado por RADIUS, não pela AABB dela)
      // antes de alcançar o bisel arredondado da própria caixa (RoundedBoxGeometry,
      // Level.js). Sem isto, mover ao longo da parede podia CONTORNAR o bisel da
      // MESMA caixa e grudar na face de FORA dela — ejetando o personagem da mansão
      // num canto mesmo sem a sonda de re-pin nunca "falhar" de verdade (bug real:
      // a normal só ia mudando aos poucos, de dentro pra fora da MESMA parede).
      if (boundsValid) {
        const b = this._latchedBounds;
        for (const ax of ['x', 'y', 'z']) {
          if (Math.abs(N[ax]) > 0.7) continue; // eixo da espessura (a normal) — não trava aqui
          const lo = b.min[ax] + EDGE_MARGIN, hi = b.max[ax] - EDGE_MARGIN;
          if (this.position[ax] < lo) { this.position[ax] = lo; hitEdge = true; }
          else if (this.position[ax] > hi) { this.position[ax] = hi; hitEdge = true; }
        }
      }
    }

    // Re-pin. Se acabou de bater na borda travada (hitEdge), tenta achar a parede
    // PERPENDICULAR primeiro — normal ao longo de `side`, não de N — pra virar o
    // canto suavemente em vez de ficar preso na quina.
    //
    // Sonda DIRETA (mesmo padrão de toggleLatch: origem em espaço aberto, sem
    // offset), não o padrão "sonda à frente da superfície, raio de volta" do re-pin
    // normal abaixo — aquele padrão pressupõe que já se está ENCOSTADO numa
    // superfície conhecida; aqui é uma busca "a frio" por uma parede ainda
    // desconhecida. Com EDGE_MARGIN >= espessura da parede, `this.position` (já
    // travado na borda) ainda está em espaço aberto de verdade, então o raio direto
    // acerta a face de DENTRO da parede adjacente (não atravessa ela pra achar a
    // face de fora — bug real que o padrão de offset causava). Ignora
    // `this.latchedObject` nos resultados (não pode voltar a grudar numa face
    // diferente da MESMA parede via o bisel arredondado).
    let hit;
    if (hitEdge) {
      const selfObj = this.latchedObject;
      for (const cand of [side, this._tmpV.copy(side).multiplyScalar(-1)]) {
        this._raycaster.set(this.position, cand);
        this._raycaster.far = PIN_RANGE;
        const cHits = this._raycaster.intersectObjects(this.climbables, false);
        hit = cHits.find((h) => h.object !== selfObj);
        if (hit) break;
      }
    }

    if (!hit) {
      // Parede atual: sonda a partir de um ponto à frente da superfície, de volta
      // pra parede (posição já travada com segurança fora do bisel, se hitEdge).
      const probeOrigin = this._tmpDir.copy(this.position).addScaledVector(N, PIN_PROBE);
      const back = this._axZ.copy(N).multiplyScalar(-1);
      this._raycaster.set(probeOrigin, back);
      this._raycaster.far = PIN_RANGE;
      hit = this._raycaster.intersectObjects(this.climbables, false)[0];
    }

    if (!hit) {
      // Saiu da superfície → gravidade volta e ele cai.
      this._detach();
      return;
    }

    // Cola exatamente na superfície e atualiza a normal (caso mude de face).
    // Se a face virou para BAIXO (ele contornou a quina e foi parar no fundo do
    // móvel/laje), solta em vez de ficar pendurado de cabeça para baixo — era o
    // que jogava a câmera para dentro do piso e prendia o jogador.
    const worldNormal = this._worldNormal(hit);
    if (worldNormal.y < MIN_LATCH_NY) { this._detach(); return; }
    this.latchedObject = hit.object;
    this.wallNormal.copy(worldNormal);
    this.position.copy(hit.point).addScaledVector(this.wallNormal, RADIUS);

    // Alinha a cápsula: eixo (local Y) ao longo da subida, "face" (local Z, onde
    // ficam os olhos) sempre virada PRA DENTRO da parede (−normal) — a barriga
    // gruda na superfície, como um lagarto de verdade. Face pra FORA (o P3b
    // original, só virava com camuflagem) lia como "escada invisível": a câmera
    // via as costas encostadas com a barriga pro lado de fora, não escalada de
    // verdade. P3a (pupilas somem ao camuflar) já cobre a pista de "esconder o
    // rosto" sem precisar girar o corpo inteiro.
    const newUp = this._tangentUp(this.wallNormal, this._axY);
    const wallSide = this._axX.copy(newUp).cross(this.wallNormal).normalize(); // "direita" na parede
    // Deitar grudado (leque, ver setPose): o clipe 'prone' deita o corpo ao
    // longo do eixo local Z (medido: pernas/cabeça ficam à mesma altura,
    // espalhadas em Z — ver PRONE_DROP acima). Com faceDir=−normal (a base
    // normal, de escalada), esse eixo aponta PRA DENTRO da parede e metade do
    // corpo fica cravado nela. Trocar faceDir por `wallSide` (tangente horizontal
    // da parede) deita o personagem DE LADO, esparramado ao longo da
    // superfície, em vez de atravessá-la.
    const wallFlat = this._manualPose === 'prone';
    const faceDir = wallFlat ? wallSide : this._tmpDir.copy(this.wallNormal).multiplyScalar(-1);
    this._orientTo(newUp, faceDir, dt);

    // Voltar ao chão: se está descendo e os "pés" da cápsula já alcançaram o
    // piso, solta e fica em pé em vez de continuar grudado (o que deixava o
    // jogador "preso na parede", pois só soltava com o centro abaixo do chão).
    // O piso é o do ANDAR em que ele está (laje do mezanino, topo de um bloco),
    // não o térreo: com y=0 fixo, quem descia no 2º andar nunca soltava e
    // atravessava a laje até ficar pendurado sob ela.
    const feetY = this.position.y - HALF_EXTENT * newUp.y;
    const floorY = this._supportTopBelow(this.position.x, this.position.z, feetY + 0.3);
    // -0.05 é menor que a deadzone do joystick (0.12, Joystick.js) — quem empurra
    // "pra baixo" o suficiente pra soltar já passou da deadzone de qualquer forma,
    // então a curva analógica não muda este gesto (revisado, sem ajuste necessário).
    if (joy.y < -0.05 && feetY <= floorY + 0.02) { this._detachToGround(floorY); return; }
    // Subir DIRETO numa laje/saliência (bug real reportado: escalar até a laje do 2º
    // andar atravessava ela): a parede do perímetro é uma caixa contínua do chão até
    // o teto, sem quebra na altura da laje — nada detectava isso, e o único código de
    // piso acima era só pra DESCER. `floorY` já é o topo sólido mais alto alcançável
    // (a mesma busca de cima); se ele ficou ACIMA dos pés, o personagem acabou de
    // subir pra dentro de um sólido — emerge em cima dele em vez de atravessar.
    // `floorY > feetY` já filtra sozinho o chão distante lá embaixo (topo 0, sempre
    // menor que os pés positivos aqui), sem precisar de outra guarda.
    if (floorY > feetY + 0.02) this._detachToGround(floorY);
  }

  // Topo do apoio sólido logo abaixo de (x,z) — piso do andar atual. `maxY`
  // limita ao que está em/abaixo dos pés (não conta o teto acima). Fallback: 0.
  _supportTopBelow(x, z, maxY) {
    let top = 0;
    for (const box of this.level.solids) {
      if (x + RADIUS > box.min.x && x - RADIUS < box.max.x &&
          z + RADIUS > box.min.z && z - RADIUS < box.max.z) {
        if (box.max.y <= maxY && box.max.y > top) top = box.max.y;
      }
    }
    return top;
  }

  // Gravidade + apoio sobre o topo mais alto sob o jogador (chão/blocos).
  _resolveVertical(dt) {
    const px = this.position.x;
    const pz = this.position.z;
    const prevFeet = this.position.y - HALF_EXTENT;

    this.velocity.y -= GRAVITY * dt;
    this.position.y += this.velocity.y * dt;
    const feet = this.position.y - HALF_EXTENT;

    // Apoio = topo mais alto cuja pegada XZ (expandida pelo raio) contém o
    // jogador e que estava em/abaixo dos pés no início do frame (evita subir
    // "por dentro" de um bloco ao encostar de lado).
    let supportTop = 0; // plano do chão como piso de segurança
    for (const box of this.level.solids) {
      if (px + RADIUS > box.min.x && px - RADIUS < box.max.x &&
          pz + RADIUS > box.min.z && pz - RADIUS < box.max.z) {
        const top = box.max.y;
        if (top <= prevFeet + STEP_UP && top > supportTop) supportTop = top;
      }
    }

    if (feet <= supportTop) {
      this.position.y = supportTop + HALF_EXTENT;
      this.velocity.y = 0;
      this.isJumping = false;
    }
  }

  // Colisão horizontal (chão): empurra a cápsula (raio RADIUS no plano XZ) para
  // fora de cada AABB sólida que ela penetre e a faz DESLIZAR ao longo da face
  // (resolve pela quina/face mais próxima). Isto substitui o antigo efeito do
  // auto-latch, que era o único motivo de o jogador não atravessar as paredes.
  _resolveHorizontal() {
    const top = this.position.y + HALF_EXTENT;
    const bot = this.position.y - HALF_EXTENT;
    const feet = bot;
    const r2 = RADIUS * RADIUS;
    // Poucas passadas: sair de um sólido pode encostar em outro (quinas).
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const box of this.level.solids) {
        // Só colide com sólidos que cruzam a faixa vertical do corpo…
        if (box.min.y >= top || box.max.y <= bot) continue;
        // …e que não sejam degraus/plataformas subíveis (o _resolveVertical sobe
        // nelas; senão a escada bloquearia como parede).
        if (box.max.y <= feet + STEP_UP) continue;

        // Ponto do box mais próximo do centro (no plano XZ).
        const cx = Math.min(Math.max(this.position.x, box.min.x), box.max.x);
        const cz = Math.min(Math.max(this.position.z, box.min.z), box.max.z);
        const dx = this.position.x - cx;
        const dz = this.position.z - cz;
        const d2 = dx * dx + dz * dz;

        if (d2 > 1e-8) {
          // Centro FORA do box (encostou numa face/quina): empurra ao longo da
          // normal do contato até ficar a RADIUS de distância → desliza.
          if (d2 >= r2) continue;
          const dist = Math.sqrt(d2);
          const push = (RADIUS - dist) / dist;
          this.position.x += dx * push;
          this.position.z += dz * push;
          moved = true;
        } else {
          // Centro DENTRO do box: resolve pelo eixo de MENOR penetração.
          const midX = (box.min.x + box.max.x) * 0.5;
          const midZ = (box.min.z + box.max.z) * 0.5;
          const penX = Math.min(this.position.x - box.min.x, box.max.x - this.position.x);
          const penZ = Math.min(this.position.z - box.min.z, box.max.z - this.position.z);
          if (penX < penZ) {
            this.position.x += (this.position.x >= midX ? 1 : -1) * (penX + RADIUS);
          } else {
            this.position.z += (this.position.z >= midZ ? 1 : -1) * (penZ + RADIUS);
          }
          moved = true;
        }
      }
      if (!moved) return;
    }
  }

  // ---------------------------------------------------------- AÇÕES (botões)
  // Pular: executa salto físico com velocidade vertical + animação Jump.fbx
  jump() {
    if (this.state === 'latched') {
      this._release();
      this.velocity.y = 5.5;
      this.isJumping = true;
      if (this.animInstance && this.animInstance.actions['jump']) {
        this.animInstance.playAnimation('jump');
      }
      return;
    }

    const feet = this.position.y - HALF_EXTENT;
    const supportTop = this._supportTopBelow(this.position.x, this.position.z, feet + 0.1);
    if (feet <= supportTop + 0.1 && this.velocity.y <= 0.1) {
      this.velocity.y = 6.2;
      this.isJumping = true;
      this.prone = false;
      this.statue = false;
      if (this.animInstance && this.animInstance.actions['jump']) {
        this.animInstance.playAnimation('jump');
      }
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {}
    }
  }
  // Grudar/soltar manual (botão). No chão: gruda na superfície que o boneco
  // ENCARA (não mais ao andar de encontro). Grudado: solta.
  toggleLatch(camera) {
    if (this.state === 'latched') { this._release(); return; }
    // Direção que o boneco encara (local +Z projetado no plano); fallback: câmera.
    const dir = this._tmpDir.set(0, 0, 1).applyQuaternion(this.object.quaternion).setY(0);
    if (dir.lengthSq() < 1e-4 && camera) camera.getWorldDirection(dir).setY(0);
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize();
    this._raycaster.set(this.position, dir);
    this._raycaster.far = LATCH_BTN_REACH;
    const hit = this._raycaster.intersectObjects(this.climbables, false)[0];
    if (hit) this._latchTo(hit); // recusa faces p/ baixo (MIN_LATCH_NY)
  }

  // Solta da parede: fica em pé se os pés já alcançam o piso do andar; senão cai.
  _release() {
    if (this.state !== 'latched') return;
    const up = this._tangentUp(this.wallNormal, this._axY);
    const feetY = this.position.y - HALF_EXTENT * up.y;
    const floorY = this._supportTopBelow(this.position.x, this.position.z, feetY + 0.3);
    if (feetY <= floorY + 0.5) this._detachToGround(floorY);
    else this._detach();
  }

  // Agachar (toggle): reduz velocidade (ver _updateGrounded) e a silhueta (visual,
  // em update) e faz o Caçador enxergar de mais perto (ver Seeker._canSee).
  toggleCrouch() { if (!this.prone) this.crouched = !this.crouched; }

  // Deitar (P3c): pose no chão para "virar tapete". Só em pé no chão. Ao deitar,
  // assenta no piso (centro a RADIUS) e tomba para a frente (−90° em X) mantendo o
  // yaw; imóvel (mover levanta). A camuflagem passa a comparar com o TAPETE embaixo.
  toggleProne() {
    if (this.state !== 'grounded') return;
    this.prone = !this.prone;
    if (this.prone) {
      this.crouched = false;
      const floorY = this._supportTopBelow(this.position.x, this.position.z, this.position.y + 0.3);
      this.position.y = floorY + RADIUS;
      this.velocity.set(0, 0, 0);
      this.object.rotation.set(-Math.PI / 2, this.object.rotation.y, 0);
    } else {
      const floorY = this._supportTopBelow(this.position.x, this.position.z, this.position.y + 0.5);
      this.position.y = floorY + GROUND_Y;
      this.object.rotation.set(0, this.object.rotation.y, 0); // levanta (reorienta ao mover)
    }
  }

  // Deitado: imóvel; empurrar o joystick levanta (UX). Sem gravidade (já assentado).
  // 0.20 (era 0.35): com a curva quadrática de Joystick.js, a magnitude bruta que
  // antes dava 0.35 agora chega bem menor no joy.x/y recebido aqui — reduzido pra
  // manter o mesmo "empurrão deliberado, mas não precisa ir até o talo" de antes.
  _updateProne(dt, joy) {
    if (Math.hypot(joy.x, joy.y) > 0.20) this.toggleProne();
  }

  // Cor do tapete/superfície colorável logo ABAIXO do jogador (pose deitada).
  _surfaceBelowColor() {
    this._raycaster.set(this._tmpV.copy(this.position), DOWN);
    this._raycaster.far = 1.5;
    const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
    if (!hit) return null;
    return this._pixelColorAt(hit) || (hit.object.material ? hit.object.material.color : null);
  }

  // Conta-gotas MIRADO por ZONA (Fase 5a + P1): cada zona amostra a superfície na
  // direção da MIRA a partir da SUA altura — então mirar num trecho parede+rodapé
  // pinta o tronco com a parede e as pernas com o rodapé de uma vez. Copia cor
  // (métrica) E carimba a estampa (P2). Funciona no chão e grudado. Retorna a cor da
  // primeira zona que pegou (ou null) para o Game disparar pulso/som/re-semear a roda.
  sampleColor(camera) {
    // Deitado (P3c): amostra o TAPETE embaixo (raycast p/ baixo) — as duas zonas
    // pegam o mesmo tapete. Em pé/grudado: amostra na direção da mira, por zona.
    const dir = this.prone ? this._tmpDir.copy(DOWN) : camera.getWorldDirection(this._tmpDir).normalize();
    const far = this.prone ? 1.5 : 8;
    let any = null;
    for (const z of this.zones) {
      const origin = this.prone ? this._tmpV.copy(this.position) : this._zoneAnchor(z, this._tmpV);
      this._raycaster.set(origin, dir);
      this._raycaster.far = far;
      const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
      let mat = hit && hit.object.material;
      // Fallback: grudado e a mira não pegou nada → usa a própria superfície grudada.
      if (!mat && this.state === 'latched' && this.latchedObject) mat = this.latchedObject.material;
      if (mat && mat.color) {
        // Pixel exato quando a superfície tem padrão procedural (userData.
        // pixelColorable); senão, a cor média do material — como sempre foi.
        const pixel = hit ? this._pixelColorAt(hit) : null;
        const sampled = pixel || mat.color;
        z.target.copy(sampled);
        this._stampZone(z, mat.map);
        // `any` sai da função — clona pra não ficar apontando pro Color
        // reutilizado (_pixelColorTmp), que a próxima zona deste MESMO loop
        // pode sobrescrever antes do retorno.
        if (!any) any = pixel ? sampled.clone() : sampled;
      }
    }
    return any;
  }

  // ------------------------------------------------------------------ HELPERS
  // Gruda numa superfície. Recusa faces viradas para baixo (ver MIN_LATCH_NY).
  _latchTo(hit) {
    const n = this._worldNormal(hit);
    if (n.y < MIN_LATCH_NY) return false;
    this.state = 'latched';
    this.velocity.set(0, 0, 0);
    this.latchedObject = hit.object;
    this.wallNormal.copy(n);
    this.position.copy(hit.point).addScaledVector(this.wallNormal, RADIUS);
    // Deitar é só-chão (ver setPose): sem isto, grudar vindo de prone deixava
    // prone=true com state='latched' e travava o personagem — ver comentário em
    // setPose('prone').
    this.prone = false;
    this.object.rotation.x = 0;
    return true;
  }

  _detach() {
    this.state = 'grounded';
    this.latchedObject = null;
    this.velocity.set(0, 0, 0); // começa a cair a partir do repouso
    this._relatchCd = 0.3;
  }

  // Solta a parede colocando o jogador em pé no chão, logo à frente dela.
  // Usado quando ele desce a parede e os pés chegam ao piso.
  // Solta e fica em pé sobre o piso do ANDAR atual (floorY; 0 = térreo).
  _detachToGround(floorY = 0) {
    this.state = 'grounded';
    this.latchedObject = null;
    // Afasta um pouco da parede para não ser recapturado imediatamente.
    this.position.addScaledVector(this.wallNormal, 0.2);
    this.position.y = floorY + GROUND_Y;
    this.velocity.set(0, 0, 0);
    this._relatchCd = 0.3;
  }

  // Normal do hit convertida para espaço do mundo.
  _worldNormal(hit) {
    const n = hit.face.normal.clone();
    n.transformDirection(hit.object.matrixWorld).normalize();
    return n;
  }

  // "Cima" tangente à parede: world up projetado no plano da normal.
  // Para superfícies quase horizontais, cai para um eixo alternativo.
  _tangentUp(normal, out) {
    out.copy(WORLD_UP).addScaledVector(normal, -WORLD_UP.dot(normal));
    if (out.lengthSq() < 1e-4) out.set(1, 0, 0).addScaledVector(normal, -normal.x);
    return out.normalize();
  }

  // Orienta o grupo para uma base (up = eixo local Y, faceDir = eixo local Z),
  // com slerp para suavizar.
  _orientTo(up, faceDir, dt) {
    const y = this._axY.copy(up).normalize();
    const z = this._axZ.copy(faceDir).normalize();
    // Ortonormaliza z contra y
    z.addScaledVector(y, -y.dot(z));
    if (z.lengthSq() < 1e-4) return;
    z.normalize();
    const x = this._axX.copy(y).cross(z).normalize();
    this._tmpMat.makeBasis(x, y, z);
    this._tmpQuat.setFromRotationMatrix(this._tmpMat);
    // Suavização exponencial independente de FPS (mesma matemática de MathUtils.damp),
    // aplicada via slerp por ser rotação (quaternion), não escalar.
    const t = 1 - Math.exp(-TUNE.turnSpeed * dt);
    this.object.quaternion.slerp(this._tmpQuat, t);
  }
}
