import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonGradient } from './textures.js';

// Mapeamento dos arquivos FBX em public/animation/
const ANIMATION_FILES = {
  idle: 'public/animation/Standing W_Briefcase Idle.fbx',
  run: 'public/animation/Running.fbx',
  crouch: 'public/animation/Crouching Idle.fbx',
  hide: 'public/animation/Sleeping Idle.fbx',
  prone: 'public/animation/Laying Sleeping.fbx',
  climb: 'public/animation/Climbing Up Wall.fbx',
  jump: 'public/animation/Jump.fbx',
};

class AnimationManager {
  constructor() {
    this.loader = new FBXLoader();
    this.baseModel = null;
    this.clips = {};
    this.instances = new Set();
    this.isLoaded = false;
    this.loadPromise = null;
  }

  // Remove o Root Motion (deslocamento X/Z do Hips) para travar TODAS as animações "In Place"
  _sanitizeClip(clip, key) {
    if (!clip || !clip.tracks) return clip;

    for (const track of clip.tracks) {
      const name = track.name.toLowerCase();

      // Sanitiza estritamente a posição do osso raiz Hips (quadril)
      if (name.includes('hips.position') || name.includes('root.position')) {
        const values = track.values;
        if (values && values.length >= 3) {
          const initialX = values[0];
          const initialY = values[1];
          const initialZ = values[2];

          for (let i = 0; i < values.length; i += 3) {
            // Trava eixos horizontais X e Z para a posição inicial em todas as 5 animações
            values[i] = initialX;     // Eixo X (lateral)
            values[i + 2] = initialZ; // Eixo Z (frente/trás - elimina o replay ao correr!)

            // Para escalada, agachamento e esconderijo, trava também o eixo Y (altura)
            // para que a física do jogo (Player.js) controle a subida na parede sem saltos
            if (key === 'climb' || key === 'hide' || key === 'crouch' || key === 'prone') {
              values[i + 1] = initialY; // Eixo Y (vertical)
            }
          }
        }
      }
    }
    return clip;
  }

