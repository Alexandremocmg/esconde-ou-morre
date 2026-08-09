# Vertical Slice — Consolidação (variabilidade + refinamento procedural)

Status: **implementado**, pronto para o teste em `localhost:8000`.

Consolida o MVP (Fases 3–6) com duas frentes: **variabilidade de gameplay**
(layouts distintos por estágio) e **refinamento procedural** (geometria suave e
personagens mais vivos). Arquitetura mantida em **ES Modules** puros, sem bundler
nem passo de build. **Sem EffectComposer/Bloom** — desempenho mobile preservado.

## 0. Dependência (`index.html`)
- Adicionado `three/addons/` ao `importmap`, apontando para
  `examples/jsm/` do **mesmo pacote** `three@0.161.0` — continua "uma dependência".
- `<link rel="icon" href="data:," />` para eliminar o 404 de favicon (console limpo).

## 1. Bisel nos blocos (`src/Level.js`)
- `_addBox` passou de `BoxGeometry` para **`RoundedBoxGeometry`** (de
  `three/addons`), com raio pequeno e proporcional:
  `radius = min(0.22, 0.14 · min(w,h,d))`, `segments = 2`.
- As quinas suaves capturam melhor a luz do Sol/rim, dando acabamento profissional.
- **Latching/colisão preservados**: `climbables`, `colorables` e as AABBs
  `solids` (dimensões cheias `w/h/d`) permanecem idênticos. O bisel fica *dentro*
  da AABB e o raio pequeno garante que o raycaster de grudar/re-pin caia nas faces
  planas, não nos cantos arredondados. Verificado: badge **PAREDE** ao grudar em
  todas as paredes.

## 2. Detalhes procedurais dos personagens
### Jogador (`src/Player.js`)
- O olho único virou **dois olhos grandes** (esclera clara achatada + pupila
  escura) na face frontal (`local +Z`, perto do topo).
- **Articulação**: em `_animateFace`, as pupilas deslizam suavemente
  (lerp `EYE_LERP`) na direção do joystick (`joy.x`, `joy.y`), limitadas a
  `PUPIL_MAX` — dão vida mesmo parado ou grudado.
- **Cauda estilizada** (`this._tail`, cone afilado na base) com balanço lateral
  procedural `sin(t·5)` e leve inclinação conforme o avanço.
- Sem alocação por frame (reuso de vetores/estado, como no resto do arquivo).

### Caçador (`src/Seeker.js`)
- Corpo/visor/cone movidos para um **`this.bodyGroup`** interno que recebe um
  **bobbing** leve em Y (`sin(time·2.4 + fase) · amp`, `amp` 0.1 patrulha / 0.05
  perseguição) — sensação de drone flutuante; fase aleatória dessincroniza os 2
  Caçadores.
- **Visão intacta**: `this.group.position.y` continua fixo em `EYE_Y`, então
  `_canSee`/waypoints/captura seguem determinísticos — o bob é puramente visual.

## 3. Geração dinâmica de fases (`src/Level.js` & `src/Game.js`)
- `Level(scene, layout)` monta chão + perímetro comuns e despacha a estrutura
  interna para `_buildOpen` / `_buildMaze` / `_buildIslands`.
- `Level` expõe `this.spawn` (início do jogador) e `this.routes` (rotas de
  patrulha, 1 por Caçador), adequados a cada layout — evita spawn/waypoint dentro
  de bloco.
- **Estágio 1 — Arena Aberta**: layout clássico.
- **Estágio 2 — Labirinto de Corredores**: divisórias internas em "L", pilar
  central e blocos de canto formam quinas próximas (reação rápida); anel externo
  livre com ronda de 8 waypoints (cantos + meios das bordas).
- **Estágio 3 — Ilhas Centrais**: cluster de 5 blocos no meio, perímetro aberto,
  **2 Caçadores em rotas cruzadas** (`routes[0]` horário, `routes[1]` diagonal
  oposta) — já casado com `SECOND_SEEKER_STAGE = 3`.
- `Game.js`: `layout = ((stage - 1) % 3) + 1` (cicla p/ estágios > 3); jogador
  posicionado por `level.spawn`; Caçadores recebem `level.routes[i]`.
- `Player.js`: início lido de `level.spawn` (fallback para a posição antiga).

## Verificação (modo crítico)
- Screenshots mobile-landscape (844×390 @2x) via **Puppeteer headless** sobre o
  Chromium local (WebGL por SwiftShader), dirigindo o **Joystick real** por
  pointer events; console (`console`/`pageerror`/`requestfailed`) monitorado.
- Cada etapa só avançou com **console limpo** e visual aprovado:
  - Bisel: quinas iluminadas + latching OK em todas as paredes.
  - Personagens: pupilas seguindo o joystick, cauda visível, 2 cones no estágio 3.
  - Layouts: preview *top-down* (temporário) confirmou spawn/rotas navegáveis nas
    3 arenas.

## Checklist da Vertical Slice
- [x] Geometria suave (bisel) sem quebrar Latching/Raycaster/colisão.
- [x] Jogador com dois olhos articulados + cauda estilizada.
- [x] Caçador com flutuação procedural sem afetar a visão/IA.
- [x] 3 layouts por estágio (aberta / labirinto / ilhas) com spawn e rotas.
- [x] Documentação atualizada; console limpo nos 3 estágios.

## Ajuste rápido
- `Level.js`: `radius` do bisel; geometria/`spawn`/`routes` de cada `_build*`.
- `Player.js`: `PUPIL_MAX`, `EYE_LERP`, tamanho dos olhos e da cauda.
- `Seeker.js`: `amp`/frequência do bobbing.
- `Game.js`: mapeamento `stage → layout`, `SECOND_SEEKER_STAGE`.

## Backlog pós-slice
- Recorde persistente (`localStorage`) por estágio/% camuflado.
- Mais variações de layout e rotas adaptadas ao interior do labirinto.
- Three.js hospedado localmente (`assets/`) para deploy 100% offline.
