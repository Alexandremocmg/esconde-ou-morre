# Log de trabalho (raw, só-acrescenta)

Registro cronológico de trabalho significativo feito por qualquer sessão do
Claude Code neste repo. **Nunca edite ou apague entradas antigas** — se algo
mudou de novo, acrescente uma entrada nova explicando o que mudou. Instruções
de uso: [`../CLAUDE.md`](../CLAUDE.md).

Formato de cada entrada: data, resumo de 1-2 parágrafos, arquivos/commits
principais.

---

## 2026-08-23/24 — Plano 3: IA dos alvos do modo Caçador

Camaleões-alvo (`ChameleonTarget.js`) deixaram de ser bonecos parados: agora
vagueiam pela própria rota, fogem ao serem avistados pela lanterna do Caçador
(com histerese) e recolorem periodicamente sampleando o ambiente real — tudo
escalando por estágio no mesmo padrão do `Seeker.js`. Locomoção adaptada (não
extraída) de `Seeker.js` — decisão consciente de duplicar ~150 linhas de
código já validado em produção em vez de arriscar regressão numa extração.

Bug real encontrado e corrigido no processo: o alvo de fuga original mirava
um ponto sintético (posição − direção do Caçador × N metros), que podia cair
além de uma parede sem garantia de alcance — travava o alvo por completo ao
ser encurralado num canto (confirmado com teste adversarial automatizado:
100% dos frames travados). Corrigido pra sempre fugir a um waypoint real da
própria rota, mesma garantia de alcançabilidade que o `wander` já tinha.

Commit `95671e6`. Doc atualizada: `docs/MECANICA_CACADOR_VISAO.md` §3.

## 2026-08-24 — Sessão paralela: mapa novo + fix de PWA

Outra sessão do Claude Code (mesmo usuário, janela diferente) trabalhou neste
repo em paralelo, sem coordenação com a sessão do Plano 3 acima — só foi
descoberto quando o usuário pediu explicitamente pra sincronizar com o GitHub
e avaliar as mudanças. Commits `d0252bc` / `7d67dde` / `3b0d34c`:

- Ícone novo do PWA (192/512/maskable/apple-touch-icon) + `manifest.json`
  ganha campo `id` + `vercel.json` corrige `Content-Type` do manifest,
  tentando resolver um bug relatado de instalação no Android que não abria.
- **Mapa novo, "Fábrica Abandonada"** (`Level.js:_buildFactoryLevel`): casco
  próprio fora da mansão, único nível + passarela elevada, 4 cômodos
  temáticos. Estágio solo cicla `%4` agora (era `%3`). Online ganha rotação
  determinística de mapa por hora do relógio (`onlineLayoutFor()`,
  `protocol.js`), calculada igual nos dois lados sem round-trip.
- README atualizado pra refletir os 2 mapas, contas Supabase e PWA.

Avaliado e testado por compatibilidade com a IA do Plano 3 depois do pull:
funciona sem nenhuma mudança no mapa novo (rotas/colorables/occluders
populam corretamente). Um comentário desatualizado em `Game.js` (mencionando
alvos "parados", herdado do texto pré-Plano 3) foi achado e corrigido durante
essa avaliação.

## 2026-08-25 — Plano 4: CLAUDE.md + índice/log da wiki de docs

Criados `CLAUDE.md` (raiz), `docs/_index.md` e este arquivo — adaptação do
padrão "LLM Wiki" do Karpathy (raw/wiki/Ingest-Query-Lint) pra este projeto,
motivada diretamente pelos dois problemas de processo registrados nas
entradas acima: sessões paralelas sem coordenação, e doc atualizado com
comentário espelhado no código esquecido. Sem mudança de código de jogo —
só documentação/processo.

## 2026-08-25 — Cache stale no PWA: `?v=N` não tinha sido bumpado

Ao sincronizar com o commit acima e aplicar a própria convenção de
cache-busting que o `CLAUDE.md` novo formaliza, achado: `Level.js` (mapa
novo + alturas de parede), `Player.js` (fixes de escalada) e
`net/protocol.js` (`onlineLayoutFor`) receberam mudanças reais em sessões
anteriores mas ficaram esquecidos em `?v=3` — a mesma URL de antes das
mudanças — em todos os import sites (`Game.js`, `Net.js`, `RemotePlayer.js`).

Isoladamente isso não seria bug (Vercel manda `Cache-Control: public,
max-age=0, must-revalidate`, então fetch normal sempre revalida). O
problema real é o `sw.js` do PWA: estratégia cache-first, devolve o que já
tem em cache pra aquela URL exata na hora e só atualiza em segundo plano
pra próxima visita. Quem já tinha o PWA instalado antes dessas mudanças
podia ficar preso no código antigo por uma visita extra ou mais.
`occluders.js` foi checado e descartado (nenhum arquivo do cliente importa
ele de verdade — só campos com nome parecido tipo `level.occluders`).

