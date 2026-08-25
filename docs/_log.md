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

Arquivos: `src/Game.js` (fix), `src/main.js` (bump `?v=12`).
