---
name: level-design
description: Pipeline para criar ou modificar um mapa/nível jogável neste projeto (Level.js) — arquitetura, rotas de IA, paleta de camuflagem, orçamento de malhas e verificação headless. Use SEMPRE que for criar um mapa/fase/ala nova, adicionar cômodo, mexer em escada/mezanino/passarela, rotas de patrulha do Seeker ou ChameleonTarget, paleta de cores camufláveis, ou aparecer sintoma como "o Caçador não sobe a escada", "trava no meio da subida", "atravessa a laje", "cai do mapa", "o boneco flutua fora da geometria", ou pedido de novo layout/mapa.

---

# Design de níveis (`src/Level.js`)

Este projeto NÃO faz geração procedural por seed/heightmap/ruído — apesar de "mapa
novo" soar como PCG clássico, o modelo real aqui é outro. Ler a seção seguinte antes
de aplicar qualquer guia genérico de PCG (heightmap, erosão, Wave Function Collapse,
chunk streaming, bioma por umidade/altura) — a maior parte **não se aplica** e tentar
encaixar à força é retrabalho.

## O modelo real deste projeto

Existe um número **pequeno e fixo** de layouts hand-authored, cada um escolhido por
**índice numérico**, nunca gerado do zero por seed do jogador:

- Solo: cicla por estágio (`(stage-1) % N + 1`, `N` = quantidade de layouts hoje).
- Online: `onlineLayoutFor()` (`net/protocol.js`) escolhe por **rotação determinística
  de relógio** (hora cheia UTC) — cliente e servidor calculam o mesmo índice sem
  round-trip, porque o servidor **nunca roda Three.js/Level.js** (só Node puro) e
  precisa concordar com o cliente sobre a geometria de colisão a partir de um
  snapshot estático (`net/occluders.js`).

O único PRNG do arquivo é `mulberry32`, **semeado pelo número do layout**
(`Level.js`, perto do fim) — usado só pra **disposição de props/decoração**
("mesmo layout → mesma disposição"), nunca pra decidir onde ficam paredes, salas ou
rotas. Isso é proposital, não uma limitação a corrigir: se a geometria de colisão
mudasse por sessão, o snapshot `net/occluders.js` do modo Online ficaria
permanentemente dessincronizado do que o cliente realmente desenha.

**Conclusão prática:** "criar um mapa novo" aqui é escrever uma função `_buildX()`
determinística que monta a geometria com os helpers já existentes — não plugar um
algoritmo de geração. Ideias do mundo PCG que SE aplicam: ruído multicamada pra
variar a disposição de props (já é o que `mulberry32` faz, em miniatura), pipeline
em etapas (layout → features → detalhe → validação), e testar em escala (rodar a
validação headless contra o layout inteiro, não uma amostra visual).

## Decisão de arquitetura: casco próprio vs. estender `_build()`

Dois padrões já existem, ambos válidos:

- **Estender `_build()`** (as 3 alas da mansão) — compartilha paredes/mezanino/
  paleta/constantes de altura já montadas. Certo quando o mapa novo é
  tematicamente a mesma "casa" (multi-andar, mesma família de cor).
- **Casco próprio**, tipo `_buildFactoryLevel()` — não passa por `_build()`, só
  reaproveita os helpers de baixo nível (`_addBox`, `_addStairFlight`, `_deco`,
  materiais toon). Certo quando o mapa é estrutural/tematicamente distinto (outro
  número de andares, outra paleta, outra "casa" por completo). `Level`'s
  construtor decide com um `if (this.layout === N) this._buildX(); else this._build();`.

Em qualquer um dos dois caminhos, o **contrato de saída é o mesmo** (próxima seção)
— quem consome (`Seeker.js`, `ChameleonTarget.js`, `Game.js`, `net/occluders.js`)
não sabe nem precisa saber qual dos dois caminhos gerou o mapa.

## Contrato de saída obrigatório

Ao fim da construção, `this.<campo>` precisa estar populado, senão a IA (Seeker
E ChameleonTarget, que leem exatamente os mesmos campos) quebra silenciosamente:

- **`this.routes`** — array de arrays de pontos `wp(x, z)` (`wp` já devolve
  `Vector3(x, ROUTE_Y, z)`, não precisa calcular Y). Convenção: `routes[0]` =
  térreo, `routes[1]` = andar/domínio de cima (se existir), `routes[2]` = térreo
  invertido (usado pelo 3º Caçador em estágios altos). Pelo menos 2 rotas se há
  mais de um domínio navegável.
- **`this.routeY`** — array paralelo a `routes`, com a altura de OLHOS (não pés)
  de cada rota.