Corrigido: bump `?v=3` → `?v=4` nos 4 import sites dos 3 arquivos.
Verificado com `node --check` e boot headless (Playwright, zero erros de
console) antes do commit. Commit `a00144f`.

## 2026-08-25 — Skill de projeto `level-design`

Usuário trouxe um documento genérico de "skill pack" para agentes de PCG
(Perlin/WFC, erosão hidráulica, chunk streaming, bioma por umidade/altura,
seed compartilhado na UI) como base pra criar um mapa novo. Avaliação: a
maior parte não se aplica — este projeto não gera layout por seed/algoritmo,
usa um número pequeno e fixo de mapas hand-authored escolhidos por índice
(`mulberry32` semeado pelo número do layout só varia DECORAÇÃO, nunca
paredes/salas/rotas — determinismo exigido pelo modo Online, cujo servidor
nunca roda `Level.js`).

Criada `.claude/skills/level-design/SKILL.md` (skill de projeto, git-tracked,
compartilhada com qualquer sessão) capturando o que REALMENTE já funciona
aqui: os dois padrões de arquitetura (estender `_build()` vs. casco próprio
tipo `_buildFactoryLevel`), o contrato de saída obrigatório pra IA
(`routes`/`routeY`/`colorables`/`climbables`/`solids`/`walkables`/
`occluders`), a regra de topologia sem beco-sem-saída (Seeker/ChameleonTarget
não têm pathfinding), 6 landmines já documentadas em `docs/PLANO_MANSAO.md`
(escada além da borda da laje, sonda de chão partindo dos olhos, bigodes
usando `occluders` em vez de `climbables`, passarela sem barreira externa,
props flutuando, corredor estreito demais), verificação sRGB de paleta,
orçamento de malhas (≤400/mapa) e a metodologia de verificação headless já
estabelecida (simulação de IA/física antes de qualquer olhar visual).

## 2026-08-25 — Plano 5: mapa "Chameleon Manor" (layout 5), 4 níveis físicos

Maior recurso único já construído no projeto: mansão de 4 domínios verticais
(porão/térreo/1º andar/ático), ~15× a área da mansão original, 10 fases
executadas uma a uma com aprovação entre elas ("continue pra Fase N"), a
partir de uma especificação externa que precisou de adaptação real (sem
`MeshPhysicalMaterial`, sem grafo de waypoints com arestas — Seeker não tem
pathfinding). Detalhe completo em
[`docs/PLANO_CHAMELEON_MANOR.md`](PLANO_CHAMELEON_MANOR.md) (novo). Resumo:

- **Fases 0-2**: casco vazio (4 níveis, 3 escadas), amostragem de cor por
  pixel (capacidade nova, testada isolada antes de qualquer zona real
  depender dela), paleta `CHAMELEON` (18 cores, verificada por sRGB).
- **Fases 3-6**: conteúdo real por domínio — Porão (3 salas), Térreo (6
  salas, 24 quadros, 1º consumo real de pixelColorable), 1º Andar (4
  quartos + passagem secreta que desliza um painel de parede de verdade,
  com resync manual do `Box3` de colisão a cada frame), Ático (claraboia —
  vão vertical real através de 2 lajes, visão direta ático→Ballroom).
- **Fase 7**: iluminação por zona REJEITADA como PointLight/SpotLight
  coloridas — quebraria a garantia sRGB da camuflagem e contradiz uma
  decisão de design já documentada em `Game.js`. Achado extra: uma mecânica
  de penumbra-afeta-visão já existiu num plano anterior e foi removida
  (`Seeker.js:352`) — confirma que zona escura como gameplay já foi tentada
  e descartada neste projeto. Substituída por luminárias emissivas
  decorativas (padrão já usado na mansão).
- **Fase 8 (rebalanceamento medido)**: harness novo usando a classe `Seeker`
  REAL (não uma aproximação) achou cobertura de patrulha muito abaixo do
  baseline da mansão — causa raiz: `opts.visionRange` (infra da Fase 0)
  nunca tinha sido ligado em `Game.js`, então todo o mapa usava o alcance de
  7,5m calibrado pra cômodos da mansão, 5-10× menores. Corrigido pra 16m +
  2º Seeker nos 2 domínios com mais salas. Um teste de estabilidade de 10min
  achou uma rota (Porão) travando quase o tempo todo — bug real que o sweep
  de colisão de 20-25 amostras/segmento usado em TODAS as fases anteriores
  não pegava (janela de cruzamento da parede fina demais pra essa
  resolução). Todas as rotas do mapa foram re-verificadas a 200
  amostras/segmento depois desse achado.
