# Plano — Virada visual TOON estilo Meccha Chameleon (opção A)

> Decisão do usuário: **virada completa de direção de arte** — sair do realismo PBR
> sombrio (mansão em penumbra) para o look **hand-drawn / claro / cute / cel-shaded**
> do Meccha Chameleon, **e** trocar a camuflagem automática (copiar cor ao grudar) por
> **pintura manual** (perícia do jogador), que é a alma do original.
> Alvo primário: **mobile web**, 100% procedural (nenhum asset externo).

Isto **reverte parcialmente** `PLANO_REALISMO.md` e a penumbra de `PLANO_MANSAO.md`.
Aqueles docs continuam válidos como referência da arquitetura (andares, escada,
climbables/solids, distribuição de Caçadores) — só a **camada de aparência** e a
**mecânica de camo** mudam.

---

## STATUS DE IMPLEMENTAÇÃO (atualizado 2026-08-11)

Decisão de escopo da camuflagem manual: **MVP** = conta-gotas mirado + roda de cor +
pose (crouch já existente). A "pintura livre por textura" fica para depois (Fase 9).

| Fase | Estado | Commit | Notas |
|------|--------|--------|-------|
| 1 — Render & luz claros | ✅ feito | `78ed7f5` | NoToneMapping, fundo/fog claros, luz plana branca, flicker removido |
| 2 — Cel-shading (MeshToonMaterial + gradientMap) | ✅ feito | `6fdd096` | `toonGradient()` em textures.js; troca nos choke points de Level/Player/Seeker |
| 2c — Achatar (sem normal nas superfícies grandes) | ✅ feito | `1403cc1` | `_addWall`/`_buildRoom` sem normalMap (banda ruidosa + fill-rate) |
| 3a — Contorno cel (inverted-hull) | ✅ feito | `1403cc1` | opção `outline` em buildHumanoid; **só Caçadores** (jogador não, p/ não denunciar camo) |
| 5a — Conta-gotas mirado | ✅ feito | `a8ad30a` | `Player.sampleColor(camera)` substitui `paintFromWall`; retícula `#reticle` |
| 5b — Roda de cor HSV | ✅ feito | `1b2560a` | `src/ColorPicker.js`; botão 🎛️ Cor; cor entregue em sRGB |
| 6 — Paleta pop/viva | ✅ feito | `8e2875c` | MANSION revisado; deltas verificados (par 0.169, boneco 0.290) |
| 7 — UI party + remover penumbra da detecção | ✅ feito | `9c53cf4` | badge removido; `_canSee` sem fator de luz; botões candy coloridos |
| 8 — Áudio (stingers de party) | ✅ feito | (este) | sons retrabalhados; +stinger `camo()` na borda de subida |
| 4 — Formas blob/cubo selecionáveis | ⬜ pendente | — | `buildHumanoid` → `buildBody(kind)`; deixado p/ o fim |
| 9 — Pintura livre por textura (fidelidade total) | ⬜ futuro | — | fora do MVP; pesado no mobile |

**Validação:** three vem por CDN (importmap), então não há harness node local — a
verificação é boot headless no Chromium (`chromium --headless=new
--enable-unsafe-swiftshader`) instanciando `new Game()` + `start()` + exercitando o
método da fase, mais **playtest visual** pelo túnel cloudflared. Cada fase acima passou
no boot headless sem erro e no playtest do usuário (Fases 1–5a confirmadas em runtime).

**Operacional:** servir SEMPRE com `python3 dev_server.py` (headers `no-store`), nunca
`http.server` — senão o túnel/navegador servem módulos ES antigos (importados sem `?v=`).

---

## 0. O que NÃO muda (para não regredir)

Preservar intocado — a virada é de *aparência* e de *como se aplica cor*, não de física:

- Colisão/latch/gravidade em `Player.js` (`_resolveHorizontal`, `_resolveVertical`,
  `_updateLatched`, `toggleLatch`, `MIN_LATCH_NY`, `STEP_UP`).