- **`this.colorables`** — superfícies que a camuflagem pode copiar (paredes,
  móveis, tanques...). **Nunca o piso genérico** — piso é "cor livre" por
  convenção (`colorable: false`), senão o Camaleão/alvo nunca sai do verde de um
  tapete parecido com outro em qualquer canto do mapa.
- **`this.climbables`** — superfícies grudáveis E usadas pelos bigodes de desvio
  de obstáculo (Seeker/ChameleonTarget).
- **`this.solids`** — AABBs de colisão horizontal.
- **`this.walkables`** — chão/lajes/degraus, alvo do raycast pra baixo que dá o Y.
- **`this.occluders`** e **`this.cameraColliders`** — se for casco próprio, monte
  explicitamente no fim: `this.occluders = this.climbables.concat(this._slabs);
  this.cameraColliders = this.climbables.concat(this._slabs);` (mesmo passo final
  que `_build()` já faz pros layouts que passam por ele).
- **`this.spawn`** — `Vector3` do ponto de spawn padrão.

## Regra de topologia: nunca beco sem saída

Seeker e ChameleonTarget **não têm pathfinding** — só movimento reativo (bigodes +
colisão-deslizante) em linha reta até um waypoint. Conectividade não é verificada
por um algoritmo de grafo em tempo de jogo: é uma **garantia de design**, que você
precisa manter na hora de desenhar a topologia. `_buildRoom`/`_buildFactoryRoom` já
encodam isso — todo cômodo maior que um closet tem pelo menos 2 portas em paredes
diferentes (nunca 1 porta só, nunca beco).

## Landmines conhecidas (cada uma já mordeu de verdade, em mapas diferentes)

1. **Escada até uma laje elevada precisa PARAR na borda INTERNA da laje, nunca ir
   além.** A laje é um sólido; se a escada continuar por baixo dela, a face frontal
   do sólido vira parede e a transição escada→laje trava o jogador/IA no meio.
   Já aconteceu 2x de forma independente (mezanino da mansão, passarela da
   Fábrica) — é fácil de cometer de novo. `_addStairFlight(cx, width, z0, z1,
   baseY, topY, steps)`: `z1` (ou `z0`, dependendo da direção) tem que ser
   exatamente a borda interna, não um valor "redondo" arbitrário.
2. **Sonda de chão (Seeker/ChameleonTarget) parte de ACIMA DOS PÉS, nunca dos
   olhos.** Partir dos olhos faz o agente "saltar" até ~2m onde há dois níveis
   sobrepostos (ex.: andar de baixo sob uma sacada) — ele é teleportado pro nível
   de cima por engano.
3. **Bigodes de desvio usam `climbables`, NUNCA `occluders`.** `occluders` inclui
   lajes (que devem bloquear VISÃO entre andares); se os bigodes também as
   tratarem como obstáculo, o agente lê a borda de qualquer laje como parede e
   nunca completa a subida de uma escada.
4. **Passarela/mezanino precisa de barreira na borda EXTERNA inteira** (senão a
   IA/jogador simulado atravessa e cai pro andar de baixo) **e a borda INTERNA
   precisa ficar ALÉM da extensão de qualquer cômodo de canto** (senão o anel da
   passarela atravessa fisicamente as paredes desses cômodos — as duas AABBs
   passam a se sobrepor na mesma faixa de Y).
5. **Nunca deixe prop/móvel "flutuando"** — fora dos limites do mapa ou num vão
   sem piso embaixo. Já aconteceu 2x (guarda-roupa fora do mapa; armários caindo
   num vão depois de um reajuste de borda) — sempre reconfira posição de
   decoração depois de mudar qualquer constante de layout.
6. **Corredor/anel largo o bastante pra não virar gargalo de 1-agente-só.** Uma
   folga lateral de 1,1m ao lado de uma escada já foi o bastante pra um agente
   contornar rente à borda e nunca completar a subida.

## Paleta de cor de camuflagem

Cores de superfícies `colorable: true` são verificadas por **distância sRGB**
(`Player.toSRGB`) — não RGB linear, porque o espaço linear comprime diferenças de
tom escuro e produz falso-positivo de camuflagem (duas cores "parecidas" no
jogo, mas com valores lineares bem distintos). Mínimo par-a-par entre as cores da
paleta E mínimo contra a cor-base do boneco — ambos precisam de folga clara. Os
números exatos mudam conforme a paleta evolui; confira o valor atual em
`docs/PLANO_MANSAO.md` (paletas `MANSION` e `FACTORY` como referência) em vez de
copiar um número fixo daqui. Escreva/adapte um script no mesmo padrão de
`scratchpad/palette_check_factory.mjs` (verificado nesta sessão) pra qualquer
paleta nova — não confie em "parece diferente na tela".