- **Fase 9 (Online)**: `ONLINE_LAYOUTS=[1,4,5]`, snapshot de 122 oclusores
  extraído do `climbables` real (mesmo processo headless do layout 1/4),
  tabelas de spawn no `server/room.js`. Testado com `ws` cru contra `Room`
  real (não mockado): spawn, `welcome.layout`, acerto real e bloqueio real
  por parede.
- **Fase 10**: 2 hero spots extra (A2, B4) fechando 16/18 (os 2 restantes,
  S2/A7, dependem de um sistema de pintura por-quadro que é escopo de fase
  própria); regressão final de malhas × {desktop,mobile} nos 5 layouts —
  Chameleon Manor fecha em 310 malhas (meta era ≤1500).

Nenhum commit ainda — trabalho aguardando instrução explícita do usuário pra
commitar (convenção já estabelecida nesta sessão desde o Plano 4).

---

## 2026-08-25 — Plano 5 commitado (Fases 0-10) + fix: sombra piscando no Chameleon Manor

Todo o trabalho do Plano 5 (entrada acima) foi commitado por fase a pedido do
usuário — reconstrução retroativa a partir do diff acumulado, já que nenhuma
fase tinha sido commitada durante a construção (11 commits, `5899f14`..
`3bca640`), seguido de push pra `origin/main` e confirmação em produção
(Vercel + Render, ambos com deploy automático). Também: atalho `?stage=N` em
`Game.js` (prioridade sobre `sessionStorage['eom-stage']`, não persiste) pra
pular direto a um estágio sem progredir pelos anteriores — útil pra testar
qualquer layout sob demanda, não só o Chameleon Manor.

**Bug real encontrado e corrigido**: usuário reportou partes do piso do
Chameleon Manor "piscando" (linhas, como uma "base" aparecendo por baixo).
Causa raiz: o frustum ortográfico da sombra da luz-chave (`Game.js:_addLights`)
é um valor FIXO (`s=15, far=42`) dimensionado pra mansão/fábrica (~29×29m) —
nunca ajustado quando o Chameleon Manor (120×80m) foi adicionado. A maior
parte do piso (Galeria, Biblioteca, Corredor, Porão inteiro — tudo fora de
±15 do centro) ficava fora do frustum; Three.js amostra a borda do shadow map
pra geometria fora dele, produzindo o artefato de banding/flicker reportado.
Não era malha duplicada nem z-fighting entre dois pisos, como a hipótese
inicial supôs — só um frustum pequeno demais pro mapa novo.

Fix: `_addLights()` movido pra depois de `this.level` existir no construtor
de `Game`; pro layout 5, calcula `s`/`far` a partir da bounding box real de
`this.level.solids` (união de todos os AABBs) em vez de outro número fixo —
acompanha sozinho se o mapa mudar de tamanho de novo. Layouts 1-4 mantêm os
valores originais exatos (`s=15, far=42`, confirmado por inspeção direta no
jogo rodando) — zero regressão. Verificado: `s≈62.3/far≈150.1` no layout 5,
piso da Galeria (x=37, bem fora do frustum antigo) sem artefato visível.

---

## 2026-08-25 — Revisão completa do projeto + fix P0: progressão de fase era cosmética

Usuário pediu uma revisão completa do projeto. Achado mais grave (P0): em
`Game.restartInPlace()`, `this.stage++` nunca recalculava nada que dependia
dele — `layout`, `surviveTime` e a contagem/velocidade dos Seekers só são
calculados no construtor de `Game`. Confirmado empiricamente (chamando
`restartInPlace(true,false)` 4× no jogo rodando): `stage` foi de 1→5, mas
`layout` ficou travado em 1, `surviveTime` em 60 e os Seekers em 2. Na
prática, jogando a progressão normal ("Próximo estágio"), o Chameleon Manor
(layout 5) **nunca aparecia** — só era alcançável via `?stage=5` direto.
Bug pré-existente, não introduzido pelo Plano 5 (afetava igualmente o ciclo
1↔2↔3 da mansão antes dele).

Outros achados da revisão (não corrigidos nesta rodada, ficam de pendência):
`server/index.js` cria o `WebSocketServer` sem `maxPayload` nem handler de
`error` (DoS trivial); `sw.js` é cache-first pra `index.html` também, então
um PWA instalado serve HTML velho por uma visita a cada deploy (mesma causa
raiz do bug já corrigido no commit `a00144f`); zero testes automatizados/CI
no repo, apesar de já existirem harnesses headless bons (descartados depois
de rodados); `game-studio.md` é cruft de skill não relacionada, commitado na
raiz por engano.

