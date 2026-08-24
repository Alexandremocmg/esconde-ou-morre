# Mansão — re-tema, 2 andares e penumbra (implementado)

Substitui o tema Backrooms por uma **mansão de luxo em penumbra**, com 2 andares e
mecânica de penumbra. Segue o plano acordado (Fases 1b→6). Verificação 100% headless
(sem browser): mocks de three+canvas no scratchpad — **falta a validação visual**.

## O que mudou

### Fase 1b — Paleta (src/Level.js)
`MANSION`/`SIGNATURE`: 9 cores-alvo de camuflagem verificadas na métrica **sRGB**
(`Player.toSRGB`): mín. par-a-par 0.161, ≥0.145 do amarelo legado, ≥0.188 do boneco.
Só corpos **grudáveis** usam essas cores; a riqueza escura da cena vem de
`material.color` + normal map e de decoração **não-colorável** (lombadas, tapetes, telas).

### Fase 2 — Materiais (src/textures.js) — já existiam, agora conectados
`marble, parquet, damask, velvet, leather, boiserie, gilt` (camoSafe, albedo claro) +
`bookSpines, persianRug, oilPaint` (sceneOnly, escuros de propósito, `colorable:false`).

### Fase 3 — Arquitetura (Level.js + Game.js)
- `HALF` 40→**12.5** (pegada 25×25 m/andar). `Game.js`: fog quente 9–40, luzes âmbar
  de penumbra, frustum de sombra 42→**15**, `shadow.far` 90→42. `VISION_RANGE` 12→**7.5**.
- 3 alas (por estágio): **Salão** (pilares de mármore + lustre), **Corredor de Quartos**,
  **Galeria** (paredes de quadros). Estantes = 1 plano `bookSpines` (não 50 lombadas).
- **Bug herdado corrigido:** Level chamava `wallpaperTexture/carpetTexture/ceilingTileTexture`
  que já não existiam em textures.js → o jogo **não carregava**. Agora carrega.

### Fase 4 — 2º andar + navegação vertical (Level.js + Seeker.js + Player.js + Game.js)
- **Mezanino-varanda** (`FLOOR2_Y=3.4`) no perímetro sobre o hall aberto + **escadaria**
  central-sul (20 degraus). `walkables` (chão/lajes/degraus) separado de `climbables`.
  `occluders = climbables + lajes` (o 2º andar bloqueia visão entre andares);
  `cameraColliders` idem (câmera não atravessa o piso).
- Seeker: **Y por sonda de chão** (raycast ↓ contra `walkables`, rampa dá interpolação),
  alcance de waypoint **horizontal** (2D), **FOV vertical próprio** (`VERT_UP=0.50`,
  `VERT_DOWN=0.70`), **captura por banda vertical** (`CATCH_V_TOL=1.2`), `startY` por andar.
- **Distribuição por andar:** estágios <3 = 1 Caçador cruza os 2 andares pela escada;
  estágio ≥3 = 1 Caçador por andar (o 2º nasce no mezanino via `routeY`).
- Player: limite de degrau 0.06→**0.30** (`STEP_UP`) para subir a escada andando.

### Fase 5 — Penumbra (Level.js + Seeker.js + Game.js + HUD)
- `Level.fixtures` (velas/lustres/arandelas) + `Level.lightAt(pos)→0..1` (piso 0.25).
- `Seeker._canSee`: alcance efetivo `VISION_RANGE*(0.55 + 0.45*luz)` — no breu ~55%,
  na luz cheia 100%. **Camuflagem segue absoluta** (afeta só `sees`, não o portão).
- HUD: badge **🕯 NA PENUMBRA** (`light < 0.5`).

### Fase 6 — Escala (Seeker.js)
`VISION_RANGE` e waypoints-fallback reescalados. **O fino de velocidade/tempo de
sobrevivência precisa de PLAYTEST** (não é aferível headless).

## Verificação
- `scratchpad/harness.mjs` — instancia todos os layouts × {desktop,mobile}: sem exceção,
  climbables/colorables não-vazios, **108–126 meshes** (meta ≤400), nenhum climbable
  compartilhando material, mín. Δcor entre grudáveis ≥0.165.
