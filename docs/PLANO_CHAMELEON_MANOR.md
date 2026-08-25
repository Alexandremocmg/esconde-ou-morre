# Chameleon Manor (layout 5) — mansão de 4 níveis físicos

Doc própria (não uma seção em `PLANO_MANSAO.md`) porque a família diverge o
bastante do resto: casco fora de `_build()`, 4 domínios verticais reais
(porão/térreo/1º andar/ático) em vez de 1-3, paleta própria, e o primeiro
consumidor real de amostragem de cor por pixel. Recomendação da skill
[`level-design`](../.claude/skills/level-design/SKILL.md), seguida.

Especificação original que motivou o mapa:
`docs/ESPECIFICACAO_MAPA_CHAMELEON_MANOR (1).md` — escrita sem acesso ao
código real (grafo de waypoints com arestas, `MeshPhysicalMaterial`, API de
`Level` inventada). Este doc registra o que foi **adaptado** e por quê; a
especificação original fica como referência histórica, não como fonte de
verdade do que existe hoje.

## Arquitetura

- **Casco próprio** (`Level.js:_buildChameleonManor()`, `layout === 5` no
  construtor, não passa por `_build()`) reaproveitando a paleta/materiais da
  família mansão (`MANSION.*`, `materialMaps()`), não uma paleta industrial
  própria como a Fábrica — tematicamente é uma mansão.
- **4 domínios verticais físicos**: porão (`CM_BASEMENT_Y=-3`), térreo
  (`CM_GROUND_Y=0`), 1º andar (`CM_FLOOR1_Y=4.5`), ático (`CM_ATTIC_Y=8.5`,
  teto em `CM_ROOF_Y=11`). Footprint 120×80m (`CM_HALF_X=60, CM_HALF_Z=40`).
- **1 Seeker por domínio desde o estágio 1** (`Game.js`, `layout===5`) — 2
  domínios (Porão, Térreo) ganharam um **2º Seeker** (rota invertida) na Fase
  8 depois de medição mostrar que 1 só não cobria salas suficientes.
- **Paleta `CHAMELEON`** (`Level.js`, 18 cores) — verificada por distância
  sRGB (`scratchpad/palette_check_chameleon.mjs`, não versionado): mín.
  par-a-par 0,173, mín. vs. base do boneco (0xEEF0F2) 0,208 — acima dos
  limiares 0,161/0,188 que toda paleta deste projeto usa.
- **Amostragem de cor por pixel** (`Player._pixelColorAt`,
  `Level._buildPixelSource`, `textures.js:stripeTexture/hexTileTexture`) —
  capacidade nova: superfícies com padrão (listras, azulejo hexagonal,
  lombadas de livro) leem a cor do pixel EXATO sob o jogador, não a cor média
  do material. Mesh dedicado com `color:0xffffff` (sem tingir) — o canvas já
  contém as cores finais, ao contrário do sistema `materialMaps()` normal
  (base + tint).
- **Passagens secretas** (`Level._secretPassages`,
  `trySecretPassage()`/`_updateSecretPassages()`) — painel climbable normal
  que desliza entre `closedPos`/`openPos`. O `Box3` em `solids` é um
  snapshot que NÃO segue `mesh.position` sozinho — precisa resync manual a
  cada frame em trânsito; `occluders`/`cameraColliders` (referências ao
  mesh) já ficam corretos de graça.

## Fases (0-9, mais esta Fase 10 de fechamento)

| Fase | Entregou |
| --- | --- |
| 0 | Casco vazio: 4 níveis, 3 escadas, rotas-placeholder retangulares. |
| 1 | Amostragem de cor por pixel (plumbing isolado, testado com parede de teste). |
| 2 | Paleta `CHAMELEON` (15 cores iniciais). |
| 3 | Porão real: Cozinha Industrial/Adega/Área de Serviço, hero S5/A4. |
| 4a | Térreo (parcial): Ballroom + Hall — hero S3/A1/A3/B1/B6. |
| 4b | Térreo (resto): Galeria (24 quadros)/Biblioteca/Corredor/Banheiro — hero S1/A6, 1º consumo real de pixelColorable. |
| 5 | 1º Andar: Quarto Principal/Hóspedes/Storage/Banheiro de Luxo — hero S4/B2/B3 — + passagem secreta 9.2. |
| 6 | Ático: Sótão + claraboia — vão vertical real através de 2 lajes até o Ballroom — hero A5/B5. |
| 7 | Iluminação por zona (adaptada — ver Desvios). |
| 8 | Rebalanceamento MEDIDO: harness com `Seeker` real, achou e corrigiu `visionRange` nunca ligado + 1 rota travando por 10min. |
| 9 | Rotação Online: `ONLINE_LAYOUTS=[1,4,5]`, `LAYOUT_5_OCCLUDERS` (122 AABBs), spawn tables, testado com `ws` cru contra `Room` real. |
| 10 | Este doc + 2 hero spots extra (A2, B4) + regressão final ×5 layouts ×{desktop,mobile}. |