**Fix do P0**: sem `Level.dispose()` (reconstruir o nível in-place vazaria
memória de GPU), a correção é um `location.reload()` dentro de
`restartInPlace()` sempre que `nextStage`/`backToMenu` muda o estágio, fora
do modo Online (lá o layout é fixo por SALA — `server/room.js:_layout` — não
por estágio; recarregar forçaria reconexão à toa). Como `boot()` só roda
dentro de `startGame()`, que só é chamado por um clique real no menu, um
reload cru derrubaria o jogador de volta na tela principal a cada avanço de
fase. Resolvido com `?continue=1` (setado só quando `nextStage`, nunca em
`backToMenu` — "Voltar ao Menu"/"Recomeçar" já mostram a tela principal de
propósito, `MenuUI.js:284-287`): `main.js`, depois de `initMenuUI()` já ter
registrado seus listeners, clica sozinho no card do modo salvo em
`sessionStorage['eom-mode']` — mesmo padrão que "Continuar Partida" já usa
pra simular escolha de modo sem duplicar a lógica de boot.

Verificado no jogo rodando, progressão real (sem `?stage=N`): stage 1→2→3→4→5
avançou layout 1→2→3→4→5 e `surviveTime`/nº de Seekers corretos em cada um
(120s/6 Seekers no 5); stage 5→6 voltou pro layout 1 (ciclo de 5 fechando
certo); "Voltar ao Menu" a partir de um estágio avançado recarrega e mostra
o menu de verdade (sem auto-continuar pra uma partida nova), com
`sessionStorage['eom-stage']` corretamente resetado pra 1; modo Online
confirmado SEM reload (mesmo comportamento de antes, `restartInPlace`
continua in-place).

Arquivos: `src/Game.js` (fix), `src/main.js` (auto-continue), `index.html`
(bump `?v=9`).

---

## 2026-08-25 — Fix P1: servidor exposto a payload gigante/flood + PWA sw.js

Dois dos achados "de pendência" da revisão completa (entrada acima) corrigidos
a pedido do usuário.

**Servidor (`server/index.js`, `server/room.js`)**: `WebSocketServer` não
tinha `maxPayload` (o default do `ws` é 100 MiB por mensagem — um cliente
mandava uma única mensagem gigante e o processo bufferizava/tentava
`JSON.parse` nela à toa) nem handler de `error` em nenhum nível (um erro de
socket sem NENHUM listener de `'error'` vira exceção não capturada e derruba
o processo Node inteiro — todo mundo na sala cai junto por causa de UMA
conexão ruim). Também não existia rate limit por mensagem — só o cooldown de
tiro já existente (`_handleFire`), que não cobre `INPUT`/`PAINT`/`JOIN`.

Fix: `maxPayload: 64 * 1024` no `WebSocketServer` (bem acima da maior
mensagem legítima — PAINT com 400 traços, protocol.js:MAX_PAINT_STROKES_PER_MSG,
≈32KB — mas 1500× menor que o default); `wss.on('error', ...)` e
`ws.on('error', ...)` por conexão (registrado antes de `room.addClient`);
rate limit de `MAX_MSGS_PER_SEC=40` por cliente em `_onMessage` (janela
deslizante de 1s, checada ANTES do `JSON.parse` — é o parse + trabalho de
jogo depois dele que a inundação custa caro pra evitar), 2× a cadência real
de INPUT (TICK_HZ=20/s) com folga pra FIRE/PAINT/JOIN ocasionais.

Verificado com um cliente `ws` cru contra o servidor real (não mockado):
handshake normal ok; mensagem de ~1MB fecha a conexão com código 1009
("message too big") em vez de travar o processo; flood de 200 mensagens de
uma vez não derruba o servidor nem trava o socket (continua respondendo
depois); nova conexão depois de tudo isso ainda funciona normal — 4/4
testes passaram. Bônus: o handler de `wss.on('error')` foi exercitado de
verdade sem querer — uma 2ª instância do servidor de teste tentou subir na
mesma porta (EADDRINUSE) e só logou o erro em vez de derrubar o processo,
confirmando o fix num cenário real, não só no script de teste.

**PWA (`sw.js`)**: cache-first pra `index.html` também (não só pros assets
versionados `?v=N`) fazia um PWA instalado servir o HTML de ANTES do deploy
mais recente — e com ele os imports `?v=N` antigos — só atualizando na
visita seguinte. Mesma causa raiz do bug já corrigido à mão uma vez (commit
`a00144f`), agora fechada na fonte. Fix: requisições de navegação
(`req.mode === 'navigate'` — cobre `/`, reload, e qualquer query string que
main.js use nela) passam a ser NETWORK-FIRST com fallback pro cache; todo o
resto (assets `?v=N`, CDN externo) continua cache-first com atualização em
segundo plano, inalterado.

Não deu pra registrar o Service Worker de verdade no Browser pane desta
sessão (ambiente sandboxed bloqueia com `ERR_NETWORK_CHANGED` — limitação do
harness, não do código: `fetch('/sw.js')` direto funciona normal, 200 OK).
Verificado em vez disso com um teste isolado (Node + `vm`, mockando
`self`/`caches`/`fetch` do escopo de Service Worker): navegação online serve
a rede fresca e atualiza o cache; navegação offline cai pro cache; asset
`?v=N` continua cache-first com atualização em 2º plano; método não-GET
continua ignorado — 4/4 passaram.

