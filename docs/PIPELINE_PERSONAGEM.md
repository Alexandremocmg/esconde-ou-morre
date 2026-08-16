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
41 ossos e os 7 clipes embutidos.

| | Antes | Depois |
|---|---|---|
| Download | ~47 MB (7 FBX) | **1,43 MB** (1 GLB) |
| Faces por personagem | 204.344 | **12.000** |
| Triângulos na cena (3 personagens) | ~1,07 M | **109 K** |
| Heap com o jogo rodando | 86 MB | **14 MB** |

Os FBX originais continuam versionados em `public/animation/` — são a **fonte**
para regerar o GLB. O jogo não os baixa mais.

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

**O GLB vem centrado na origem** (bbox de −0,5 a +0,5), enquanto o FBX tinha os
pés em y=0. `createInstance` compensa com
`clone.position.y = -bbox.min.y * scale`; sem isso o personagem afunda meio corpo
no chão.

**Frustum culling some com o personagem.** A bounding sphere de um `SkinnedMesh`
é calculada uma vez na bind pose e nunca recalculada, então em certos ângulos o
Three.js para de desenhar. `createInstance` marca `frustumCulled = false`.

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
