import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Carrega o BONECO em GLB (gerado no Higgsfield a partir da imagem de referência)
// e o prepara para o jogo. Substitui a construção procedural de `buildBody` quando
// o arquivo existe; se falhar, o chamador volta para o corpo procedural (o jogo
// nunca fica sem personagem).
//
// O contrato de saída COPIA o de `buildBody` no que o resto do código consome:
//   • figura centrada na origem no eixo vertical, PÉS em -height/2, frente em +Z;
//   • `materials` = materiais cuja `.color` a camuflagem tinge (o mapa base é
//     claro, então color × map continua lendo como a cor copiada).
// A malha vem em metros do Meshy (rigging_height_meters); aqui é reescalada para
// a altura lógica do jogador, senão apareceria gigante ao lado da cápsula de colisão.

const _loader = new GLTFLoader();

// Pose de AGACHAR, montada por osso (o GLB só tem clipe de locomoção). Calibrada
// no render: a coxa vai à FRENTE, a canela ao CONTRÁRIO (para o pé ficar sob o
// corpo) e o quadril DESCE — girar as pernas sem baixar o quadril só levanta os
// pés do chão, e canela no mesmo sentido da coxa vira "ajoelhar".
export const CROUCH = { upLeg: 0.9, lowLeg: -1.2, hipDrop: 0.30 };

// `animUrl` (opcional): GLB com SÓ a animação (mesmo esqueleto), usado no lugar do
// clipe embutido. Serve porque o re-rig do provedor devolveu o clipe de corrida
// junto com uma malha decimada (20 662 → 400 triângulos, inutilizável): ficamos com
// a malha boa daqui e o clipe bom de lá. Os ossos são os mesmos (24 juntas, mesmos
// nomes), então as faixas casam por nome.
// `animUrls`: { nome: url } de GLBs com SÓ a animação (28-31 KB cada), extraídos
// com scratchpad/extract-anim.py. Cada um vira um clipe trocável em tempo real
// pelo painel de ajustes. Um clipe que falhe ao carregar é simplesmente ignorado.
export function loadPlayerModel(url, height = 1, { glossy = true, animUrls = {} } = {}) {
  const base = new Promise((resolve, reject) => _loader.load(url, resolve, undefined, reject));
  const names = Object.keys(animUrls);
  const extras = names.map((n) => new Promise((resolve) => {
    _loader.load(animUrls[n], (g) => resolve({ name: n, clip: g.animations && g.animations[0] }),
      undefined, () => resolve({ name: n, clip: null }));
  }));
  return Promise.all([base, Promise.all(extras)]).then(([gltf, loaded]) => {
    const clips = {};
    for (const { name, clip } of loaded) if (clip) clips[name] = clip;
    return _prepare(gltf, height, glossy, clips);
  });
}

