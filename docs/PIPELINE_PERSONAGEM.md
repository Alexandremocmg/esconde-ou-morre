# Pipeline do personagem (Mixamo → Blender → GLB)

Como o personagem animado do jogo é montado, por que ele é assim, e como
regerar o arquivo quando uma animação nova entrar.

---

## 1. O problema que motivou a mudança

O jogo carregava **7 arquivos FBX** do Mixamo (`public/animation/*.fbx`), um por
animação. Cada arquivo do Mixamo embute uma **cópia completa da malha do
personagem** — 204.344 faces, ~26MB de atributos — só para entregar um clipe.

Medido no navegador:

| | Valor |
|---|---|
| Download total | ~47 MB |
| Heap durante o parse de **um** FBX | ~198 MB |
| Vértices vivos ao mesmo tempo (`Promise.all` dos 7) | 4.291.224 |
| Pico de heap | ~1,4 GB |

Navegador de celular mata a aba entre 300–600 MB, então o carregamento
**travava sempre no celular**, independente da velocidade da rede — e passava no
PC só porque sobra RAM.

## 2. O que existe hoje

Um único **`public/models/character_animated.glb`**: uma malha, um esqueleto de
41 ossos e **9 clipes** embutidos — `idle`, `run`, `crouch`, `hide`, `prone`,
`climb`, `jump` (Camaleão) e `rifleRun`, `shoot` (poses com arma, só do Caçador).

| | Antes | Depois |
|---|---|---|
| Download | ~47 MB (7 FBX) | **1,53 MB** (1 GLB) |
| Faces por personagem | 204.344 | **12.000** |
| Triângulos na cena (3 personagens) | ~1,07 M | **109 K** |
| Heap com o jogo rodando | 86 MB | **14 MB** |

Os FBX originais continuam versionados em `public/animation/` — são a **fonte**
para regerar o GLB. O jogo não os baixa mais.

### A arma de água

**`public/models/water_gun.glb`** (96 KB, 2.600 triângulos) é um asset separado,
carregado pelo `AnimationManager` na mesma barra de progresso e clonado por
Caçador via `createBlaster()`. Fica fora do GLB do personagem porque só o
Caçador a usa — o Camaleão compartilha o mesmo corpo.

Preparado no Blender: hierarquia do Sketchfab achatada, **cano orientado no eixo
+Z**, maior eixo normalizado para 1,0, centrado na origem e **sem material nem
textura** (o jogo aplica `MeshToonMaterial`; a textura embutida era 0,12 MB de
peso morto). A arma é filha do osso `mixamorigRightHand`, então acompanha o
braço; a rotação alinha o cano com a direção dos **dedos**, que no espaço do osso
é +Y — medido, não deduzido.

## 3. Como regerar

```bash
blender --background --python scripts/gerar_personagem_glb.py
```

Para acrescentar uma animação: baixe o FBX do Mixamo em `public/animation/`,
adicione uma linha em `FONTES` e outra em `POLITICA_ROOT_MOTION` no script, e
rode de novo. O primeiro arquivo da lista é quem doa a malha e o esqueleto.

## 4. Decisões que não são óbvias

**Root motion por eixo.** X/Z saem sempre — quem posiciona o personagem no mundo
é o jogo. Y sai só onde a altura é controlada pelo jogo (`climb`) ou pela física
(`jump`). Y **fica** em `crouch`, `prone` e `hide`, onde a descida *é* a própria
ação: zerar ali arruína o clipe (o corpo deita mas fica flutuando).

**Decimação por COLLAPSE, não descartando triângulos.** O `Decimate` do Blender
em modo `COLLAPSE` interpola os vertex groups, então os pesos de skinning
sobrevivem (conferido: 0 vértices sem peso). Havia uma função `_decimateGeometry`
no `AnimationManager` que descartava 1 triângulo a cada N — nunca foi usada, e
ligá-la esfarraparia o personagem. Foi removida.

**Escala do Armature.** O import do Mixamo deixa o objeto `Armature` com escala
`0.01`; exportar assim gera um GLB 100× menor. Escala de *objeto* não entra nas
f-curves (que são em espaço de osso), então o script corrige para `1.0` sem
mexer nas animações.

