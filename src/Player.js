import * as THREE from 'three';
import { buildHumanoid, Gait } from './Character.js';
import { toonGradient } from './textures.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

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

    this.velocity = new THREE.Vector3();
    this.wallNormal = new THREE.Vector3(0, 0, 1);
    this.latchedObject = null; // superfície atual (para checagem de camuflagem)
    this._relatchCd = 0;       // tempo (s) de bloqueio de re-latch após soltar

    // Grupo raiz: movemos/rotacionamos isto. Início vem do layout (level.spawn).
    this.object = new THREE.Group();
    const s = level.spawn;
    this.object.position.set(s ? s.x : 0, GROUND_Y, s ? s.z : 6);

    // Branco fosco de "art toy" (Pop Mart): é a cor BASE do boneco; a camuflagem
    // apenas tinge por cima. Uma só material para o corpo inteiro (ver Character.js).
    const bodyMat = new THREE.MeshToonMaterial({
      color: 0xeef0f2, gradientMap: toonGradient(),
    });
    this.material = bodyMat;
    this.targetColor = new THREE.Color(0xeef0f2);

    // Boneco de vinil branco: cabeça redonda, corpo gelatinoso, membros atarracados.
    const H = HALF_EXTENT * 2; // altura total = extensão vertical da cápsula de colisão
    const toy = buildHumanoid(bodyMat, H);
    this.object.add(toy.group);

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
  }

  get position() { return this.object.position; }

  // Direção de escalada (para cima na parede) — usada pela câmera.
  get climbUp() {
    return this._tangentUp(this.wallNormal, this._axY);
  }

  // Aplica uma cor de camuflagem (alvo do lerp).
  setCamouflage(color) {
    this.targetColor.copy(color);
  }

  // Verdadeiro se está grudado E a cor atual bate com a da superfície grudada.
  // Usa histerese (_camo) para não oscilar exatamente sobre o limiar.
  // A comparação é feita em sRGB (ver toSRGB): é o espaço em que o jogador julga
  // "esta cor é igual àquela", e o único em que a paleta escura da mansão fica
  // separável pelos limiares CAMO_ENTER/EXIT.
  isCamouflaged() {
    if (this.state !== 'latched' || !this.latchedObject) { this._camo = false; return false; }
    const surf = this.latchedObject.material && this.latchedObject.material.color;
    if (!surf) { this._camo = false; return false; }
    const c = this.material.color;
    const diff = Math.max(
      Math.abs(toSRGB(c.r) - toSRGB(surf.r)),
      Math.abs(toSRGB(c.g) - toSRGB(surf.g)),
      Math.abs(toSRGB(c.b) - toSRGB(surf.b))
    );
    if (this._camo) { if (diff > CAMO_EXIT) this._camo = false; }
    else if (diff < CAMO_ENTER) this._camo = true;
    return this._camo;
  }

  update(dt, joy, camera) {
    if (this.state === 'grounded') this._updateGrounded(dt, joy, camera);
    else this._updateLatched(dt, joy);

    this._animateFace(dt, joy);

    // Lerp de cor da camuflagem
    this.material.color.lerp(this.targetColor, Math.min(1, COLOR_LERP * dt));

    // Brilho pulsante quando totalmente camuflado (feedback de sucesso):
    // emite na própria cor do disfarce, então só "reluz" sem mudar o tom.
    if (this.isCamouflaged()) {
      this._glow += dt;
      this.material.emissive.copy(this.material.color);
      this.material.emissiveIntensity = 0.16 + 0.12 * Math.sin(this._glow * 6);
    } else {
      this.material.emissiveIntensity = 0;
      this._glow = 0;
    }

    // Caminhada: a fase avança pela distância REAL percorrida (chão ou parede),
    // ignorando saltos de latch/teleporte para não disparar um passo fantasma.
    let dist = this.object.position.distanceTo(this._prevPos);
    dist = Math.min(dist, MOVE_SPEED * dt * 1.6);
    this._prevPos.copy(this.object.position);
    this.gait.update(dt, dist);

    // Agachar: pose HUMANOIDE (dobra pernas + afunda/inclina o tronco), aplicada
    // pelo Gait sobre o rig — bem mais orgânica que comprimir a malha. É só visual:
    // a cápsula de colisão/latch não muda (evita regressão de degrau/pin).
    this._crouchT += ((this.crouched ? 1 : 0) - this._crouchT) * Math.min(1, 10 * dt);
    this.gait.crouch = this._crouchT;
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

    // Alinha a cápsula: eixo (local Y) ao longo da subida; "olho" (local Z)
    // apontando para fora da parede (visível para a câmera).
    const newUp = this._tangentUp(this.wallNormal, this._axY);
    this._orientTo(newUp, this.wallNormal, dt);

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
  toggleCrouch() { this.crouched = !this.crouched; }

  // Pintar (botão): copia a cor da superfície grudada para se camuflar. Sonda a
  // partir do jogador de volta para a parede (−normal). Retorna a cor (ou null)
  // para o Game disparar o pulso/som.
  paintFromWall() {
    if (this.state !== 'latched') return null;
    const back = this._tmpDir.copy(this.wallNormal).multiplyScalar(-1);
    this._raycaster.set(this.position, back);
    this._raycaster.far = RADIUS + 0.6;
    const hit = this._raycaster.intersectObjects(this.level.colorables, false)[0];
    let color = hit && hit.object.material && hit.object.material.color;
    if (!color && this.latchedObject && this.latchedObject.material) {
      color = this.latchedObject.material.color; // fallback: a própria superfície grudada
    }
    if (!color) return null;
    this.setCamouflage(color);
    return color;
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
