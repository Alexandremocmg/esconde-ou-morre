import * as THREE from 'three';
import { animationManager } from './AnimationManager.js?v=3';
import { toonGradient } from './textures.js?v=3';

// Alvo do modo Caçador jogável (Game.js): um Camaleão-boneco parado, plantado
// num ponto navegável da mansão (reaproveita level.routes — já validados como
// livres de colisão/paredes pelo AI do Seeker, ver Level.js._setRoutes). Sem
// IA de esconderijo/camuflagem própria (fase 1 — ver docs/PIPELINE_PERSONAGEM.md
// e a conversa que motivou este modo); a "graça" vem de explorar a mansão para
// achá-los, não de fugir de um algoritmo de patrulha.

const EYE_Y = 1.1;  // mesma referência de pés de Seeker.js (routes já vêm nessa altura)
// Mesma altura do Camaleão jogável (Player.js: HALF_EXTENT*2, SCALE=0.8). Ficou presa
// em 0.9 (o valor de quando Player.js usava SCALE=0.5) por duas rodadas de aumento do
// jogador — os bonecos-alvo do modo Caçador solo renderizavam ~40% menores que o
// próprio jogador. Padronizado de volta pra bater com Player.js.
const HEIGHT = 1.44;

export class ChameleonTarget {
  constructor(scene, level, point, color = 0x5fbf6e) {
    this.level = level;
    this.eliminated = false;
    this._fade = 0; // 0..1 ao ser eliminado (encolhe e some)

    this.group = new THREE.Group();
    this.group.position.copy(point);
    scene.add(this.group);

    // Mesmo deslocamento do Seeker: o grupo lógico fica na altura dos "olhos";
    // o corpo visual desce para os pés encostarem no chão/laje.
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.y = -EYE_Y;
    this.group.add(this.bodyGroup);

    this.bodyMat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    this.animInstance = null;
    this._checkAnimInstance();
  }

  // O GLB pode ainda não ter carregado quando o alvo é criado (spawn no boot
  // da partida) — mesmo padrão de lazy-attach do Seeker/Player.
  _checkAnimInstance() {
    if (this.animInstance || !animationManager.isLoaded) return;
    // Sem contorno: um alvo parado com borda de desenho se denunciaria à distância
    // (docs/MECANICA_CACADOR_VISAO.md §1 — "sem contornos/realces" no que o Caçador vê).
    const inst = animationManager.createInstance(this.bodyMat, HEIGHT);
    if (inst) {
      this.bodyGroup.add(inst.group);
      this.animInstance = inst;
      inst.playAnimation('idle');
    }
  }

  get position() { return this.group.position; }

  // Chamado pelo Game ao acertar o jato de água. Retorna false se já tinha
  // sido eliminado (evita contar o mesmo alvo duas vezes).
  hit() {
    if (this.eliminated) return false;
    this.eliminated = true;
    if (this.animInstance && this.animInstance.actions['prone']) {
      this.animInstance.playAnimation('prone');
    }
    return true;
  }

  update(dt) {
    this._checkAnimInstance();
    if (this.animInstance) this.animInstance.update(dt);

    if (this.eliminated) {
      this._fade = Math.min(1, this._fade + dt * 1.5);
      const s = Math.max(0.001, 1 - this._fade);
      this.group.scale.setScalar(s);
      if (this._fade >= 1) this.group.visible = false;
    }
  }

  destroy() {
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
