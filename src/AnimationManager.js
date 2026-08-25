import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonGradient } from './textures.js?v=4';

// UM GLB com a malha decimada e os 7 clipes embutidos, gerado no Blender a
// partir dos FBX do Mixamo (ver docs/PIPELINE_PERSONAGEM.md). Antes eram 7 FBX
// de ~6,5MB, e cada um trazia uma cópia COMPLETA da malha (204.344 faces) só
// para entregar um clipe — 47MB baixados e ~1,4GB de pico de heap ao parsear,
// o que matava a aba no celular. Agora: 1,43MB e 12.000 faces.
const MODELO = 'public/models/character_animated.glb';
const TAMANHO_ESTIMADO = 1_495_384; // p/ barra de progresso quando falta Content-Length

// Arma de água do Caçador. Asset separado (não embutido no personagem) porque só
// o Caçador a carrega — o Camaleão usa o mesmo GLB de corpo. Exportado do
// Blender já centrado na origem, com o CANO no eixo +Z e o maior eixo = 1,0, e
// sem material/textura (o jogo aplica MeshToonMaterial). Ver docs/PIPELINE_PERSONAGEM.md.
const ARMA = 'public/models/water_gun.glb';
const ARMA_COMPRIMENTO = 0.55; // comprimento alvo, calibrado p/ BODY_H = 2.2
const ARMA_COR = 0x59c1e8;     // azul-água da paleta do jogo

class AnimationManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.baseModel = null;
    this.clips = {};
    this.instances = new Set();
    this.isLoaded = false;
    this.loadPromise = null;
    this.blasterModel = null;   // protótipo da arma, clonado por Caçador
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

        // A arma entra na MESMA barra de progresso: carregada depois, ela
        // apareceria "pipocando" na mão do Caçador já em jogo.
        try {
          const arma = await this.loader.loadAsync(ARMA);
          this.blasterModel = arma.scene;
        } catch (err) {
          // Sem fallback silencioso: Caçador desarmado tem que gritar no console.
          console.error('❌ AnimationManager: falha ao carregar a arma', ARMA, err);
        }

        this.isLoaded = true;
        console.log('🎉 AnimationManager: pronto!', Object.keys(this.clips),
                    this.blasterModel ? '+ arma' : '(SEM arma)');
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

  // Instancia a arma de água: clone do protótipo, já no material toon do jogo e
  // no comprimento certo. Devolve `{ group, muzzle }` — `muzzle` é um marcador
  // vazio na BOCA DO CANO, de onde o jato deve sair (o modelo não traz um nó de
  // bocal nomeado, então a ponta é derivada da bounding box).
  createBlaster() {
    if (!this.blasterModel) return null;

    const group = this.blasterModel.clone(true);
    group.updateMatrixWorld(true);

    // Normaliza pelo comprimento REAL do modelo: se um dia trocarem o asset por
    // outro de escala diferente, isto continua valendo.
    const bbox = new THREE.Box3().setFromObject(group);
    const comprimento = bbox.max.z - bbox.min.z || 1; // cano no eixo Z (ver ARMA)
    group.scale.setScalar(ARMA_COMPRIMENTO / comprimento);

    const mat = new THREE.MeshToonMaterial({ color: ARMA_COR, gradientMap: toonGradient() });
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = mat;
      o.castShadow = true;
      o.frustumCulled = false; // acompanha um osso animado; a bounding sphere mente
    });

    // Marcador na ponta do cano, em coordenadas LOCAIS do grupo (antes da escala,
    // porque ele entra como filho e herda a mesma escala).
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, bbox.max.z);
    group.add(muzzle);

    return { group, muzzle };
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
    // inflava a escala em ~3,2×. Aqui o Box3 serve só para o TAMANHO — a bind
    // pose tem a altura natural do modelo, que é o que queremos escalar.
    clone.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(clone);
    const modelHeight = bbox.max.y - bbox.min.y || 1;
    const scale = height / modelHeight;
    clone.scale.setScalar(scale);

    // NÃO deslocar pela bbox: ela é da BIND POSE (centrada na origem no GLB),
    // enquanto quem manda na altura é a POSE ANIMADA, que já apoia os pés em
    // y=0. Compensar pela bind pose fazia o personagem correr flutuando
    // exatamente GROUND_Y acima do piso. Quem ajusta o resto é o chamador
    // (Player: -GROUND_Y; Seeker: -EYE_Y). Conferir sempre pelos OSSOS dos pés.
    clone.position.y = 0;

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

    // Pincel livre por UV: expõe o SkinnedMesh direto — o
    // raycast padrão do Three.js testa a BIND POSE dele, não a pose animada
    // (mesma armadilha do jato de água d'água, já documentada em
    // docs/PIPELINE_PERSONAGEM.md), então src/UVPaint.js faz seu próprio
    // raycast manual via `applyBoneTransform` e precisa dessa referência.
    const skinnedMesh = meshes.find((m) => m.isSkinnedMesh) || meshes[0] || null;

    const instanceObj = {
      group,
      mixer,
      skinnedMesh,
      actions,
      currentActionName: 'idle',
      materials: customMaterials,
      // Escala aplicada ao clone. Quem pendura algo num OSSO precisa dividir por
      // ela: o osso vive dentro do clone e o filho herda essa escala.
      modelScale: scale,
      // Osso da mão direita — ponto de anexo da arma do Caçador.
      handBone: clone.getObjectByName('mixamorigRightHand') || null,

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

      // Fosco/Brilhante (Player.setFinish) — troca o LUT do cel shading em vez
      // de roughness/metalness (inertes no MeshToonMaterial). Sem isto, o
      // toggle não tinha efeito nenhum no personagem animado: só mexia nas
      // zonas do boneco primitivo, que fica invisível assim que o GLB carrega.
      setGradientMap(tex) {
        for (const mat of customMaterials) {
          mat.gradientMap = tex;
          mat.needsUpdate = true;
        }
      },

      // Canal emissivo do pincel livre: MeshToonMaterial suporta
      // emissive/emissiveIntensity nativamente, sem precisar de PBR (que
      // colidiria com a direção toon do jogo — ver avaliação da spec de
      // pintura 3D). Simula camuflagem contra lâmpada/letreiro aceso.
      setEmissive(color, intensity) {
        for (const mat of customMaterials) {
          mat.emissive.copy(color);
          mat.emissiveIntensity = intensity;
        }
      },

      // Pincel livre por UV (ver src/UVPaint.js) — troca o `.map` de todo
      // material do GLB pela textura pintada, sem mexer em
      // setColor/customMaterials (o jogo padrão nunca chama isto). A malha
      // tem UV em 6 regiões não sobrepostas — ver
      // scripts/gerar_personagem_glb.py, reunwrap_por_regiao.
      setPaintTexture(texture) {
        for (const mat of customMaterials) {
          mat.map = texture;
          mat.needsUpdate = true;
        }
      },

      // Modo raio-X do pincel livre — desliga o teste
      // de profundidade e desenha por cima de tudo, pra examinar a pintura
      // mesmo com o personagem parcialmente atrás de quina/sofá (mesmo
      // motivo do toggle da spec original). `renderOrder` alto garante que
      // desenha DEPOIS dos opacos normais, senão `depthTest:false` sozinho
      // ainda pode perder pra ordem natural de desenho da cena.
      setXray(enabled) {
        for (const mat of customMaterials) {
          mat.depthTest = !enabled;
        }
        group.renderOrder = enabled ? 999 : 0;
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