  // Otimização mobile: simplifica a malha 3D de 613.000 vértices para ~35.000 vértices
  // eliminando travamentos de memória WebGL em celulares/desktops sem perder animação.
  _decimateGeometry(geom, targetFaces = 12000) {
    if (!geom || !geom.attributes || !geom.attributes.position) return geom;
    if (geom.index) {
      const oldIndex = geom.index.array;
      const currentFaces = oldIndex.length / 3;
      if (currentFaces <= targetFaces) return geom;
      const step = Math.ceil(currentFaces / targetFaces);
      const newIndexArr = [];
      for (let i = 0; i < currentFaces; i += step) {
        newIndexArr.push(oldIndex[i * 3], oldIndex[i * 3 + 1], oldIndex[i * 3 + 2]);
      }
      geom.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndexArr), 1));
    } else {
      const pos = geom.attributes.position.array;
      const norm = geom.attributes.normal ? geom.attributes.normal.array : null;
      const uv = geom.attributes.uv ? geom.attributes.uv.array : null;
      const sIndex = geom.attributes.skinIndex ? geom.attributes.skinIndex.array : null;
      const sWeight = geom.attributes.skinWeight ? geom.attributes.skinWeight.array : null;
      const currentFaces = pos.length / 9;
      if (currentFaces <= targetFaces) return geom;
      const step = Math.ceil(currentFaces / targetFaces);
      const newPos = [], newNorm = [], newUv = [], newSIndex = [], newSWeight = [];
      for (let i = 0; i < currentFaces; i += step) {
        for (let v = 0; v < 3; v++) {
          const idx = (i * 3 + v);
          newPos.push(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]);
          if (norm) newNorm.push(norm[idx * 3], norm[idx * 3 + 1], norm[idx * 3 + 2]);
          if (uv) newUv.push(uv[idx * 2], uv[idx * 2 + 1]);
          if (sIndex) newSIndex.push(sIndex[idx * 4], sIndex[idx * 4 + 1], sIndex[idx * 4 + 2], sIndex[idx * 4 + 3]);
          if (sWeight) newSWeight.push(sWeight[idx * 4], sWeight[idx * 4 + 1], sWeight[idx * 4 + 2], sWeight[idx * 4 + 3]);
        }
      }
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
      if (norm) geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(newNorm), 3));
      if (uv) geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(newUv), 2));
      if (sIndex) geom.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(newSIndex), 4));
      if (sWeight) geom.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(newSWeight), 4));
      geom.computeBoundingSphere();
      geom.computeBoundingBox();
    }
    return geom;
  }

  // Libera a malha de um FBX do qual só queríamos o clipe de animação.
  // Sem isto, cada arquivo extra segura ~26MB de atributos até o GC rodar.
  _disposeMeshes(root) {
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.dispose) m.dispose();
    });
  }

  // Carrega todos os arquivos FBX e envia progresso para a tela de carregamento
  async loadAll(onProgress) {
    if (this.loadPromise) {
      if (onProgress && this.isLoaded) onProgress(100, 'pronto');
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      console.log('🎬 AnimationManager: Pré-carregando todas as animações FBX...');

      const entries = Object.entries(ANIMATION_FILES);
      const total = entries.length;
      let loadedCount = 0;

      // SEQUENCIAL, não Promise.all. Todo FBX do Mixamo traz uma cópia COMPLETA
      // da malha (613k vértices, ~26MB de atributos, ~198MB de heap durante o
      // parse) além do clipe. Baixando os 7 em paralelo o pico chegava a ~1.4GB
      // e o navegador do celular matava a aba — a barra travava antes de 100%,
      // independente da velocidade da rede. Em série o pico fica no custo de UM
      // arquivo por vez, e cada await dá folga ao coletor de lixo.
      for (const [key, url] of entries) {
        try {
          const fbx = await this.loader.loadAsync(url);

          if (fbx.animations && fbx.animations.length > 0) {
            const clip = this._sanitizeClip(fbx.animations[0], key);
            clip.name = key;
            this.clips[key] = clip;
          }

          // O primeiro arquivo doa a malha do personagem; dos demais só
          // interessa o clipe — a malha repetida é liberada na hora para não
          // segurar ~26MB × 6 até o GC decidir passar.
          if (!this.baseModel) this.baseModel = fbx;
          else this._disposeMeshes(fbx);
        } catch (err) {
          console.warn(`⚠️ Falha ao carregar FBX ${key}:`, err);
        } finally {
          loadedCount++;
          const pct = Math.round((loadedCount / total) * 100);
          if (onProgress) onProgress(pct, key);
        }
      }

      this.isLoaded = true;
      console.log('🎉 AnimationManager: Pré-carregamento concluído 100%!', Object.keys(this.clips));
      if (onProgress) onProgress(100, 'concluído');
      return true;
    })();

    return this.loadPromise;
  }

  // Instancia um personagem animado clonado
  createInstance(materials, height = 1, { outline = false, outlineColor = 0x14181d } = {}) {
    if (!this.baseModel) {
      return null;
    }

    // Clona a estrutura da malha e esqueleto
    const clone = SkeletonUtils.clone(this.baseModel);

    // Normaliza a escala do modelo para bater exatamente com a altura 'height' física do jogo
    const bbox = new THREE.Box3().setFromObject(clone);
    const modelHeight = bbox.max.y - bbox.min.y || 1;
    const scale = height / modelHeight;
    clone.scale.setScalar(scale);

    // O clone FBX Mixamo tem seus pés aproximadamente em y=0 no espaço local após a
    // normalização. Quem decide onde os pés tocam o chão é o chamador (Seeker/Player),
    // que deve deslocar inst.group.position.y para alinhar ao seu sistema de coordenadas.
    clone.position.y = 0;

    const matU = materials.isMaterial ? materials : materials.upper;

    // Contorno toon opcional
    const outlineMat = outline
      ? new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide })
      : null;

    const customMaterials = [];

    const meshes = [];
    clone.traverse((child) => {
      if (child.isMesh && !child.userData.isOutline) {
        meshes.push(child);
      }
    });

    for (const child of meshes) {
      child.castShadow = true;
      child.receiveShadow = true;

      // Aplica o material Toon (em Three.js v0.161 o SkinnedMesh configura o shader automaticamente)
      const toonMat = new THREE.MeshToonMaterial({
        color: matU ? matU.color : 0xeef0f2,
        gradientMap: toonGradient(),
      });
      if (matU && matU.map) {
        toonMat.map = matU.map;
      }

      child.material = toonMat;
      customMaterials.push(toonMat);

      if (outlineMat) {
        let outlineMesh;
        if (child.isSkinnedMesh) {
          outlineMesh = new THREE.SkinnedMesh(child.geometry, outlineMat);
          outlineMesh.bind(child.skeleton, child.bindMatrix);
        } else {
          outlineMesh = new THREE.Mesh(child.geometry, outlineMat);
        }
        outlineMesh.userData.isOutline = true;
        outlineMesh.scale.setScalar(1.04);
        child.add(outlineMesh);
      }
    }

    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};

    const group = new THREE.Group();
    group.add(clone);

    const instanceObj = {
      group,
      mixer,
      actions,
      currentActionName: 'idle',
      materials: customMaterials,

      _registerClip(name, clip) {
        if (actions[name]) return;
        const action = mixer.clipAction(clip);
        actions[name] = action;
        if (this.currentActionName === name) {
          action.reset().play();
        }
      },

      playAnimation(name, fadeDuration = 0.15) {
        if (this.currentActionName === name && actions[name] && actions[name].isRunning()) return;

        const prevAction = actions[this.currentActionName];
        this.currentActionName = name;
        const nextAction = actions[name];

        if (nextAction) {
          if (prevAction && prevAction !== nextAction) {
            prevAction.fadeOut(fadeDuration);
          }
          nextAction.reset().fadeIn(fadeDuration).play();
        }
      },

      update(dt) {
        mixer.update(dt);
      },

      setColor(color) {
        for (const mat of customMaterials) {
          mat.color.copy(color);
        }
        if (matU) matU.color.copy(color);
      },

      setEmissive(color, intensity) {
        for (const mat of customMaterials) {
          mat.emissive.copy(color);
          mat.emissiveIntensity = intensity;
        }
      },

      destroy() {
        animationManager.instances.delete(instanceObj);
      }
    };

    instanceObj.group.add(clone);

    // Registra todas as animações já disponíveis
    for (const [key, clip] of Object.entries(this.clips)) {
      instanceObj._registerClip(key, clip);
    }

    if (actions.idle) {
      actions.idle.play();
    }

    this.instances.add(instanceObj);
    return instanceObj;
  }
}

export const animationManager = new AnimationManager();