- Andares/escada/`solids`/`climbables`/`walkables`/`occluders` em `Level.js`.
- IA do Caçador (`Seeker.js`): patrulha, sonda de Y, FOV, captura por banda vertical.
- **A comparação de camuflagem continua sobre `material.color`** (`isCamouflaged`,
  `Game._tryCamouflage`) — mudamos **como o jogador define a própria cor**, não a
  métrica. `MeshToonMaterial` também tem `.color`, então a mecânica sobrevive à troca.

---

## 1. Fase 1 — Render & luz (maior impacto, menor custo) · `src/Game.js`

O ACES + penumbra quente é o que mais "suja" um look toon. Trocar primeiro dá o maior
salto visual com pouquíssimas linhas.

- **Tone mapping** (linha 44–47): `ACESFilmicToneMapping` → `NoToneMapping`
  (`toneMappingExposure = 1.0`). ACES comprime highlights e dessatura — cores chapadas
  precisam sair "cruas".
- **Fundo & fog** (linha 51–54): background escuro `0x120f0b` → **claro** (ex.
  `0xeaf0f5` / céu-papel). Fog: manter `THREE.Fog` mas **afastar muito** (ex. 30→120) ou
  desligar; o charme do Meccha é ambiente **legível**, não horizonte fechado.
- **`_addLights`** (linha 150–179): substituir a penumbra âmbar por luz **clara e plana**:
  - `HemisphereLight(0xffffff, 0xdfe3ea, ~0.95)` (céu branco, chão neutro claro).
  - `AmbientLight` claro e alto (~0.5) — toon quer sombra própria mínima.
  - Direcional continua **1 caster** (perf), mas **branca** e menos contrastada
    (`0xffffff`, ~0.7); reduzir `shadow.radius`/opacidade e, no mobile, **considerar
    desligar sombra** (o look cel raramente depende dela).
- **Remover o flicker fluorescente** (`_fluorFlicker`, linha 182–189) — é atmosfera de
  terror, não de party game. Deixa a luz-chave estável.

**Resultado esperado:** cena clara e legível já com os materiais atuais (validar antes de
seguir — é o ponto de maior risco/retorno).

---

## 2. Fase 2 — Materiais toon (cel-shading) · `src/textures.js` + `src/Level.js`

O "desenho" vem de `MeshToonMaterial` + `gradientMap` de poucos degraus. A troca é em
**pontos de estrangulamento** — a cena inteira passa por 4 funções.

### 2a. Rampa de sombreamento (novo, `textures.js`)
- Adicionar `toonGradient(steps = 3)`: `DataTexture` 1×N com N patamares (ex. 3–4),
  `magFilter = minFilter = NearestFilter`, `colorSpace = SRGBColorSpace`. Cacheada.
- Exportar para o Level/Player usarem o **mesmo** gradiente (consistência do sistema).

### 2b. Trocar a classe de material nos choke points (`Level.js`)
- `_makeMat` (145), `_addBox` (163), `_addWall`/`_stdMat` (136), `_addSphere`/`_addCylinder`/
  `_addCone`/`_deco`: `new THREE.MeshStandardMaterial({color,roughness,metalness})`
  → `new THREE.MeshToonMaterial({ color, gradientMap })`.
  - `MeshToonMaterial` **ignora `roughness`/`metalness`** (remover ou deixar — inertes).
  - Mantém `map`, `normalMap`, `emissive`, `color` → **API downstream intacta**.
- **Emissivos** (chamas/telas) seguem funcionando (`emissive`/`emissiveIntensity`).

### 2c. Achatar o realismo (o oposto do hand-drawn)
- **Remover `normalMap` das superfícies grandes** (paredes/piso em `_addWall`, `_buildRoom`):
  relevo PBR briga com o cel e queima fill-rate no mobile (ver `PLANO_REALISMO.md §0.2`).
  Manter normal só onde ajuda a silhueta, se ajudar.
