import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DIST = 6.5;   // distância atrás do jogador
const HEIGHT = 3.2; // elevação ao longo do "up"
const POS_LERP = 6; // suavização de posição
const UP_LERP = 5;  // suavização do vetor up (reorientação na parede)

// Câmera de 3ª pessoa que segue o jogador e reorienta o "up" para
// alinhar com a normal da parede quando ele está grudado.
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this._desiredPos = new THREE.Vector3();
    this._up = new THREE.Vector3().copy(WORLD_UP);
    this._targetUp = new THREE.Vector3().copy(WORLD_UP);
    this._back = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    camera.position.set(0, HEIGHT, 6 + DIST);
    camera.up.copy(WORLD_UP);
    camera.lookAt(0, 1, 6);
  }

  update(dt, player) {
    const pos = player.position;

    if (player.state === 'latched') {
      // "Up" da tela = subida na parede; câmera afastada para fora da parede.
      this._targetUp.copy(player.climbUp);
      const outward = this._tmp.copy(player.wallNormal);
      this._back.copy(outward).multiplyScalar(DIST)
        .addScaledVector(this._targetUp, -HEIGHT * 0.35);
    } else {
      // No chão: up do mundo, câmera atrás da direção que o jogador encara.
      this._targetUp.copy(WORLD_UP);
      const facing = this._tmp.set(0, 0, 1).applyQuaternion(player.object.quaternion);
      facing.setY(0);
      if (facing.lengthSq() < 1e-4) facing.set(0, 0, 1);
      facing.normalize();
      this._back.copy(facing).multiplyScalar(-DIST).addScaledVector(WORLD_UP, HEIGHT);
    }

    this._desiredPos.copy(pos).add(this._back);

    // Suaviza posição e up
    this.camera.position.lerp(this._desiredPos, Math.min(1, POS_LERP * dt));
    this._up.lerp(this._targetUp, Math.min(1, UP_LERP * dt)).normalize();
    this.camera.up.copy(this._up);
    this.camera.lookAt(pos);
  }
}
