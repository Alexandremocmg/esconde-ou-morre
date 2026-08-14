---
name: personagem-glb
description: Gerar, riggar e integrar personagens 3D (GLB) vindos de image-to-3D (Higgsfield/Meshy) neste jogo Three.js. Use ao criar ou trocar o modelo do jogador/Caçador, ao adicionar ou trocar clipes de animação, ao ajustar cadência/poses, ou ao depurar malha com skin no Three.js (escala errada, pernas tortas, pé patinando, transição brusca, "pedalando bicicleta"). Contém as armadilhas já pagas — leia ANTES de gerar ou de mexer em PlayerModel.js.
---

# Personagem em GLB — pipeline e armadilhas

Conhecimento obtido construindo o boneco do jogo a partir de uma imagem de
referência. **Cada item abaixo custou pelo menos uma rodada de erro visível.**
Ler antes de gastar crédito ou de "consertar" a animação no código.

## 0. Antes de tudo: o que NÃO fazer

- **Não regenere o modelo para corrigir postura/animação.** Quase todo defeito de
  movimento que apareceu era código (medição, blend, cadência), não a malha.
- **Não "endireite" a pose de um clipe por código.** Ver §5 — quebra a passada.
- **Crédito é finito.** `image_to_3d` com rig ≈ 38 créditos; `3d_rigging` ≈ 8.
  Preflight sempre com `get_cost: true`.

## 1. Gerar o modelo (image-to-3D)

Ler `get_website_creation_instructions` → `references/game-meshy-input-rules.md`.
A regra que mais importa, e a que foi violada na primeira tentativa:

> **Membros SEPARADOS na imagem-fonte.** Braços colados ao tronco e pernas
> juntas fazem o Meshy fundir a geometria; os pesos do auto-rig vazam entre as
> pernas e, ao andar, elas **torcem e se fundem**.

Se a referência do usuário tem os membros colados, **edite a imagem antes**:
`generate_image` com a própria referência em `medias` pedindo A-pose com vãos
visíveis. Preserva o design e conserta a silhueta. (Passada medida subiu de
0,36 → 0,65 só com isso.)

Fundo: o Meshy quer fundo limpo. Se o PNG vier com xadrez de transparência
**queimado nos pixels** (alpha 255 em tudo), use `remove_background` do MCP —
flood-fill local come partes da figura.

Parâmetros que funcionaram (herói):
```
image_to_3d, pose_mode: "a-pose", should_texture: true, enable_pbr: false,
should_remesh: true, topology: "triangle", target_polycount: 20000,
enable_rigging: true, enable_animation: true, animation_action_id: <clipe>,
rigging_height_meters: 1.7, symmetry_mode: "on"
```
`enable_pbr: false` porque o brilho vem do `MeshPhysicalMaterial` no código.

## 2. Clipes extras são BARATOS — a malha do re-rig é lixo

`3d_rigging` devolve o clipe pedido **junto com a malha decimada** (20 662 → 400
triângulos, inutilizável). Não descarte o job: **extraia só a animação**.

```bash
python3 tools/extract-anim.py entrada.glb assets/player-<nome>.glb   # 2,5 MB → ~30 KB
```

Funciona porque os esqueletos saem do mesmo modelo (mesmos nomes de osso), e as
faixas do three.js casam **por nome**. `loadPlayerModel({ animUrls })` aceita
vários clipes e troca em tempo real.

O modelo base também traz o clipe da geração original embutido em
`gltf.animations` — aproveite-o (é de graça) em vez de gerar de novo.

## 3. Medir a malha com skin — `Box3` MENTE

`Box3.setFromObject` mede a **bind pose da geometria**, não o que a GPU desenha
(o auto-rig cria o esqueleto em cm, com `Armature.scale = 0.01`). Usar esse box
deu fator de escala errado e o boneco entrou na câmera.

- Meça os vértices **já deformados**: `applyBoneTransform` por vértice
  (`_posedBounds` em `PlayerModel.js`).