function _prepare(gltf, height, glossy, extraClips = {}) {
  const root = gltf.scene;
  const materials = [];

  // Pose de REPOUSO dos ossos, capturada ANTES de qualquer animação: é a base
  // para (a) suavizar a inclinação do clipe de corrida e (b) o personagem ficar
  // DE PÉ quando parado, em vez de congelado no meio da passada.
  const rest = [];
  root.traverse((o) => {
    if (o.isBone) rest.push({ bone: o, q: o.quaternion.clone(), p: o.position.clone() });
  });

  // 1) Materiais: MeshPhysicalMaterial (cerâmica/plástico polido). Preserva o mapa
  //    base assado pelo Meshy — ele é claro, então `color` (alvo da camuflagem)
  //    multiplica por cima sem mentir sobre a cor final.
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const old = o.material;
    const src = Array.isArray(old) ? old[0] : old;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: src && src.map ? src.map : null,
      roughness: glossy ? 0.28 : 0.75,   // cerâmica polida
      metalness: 0.0,
      clearcoat: glossy ? 0.85 : 0.0,    // verniz do vinil/porcelana
      clearcoatRoughness: 0.18,
      sheen: 0.0,
    });
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    o.material = mat;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // malha com skin: o bounding box da bind pose engana o culling
    materials.push(mat);
    if (Array.isArray(old)) old.forEach((m) => m.dispose && m.dispose());
    else if (old && old.dispose) old.dispose();
  });

  // 2) Animação ANTES de medir (a bind pose daria offset errado).
  //    NÃO remover a faixa de posição do `Hips`: o clipe do auto-rig já é IN-PLACE
  //    (deslocamento líquido ~0 — ele só bobeia e balança). A faixa carrega a
  //    ALTURA do quadril (73.4 em repouso vs 77.7–80.8 animado); removê-la afunda
  //    o quadril com os pés plantados e ENTORTA as pernas para dentro.
  const group = new THREE.Group();
  group.add(root);
  // Os clipes externos entram primeiro (o 1º vira o padrão). O modelo base traz o
  // Casual_Walk embutido da geração original — aproveitado como 'walk' sem custo
  // de download nem de créditos.
  const pool = { ...extraClips };
  if (gltf.animations && gltf.animations.length && !pool.walk) pool.walk = gltf.animations[0];
  const names = Object.keys(pool);
  const mixer = names.length ? new THREE.AnimationMixer(root) : null;
  const actions = {};
  let walk = null;
  if (mixer) {
    for (const n of names) actions[n] = mixer.clipAction(pool[n]);
    walk = actions[names[0]];
    walk.play();
    mixer.update(0);     // aplica a pose do 1º quadro antes de medir
  }

  // 3) Escala + assentamento. ATENÇÃO: `Box3.setFromObject` mede a BIND POSE da
  //    geometria numa malha com skin — o render, porém, usa as matrizes dos ossos
  //    (o auto-rig cria o esqueleto em metros). Usar aquele box dava um fator de
  //    escala errado e o boneco entrava na câmera. Medimos os vértices JÁ
  //    deformados pelos ossos, que é o que aparece na tela.
  //    Medimos UMA vez (root ainda com transform identidade, então o que medimos
  //    já está no espaço do pai) e posicionamos por conta: remedir depois de
  //    escalar contava a escala DUAS vezes (as matrizes dos ossos já a carregam)
  //    e o boneco saía 58× maior.
  root.updateWorldMatrix(true, true);
  const box = _posedBounds(root);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 1e-5 ? height / size.y : 1;
  const c = box.getCenter(new THREE.Vector3());
  root.scale.setScalar(s);
  root.position.set(-c.x * s, -(box.min.y * s) - height / 2, -c.z * s); // pés em -height/2

  // 4) PASSADA do clipe: quanto o boneco deveria avançar em UM ciclo completo.
  //    O clipe é in-place, então nada no arquivo diz isso — medimos a excursão do
  //    pé ao longo do ciclo (× 2, pois há dois passos por ciclo). O Player usa
  //    esse valor para avançar a animação pela DISTÂNCIA percorrida: é o que
  //    impede o pé de patinar (andar devagar avançando muito, e vice-versa).
  // Cada clipe tem passada própria (o Run_02 pisa diferente do RunFast), então a
  // cadência é medida POR CLIPE — senão trocar de animação faria o pé patinar.
  const strides = {};
  for (const n of names) {
    for (const m of names) actions[m].enabled = (m === n);
    strides[n] = _measureStride(root, mixer, actions[n], height);
  }
  for (const n of names) actions[n].enabled = (actions[n] === walk);
  let stride = strides[names[0]] || 0;

  // Troca o clipe de locomoção em tempo real (painel de ajustes).
  const setClip = (name) => {
    if (!actions[name] || actions[name] === walk) return;
    for (const n of names) { actions[n].enabled = false; actions[n].stop(); }
    walk = actions[name];
    walk.enabled = true;
    walk.play();
    stride = strides[name] || stride;
    api.walk = walk; api.stride = stride;
  };

  // Mistura a pose animada com a de repouso. Chamar DEPOIS de `mixer.update`.
  //   idle  0..1 → 1 deixa o boneco totalmente em pé (parado)
  //   lean  0..1 → puxa só o tronco de volta, domando a inclinação do sprint
  // O clipe RunFast dobra o tronco quase na horizontal: além de ficar corcunda,
  // é essa dobra extrema que AMASSA a malha nas costas (os pesos do auto-rig não
  // dão conta). Reduzir a inclinação corrige a silhueta e a deformação juntas.
  // APENAS pescoço/cabeça. Testado: amortecer o `Hips` gira o corpo todo e TIRA OS
  // PÉS DO CHÃO (joelhos girando no ar = pedalar bicicleta); amortecer a `Spine`
  // é pior ainda, porque no sprint a inclinação mora no quadril e a coluna faz a
  // CONTRA-rotação que segura o tronco — puxá-la ao repouso dobra o boneco mais.
  // Só a cabeça pode ser endireitada sem efeito colateral: ele passa a olhar à
  // frente em vez de para o chão.
  const SPINE = /neck|head/i;
  const ARM = /^(left|right)arm$/i;   // braço superior (a pose de repouso é um "A")
  const _q = new THREE.Quaternion();
  const _axis = new THREE.Vector3(0, 0, 1);
  // Parado, a pose de repouso deixa os braços ABERTOS (é a A-pose da imagem-fonte).
  // Braço caído lê como alguém em pé; aberto lê como manequim. Rotação no eixo Z
  // local do ombro, com sinal por lado.
  // AGACHAR: o Gait procedural fazia essa pose e ela se perdeu com o GLB (só há
  // clipe de locomoção). Reconstruída por osso: coxa à frente, joelho dobrado e
  // quadril descido — o suficiente para ler como agachado sem tocar na cápsula
  // de colisão (que nunca muda).
  const UPLEG = /^(left|right)upleg$/i;
  const LEG = /^(left|right)leg$/i;
  const _qx = new THREE.Quaternion();
  const _axX = new THREE.Vector3(1, 0, 0);

  const applyPose = (idle, lean, armDrop = 0, crouch = 0) => {
    for (const r of rest) {
      if (idle > 0.999) { r.bone.quaternion.copy(r.q); r.bone.position.copy(r.p); }
      else {
        if (idle > 0) { r.bone.quaternion.slerp(r.q, idle); r.bone.position.lerp(r.p, idle); }
        if (lean > 0 && SPINE.test(r.bone.name)) r.bone.quaternion.slerp(r.q, lean * (1 - idle));
      }
      if (armDrop && idle > 0 && ARM.test(r.bone.name)) {
        const side = /^left/i.test(r.bone.name) ? 1 : -1;
        r.bone.quaternion.multiply(_q.setFromAxisAngle(_axis, side * armDrop * idle));
      }
      if (crouch > 0.001) {
        // Sinais e proporções LIDOS do próprio clipe de corrida (ver análise): lá
        // coxa e canela giram no MESMO sentido +X, e o quadril desce de 78,9 para
        // ~70-74. Sem baixar o quadril, girar as pernas só levanta os pés do chão.
        if (UPLEG.test(r.bone.name)) r.bone.quaternion.multiply(_qx.setFromAxisAngle(_axX, crouch * CROUCH.upLeg));
        else if (LEG.test(r.bone.name)) r.bone.quaternion.multiply(_qx.setFromAxisAngle(_axX, crouch * CROUCH.lowLeg));
        else if (/^hips$/i.test(r.bone.name)) r.bone.position.y -= crouch * r.p.y * CROUCH.hipDrop;
      }
    }
  };

  const api = { group, materials, mixer, walk, stride, actions, strides, setClip, applyPose,
    clips: gltf.animations || [], height };
  return api;
}

