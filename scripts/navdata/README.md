# Dados de navegação e esconderijos da IA

Gera `server/navdata.js` (grade de navegação do térreo + esconderijos de cada mapa do
Online) a partir do **jogo real**. Desenho e motivos em
[`docs/PLANO_IA_ESCONDERIJOS.md`](../../docs/PLANO_IA_ESCONDERIJOS.md).

## Quando regerar

Sempre que mexer, no térreo de um layout do Online (`ONLINE_LAYOUTS`), em: parede, móvel,
escada, buraco de laje, ou a cor de uma superfície colorável. `server/navdata.js` é um
snapshot e **não sabe que o mapa mudou** — o sintoma de dado velho é a IA andando por
dentro de um móvel novo ou "camuflada" numa cor que a parede já não tem. Os testes
(`server/test/botai.test.mjs`) não enxergam o `Level.js` e não detectam isso.

## Passo a passo

Três processos: o servidor estático do jogo, o coletor, e uma aba do navegador.

```bash
python dev_server.py 8000                 # servidor do jogo (ou o preview do Claude Code)
node scripts/navdata/collect.mjs 8790     # coletor: grava scripts/navdata/out/layout-N.json
```

Para **cada** layout (1, 4 e 5), abra o jogo em modo solo Camaleão no estágio que dá aquele
layout e rode a extração no console do navegador:

```js
// 1) entre no jogo no layout desejado (?stage=1 | 4 | 5), modo Camaleão
sessionStorage.setItem('eom-mode', 'chameleon');
location.href = '/?stage=4&continue=1';   // troque o 4 pelo layout

// 2) depois que o jogo carregar, rode a extração (leva alguns segundos; 15-30s no layout 5)
const m = await import('/scripts/navdata/extract.browser.mjs');
m.extractAndSend(window.game);            // posta o resultado pro coletor
// acompanhe: window.__navdataStatus  ->  "ok layout 4 {...}" quando terminar
```

Depois das três extrações:

```bash
node scripts/navdata/build.mjs            # lê out/*.json e reescreve server/navdata.js
cd server && npm test                     # a suíte da IA confere o que foi gerado
```

Confira o relatório do `build.mjs` (células alcançáveis e esconderijos por layout) e olhe
o diff de `server/navdata.js`: uma mudança grande onde você não mexeu no mapa é sinal de
problema.

## O que cada peça faz

- **`extract.browser.mjs`** (roda na página): monta a grade testando cada célula contra
  `level.solids` (paredes e móveis no térreo) e `level.walkables` (piso, degrau, buraco), e
  descobre esconderijos usando o **próprio `Player`** — `toggleLatch` em 16 direções a
  partir de cada célula perto de obstáculo, e `_surfaceBehindZone`/`_surfaceBelowColor`
  para as cores. Congela o jogo (`game.over = true`) enquanto roda.
- **`collect.mjs`**: recebe o JSON que a página posta (a grade do layout 5 passa de 38 mil
  caracteres, grande demais para devolver pelo console) e grava em `out/` (ignorado pelo git).
- **`build.mjs`**: descarta o que não é alcançável a partir do spawn, liga cada esconderijo
  a uma célula de aproximação, afina (1,5 m entre paredes, 1,8 m entre tapetes, teto de 220
  por layout) e emite `server/navdata.js` de forma determinística.

## Parâmetros

No topo de cada arquivo: raio da IA (`BOT_RADIUS`, 0,4 m) e faixa de altura que bloqueia
(`BLOCK_MIN_Y`/`BLOCK_MAX_Y`) em `extract.browser.mjs`; separação e teto de esconderijos
em `build.mjs`. Um layout novo precisa entrar em `LAYOUTS` de `build.mjs`.