- **Albedo mais chapado** (`MATERIALS` em `textures.js`, 682): reduzir ruído/manchas
  (`speckle`, `dampStain`) e trocar por **linhas/contornos pintados** no canvas — o
  charme "hand-drawn". Manter a regra de ouro: **albedo de média clara** (multiplica
  `material.color`, alvo da camo — não pode escurecer a leitura).

**Nota de perf:** a troca não muda draw calls (1 por mesh, como já documentado); ganho vem
de **menos normalMap** + **sombra mais barata/desligada**.

---

## 3. Fase 3 — Contorno cel (opcional, alto ganho de "cara") · `Character.js` + `Level.js`

Duas opções (escolher uma):

- **(3a) Inverted-hull** — por mesh herói (boneco, props grandes): um 2º mesh com
  `MeshBasicMaterial({ color:0x1a1a1a, side:THREE.BackSide })` levemente inflado
  (escala ~1.03 ou deslocado pela normal). Barato, robusto em mobile, seletivo.
- **(3b) Pós-processo Sobel** (`OutlinePass`/`EdgeDetection`): contorno global uniforme,
  porém adiciona uma passada de tela cheia — **caro no mobile**, provavelmente pular.

**Recomendação:** 3a só no boneco (e talvez nos Caçadores) — máximo retorno visual, custo
mínimo. Contorno em toda a cena tende a poluir num mapa denso.

---

## 4. Fase 4 — Personagem "tela em branco" · `src/Character.js` + `src/Player.js`

O boneco já é branco art-toy (bom começo). Alinhar ao Meccha:

- Corpo em `MeshToonMaterial` branco (`0xffffff`/quase) com o `gradientMap` compartilhado
  (`Player.js` bodyMat, 73; pupilMat, 95).
- **Formas selecionáveis** (assinatura do Meccha): além do humanoide atual, oferecer
  **blob** (esfera achatada, sem membros) e **cubo**. `buildHumanoid` vira uma fábrica
  `buildBody(kind)` com `kind ∈ {toy, blob, cube}` — todas compartilham UM material
  (a camo tinge tudo de uma vez). Fase inicial pode entregar só **blob** + atual.
- Contorno inverted-hull (Fase 3a) no corpo.

---

## 5. Fase 5 — Camuflagem MANUAL (a alma do Meccha) · `src/Player.js` + `src/Game.js`

Hoje: grudar (`toggleLatch`) → `paintFromWall()` **copia** a cor da superfície de uma vez.
Meccha: o jogador **compõe** a própria cor manualmente; o acerto é perícia.

### Design recomendado (escopo mobile, incremental)
1. **Conta-gotas (eyedropper) mirado** — em vez de copiar a superfície grudada por trás,
   o jogador **mira** (retícula central / direção da câmera) numa amostra e toca para
   sugá-la. Skill = alinhar na "mancha" certa. Reescreve `paintFromWall()` →
   `sampleUnderAim(camera)`: raycast na direção da câmera contra `colorables`, pega
   `material.color` do ponto. Funciona **grudado e no chão**.
2. **Roda de cor (fine-tune)** — HUD com um color-wheel/HSV para ajustar manualmente a
   cor sugada (aproximar do fundo por perícia). Novo `setCamouflage(color)` já existe;
   só alimentar a partir da UI. Guarda `targetColor`, lerp já implementado (159).
3. **Pose** — reaproveitar `toggleCrouch`/`Gait.crouch` como "encolher"; opcional: pose
   "deitar". Poses melhoram a leitura (silhueta) — puramente visual/estratégico.
4. **Métrica de acerto (mantida):** `isCamouflaged()` continua comparando
   `material.color` do jogador com a superfície **grudada** (não muda a métrica nem o
   portão de detecção). O que muda é que **acertar a cor agora é trabalho do jogador**,
   não automático → tensão/perícia estilo Meccha.

### Alternativa mais fiel (fase futura, maior custo)
Pintura por-textura no corpo (CanvasTexture editável por toque) e score por comparação
da textura com o fundo do ponto de vista do Caçador. Poderoso, mas pesado no mobile —
**fora do MVP da virada**; documentar como "Fase 9 — pintura livre".

