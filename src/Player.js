import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Parâmetros de tuning
const RADIUS = 0.45;
const LENGTH = 0.9;                 // parte cilíndrica da cápsula
const HALF_EXTENT = RADIUS + LENGTH / 2;
const GROUND_Y = HALF_EXTENT;       // altura do centro quando no chão
const MOVE_SPEED = 7.0;             // m/s no chão
const CLIMB_SPEED = 5.5;            // m/s na parede
const GRAVITY = 22.0;
const LATCH_REACH = RADIUS + 0.35;  // distância p/ grudar ao ir de encontro à parede
const PIN_PROBE = 0.6;              // origem da sonda de re-pin, à frente da superfície
const PIN_RANGE = PIN_PROBE + RADIUS + 0.4; // alcance máx. antes de soltar
const TURN_LERP = 12;               // suavização de rotação
const COLOR_LERP = 10;              // suavização da troca de cor (camuflagem)

// Histerese: entra em camuflagem com folga apertada e só sai quando a cor se
// afasta bem mais. Evita o badge/detecção "piscarem" no limiar durante o lerp.
const CAMO_ENTER = 0.07; // diferença máx. por canal para PASSAR a camuflado
const CAMO_EXIT = 0.13;  // diferença por canal para DEIXAR de estar camuflado

export class Player {
  constructor(scene, level) {
    this.level = level;
    this.climbables = level.climbables;
    this.state = 'grounded'; // 'grounded' | 'latched'
    this._camo = false;      // estado de camuflagem com histerese
    this._glow = 0;          // relógio do brilho pulsante ao camuflar

    this.velocity = new THREE.Vector3();
    this.wallNormal = new THREE.Vector3(0, 0, 1);
    this.latchedObject = null; // superfície atual (para checagem de camuflagem)

    // Grupo raiz: movemos/rotacionamos isto.
    this.object = new THREE.Group();
    this.object.position.set(0, GROUND_Y, 6);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x8a8f98, roughness: 0.55, metalness: 0.1,
    });
    this.material = bodyMat;
    this.targetColor = new THREE.Color(0x8a8f98);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(RADIUS, LENGTH, 8, 20), bodyMat);
    body.castShadow = true;
    this.object.add(body);

    // "Olho" indicando a frente/topo (local +Y = eixo da cápsula)
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.3 })
    );
    eye.position.set(0, HALF_EXTENT - 0.1, RADIUS * 0.7);
    this.object.add(eye);

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
  isCamouflaged() {
    if (this.state !== 'latched' || !this.latchedObject) { this._camo = false; return false; }
    const surf = this.latchedObject.material && this.latchedObject.material.color;
    if (!surf) { this._camo = false; return false; }
    const c = this.material.color;
    const diff = Math.max(
      Math.abs(c.r - surf.r),
      Math.abs(c.g - surf.g),
      Math.abs(c.b - surf.b)
    );
    if (this._camo) { if (diff > CAMO_EXIT) this._camo = false; }
    else if (diff < CAMO_ENTER) this._camo = true;
    return this._camo;
  }

  update(dt, joy, camera) {
    if (this.state === 'grounded') this._updateGrounded(dt, joy, camera);
    else this._updateLatched(dt, joy);

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

    // Tenta grudar: raycast na direção do movimento contra as paredes.
    if (moving) {
      this._raycaster.set(this.position, move);
      this._raycaster.far = LATCH_REACH;
      const hit = this._raycaster.intersectObjects(this.climbables, false)[0];
      if (hit) {
        this._latchTo(hit);
        return;
      }
    }

    // Movimento horizontal
    if (moving) this.position.addScaledVector(move, MOVE_SPEED * dt);

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
    this.latchedObject = hit.object;
    const worldNormal = this._worldNormal(hit);
    this.wallNormal.copy(worldNormal);
    this.position.copy(hit.point).addScaledVector(this.wallNormal, RADIUS);

    // Alinha a cápsula: eixo (local Y) ao longo da subida; "olho" (local Z)
    // apontando para fora da parede (visível para a câmera).
    const newUp = this._tangentUp(this.wallNormal, this._axY);
    this._orientTo(newUp, this.wallNormal, dt);
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
        if (top <= prevFeet + 0.06 && top > supportTop) supportTop = top;
      }
    }

    if (feet <= supportTop) {
      this.position.y = supportTop + HALF_EXTENT;
      this.velocity.y = 0;
    }
  }

  // ------------------------------------------------------------------ HELPERS
  _latchTo(hit) {
    this.state = 'latched';
    this.velocity.set(0, 0, 0);
    this.latchedObject = hit.object;
    this.wallNormal.copy(this._worldNormal(hit));
    this.position.copy(hit.point).addScaledVector(this.wallNormal, RADIUS);
  }

  _detach() {
    this.state = 'grounded';
    this.latchedObject = null;
    this.velocity.set(0, 0, 0); // começa a cair a partir do repouso
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
    this.object.quaternion.slerp(this._tmpQuat, Math.min(1, TURN_LERP * dt));
  }
}