Piso genérico e decoração "de cena" (livros, quadros, tapetes escuros de
propósito) ficam `colorable: false` — só entram na paleta verificada as
superfícies que a camuflagem realmente pode copiar.

## Orçamento de malhas

Cada mapa tem seu próprio orçamento de ≤400 malhas — mapas nunca renderizam
juntos, então não competem entre si, mas cada um sozinho precisa caber (celular é
o alvo de performance). Referência histórica: a mansão passou por
108–126 → 188–204 → 285–298 malhas ao longo de fases de densidade visual; a
Fábrica Abandonada entrou com 165. Conte as malhas do layout novo (mesmo
`scratchpad/harness.mjs` faz isso pra todos os layouts × {desktop, mobile}) antes
de considerar terminado.

## Como verificar (headless primeiro, browser depois — nunca só inspeção visual)

**Toda landmine listada acima foi encontrada por simulação, não olhando o
desenho da planta.** A prática estabelecida neste repo é escrever um harness
headless (mocks de Three.js/canvas em `scratchpad/`, não versionado) antes de
declarar um mapa pronto:

1. **Contagem de malhas** por layout × {desktop, mobile}.
2. **Paleta sRGB** — script dedicado, ver seção acima.
3. **Navegabilidade da IA**: instancie o `Seeker`/`ChameleonTarget` no layout novo
   e rode alguns minutos simulados de `update(dt)` — confirme que o índice de
   waypoint **avança** (não trava) e que o Y **acompanha o andar/domínio certo**
   em vez de ficar preso num valor.
4. **Sweep de física**: para cada superfície grudável × várias faces × o layout
   novo, simule escalar/descer/atravessar — 0 presos, 0 "tela preta"
   (câmera dentro de sólido), 0 quedas do mundo. Ao aumentar qualquer constante
   de altura/largura, refaça esse sweep — mudanças de escala já quebraram escada
   e mezanino mais de uma vez.
5. **Cobertura por domínio** (opcional, mas revelador): amostre pontos
   "em pé" por nível e conte quantos a IA chega a enxergar dentro do tempo de uma
   partida — já revelou rotas que cobriam <15% de um andar inteiro, invisível
   numa inspeção visual da planta.
6. **Regressão nos layouts existentes**: contagem de malhas idêntica à anterior
   nos mapas que você NÃO tocou — confirma que os helpers compartilhados não
   quebraram nada.
7. **Só depois disso, `dev_server.py` + validação visual real no browser** —
   nenhum harness substitui o render (materiais, escala dos cômodos, "feel" da
   escada e da câmera).

## Se o mapa deve entrar no modo Online

- Adicione o número do layout a `ONLINE_LAYOUTS` (`net/protocol.js`).
- `server/room.js`: entradas por layout em `HUNTER_SPAWN_BY_LAYOUT`,
  `CHAMELEON_SPAWN_BASE_BY_LAYOUT`, `CHAMELEON_SPAWN_RADIUS_BY_LAYOUT` — pontos
  já testados sem colisão dentro do layout.
- `net/occluders.js`: gere um snapshot novo (`LAYOUT_N_OCCLUDERS`) — o servidor
  nunca roda `Level.js`, então esse array estático é a única fonte de verdade
  dele pra oclusão de tiro. Regenere sempre que a geometria de PAREDE do mapa
  mudar (não decoração — só o que bloqueia tiro/visão de verdade).
- `server/navdata.js` (**gerado**, não edite à mão): grade de navegação e esconderijos
  da IA do servidor, do térreo do mapa. Rode a extração no jogo real
  (`?stage=N`) e `node scripts/navdata/build.mjs` — passo a passo em
  `scripts/navdata/README.md`. **Regenere sempre que mexer em parede, móvel, escada,
  buraco de laje ou cor de superfície colorável do térreo**: o arquivo não sabe que o
  mapa mudou. Sintoma de dado velho: IA andando por dentro de um móvel novo, parada
  num lugar que virou parede, ou "camuflada" numa cor que a parede já não tem.
  `server/test/botai.test.mjs` roda nos layouts 1, 4 e 5 e cobre a coerência do que foi
  gerado, mas NÃO enxerga o `Level.js` — não detecta mapa que mudou sem regerar.
- Teste headless com `ws` cru contra o `Room` real: spawn correto por layout,
  oclusão bloqueando/liberando tiro com o snapshot certo, `welcome.layout`
  batendo com o mapa que o servidor realmente escolheu.

## Depois de terminar

Siga o workflow de Ingest de [`../../../CLAUDE.md`](../../../CLAUDE.md): atualize
`docs/PLANO_MANSAO.md` (ou crie uma doc própria se a família de mapas divergir o
bastante) com o que mudou e quais landmines desta lista você encontrou de novo —
e acrescente uma entrada em `docs/_log.md`.
