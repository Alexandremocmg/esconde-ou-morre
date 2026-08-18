import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Câmera de 1ª pessoa do Caçador jogável (Fase 1 de docs/MECANICA_CACADOR_VISAO.md).
// Mesma interface pública de FollowCamera (addLook/addZoom/update/reset) para o resto
// de Game.js não precisar de if/else por modo.
export const HUNTER_FOV = 80; // dentro do range 75-85° pedido — pontos cegos laterais de propósito

const EYE_OFFSET = 0.42;  // altura do "olho" acima do centro da cápsula (Player.js GROUND_Y);
                           // calibrado no olho vendo o jogo — mesmo padrão de EYE_Y em Seeker.js
const LOOK_SENS = 0.005;  // rad por px de arrasto — mesma sensibilidade de FollowCamera
const PITCH_LIMIT = 1.5;  // ~86°: olhar de verdade, não órbita, então bem mais aberto

export class HunterCamera {
  constructor(camera) {
    this.camera = camera;
    camera.fov = HUNTER_FOV;
    camera.updateProjectionMatrix();
    camera.up.copy(WORLD_UP); // sem reorientar ao grudar em parede (ver plano — evita roll/enjoo)

    this.yaw = 0;
    this.pitch = 0;
    this._quat = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();
    this._axisX = new THREE.Vector3(1, 0, 0);
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
  }

  // Arrasto do usuário (área direita): olha ao redor de verdade (não órbita o jogador).
  addLook(dx, dy) {
    this.yaw -= dx * LOOK_SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
  }

  // Pinça (zoom) não se aplica em 1ª pessoa — mantém a interface, sem efeito.
  addZoom(_delta) {}

  update(dt, player, _occluders) {
    if (isNaN(this.yaw)) this.yaw = 0;
    if (isNaN(this.pitch)) this.pitch = 0;

    const pos = player.position;
    if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) pos.set(0, 0.5, 6);

    this.camera.position.copy(pos);
    this.camera.position.y += EYE_OFFSET;
    if (this.camera.position.y < 0.35) this.camera.position.y = 0.35;

    this._qYaw.setFromAxisAngle(WORLD_UP, this.yaw);
    this._qPitch.setFromAxisAngle(this._axisX, this.pitch);
    this._quat.copy(this._qYaw).multiply(this._qPitch);
    this.camera.quaternion.copy(this._quat);
  }
}