- `scratchpad/harness_seeker.mjs` — simula 90 s de patrulha: o índice de waypoint avança
  (não trava) e o Y acompanha o andar (térreo 1.10 ↔ mezanino 4.50).
- `scratchpad/palette_check.js`, `light.mjs` — paleta sRGB e alcance por penumbra.
- **IMPORTANTE:** rodar `python3 -m http.server` e validar visualmente. Nenhum harness
  substitui o render (materiais, escala dos cômodos, feel da escada e da câmera).

## Correção — preso no 2º andar / tela preta (reportado no playtest)

**Sintoma:** grudar num corpo no 2º andar e tentar descer → tela preta e o jogador
não sai mais dali.

**Causa (3 defeitos encadeados, reproduzidos em `scratchpad/repro.mjs`):**
1. Descendo pela lateral, o jogador contornava a quina e o re-pin o prendia na face
   **inferior** do móvel (`wallNormal.y ≈ -0.97`) — pendurado de cabeça para baixo.
2. A câmera fica na direção da normal ⇒ com a normal para baixo ela era lançada para
   `y ≈ -0.35`, **dentro do bloco do piso** ⇒ tela preta.
3. `_detachToGround` exigia `feetY <= 0.02` (**chão fixo em y=0**): no 2º andar nunca
   era satisfeito, então "descer para sair" não soltava nunca.

**Correções:**
- `Player.MIN_LATCH_NY`: recusa grudar/permanecer em faces viradas para baixo (o
  re-pin solta em vez de pendurar). `_latchTo` agora retorna bool e o chamador respeita.
- `Player._supportTopBelow(x,z,maxY)`: piso do **andar atual** (laje/topo de bloco).
  `_updateLatched` e `_detachToGround(floorY)` usam-no no lugar de y=0 — descer no
  mezanino agora deixa o jogador **em pé no mezanino**.
- `FollowCamera._unstick()`: guarda aplicada à posição **final** da câmera — nunca
  permanece dentro de uma AABB sólida (defesa em profundidade contra tela preta).
- **Bug de nível:** ao alargar o anel do mezanino (borda interna 10→9) os armários
  ficaram em ±8.3, isto é, **flutuando no vão**. Reposicionados para ±10 (sobre a laje).

**Verificação:** `scratchpad/sweep.mjs` — 420 casos (todo climbable × 4 faces × 3
layouts), descendo até resolver: **0 presos, 0 tela preta, 0 quedas do mundo**.

## Expansão vertical — 3 níveis, quartos e 2ª escadaria

**Pedido:** mais 2º andar (o mezanino era um anel vazio com 2 armários).

- **Pé-direito** `WALL_H` 6.5 → **7.8** (abre espaço para o 3º nível).
- **Quartos do 2º andar** (`_buildUpstairsRoom`): 4 alcovas nos cantos do anel, cada
  uma com divisória **parcial** (parte da parede externa, para antes da borda interna),
  cama de veludo, guarda-roupa de ébano, tapete e arandela. A divisória corta a linha
  de visão ao longo do anel **sem criar beco** — o Caçador só tem whiskers, não pathfinding.
- **2ª escadaria** (norte, x=0, z=-5→-9.6): rota alternativa. Com uma escada só, a
  subida era um gargalo onde jogador e Caçador sempre se cruzavam.
- **3º nível — passagem elevada** (`MEZZ3_Y = 5.2`) sobre a faixa W: sobe, atravessa e
  desce, ocupando a **largura toda** da faixa. Vira parte do circuito do anel, então o
  Caçador cobre os três níveis sem waypoints especiais.
- `_addStairFlight(cx,w,z0,z1,baseY,topY,steps)` — lance genérico (com corrimão), usado
  pelas 4 escadarias; `_addStep` ganhou `baseY` para lances que partem de uma laje.

**Três defeitos encontrados e corrigidos pela simulação (não por inspeção):**
1. **Sonda de chão partia acima dos OLHOS** (`prevY+1.0` ≈ piso+2.1): o Caçador saltava
   até ~2 m e, onde há dois níveis sobrepostos (2º andar sob a sacada), era
   **teleportado para o de cima**. Agora parte de 0.5 acima dos **pés**.