Arquivos: `server/index.js`, `server/room.js`, `sw.js`.

---

## 2026-08-25 — Fix P2: testes automatizados + CI pro servidor Online

Último item "de pendência" da revisão completa (entrada de duas acima):
zero testes automatizados/CI no repo, apesar de já existirem harnesses
headless bons (descartados em `scratchpad/` depois de rodados).

**Decisão de escopo**: formalizar isto só pro servidor Online
(`server/`), não pro `Level.js`/geometria do cliente. A skill de
level-design já documenta que os mocks de Three.js/canvas usados pra
verificação headless de mapa são deliberadamente descartáveis
(`.claude/skills/level-design/SKILL.md`) — comitar uma versão permanente
arriscaria virar uma 2ª implementação (parcial, sempre defasada) da API
do Three.js que apodrece sem ninguém notar, pra um ganho que já é
coberto pelo processo manual (headless → browser) documentado ali. O
servidor não tem esse problema: `server/room.js` é lógica pura de estado
+ protocolo, testável contra a peça REAL (`ws` de verdade, não mockado)
sem esse risco.

**`server/testHelpers.mjs`** (novo, fora de `test/` e sem o prefixo
`test-`/`.test.` de propósito — nomes assim são pegos pela descoberta
automática do `node --test` e rodavam como um "teste" vazio próprio):
sobe um `Room` + `WebSocketServer` de verdade numa porta efêmera
(`port: 0`), conecta clientes `ws` reais. Achado real ao escrever isto:
a sala transmite `SNAPSHOT` a 20Hz o tempo todo — um `ws.once('message',
...)` anexado só depois de esperar o evento `'open'` tem uma janela de
corrida real (o evento pode disparar nesse meio-tempo e ser perdido,
já que EventEmitter não enfileira eventos sem ouvinte), pegando um
SNAPSHOT no lugar do WELCOME esperado. Resolvido com fila por-socket
alimentada por um listener único anexado no mesmo tick síncrono da
criação do `WebSocket`, e um `waitForMessage(ws, predicate)` que ignora
SNAPSHOTs/etc. até achar o tipo esperado (ou devolve `null` no timeout,
sem lançar) — sem isto, boa parte da suíte ficava ora passando ora
travando dependendo de quando o tick calhava de disparar.

`Room` ganhou um `stop()` (só usado por testes — produção sai por
`process.exit()` direto, nunca precisou disto) pra parar o
`setInterval` do tick; sem ele, cada teste que sobe uma sala própria
deixaria um timer rodando pra sempre e o `node --test` nunca fecharia
sozinho.

**`server/test/`**: `hardening.test.mjs` (promove os testes manuais do
fix P1 — maxPayload fecha com 1009, flood não derruba o processo,
`wss.on('error')` sobrevive a EADDRINUSE), `room.test.mjs` (capacidade
do lobby + atribuição de papel, sala cheia recusa com `MATCH_OVER`+4001,
`revive` reabre partida sem reconectar, validação de PAINT
descarta-o-inválido-retransmite-o-válido e rejeita lote acima do
limite, reconexão via `?rejoin=` devolve o mesmo id/role), e
`protocol.test.mjs` (funções puras de `net/protocol.js` — determinismo/
domínio de `onlineLayoutFor`, arredondamento de `makeInputPayload`/
`makePaintStroke`). `server/package.json` ganhou `"test": "node --test"`
— **`node --test test/` (com diretório explícito) não funcionou** nesta
versão do Node (24.11.0, erro `MODULE_NOT_FOUND` tentando resolver
`test` como módulo) — só a descoberta automática sem argumento funciona.

**`.github/workflows/test.yml`** (novo): roda `npm test` em `server/`
(Node 20) + um `node --check` em todo `.js`/`.mjs` de `src/`+`server/`
como gate rápido de sintaxe — em push/PR pra `main`.

16/16 testes passando, confirmado estável em 4 execuções seguidas
(nenhuma flakiness residual da corrida contra SNAPSHOT).

Arquivos: `server/room.js` (`stop()`), `server/testHelpers.mjs` (novo),
`server/test/*.test.mjs` (novo), `server/package.json`,
`.github/workflows/test.yml` (novo).

---

## 2026-08-26 — Fix P3: remove game-studio.md (cruft não relacionado)

