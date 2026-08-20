# Painel de ajuste ao vivo (⚙️)

> Ferramenta de dev **permanente** — não é uma fase com início/fim, é reaproveitada pra
> qualquer novo parâmetro de sensação (movimento, câmera, o que surgir) que precise ser
> calibrado jogando de verdade, não só olhando número ou rodando teste headless.

## Por quê

Depois de duas rodadas de "chuto um valor, faço deploy, o usuário joga, ainda não está
certo" pra calibrar o joystick (deadzone/curva/velocidade — ver histórico abaixo), ficou
claro que sensação de controle não dá pra acertar só matematicamente. O usuário sugeriu
expor os parâmetros numa tela pra ajustar ao vivo, no próprio celular, contra a build de
produção, e só depois passar os valores que sentiram certo. Essa ideia virou o padrão pra
esse tipo de ajuste daqui pra frente.

## Como usar

Abra o jogo com `?tune=1` na URL (ex.:
`https://esconde-ou-morre.vercel.app/?tune=1`). Sem esse parâmetro o botão nem existe no
DOM visível — nenhum outro jogador vê. A engrenagem (⚙️) aparece no canto inferior
direito; toca pra abrir/fechar o painel com um slider por parâmetro (`src/Tuning.js`,
array `TUNE_SPEC`) e um `<pre>` com os valores atuais formatados (mais um botão "Copiar
valores" pra área de transferência).

Mudanças aplicam **na hora**, sem reload (`TUNE` é um objeto mutável que `Joystick.js`/
`Player.js` leem todo frame — nunca uma cópia congelada). Persistem em `localStorage`
(`eom-tune-v1`) — sobrevive a fechar a aba/recarregar no meio de um teste no celular.
"Resetar padrão" volta pros valores hardcoded em `Tuning.js`.

## Arquitetura

- `src/Tuning.js` — `TUNE` (objeto mutável, valores atuais), `TUNE_SPEC` (label/faixa de
  cada slider, desacopla a UI dos nomes internos), `DEFAULTS` + `loadTune`/`saveTune`/
  `resetTune` (localStorage).
- `src/TunePanel.js` — `initTunePanel()`: confere `?tune=1`, monta os sliders a partir de
  `TUNE_SPEC` (não precisa editar HTML pra adicionar um parâmetro novo — só adicionar uma
  entrada em `TUNE_SPEC`), liga os eventos.
- `index.html` — só o botão `#tune-btn` e o container vazio `#tune-panel` (conteúdo
  montado por JS). `css/style.css` — escondidos por padrão (`display:none`), revelados
  só por `initTunePanel()`.
- Consumidores atuais: `src/Joystick.js` (`TUNE.deadzone`/`TUNE.curve`/`TUNE.knee`) e
  `src/Player.js` (`TUNE.turnSpeed`/`TUNE.moveSpeed`).

**Pra adicionar um novo parâmetro tunável no futuro:** acrescentar a chave em
`TUNE`+`DEFAULTS` e uma entrada em `TUNE_SPEC` (`Tuning.js`); no arquivo que consome,
importar `TUNE` e ler o campo **toda vez** que for usado (nunca cachear num `const` de
módulo — o painel muda em runtime, um cache ficaria congelado no valor do boot).

## Valores atuais (calibrados ao vivo pelo usuário, `Tuning.js:DEFAULTS`)

| Parâmetro | Valor | Era (1ª tentativa, só matemática) |
| --- | --- | --- |
| `deadzone` | 0.04 | 0.12 |
| `curve` | 2.3 | 2 |
| `knee` | 0.85 | 0.85 (sem mudança) |
| `turnSpeed` | 4 | 4 (sem mudança) |
| `moveSpeed` | 8.25 | 7.0 |

## Débito registrado: `moveSpeed` e o Caçador-IA

`moveSpeed` subiu de 7.0 pra 8.25, mas `Seeker.js:PLAYER_GROUND_SPEED` (constante própria
do Caçador-IA, **não lê `TUNE`**) continua em 7.0 — é o "teto de justiça": a perseguição
é sempre `PLAYER_GROUND_SPEED - 0.2` (6.8), de propósito um pouco mais lenta que o
jogador, pra nunca alcançar em linha reta. Com o Camaleão a 8.25, essa margem cresceu de
0.2 pra 1.45 — o Caçador-IA ficou proporcionalmente mais fácil de despistar em campo
aberto. **Decisão do usuário: deixar assim por agora**, reavaliar se sentir fácil demais
depois de jogar mais. Se um dia isso for revisitado, ajustar `PLAYER_GROUND_SPEED`/
`CHASE_SPEED_CAP` em `Seeker.js` pra acompanhar (ou trazer essa constante pro painel
também, já que é conceitualmente do mesmo tipo — velocidade calibrada por sensação).

## Bug real corrigido na mesma leva (não é calibração)

A animação de corrida (`Player.js`, clipe `run`/`rifleRun`/`climb`-em-movimento) sempre
tocava na cadência cheia (`timeScale` implícito = 1), mesmo depois do movimento virar
analógico (deflexão parcial do joystick = velocidade de translação reduzida) — as pernas
"corriam" enquanto o corpo mal saía do lugar. Corrigido escalando `action.timeScale` pela
distância REAL percorrida no frame (`speedRatio`, não o `speedScale` "pretendido" antes
da resolução de colisão), com piso de 0.15 pra não virar uma pose quase congelada bem no
limite da deadzone.