2. **Whiskers usavam `occluders`** (que inclui as lajes): subindo uma escada em direção
   a uma laje, o Caçador lia a borda dela como parede e desviava para sempre. Passaram a
   usar `climbables` — lajes bloqueiam **visão**, não **navegação**.
3. **Sacada estreita deixava folga lateral de 1,1 m**: o Caçador contornava a escada
   rente à borda e nunca subia. Daí a largura total da faixa.
   (Também: a cama do quarto NW caía sobre a escada, e o guarda-roupa era posicionado
   **fora do mapa** em z=-13.35 — ambos corrigidos.)

**Verificação:** patrulha cobre Y de 1.10 a 6.30 nos 3 layouts (térreo → 2º andar →
passagem elevada); sweep de **544 casos**: 0 presos, 0 tela preta, 0 quedas.
Meshes 188–204 (meta ≤400).

## Fase 6 — Rebalanceamento (medido, não estimado)

Harness novo (`scratchpad/balance2.mjs`) mede **cobertura por NÍVEL**: para cada nível
(térreo / 2º andar / passagem) amostra os pontos onde dá para ficar em pé e conta quantos
o Caçador chega a enxergar dentro do tempo de partida.

**O que a medição revelou:**
- Com **1 Caçador e 3 níveis, sempre sobrava um nível quase sem vigilância**:
  L1 cobria 1% do 2º andar, L2 14% do térreo, L3 12% do 2º andar em 120 s. Ou seja: subir
  (ou descer) e ficar parado era vitória garantida.
- A rota de térreo do L3 era um **quadrado de 3 m no canto NE** — volta em 1,8 s,
  deixando o resto do andar sem ninguém. (Regressão introduzida na Fase 3.)
- A do L2 entrava fundo em 2 dos 4 quartos, deixando **77% do térreo nunca visto**.

**Mudanças:**
- **Um Caçador por DOMÍNIO desde o estágio 1** (`routes[0]`=térreo, `routes[1]`=andares
  altos, `routes[2]`=térreo invertido). Antes o 2º só entrava no estágio 3 — insustentável
  com 3 níveis. O 3º Caçador passa a entrar no estágio 3 (`THIRD_SEEKER_STAGE`).
- `Level._setRoutes(ground)` monta o trio de rotas + `routeY` de forma uniforme.
- Rotas de térreo reescritas nos 3 layouts (L3 varre o perímetro; L2 passa pelas **quatro**
  portas de quarto — espiar da porta cobre quase todo o quarto e sai barato em tempo de volta).

**Resultado (60 s, = tempo do estágio 1):** andares altos **90–93%**, passagem **100%**,
térreo **41–54%**. Nenhum nível é mais zona franca; o térreo mantém esconderijos reais.
Voltas de circuito: 13–23 s (todas < 75 s).

## Densidade visual

Ataca a queixa original (o ambiente). Tudo dentro das regras já estabelecidas: sem
post-processing, sem instancing, albedo claro nos materiais de camuflagem, superfícies
de cena com `colorable:false`.

- **Janelas altas** (`_buildWindow`) — o maior ganho visual por malha: as paredes de
  perímetro eram superfícies enormes e vazias. Caixilho dourado, vidro de noite
  (emissivo frio), montantes em cruz, duas cortinas de veludo e bandô. Ficam **acima da
  laje do 2º andar** (y≈5.1): são vistas de perto da varanda, iluminam o vão duplo por
  cima e não esbarram na mobília rente às paredes do térreo. N/S em x=±5; E/W em
  |z|=8.5 (evita a passagem elevada em |z|<6.5 e as divisórias em |z|=7.55).
  Cada uma registra uma luminária fria e ampla (luar) — entra na mecânica de penumbra.
- **Espelhos** (`_buildMirror`) — reflexo real exigiria um render target e um re-render
  da cena por espelho (zero infra). Aqui: moldura dourada + superfície escura
  `metalness:1.0, roughness:0.06`, que capta os emissivos ao redor. Lê como espelho a
  **2 malhas**. No salão, no corredor de quartos e na galeria.