**Trade-off a confirmar contigo:** MVP = **eyedropper mirado + roda de cor + pose**
(perícia real, custo baixo). Pintura livre por textura fica para depois.

---

## 6. Fase 6 — Cenário claro & vibrante · `src/Level.js`

- **Paleta** (`MANSION`/`SIGNATURE`/`HERO_COLORS`, ~1040): sair dos tons de material
  discretos/escuros para **cores vivas e chapadas** por cômodo (o Meccha tem estágios
  temáticos coloridos). Manter a **restrição de camuflagem**: Δcor sRGB par-a-par ≥ ~0.16
  entre grudáveis (rodar `scratchpad/palette_check.js` de novo com a paleta nova).
- Reduzir decoração "suja" (lombadas escuras, tapetes persa, óleo) → substituir por
  formas alegres/planas ou manter poucas como pontos de cor.
- Fog claro coerente com Fase 1.

---

## 7. Fase 7 — UI party-game · `index.html` + `css/style.css`

- Remover o HUD de tensão: `#penumbra-badge` (🕯 NA PENUMBRA — some junto com a penumbra),
  `#vignette`, `#alert` viram feedback mais "cartoon".
- Botões `#actions` (`#btn-latch`, `#btn-paint`, `#btn-crouch`): visual grande, colorido,
  arredondado. `#btn-paint` passa a abrir a **roda de cor** (Fase 5) + conta-gotas.
- `#color-chip` continua mostrando a cor atual do disfarce (feedback do lerp).
- `#hint` reescrito para a nova mecânica (mirar/sugar/ajustar cor).
- Paleta de CSS clara e saturada (tipografia redonda, sombras suaves).

---

## 8. Fase 8 — Áudio & tom · `src/Audio.js`

Trocar o clima de terror (batida cardíaca, zumbido) por **stingers cômicos/party**
(sugar cor, camuflar, ser pego). Menor prioridade; ajuste fino.

---

## 9. Ordem de execução recomendada

1. **Fase 1** (render/luz) — commit isolado, validar no browser (maior risco visual).
2. **Fase 2** (materiais toon) — validar leitura de cor da camo continua honesta.
3. **Fase 4** (boneco branco toon) + **Fase 3a** (contorno) — herói primeiro.
4. **Fase 5** (camo manual) — a mudança de gameplay; playtest obrigatório.
5. **Fase 6** (paleta viva) + rodar `palette_check`.
6. **Fase 7/8** (UI/áudio) — polish.

Cada fase = 1 commit; **validação visual no browser** a cada uma (nenhum harness headless
substitui o render toon — materiais, gradiente, contorno e feel da pintura).

## 10. Verificação

- `scratchpad/palette_check.js` — Δcor sRGB da nova paleta viva ≥ limiar.
- `scratchpad/harness.mjs` — layouts × {desktop,mobile}: sem exceção, contagem de meshes
  no orçamento, climbables/colorables não-vazios (a troca de material não deve quebrar).
- `scratchpad/harness_seeker.mjs` — patrulha inalterada (não tocamos na IA).
- **Playtest** — feel da pintura manual (eyedropper + roda), legibilidade em mobile, FPS
  com/sem sombra.

## 11. Riscos

- **`MeshToonMaterial` + camuflagem:** a métrica lê `.color` (linear) — inalterada; mas o
  **gradientMap** muda a *aparência* da cor sombreada → revalidar a leitura "honesta"
  (albedo claro + gradiente claro).
- **Pintura manual pode ficar frustrante** no touch — calibrar tolerância do eyedropper e
  do portão de detecção no playtest.
- **Reversão de escopo:** penumbra (`Level.lightAt`, `Seeker._canSee` com fator de luz) —
  decidir se a luz deixa de afetar detecção (coerente com cena clara) ou vira mecânica
  vestigial. Recomendo **remover o fator de penumbra** da detecção nesta virada.
