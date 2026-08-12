# Plano — 4º modelo "🪆 Manequim" articulado (paridade de personagem)

> Objetivo: adicionar um **manequim de desenho articulado branco** (como o do Meccha
> Chameleon) como **4º modelo** selecionável, ao lado de 🧍 Boneco, 🫧 Blob, 🧊 Cubo.
> Decisões do usuário: **mantém os olhos**; **adiciona** (não substitui); **com flexão**
> de joelho/cotovelo. 100% procedural (cápsulas + esferas).
>
> **Status: ✅ implementado — REVISADO.** A 1ª versão (manequim de madeira articulado com
> juntas esféricas + flexão de joelho/cotovelo) ficou **estranha ao movimentar** e não
> batia com o modelo real. O modelo do Meccha é um **pictograma MACIO e sem juntas**.
> Versão final: `kind:'mannequin'` = cabeça-bola grande + torso ovoide único + braços/
> pernas lisos de UMA peça (pontas arredondadas), **sem articulação**. Removidos o helper
> `seg2` e a flexão do Gait (código morto). 4º botão 🪆 no menu. Validado headless.

## Diferença vs. o "boneco" (toy) atual
O toy é chibi/atarracado, 1 cápsula por membro. O manequim é **esguio e segmentado**,
com **juntas esféricas visíveis**:
- Cabeça ovoide + **pescoço-pino**.
- Torso em **peito + pelve** com **junta de cintura** (esfera).
- Braços em **2 segmentos** (braço+antebraço) com **ombro + cotovelo** esféricos.
- Pernas em **2 segmentos** (coxa+canela) com **quadril + joelho** esféricos.

## Implementação
### `src/Character.js`
- Novo `kind === 'mannequin'` em `buildBody`. Helper `seg2(mat, opts)` cria um membro de
  2 segmentos com juntas, retornando `[topPivot, secondPivot]` (topo = ombro/quadril;
  second = cotovelo/joelho, filho do 1º segmento).
- **Contrato de rig preservado + estendido:** `legs`/`arms` continuam os pivôs de topo
  (Gait balança daí). Novos arrays **`shins`/`forearms`** (pivôs secundários) no rig,
  usados só pela flexão.
- **Zonas P1:** `upper` = cabeça/pescoço/peito/cintura/braços; `lower` = pelve/pernas.
- Retorna `headR/headY` (olhos do Player caem na cabeça ovoide).

### `Gait` (em `Character.js`)
- Nova **flexão** (só se `rig.shins`/`rig.forearms` existem — toy/blob/cube não têm):
  joelhos dobram para trás (+X) e cotovelos para a frente (−X), com base leve + bombeada
  no passo (sync com `phase`) + termo de agachamento (`crouch`). Guardado por presença,
  então **não afeta os outros modelos**.

### UI
- `index.html`: 4º botão `data-kind="mannequin"` (🪆 Manequim) no `#body-pick`.
- `css/style.css`: `#body-pick` com `flex-wrap` e botões um pouco menores (cabe 4).
- `main.js`: sem mudança (o seletor itera os botões genericamente; persiste `eom-body`).

### Sem mudança
Player (só passa `kind`; olhos mantidos), Seeker (usa `buildHumanoid`=toy), P1/P2/P3.

## Verificação
- Boot headless: `buildBody({upper,lower},1,{kind:'mannequin'})` constrói; rig tem
  `legs[2]/arms[2]/shins[2]/forearms[2]`; Gait anima (swing + flexão) e agacha sem erro;
  Game completo com `eom-body='mannequin'` inicia.
- Playtest: proporções, leitura das juntas, caminhada com joelho/cotovelo, camuflagem
  (zonas/estampa/deitar) e olhos/contorno seguem funcionando.

## Futuro (fora do escopo)
Faceless opcional; dedos/mãos; ajuste fino da cadência de flexão.