- **Cimalha + rodapé** (`_buildTrim`) — duas faixas finas que fecham a parede e dão
  escala: 8 malhas para o cenário inteiro.
- **Mais telas-herói** na galeria e no salão; **lustres** no corredor de quartos (era a
  única ala sem nenhum) e no salão.
- As cortinas são **coloráveis** em bordô (cor já da paleta): mais alvos de camuflagem
  sem introduzir colisão de cor. Alvos coloráveis subiram de ~60 para 84–102.

**Custo:** 285–298 malhas (meta ≤400; antes 188–204). Cobertura e penumbra sem
regressão — centro de L2/L3 segue em 0.25 (penumbra) apesar das 8 luminárias novas.

## Aumento adicional do pé-direito (produção, resolve a pendência abaixo)

Feedback jogando em produção confirmou a sensação de "paredes baixas" descrita na
pendência original — mas o caminho escolhido foi o OPOSTO do que as duas opções (a)/(b)
propunham (nenhuma delas exigia baixar nada): em vez de baixar `WALL_H` pra caber no
mezanino, o pé-direito do salão subiu mais **+3m** e o piso superior **+2m**, com o
mezanino/escadaria acompanhando junto. Valores atuais (`src/Level.js`):

| Constante | Antes | Agora |
| --- | --- | --- |
| `WALL_H` (pé-direito do salão) | 7,8 | **10,8** |
| `ROOM_H` (paredes de cômodo do térreo) | 3,2 | **6,2** |
| `ROOM2_H` (divisórias do 2º andar) | 2,4 | **4,4** |
| `FLOOR2_Y` (laje do 2º andar) | 3,4 | **6,4** |
| `MEZZ3_Y` (sacada/passagem elevada) | 5,2 | **8,2** |

Teto/cornija/lustre/pilares e toda a decoração posicionada relativa a essas constantes
acompanharam automaticamente. Bug real exposto pela mudança: a escadaria térreo→2º andar
tinha número fixo de degraus (20) calibrado pro `FLOOR2_Y` antigo — cada degrau passou do
limite de `STEP_UP` (0,30m) que o jogador sobe andando, travando no meio da subida;
recalibrado pra 28 degraus. `src/net/occluders.js` (snapshot estático de geometria pro
hitreg do modo Online) foi regenerado do zero, já que as caixas de parede dependem
diretamente dessas constantes.

## Pendências / próximos passos
- ~~Escala do personagem vs. altura das paredes~~ — **resolvido** pelo aumento de
  pé-direito acima. Histórico do problema original, pra contexto: proporção pedida era
  boneco ≈45-50% da altura de parede em cômodo normal, ≈25-30% num salão de pé-direito
  alto; a sala normal já batia certo (1,44m / `ROOM_H` antigo = 45%), mas o teto único do
  prédio (`WALL_H` antigo) criava uma "janela" visível pro teto alto de qualquer cômodo,
  o que era a causa provável da sensação de desproporção — confirmado pelo feedback
  seguinte pedindo mais pé-direito, não menos.
- **Fino de dificuldade por playtest**: `BASE_SURVIVE=60`/`+15` por estágio e
  `DIFF_PER_STAGE=0.12` seguem os valores antigos, de quando o estágio 1 tinha **um**
  Caçador. Agora tem dois — pode estar duro no começo. Isso é sensação, não medição:
  precisa de você jogando.
- **Mezanino y=5.2** (varanda dupla): fora do escopo entregue (2 andares 0/3.4 já de pé).
- Camuflagem por padrão de lombada / espelhos reais: fora de escopo (ver plano original).

## Correção — escalada atravessava a laje e escapava da mansão nos cantos (reportado no playtest)

Dois bugs em `Player._updateLatched` (escalar parede — compartilhado entre Camaleão e
Caçador humano):

