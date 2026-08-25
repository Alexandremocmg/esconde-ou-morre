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