- **NÃO** chame `localToWorld` depois — as matrizes dos ossos já trazem a
  transformação do root; aplicar de novo **dobra a escala** (saiu 58× maior).
- Meça **uma vez** com o root em identidade e posicione analiticamente
  (`p*s + offset`); remedir depois de escalar reintroduz o erro.

## 4. Animação: pela DISTÂNCIA, nunca pelo relógio

- `mixer.update((dist / stride) * duração)`. Com `timeScale` fixo o pé patina
  ("anda devagar e avança muito").
- Use **velocidade suavizada** (passa-baixa), não o deslocamento bruto do quadro:
  colisão, degrau e latch fazem `dist` oscilar, e isso lê como **tremor**.
- `stride` é medido por clipe (excursão do pé × 2). A excursão **subestima** a
  passada real porque ignora a **fase aérea** → aplique um ganho (~2,0). Sem ele
  a cadência dava 4,8 ciclos/s; velocista real faz ~2,4.
- **Cada clipe tem passada própria** — meça por clipe, senão trocar de animação
  faz o pé patinar.

Conferência de sanidade: `velocidade ÷ altura do personagem` = alturas de corpo
por segundo. ~1 = caminhada, 3–5 = corrida. Aqui deu **4,9** → o clipe certo é de
corrida; nenhum ajuste salvaria um clipe de caminhada.

## 5. Poses: misturar com a pose de REPOUSO

Capture a pose de repouso dos ossos **antes de qualquer animação** e misture
(`applyPose(idle, lean, armDrop, crouch)`).

- **PARADO:** sem isso o boneco congela no meio da passada = "estátua correndo".
  Some respiração senoidal. Taxa ~3,5/s — mais rápido lê como corte.
- **NUNCA pause a ação** (`action.paused = true`) para segurar a pose: pausada, o
  mixer **para de reescrever os ossos** e o blend passa a operar sobre o próprio
  resultado anterior, **acumulando** — a transição salta (parece remendo). Use
  `mixer.update(0)`.
- `mixer.setTime()` **não reavalia ação pausada** — despause antes de amostrar
  poses (uma medição de passada saiu zero por isso).
- **Não amorteça a inclinação do corpo:**
  - amortecer o **Hips** gira o corpo todo e **tira os pés do chão** → lê como
    *pedalar bicicleta*;
  - amortecer a **Spine** é pior: no sprint a inclinação mora no quadril e a
    coluna faz a **contra-rotação** que segura o tronco; puxá-la ao repouso dobra
    o boneco mais.
  - Só **pescoço/cabeça** é seguro (faz olhar à frente).
- **Poses novas por osso** (ex.: agachar) são de graça — não precisa de crédito.
  Tire os sinais **de um clipe existente** (extraia rotX dos ossos e a altura do
  Hips) em vez de chutar. Agachar = coxa à FRENTE + canela ao CONTRÁRIO + quadril
  DESCE. Mesma direção nos dois vira *ajoelhar*; sem baixar o quadril os pés
  sobem.

## 6. Material e luz

`MeshPhysicalMaterial` (clearcoat) **precisa de environment map** — sem IBL a
cerâmica lê como plástico cinza chapado. `Game._addEnvironment()` gera
`RoomEnvironment` via PMREM. Só afeta o GLB: o cenário usa `MeshToonMaterial`,
que ignora `envMap`.

Camuflagem: mantenha o mapa base CLARO e tinja por `material.color` — a métrica
de `isCamouflaged()` compara `color`, então o disfarce continua honesto.

## 7. Regras do projeto

- O corpo procedural (`buildBody`) é **fallback**: se o GLB falhar, o jogo não
  pode ficar sem personagem.
- A cápsula de colisão/latch **nunca** muda com a pose — agachar é só visual.
- Exponha o que for calibrável no painel (`src/Tuner.js`), em vez de fixar no
  código: calibrar jogando é mais rápido que uma rodada de código por número.
- Sempre verifique com screenshot real (skill `verificacao-visual`), nunca "no
  olho" — todos os defeitos desta lista só apareceram renderizando.