1. **Escalando até a altura do 2º andar, o personagem atravessava a laje** em vez de
   subir nela. `_updateLatched` só verificava colisão contra a MALHA da parede
   (`climbables`), nunca contra `level.solids` (que inclui as lajes) — só existia
   checagem de piso pra DESCER (`_supportTopBelow`, usado em `_detachToGround`).
   Corrigido reusando a mesma busca também pra SUBIR: se o topo sólido mais alto
   alcançável (`floorY`) ficou acima dos pés, emerge em cima dele em vez de atravessar.
2. **Escalando perto de um canto do perímetro, o personagem "vazava" pra fora da
   mansão.** Causa: as 4 paredes do perímetro são caixas que se sobrepõem exatamente no
   canto, e o movimento tangencial ao escalar (`side`/`up`, dentro do plano da parede)
   não tinha limite nenhum — contornar o bisel arredondado da própria caixa
   (`RoundedBoxGeometry`) podia grudar na face de FORA dela, ejetando o personagem.
   Corrigido travando o movimento nas duas direções tangenciais pela AABB real da
   parede (`EDGE_MARGIN`), ANTES de alcançar o bisel; ao bater na borda, tenta achar a
   parede PERPENDICULAR primeiro (sonda direta, não o padrão de offset do re-pin
   normal) pra virar o canto suavemente em vez de ficar preso ou vazar.

**Verificação:** testado em browser nos dois cenários (subir até a laje do 2º andar,
contornar um canto do perímetro escalando) — sem atravessar, sem vazar.

## Mapa 2 — Fábrica Abandonada de Brinquedos/Tinta (layout=4)

Primeiro mapa que NÃO é uma ala da mansão — casco próprio (`Level.js:_buildFactoryLevel`),
não passa por `_build()` (não herda paredes/mezanino/paleta da mansão), só reaproveita os
helpers de baixo nível (`_addBox`/`_addStairFlight`/`_deco`/materiais toon). Único nível +
passarela elevada (mais simples que o mezanino de 3 níveis da mansão): 4 cômodos de canto
(mesma topologia passável de `_buildRoom` — nunca beco sem saída) em volta de um piso
aberto central com 2 tanques de tinta (alvos de camuflagem) e caixotes.

**Paleta nova** (`FACTORY` em `Level.js`), verificada com o MESMO método sRGB da paleta
`MANSION` (script `scratchpad/palette_check_factory.mjs`, sessão): mín. par-a-par 0,238,
mín. vs. base do boneco 0,447 — folga maior que a própria `MANSION` (0,187/0,304).

**Dois bugs reais achados só com simulação de verdade** (não apareceram olhando o
desenho da planta):
1. A escada até a passarela subia ATÉ O MEIO da laje elevada em vez de parar na borda
   interna dela — mesma pegadinha já documentada pra escada da mansão ("CRÍTICO subir só
   até a borda, não além"), só que cometida de novo aqui por engano. O jogador ficava
   preso na transição escada→laje.
2. A passarela não tinha barreira nenhuma na borda EXTERNA (lado da parede) — um jogador
   simulado atravessando ela caía direto pro térreo. Corrigido esticando a passarela até
   encostar na parede do perímetro (em vez de adicionar mais um corrimão), o que também
   resolveu uma sobreposição real entre o anel da passarela e as paredes dos 4 cômodos de
   canto (a borda interna original ficava DENTRO do alcance deles).

**Online**: os 2 mapas elegíveis (`protocol.js:ONLINE_LAYOUTS = [1, 4]`) circulam por
rotação determinística de relógio (`onlineLayoutFor()`) — ver `docs/PLANO_MULTIPLAYER.md`
§4 item 3 pro raciocínio completo (por que não o servidor decidindo por sala).

**Verificação:** paleta (script dedicado), contagem de malhas (165, teto ~400 — orçamento
próprio, nunca renderiza junto com a mansão), simulação real do Player subindo a escada e
atravessando a passarela até a parede (sem travar, sem cair), regressão nos 3 layouts da
mansão (contagem de malhas idêntica à anterior), e teste headless `ws` cru contra o `Room`
real cobrindo os dois mapas Online (spawn certo por layout, oclusão bloqueando/liberando
tiro com o snapshot certo, `welcome.layout` batendo com o mapa realmente escolhido).