function _measureStride(root, mixer, walk, height) {
  let foot = null;
  root.traverse((o) => { if (!foot && o.isBone && /foot/i.test(o.name) && /left/i.test(o.name)) foot = o; });
  if (!foot) return 0;
  const dur = walk.getClip().duration;
  const p = new THREE.Vector3();
  let min = Infinity, max = -Infinity;
  const N = 32;
  walk.paused = false; // ação PAUSADA não é reavaliada por setTime — a medida sairia zero
  for (let k = 0; k < N; k++) {
    mixer.setTime((dur * k) / N);
    root.updateWorldMatrix(true, true);
    foot.getWorldPosition(p);
    if (p.z < min) min = p.z;
    if (p.z > max) max = p.z;
  }
  mixer.setTime(0);
  walk.paused = true;
  // A excursão do pé em relação ao CORPO subestima a passada real: na corrida há
  // FASE AÉREA — o corpo avança com os dois pés no ar, e esse trecho não aparece
  // no movimento relativo do pé. Sem o ganho, a cadência dava ~4,8 ciclos/s (nem
  // um velocista passa de ~2,4) e os passos ficavam frenéticos/tremidos.
  // O GANHO fica no painel de ajustes (TUNE.strideGain, padrão 2.0), para ser
  // calibrado jogando — aqui devolvemos só a medida crua.
  const stride = (max - min) * 2;
  return stride > 1e-3 ? stride : height * 0.9;       // guarda-chuva se a medida falhar
}

// Caixa envolvente REAL (mundo) de uma malha com skin: percorre os vértices
// aplicando as matrizes dos ossos (`applyBoneTransform`), que é o que a GPU
// desenha. Malhas comuns caem no caminho normal. ~20 mil vértices, uma vez só.
function _posedBounds(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.skeleton.update();
      const pos = o.geometry.attributes.position;
      const apply = o.applyBoneTransform ? 'applyBoneTransform' : 'boneTransform'; // r155 renomeou
      // NÃO chamar localToWorld aqui: as matrizes dos ossos já trazem a
      // transformação do root, e converter de novo dobraria a escala.
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        o[apply](i, v);
        box.expandByPoint(v);
      }
    } else if (o.isMesh) {
      box.expandByObject(o);
    }
  });
  return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}
