import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonGradient } from './textures.js';

// UM GLB com a malha decimada e os 7 clipes embutidos, gerado no Blender a
// partir dos FBX do Mixamo (ver docs/PIPELINE_PERSONAGEM.md). Antes eram 7 FBX
// de ~6,5MB, e cada um trazia uma cópia COMPLETA da malha (204.344 faces) só
// para entregar um clipe — 47MB baixados e ~1,4GB de pico de heap ao parsear,
// o que matava a aba no celular. Agora: 1,43MB e 12.000 faces.
const MODELO = 'public/models/character_animated.glb';
const TAMANHO_ESTIMADO = 1_495_384; // p/ barra de progresso quando falta Content-Length

class AnimationManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.baseModel = null;
    this.clips = {};
    this.instances = new Set();
    this.isLoaded = false;
    this.loadPromise = null;
  }

  // Carrega o GLB e envia progresso para a tela de carregamento.
  async loadAll(onProgress) {
    if (this.loadPromise) {
      if (onProgress && this.isLoaded) onProgress(100, 'pronto');
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      console.log('🎬 AnimationManager: carregando personagem (GLB único)…');
      try {
        const gltf = await this.loader.loadAsync(MODELO, (ev) => {
          if (!onProgress) return;
          const total = ev.total || TAMANHO_ESTIMADO;
          // Trava em 99 até terminar: o 100 quem dá é o fim do await.
          onProgress(Math.min(99, Math.round((ev.loaded / total) * 100)), 'personagem');
        });

        this.baseModel = gltf.scene;
        for (const clip of gltf.animations) this.clips[clip.name] = clip;

        this.isLoaded = true;
        console.log('🎉 AnimationManager: pronto!', Object.keys(this.clips));
      } catch (err) {
        // Falha silenciosa aqui viraria "personagem invisível" sem pista alguma.
        console.error('❌ AnimationManager: falha ao carregar', MODELO, err);
        throw err;
      } finally {
        if (onProgress) onProgress(100, 'concluído');
      }
      return true;
    })();

    return this.loadPromise;
  }

  // Instancia um personagem animado clonado
  createInstance(materials, height = 1, { outline = false, outlineColor = 0x14181d } = {}) {
    if (!this.baseModel) {
      return null;
    }

    // Clona malha + esqueleto (SkeletonUtils religa os ossos do clone).
    const clone = SkeletonUtils.clone(this.baseModel);

    // updateMatrixWorld ANTES de medir: sem isto as matrizes ainda não foram
    // compostas e o Box3 devolve uma altura errada (0,28 em vez de 1,0), o que
    // inflava a escala em ~3,2×.
    clone.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(clone);
    const modelHeight = bbox.max.y - bbox.min.y || 1;
    const scale = height / modelHeight;
    clone.scale.setScalar(scale);

    // O GLB vem CENTRADO na origem (bbox de −0,5 a +0,5); os chamadores
    // (Player/Seeker) esperam os pés em y=0 local e aplicam o próprio offset.
    // Sem esta linha o personagem afunda meio corpo no chão.
    clone.position.y = -bbox.min.y * scale;

    // A bounding sphere de um SkinnedMesh é calculada na bind pose e nunca
    // recalculada: com culling ligado o personagem some em certos ângulos.
    clone.traverse((o) => { o.frustumCulled = false; });

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

      // Material do GLB é descartado: quem manda na cor é a camuflagem do jogo.
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
        outlineMesh.frustumCulled = false;
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