Último item da revisão completa do projeto. `game-studio.md` (raiz do
repo, frontmatter de skill "Turn a one-line, casual game idea into a
real, deployed, multiplayer browser game... via the Higgsfield game
pipeline") não tem nenhuma relação com este projeto — entrou por engano
no commit `d59d982` ("feat: personagem 3D Tripo + Mixamo..."), um commit
sobre pipeline de personagem sem nada a ver com o conteúdo do arquivo.
Confirmado antes de remover: nenhum código/doc do repo referencia o
arquivo (só a entrada de log da própria revisão completa, que fica —
é histórico).

Arquivos: `game-studio.md` (removido).

---

## 2026-09-09 — Plano de correções após análise do jogo

Criado `PLANO_CORRECOES.md` com seis etapas, dependências, arquivos envolvidos e critérios de aceite; distingue problemas confirmados de hipóteses de playtest e funcionalidades novas. Prioriza a configuração impossível do Caçador solo, HUD por papel e consistência de mapa/tempo/regras online. Nenhuma alteração de gameplay ou implantação nesta entrega.

Arquivos: `docs/PLANO_CORRECOES.md` (novo), `docs/_index.md`, `docs/_log.md`.

---

## 2026-09-09 — Marco 1 do plano de correções

O modo Caçador passou a iniciar com 8 jatos para 6 alvos, permitindo dois erros na configuração padrão. O HUD agora muda o objetivo, dica, título do cronômetro e rótulo de tempo conforme o papel; o padrão foi atualizado no menu e no protocolo compartilhado.

Arquivos: `src/Game.js`, `src/net/protocol.js`, `src/Net.js`, `src/Player.js`, `src/RemotePlayer.js`, `src/main.js`, `index.html`.

O mesmo marco também passou a aplicar a duração enviada pelo servidor ao HUD online e bloqueou JOIN repetido (não recarrega munição) e REVIVE antes do fim da rodada. A documentação do Caçador e o README foram sincronizados com o padrão de 8 jatos.

Arquivos adicionais: `server/room.js`, `README.md`, `docs/MECANICA_CACADOR.md`, `docs/MECANICA_CACADOR_VISAO.md`.

### Continuação — endurecimento da sala online

O servidor agora rejeita coordenadas não finitas/absurdas, origens de disparo distantes do avatar, JOIN repetido e REVIVE durante uma rodada ativa. A suíte da sala ganhou três regressões e passou de 16 para 19 testes.

Arquivos: `server/room.js`, `server/test/room.test.mjs`.

### Continuação — layout online confirmado pela sala

O cliente online agora usa o layout salvo da sessão quando reconecta, compara o layout inicial com o `WELCOME` autoritativo do servidor e recria a cena automaticamente quando houver divergência. Isso fecha a janela de inconsistência na virada de hora sem alterar o boot dos modos solo.

Arquivos: `src/Game.js`, `src/main.js`, `docs/PLANO_MULTIPLAYER.md`.

### Continuação — feedback de camuflagem e tutorial inicial

O jogador agora recebe o motivo do estado de camuflagem no HUD (`COR ERRADA`, `PAREDE` ou `CHÃO`) e uma dica contextual. Foi adicionado um tutorial curto de três passos para Camaleão e Caçador, exibido uma vez por papel e com opção de pular; o Online mantém seu fluxo de lobby próprio.

Arquivos: `src/Player.js`, `src/Game.js`, `index.html`, `css/style.css`, `src/main.js`.

### Continuação — leitura visual e qualidade adaptativa

O HUD do Camaleão deixou de exibir munição irrelevante, ganhou estado visual vermelho para cor incompatível e mantém o indicador de cor apenas nos papéis que usam camuflagem. Em celulares que sustentarem menos de 24 FPS por dois segundos, a resolução de renderização cai uma vez para preservar fluidez; a qualidade não muda em desktop.

Arquivos: `css/style.css`, `src/Game.js`, `src/main.js`, `index.html`.

### Continuação — salas por código

Documentação sincronizada com a implementação: o multiplayer agora descreve salas em memória por código, mantém `PUBLIC` como entrada rápida e remove salas vazias após a limpeza periódica. A validação final passou na checagem de sintaxe, no teste da sala autoritativa e no `git diff --check`.

O servidor passou a manter salas isoladas por código (`room=ABC123`), com a sala pública como padrão. O menu Online ganhou um campo opcional de código; o cliente inclui esse código na conexão e na reconexão. Salas vazias são recolhidas periodicamente para liberar o tick e o estado em memória.

Arquivos: `server/index.js`, `src/Net.js`, `src/Game.js`, `src/main.js`, `index.html`, `css/style.css`.

---

## 2026-09-10 — Matchmaking prioriza pessoas e completa com IA

O modo Online passou a reservar 30 segundos para jogadores reais. Ao fim da busca, o servidor completa somente as vagas restantes com Camaleões de IA; uma sala 5/5 começa imediatamente sem bots. Busca e caçada usam relógios separados, então os 180 segundos só começam após a formação. IAs são simuladas pelo servidor, identificadas no avatar e assumem a vaga de um Camaleão que não reconectar dentro do prazo. A entrada pública abre uma nova fila quando as anteriores já começaram, mantendo novos jogadores no matchmaking.

A suíte do servidor passou de 19 para 22 testes. O fluxo também foi validado no navegador: busca mostrou `1/5 online`, quatro IAs entraram após o prazo, o HUD contou `4/4`, o tempo começou em `3:00` e a reconexão preservou a partida. Em uma verificação adicional com seis conexões públicas, as cinco primeiras formaram uma sala e a sexta abriu outra como Caçador.

Arquivos: `src/net/protocol.js`, `server/index.js`, `server/room.js`, `server/test/room.test.mjs`, `src/Game.js`, `src/RemotePlayer.js`, `src/Net.js`, `src/Player.js`, `src/main.js`, `index.html`, `README.md`, `docs/PLANO_LOBBY_COUNTDOWN.md`, `docs/PLANO_LOBBY_MULTIPLAYER.md`, `docs/PLANO_MULTIPLAYER.md`, `docs/_index.md`, `docs/_log.md`.

---

## 2026-09-10 — Plano de melhorias revisado pelo estado atual

Criado `PLANO_MELHORIAS_JOGO.md` com seis entregas priorizadas: confiabilidade online, IA com esconderijos, aprendizado/camuflagem, tempo/desempenho/celular, equilíbrio por playtest e resultados/progressão. A revisão identificou lacunas na repetição de reconexão, saída do Caçador na espera, preservação das eliminações ao substituir jogadores e coordenação da revanche. Também registrou limitações da IA, tutorial durante rodada ativa, dicas móveis e relógio baseado em intervalo limitado.

Os 22 testes existentes do servidor passaram novamente. As novas lacunas foram identificadas por leitura do código; desempenho real e equilíbrio ainda exigem medição e playtest. Atualizado o status do plano anterior para parcialmente implementado e indicado o novo plano como referência das próximas entregas. Nenhuma mudança no código do jogo ou publicação nesta revisão; as alterações locais anteriores foram preservadas.

Arquivos: `docs/PLANO_MELHORIAS_JOGO.md` (novo), `docs/PLANO_CORRECOES.md`, `docs/_index.md`, `docs/_log.md`.

---

## 2026-09-11 — Primeira execução do plano de melhorias

O Online ganhou fases e número de rodada, revanche por confirmação coletiva seguida de
nova busca por humanos, reconexão repetida com restauração do estado, promoção de um
novo Caçador na fila e preservação de capturas quando uma vaga passa à IA. Regras de
munição online foram fixadas no servidor e a reconexão passou a validar id e token na
sala correta.

A IA do servidor deixou as órbitas: escolhe trajetos diretos livres de obstáculos,
privilegia pontos fora da visão do Caçador, para para se esconder e foge quando vista.
A etiqueta flutuante foi retirada. O tutorial agora pausa o gameplay, a dica de cor
também cobre o apoio no chão, o texto de camuflagem aparece em telas pequenas e relógio
e FPS usam tempo real separado do intervalo limitado da física.

A suíte passou para 25 testes, todos aprovados, e as checagens de sintaxe passaram. No
navegador, a fila exibiu `1/5`, recebeu quatro IAs após 30s, iniciou em `3:00`, mostrou
`4/4` alvos e não registrou erros no console.

Arquivos principais: `server/index.js`, `server/room.js`, `server/test/room.test.mjs`,
`src/Net.js`, `src/Game.js`, `src/RemotePlayer.js`, `src/net/protocol.js`, `src/main.js`,
`css/style.css`, `index.html`, `sw.js`, `README.md` e documentação do Online.

---

## 2026-09-30 — Fecha a etapa 1 do Online: rotação do Caçador e validação de velocidade

Contexto: playtest rápido com 5 pessoas já tinha sido feito e funcionou bem; os dois itens que
o `PLANO_MELHORIAS_JOGO.md` ainda listava como pendentes na etapa 1 foram implementados.

**Rotação do Caçador** (`server/room.js`). Até aqui o papel era fixo pela vida da sala — quem
entrava primeiro caçava para sempre. Agora cada revanche (`_tryBeginRematch`) chama
`_rotateHunter`: escolhe o próximo Caçador por justiça (`_pickNextHunter` — menos rodadas como
Caçador; empate → quem caçou há mais tempo; empate → quem entrou antes), troca papéis, recalcula
spawns (Caçador no ponto dele, Camaleões no anel sem empilhar), zera munição e reposiciona todo
mundo, tudo ANTES do `ROUND_RESET` — o cliente lê o próprio papel desse mesmo pacote, então não há
janela com papéis velhos. Com N humanos, todos caçam antes de alguém repetir; com 1 humano (o
resto é IA) ele continua Caçador. A promoção por saída do Caçador na busca passou a usar o mesmo
critério (`_makeHunter`), para não dar a vez a quem já caçou.
Cliente (`src/Game.js`): `_onRoundReset` aplica o papel novo via `_applyOwnOnlineRole`, que agora
cobre os dois sentidos. O caminho antigo só sabia PROMOVER; rebaixar deixaria o jogador com câmera
em 1ª pessoa, lanterna e arma na tela. `_teardownHunterRig` remove lanterna (com `dispose`), arma e
braço da câmera, reexibe o corpo, volta a `FollowCamera` e repõe o FOV (a `HunterCamera` muda o FOV
da MESMA câmera pra 80° e a `FollowCamera` não restaura — `DEFAULT_CAMERA_FOV=60`).

**Validação de velocidade** (`room.js:_validateMove`). O servidor só retransmitia a posição. Agora
limita a TAXA com que ela avança, com limites derivados do `Player.js` real: horizontal 10,5 m/s
(`TUNE.moveSpeed` = 8,25; o painel de dev vai a 10), subida 8 m/s (pulo 6,2), queda 26 m/s
(`GRAVITY=22` sem velocidade terminal; a maior queda do mapa chega a ~22). É um crédito em metros
que recarrega em tempo real, com teto de 0,75 s: tolera pacotes agrupados pela rede, picos de
latência e os saltos legítimos de ~1 m do encaixe na parede, mas a taxa SUSTENTADA de quem
trapaceia fica travada no limite — "distância máxima por pacote" deixaria passar ~2× a velocidade
só pelo tamanho da folga. Acima do limite a posição é ENCURTADA na direção pedida, não recusada:
nunca congela um jogador honesto (se congelasse, um respawn ou reconexão longa travaria ele pra
sempre) e a posição que vale para tiro e para os outros jogadores é a encurtada. Teleportes do
próprio servidor (`_teleport`: revanche, promoção) abrem 1 s de graça que descarta, em silêncio e
sem punir, as entradas em trânsito com a posição antiga; a reconexão (`_resync`) ressincroniza uma
vez com crédito proporcional ao tempo real fora (derrubar a conexão de propósito não rende mais
que correr esse tempo todo). Violações ficam em `speedViolations` e no log.
Não entrou: aviso de correção ao cliente (ele segue se movendo localmente; só os outros o veem
"atrasado"), nem re-simulação de colisão/gravidade — atravessar parede na velocidade normal e subir
devagar (voar) continuam passando. Débito 1 do multiplayer reescrito em `PLANO_MULTIPLAYER.md` §5.

**Verificação.** Suíte do servidor 25 → 38 testes (`test/rotation.test.mjs`, 5; `test/movement.test.mjs`,
8), todos passando, e sem flakiness. Testes checados por MUTAÇÃO: com a rotação desligada 4 dos 5
de rotação quebram (o que passa é o de "um humano só", que deve passar sempre); com a validação
desligada 6 dos 8 de movimento quebram (os 2 que passam são os de movimento LEGÍTIMO — corrida
máxima e pacotes agrupados — que existem pra provar que ela não gera falso positivo). No navegador,
2 abas contra o servidor real (com um gancho de teste só no scratchpad, não versionado, para
encerrar a rodada sem esperar 3 min): 3 rodadas seguidas com papéis trocando certo nas duas pontas
(servidor e cliente), rig do Caçador montado com exatamente 4 objetos na câmera ao voltar a caçar
(sem duplicar), aba rebaixada limpa (`FollowCamera`, FOV 60, 0 objetos na câmera, corpo visível),
0 violações de velocidade em jogo normal (incluindo os dois teleportes do servidor), e um
"trapaceiro" simulado pelo console (+40 m no cliente) limitado pelo servidor a ~9,8 m em 250 ms
com 4 violações contadas. Sem erros de console. Limitação da verificação: o harness roda o
navegador com FPS baixo (e `dt` do jogo limitado a 0,05 s), então a corrida a 8,25 m/s sustentada
NÃO foi exercitada com o cliente real — isso ficou a cargo dos testes unitários com relógio
controlado; vale um playtest em rede real.
Observado e NÃO corrigido (já existia): o spawn do Camaleão no mapa 1 (`room.js`, base (-3, 8) +
raio 2,2) cai na base da escadaria; a física do cliente empurra o jogador de z=8 para z=10,9
logo no início e a câmera encurta ali. Cabe nos 0,75 s de crédito (2,9 m), então a validação não
reage, mas o ponto de spawn merece ser revisto.

Arquivos: `server/room.js`, `server/test/rotation.test.mjs` (novo), `server/test/movement.test.mjs`
(novo), `src/Game.js`, `src/main.js` (`Game.js?v=27`), `index.html` (`main.js?v=16`, texto do lobby),
`README.md`, `docs/PLANO_MELHORIAS_JOGO.md`, `docs/PLANO_MULTIPLAYER.md`, `docs/PLANO_LOBBY_MULTIPLAYER.md`,
`docs/PLANO_LOBBY_COUNTDOWN.md`, `docs/PLANO_CONTAS.md`.