**Sem materiais nem texturas.** `export_materials="NONE"`: o
`AnimationManager.createInstance` substitui o material por `MeshToonMaterial`
para a camuflagem funcionar, então textura no GLB seria peso morto.

**Sem Draco.** Com 12k faces o arquivo já é pequeno, e ativar Draco obrigaria a
carregar o `DRACOLoader` e os binários do decodificador no jogo.

## 5. Armadilhas do lado do Three.js

**`Box3.setFromObject` mente em `SkinnedMesh`.** Ele devolve a caixa da *bind
pose*, e se for chamado antes de `updateMatrixWorld(true)` devolve altura errada
(0,28 em vez de 1,0) — foi o que inflou a escala em 3,2× na primeira tentativa.
Para medir a pose animada, percorra os **ossos** com `getWorldPosition`. Teste de
sanidade: numa corrida o topo tem que **variar** entre quadros.

**Não alinhe a altura pela bbox.** O GLB vem com a *bind pose* centrada na origem
(bbox de −0,5 a +0,5), o que dá vontade de compensar com
`clone.position.y = -bbox.min.y * scale`. **É errado**: quem manda na altura é a
*pose animada*, que já apoia os pés em y=0. Com a compensação o personagem corre
flutuando exatamente `GROUND_Y` (0,45 m) acima do piso. A bbox serve só para
medir o **tamanho** do modelo (a bind pose tem a altura natural); o
posicionamento fica com `clone.position.y = 0` e o offset do chamador
(`Player`: `-GROUND_Y`; `Seeker`: `-EYE_Y`).

Esse bug passou por uma verificação minha justamente porque conferi os pés com
`Box3`, que reportava `min_y = 0` (bind pose) enquanto os ossos dos pés estavam
em 0,45. **Confira altura de personagem sempre pelos ossos:**

```js
const pes = [];
inst.group.traverse(o => { if (o.isBone && /Foot|Toe/i.test(o.name)) pes.push(o); });
const wp = new THREE.Vector3();
let chao = Infinity;
for (const b of pes) { b.getWorldPosition(wp); chao = Math.min(chao, wp.y); }
// parado: ~0,00 · correndo: oscila (o pé levanta na passada)
```

**Frustum culling some com o personagem.** A bounding sphere de um `SkinnedMesh`
é calculada uma vez na bind pose e nunca recalculada, então em certos ângulos o
Three.js para de desenhar. `createInstance` marca `frustumCulled = false`.

**Não acerte um `SkinnedMesh` por raycast.** Pelo mesmo motivo, o raycast do
Three.js testa a geometria da **bind pose** — que no nosso GLB é centrada na
origem, com metade abaixo do piso. O jato de água do Caçador mirava no corpo
animado, passava por cima da bind pose e "acertava" a parede atrás: com o
jogador dentro de um cômodo, o tiro **nunca** lavava tinta. Para acertar um
personagem, teste distância + oclusão contra o cenário (é o que
`Game.fireWaterJet` faz), ou use os ossos — nunca a malha deformada.

**Pendurar algo num osso herda a escala do rig.** O osso vive dentro do clone,
que leva `inst.modelScale`. Um filho do osso sai `modelScale`× maior; divida por
ela (`multiplyScalar(1/modelScale)`, nunca `setScalar`, que jogaria fora a
normalização de tamanho do próprio objeto). Offsets de posição em espaço de osso
também precisam ser divididos para valerem em metros de mundo.

## 6. Defeito herdado da fonte

No clipe **`prone`** o corpo deita mas fica **flutuando** acima do chão. Medido
no `Laying Sleeping.fbx` original: os ossos ficam entre 0,366 e 0,487 — ou seja,
**já vinha assim da fonte**, não é da conversão. O jogo compensa tombando o
objeto 90° em `Player.toggleProne()`. Se algum dia incomodar, o conserto é
baixar o clipe de novo no Mixamo ou corrigir a altura do Hips no Blender.

## 7. Página de inspeção

`inspecao.html` (servida pelo dev server) mostra cada clipe em loop, com câmera
orbital, controle de velocidade, o enquadramento real do jogo e um botão que
carrega o FBX original lado a lado para comparar a perda de detalhe. Use antes de
trocar qualquer asset.
