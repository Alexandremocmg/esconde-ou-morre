import * as THREE from 'three';
import { buildBody, Gait } from './Character.js';
import { toonGradient } from './textures.js';
import { animationManager } from './AnimationManager.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0); // amostra/checagem do chão na pose deitada (P3c)

// Parâmetros de tuning
// SCALE reduz o personagem inteiro de forma coerente: as dimensões físicas e os
// offsets visuais derivam dele, então colisão/latching/olhos/cauda encolhem juntos
// (evita o descasamento que object.scale causaria com as constantes de colisão).
const SCALE = 0.5;                  // metade do tamanho: mundo parece mais vasto
const RADIUS = 0.45 * SCALE;
const LENGTH = 0.9 * SCALE;         // parte cilíndrica da cápsula
const HALF_EXTENT = RADIUS + LENGTH / 2;
const GROUND_Y = HALF_EXTENT;       // altura do centro quando no chão
// Velocidades NÃO escalam: MOVE_SPEED é o teto de justiça do Caçador
// (PLAYER_GROUND_SPEED em Seeker.js). Menor + mesma velocidade = mais ágil.
const MOVE_SPEED = 7.0;             // m/s no chão
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
const TURN_SPEED = 6;               // suavização de rotação (menor = giro mais suave/lento).
                                    // Usado como taxa em 1 - exp(-TURN_SPEED*dt): independente de FPS.
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
  constructor(scene, level) {
    this.level = level;
    this.climbables = level.climbables;
    this.state = 'grounded'; // 'grounded' | 'latched'
    this._camo = false;      // estado de camuflagem com histerese
    this._glow = 0;          // relógio do brilho pulsante ao camuflar
    this.crouched = false;   // agachado (o Caçador lê isto p/ reduzir o alcance de visão)
    this._crouchT = 0;       // transição suavizada de agachamento (0..1)
    this.prone = false;      // deitado no chão (P3c): camufla contra o TAPETE embaixo

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

    // Boneco branco na forma escolhida no menu (Fase 4): 'toy' | 'blob' | 'cube'.
    // A colisão/latch NÃO muda com a forma (usa a cápsula lógica); só o visual.
    const kind = sessionStorage.getItem('eom-body') || 'toy';
    const toy = buildBody({ upper: this.zones[0].mat, lower: this.zones[1].mat }, H, { kind });
    this.toy = toy;
    this.animInstance = null;
    this.playerHeight = H;

    this.object.add(toy.group);

    if (animationManager.isLoaded) {
      const inst = animationManager.createInstance({ upper: this.zones[0].mat, lower: this.zones[1].mat }, H);
      if (inst) {
        toy.group.visible = false;
        this.object.add(inst.group);
        this.animInstance = inst;
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
    this._tmpMat = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._axX = new THREE.Vector3();
    this._axY = new THREE.Vector3();
    this._axZ = new THREE.Vector3();
    this._tmpV = new THREE.Vector3(); // âncora de zona (P1)
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
      if (hits.length > 0 && hits[0].object.material) {
        sampledColor = hits[0].object.material.color;
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

  setFinish(finish) {
    const isGloss = finish === 'gloss';
    for (const z of this.zones) {
      z.mat.roughness = isGloss ? 0.2 : 0.85;
      z.mat.metalness = isGloss ? 0.25 : 0.0;
    }
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
      this.prone = true;
      this.crouched = false;
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

  // Camuflado quando TODAS as zonas batem com a superfície correspondente:
  //  • grudado (P1): cada zona vs. a superfície ATRÁS dela (rodapé/parede);
  //  • deitado (P3c): todas as zonas vs. o TAPETE embaixo ("virar tapete").
  // Camuflado = pior zona dentro do limiar. sRGB (toSRGB) + histerese (_camo).
  isCamouflaged() {
    let surfFor;
    if (this.prone) {
      const floor = this._surfaceBelowColor();
      if (!floor) { this._camo = false; return false; } // fora de tapete → exposto
      surfFor = () => floor;
    } else if (this.state === 'latched' && this.latchedObject) {
      surfFor = (z) => this._surfaceBehindZone(z);
    } else {
      this._camo = false; return false;
    }
    let maxDiff = 0;
    for (const z of this.zones) {
      const surf = surfFor(z);
      if (!surf) { this._camo = false; return false; }
      const c = z.mat.color;
      const d = Math.max(
        Math.abs(toSRGB(c.r) - toSRGB(surf.r)),
        Math.abs(toSRGB(c.g) - toSRGB(surf.g)),
        Math.abs(toSRGB(c.b) - toSRGB(surf.b))
      );
      if (d > maxDiff) maxDiff = d;
    }
    if (this._camo) { if (maxDiff > CAMO_EXIT) this._camo = false; }
    else if (maxDiff < CAMO_ENTER) this._camo = true;
    return this._camo;
  }

  // Cor da superfície colorável logo ATRÁS de uma zona (raycast −normal a partir da
  // âncora). Fallback: a própria superfície grudada. Habilita o bi-tom.
  _surfaceBehindZone(z) {
    const origin = this._zoneAnchor(z, this._tmpV);
    const back = this._axZ.copy(this.wallNormal).multiplyScalar(-1);
    this._raycaster.set(origin, back);
    this._raycaster.far = RADIUS + 0.6;
    const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
    if (hit && hit.object.material) return hit.object.material.color;
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
      this.object.add(inst.group);
      this.animInstance = inst;
    }
  }

  update(dt, joy, camera) {
    this._checkAnimInstance();

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
    dist = Math.min(dist, MOVE_SPEED * dt * 1.6);
    this._prevPos.copy(this.object.position);

    if (this.animInstance) {
      const moving = dist > 1e-3;
      if (this.isJumping || this.velocity.y > 0.5) {
        this.animInstance.playAnimation('jump');
      } else if (this.state === 'latched') {
        this.animInstance.playAnimation(moving ? 'climb' : 'hide');
      } else if (this.prone) {
        this.animInstance.playAnimation('prone');
      } else if (this.crouched) {
        this.animInstance.playAnimation('crouch');
      } else if (moving) {
        this.animInstance.playAnimation('run');
      } else {
        this.animInstance.playAnimation('idle');
      }
      this.animInstance.setColor(this.zones[0].mat.color);
      this.animInstance.update(dt);
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
    const moving = move.lengthSq() > 1e-4;
    if (moving) move.normalize();

    // Cooldown de re-latch: após soltar da parede, deixa o cd correr (usado só
    // para o auto-detach ao descer; grudar agora é manual — ver toggleLatch).
    if (this._relatchCd > 0) this._relatchCd -= dt;

    // Movimento horizontal (grudar NÃO é mais automático: andar rente à parede
    // não cola mais; use o botão Grudar). Agachado anda mais devagar.
    const speed = MOVE_SPEED * (this.crouched ? CROUCH_SPEED_MULT : 1);
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

    // Move no plano da parede
    const move = this._axZ.set(0, 0, 0)
      .addScaledVector(side, joy.x)
      .addScaledVector(up, joy.y);
    if (move.lengthSq() > 1e-4) {
      move.normalize();
      this.position.addScaledVector(move, CLIMB_SPEED * dt);
    }

    // Re-pin: sonda a partir de um ponto à frente da superfície, de volta pra parede.
    const probeOrigin = this._tmpDir.copy(this.position).addScaledVector(N, PIN_PROBE);
    const back = this._axZ.copy(N).multiplyScalar(-1);
    this._raycaster.set(probeOrigin, back);
    this._raycaster.far = PIN_RANGE;
    const hit = this._raycaster.intersectObjects(this.climbables, false)[0];

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

    // Alinha a cápsula: eixo (local Y) ao longo da subida. A "face" (local Z)
    // aponta para FORA normalmente; mas quando CAMUFLADO ela PRENSA na parede
    // (−normal), escondendo o rosto e mostrando as costas à câmera (P3b). Usa o
    // flag de histerese _camo (1 frame de atraso, suavizado pelo slerp do _orientTo).
    const newUp = this._tangentUp(this.wallNormal, this._axY);
    const faceDir = this._camo
      ? this._tmpDir.copy(this.wallNormal).multiplyScalar(-1)
      : this.wallNormal;
    this._orientTo(newUp, faceDir, dt);

    // Voltar ao chão: se está descendo e os "pés" da cápsula já alcançaram o
    // piso, solta e fica em pé em vez de continuar grudado (o que deixava o
    // jogador "preso na parede", pois só soltava com o centro abaixo do chão).
    // O piso é o do ANDAR em que ele está (laje do mezanino, topo de um bloco),
    // não o térreo: com y=0 fixo, quem descia no 2º andar nunca soltava e
    // atravessava a laje até ficar pendurado sob ela.
    const feetY = this.position.y - HALF_EXTENT * newUp.y;
    const floorY = this._supportTopBelow(this.position.x, this.position.z, feetY + 0.3);
    if (joy.y < -0.05 && feetY <= floorY + 0.02) this._detachToGround(floorY);
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
  _updateProne(dt, joy) {
    if (Math.hypot(joy.x, joy.y) > 0.35) this.toggleProne();
  }

  // Cor do tapete/superfície colorável logo ABAIXO do jogador (pose deitada).
  _surfaceBelowColor() {
    this._raycaster.set(this._tmpV.copy(this.position), DOWN);
    this._raycaster.far = 1.5;
    const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
    return hit && hit.object.material ? hit.object.material.color : null;
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
        z.target.copy(mat.color);
        this._stampZone(z, mat.map);
        if (!any) any = mat.color;
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
    const t = 1 - Math.exp(-TURN_SPEED * dt);
    this.object.quaternion.slerp(this._tmpQuat, t);
  }
}