## Desvios da especificação original (com razão)

- **Sem `MeshPhysicalMaterial`** — decisão de arquitetura do projeto inteiro
  (toon/cel-shading). Claraboia usa o mesmo truque de `_buildWindow` (vidro
  emissivo frio).
- **Sem PointLight/SpotLight coloridas por zona** (Fase 7) — rejeitado por
  dois motivos concretos, não estética: (1) `Game.js:_addLights()` já
  documenta a cena como deliberadamente clara/plana, uma luz-chave branca
  pra todos os 5 layouts; (2) luz colorida tingiria `MeshToonMaterial` e
  quebraria a garantia sRGB (hex == cor percebida) que a camuflagem inteira
  depende. Achado nesta sessão: uma mecânica de penumbra-afeta-visão já
  existiu e **foi removida** num Plano anterior (`Seeker.js:352`) — sinal
  de que zona-escura-como-gameplay já foi tentado e descartado. Substituído
  por luminárias emissivas decorativas (mesmo padrão de `_buildSconce`/
  `_buildCandelabra` já usado na mansão) + registro em `fixtures` (custo
  zero de GPU, consistência de dados com o resto do mapa).
- **"Gira 360° no Ballroom" (Seeker patrulha em círculo)** — Seeker não tem
  estado "girar no lugar". Virou um loop de patrulha apertado (raio 2m) ao
  redor de um pilar deslocado do centro geométrico (hero S3) — o pilar
  central intencionalmente NÃO fica embaixo do lustre, pra as duas malhas
  não ocuparem o mesmo eixo vertical.
- **Passagem secreta 9.2 desliza, não gira 90°** — a própria 9.1 da spec já
  usa "desliza"; girar de verdade exigiria um pivô fora do centro que o
  projeto não tem infra pra montar barato.
- **Passagem secreta 9.1 (Biblioteca → Hall) NÃO implementada** — no layout
  real construído nas Fases 4a/4b, esses 2 cômodos ficam em lados opostos
  do Ballroom (não vizinhos); um "painel secreto" ali precisaria de um túnel
  novo sem relação com nenhuma parede existente. A 9.2 (Hóspedes ↔ Storage,
  vizinhos por design) valida o mecanismo de verdade.
- **`visionRange` nunca tinha sido ligado a este layout** (achado na Fase 8)
  — a infra existia desde a Fase 0 (`opts.visionRange` no `Seeker`), mas
  `Game.js` nunca passava um valor maior que o padrão de 7,5m (calibrado
  pra cômodos da mansão, 5-10× menores que os deste mapa). Corrigido:
  `CM_VISION_RANGE=16`.

## Hero spots (16/18 implementados)

Os 18 documentados na especificação (S1-S5, A1-A7, B1-B6) — confirmados
presentes via consulta direta às malhas construídas (posição + flags
`pixelColorable`/`climbable`/`seekerPass` conforme o tipo do spot):

**Implementados**: S1 (lombada pixelColorable, Biblioteca), S3 (pilar
central, Ballroom), S4 (azulejo hexagonal pixelColorable, Banheiro de
Luxo), S5 (caixas, Cozinha Industrial), A1 (cortina climbable, Ballroom),
A2 (sofá, Biblioteca), A3 (tapete, Hall), A4 (barris, Adega), A5 (trave,
Ático), A6 (vasos, Galeria), B1 (mesa, Ballroom), B2 (cama, Quarto
Principal), B3 (caixas, Storage), B4 (toalha, Banheiro de Visitas), B5
(chaminé, Ático), B6 (estatueta, Hall).

**Deliberadamente adiados** (documentado, não esquecido):
- **S2** ("Quadro Vivo" — jogador se pinta como parte de um quadro real) —
  os 24 quadros da Galeria ficaram `colorable:false` de propósito (Fase 4b:
  "decoração, não hero spot"). Implementar S2 de verdade precisaria de um
  sistema de canvas pixelColorable POR QUADRO (24 texturas dedicadas em vez
  de 4 imagens cicladas) — escopo de fase própria, não uma adição de Fase 10.
- **A7** ("Moldura Falsa" — parede vazia entre 2 quadros, Corredor) —
  depende de o Corredor ter quadros de verdade (não tem; só o painel de
  listras foi construído lá). Mesma dependência de S2.

## Métricas finais (Fase 10)

Malhas por layout, desktop vs. mobile (`castShadowCount` é o único campo
que muda — mobile só desliga sombra, não geometria):

| Layout | Malhas | Solids | Cast (desktop) | Cast (mobile) |
| --- | --- | --- | --- | --- |
| 1 (mansão) | 384 | 153 | 94 | 24 |
| 2 (mansão, layout alt.) | 406 | 166 | 103 | 34 |
| 3 (mansão, layout alt.) | 380 | 152 | 91 | 24 |
| 4 (fábrica) | 83 | 77 | 40 | 30 |
| 5 (Chameleon Manor) | **310** | 187 | 138 | 95 |

Meta da Fase 0 era ≤1500 malhas — fechou em 310, bem dentro do orçamento
mesmo sendo ~15× a área da mansão original (densidade vem de texturas
proceduais + reuso de helpers, não de contagem de objetos).

**Cobertura de patrulha** (Fase 8, medida contra a área real das salas de
cada domínio, não o footprint bruto 120×80 que incluiria margem nunca
construída): Porão 95,9%, Térreo 84,0%, 1º Andar 95,3%, Ático 78,3% — todos
dentro ou acima do baseline da mansão (41-54% no nível mais fraco, 90%+ nos
outros).

**Online**: `LAYOUT_5_OCCLUDERS` com 122 AABBs (vs. 91 do layout 1, 33 do
layout 4 — este mapa tem 4 níveis físicos, não 1-3). Testado com `ws` cru
contra `Room` real: `welcome.layout`, spawn (Caçador + anel de Camaleões) e
oclusão de tiro (acerto real + bloqueio real por parede) — todos corretos.

## Landmines novas encontradas nesta sessão (candidatas a entrar na skill)

1. **Sweep de colisão por amostragem de pontos tem resolução finita** — um
   segmento de rota longo (~39m) cruzando uma parede fina (0,6m) numa janela
   de t estreita (~0,016 em 20-25 amostras) pode não acertar NENHUMA
   amostra. Achado só pela simulação de 10 minutos da Fase 8 (o Seeker
   ficava preso deslizando na parede por ~9 dos 10 minutos), não pelo sweep
   de 20-25 amostras usado em todas as fases anteriores. Fix aplicado:
   re-sweep de 200 amostras/segmento em todas as rotas do mapa.
2. **`opts.visionRange` do Seeker precisa ser conscientemente LIGADO por
   layout** — a infra existir em `Seeker.js` não significa que `Game.js`
   está passando um valor não-padrão. Só foi pego por medição direta de
   cobertura (Fase 8), não por inspeção.
3. **Slabs com múltiplos vãos na mesma laje** (`slabWithGaps`, generalização
   de `slabWithGap` de 1 vão pra N, contanto que não se sobreponham em Z) —
   necessário pra claraboia (Fase 6): vão da escada + vão da claraboia na
   MESMA laje `CM_ATTIC_Y`.
4. **Testar mecânicas de rede (Room) headless exige cuidado com relógio** —
   sobrescrever `Date.now()` globalmente pra forçar uma decisão determinística
   (`onlineLayoutFor()`) corrompe QUALQUER OUTRO timestamp que a classe já
   tenha gravado antes do reset (cooldowns, timeout de cliente) — apareciam
   como desconexões/timeouts instantâneos sem relação aparente com a mudança.
   Fix: forçar a propriedade (`room._layout = 5`) direto, sem tocar no
   relógio.

## Pendências conhecidas

- S2/A7 (ver Hero spots acima) — sistema de pixelColorable por-quadro,
  escopo de fase própria se o usuário quiser fechar os 18/18.
- Perf mobile real (dispositivo físico, alvo 55fps) não foi medida com
  hardware — só a gate `_mobile` (`castShadow`) foi confirmada aplicada
  corretamente via contagem de malhas com `cast=true`, mesmo padrão de
  verificação usado pelos outros 4 layouts neste projeto.
