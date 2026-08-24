# Especificação de Design: Visão/Câmera, Armamento e Scanner do Caçador

> Este documento cobre a experiência de **jogar como Caçador**: como ele enxerga o mundo
> (câmera/FOV), como funciona a arma de água (disparo/munição/penalidade) e a habilidade de
> Scanner. É complementar a [`docs/MECANICA_CACADOR.md`](MECANICA_CACADOR.md), que já cobre a
> economia de munição, condições de vitória/derrota, HUD e o sorteio no lobby — regras já
> shipadas e não duplicadas aqui.
>
> Cada item abaixo é marcado como **✅ implementado** (existe no código hoje, como está) ou
> **🔲 proposto** (design-alvo deste documento, ainda não construído), com referência ao
> arquivo/linha equivalente ou ao gap exato.
>
> Escrito olhando pro Caçador **solo** (`this.mode === 'hunter'`), mas câmera, arma, munição
> e Scanner são os mesmos componentes reusados pelo Caçador do **modo Online**
> (`this.onlineRole === ROLE.HUNTER`, ver `Game.js:373`) — a única diferença é que ali a
> munição é autoritativa no servidor em vez de só local (`docs/PLANO_MULTIPLAYER.md`).

---

## 1. Sistema de Visão e Câmera (Perspectiva e FOV)

| Item | Status | Referência atual |
| --- | --- | --- |
| Perspectiva 1ª pessoa (FPS) | ✅ implementado | `HunterCamera.js`, escolhida em `Game.js` quando `this.mode === 'hunter'` |
| FOV 75°–85° | ✅ implementado | `HunterCamera.js`: `HUNTER_FOV = 80`, aplicado só no modo Caçador |
| Sem contornos/realces no cenário | ✅ implementado | `ChameleonTarget.js` não passa mais `{ outline: true }` |
| Lanterna com atenuação quadrática | ✅ implementado | `Game._addHunterFlashlight()`, `SpotLight` com `decay=2` |

* **Perspectiva:** Primeira Pessoa (FPS) obrigatória, para limitar a visão periférica e forçar
  a varredura atenta do ambiente. `Game.js` agora escolhe a câmera por modo:
  `this.follow = this.mode === 'hunter' ? new HunterCamera(this.camera) : new FollowCamera(this.camera)`.
  `HunterCamera` (novo arquivo) posiciona a câmera em `player.position + (0, EYE_OFFSET, 0)`
  e orienta por yaw/pitch livres (arrasto no `look-zone`, mesma área de antes), independente
  da rotação do boneco — sem herdar a órbita/zoom/colisão de câmera do `FollowCamera` (que
  seguem exclusivas do modo Camaleão em 3ª pessoa). Simplificação assumida: sem reorientar o
  "up" da câmera ao escalar paredes (o `FollowCamera` faz isso; aqui manteria roll e foi
  descartado por conforto). O corpo do Caçador fica invisível em 1ª pessoa
  (`Game._updateHunterFPSRig()`, `this.player.animInstance.group.visible = false`) — no lugar,
  uma arma-viewmodel (`animationManager.createBlaster()`, uma 2ª instância independente do
  protótipo) fica pendurada na câmera, ao estilo FPS clássico, junto de um antebraço+mão
  (`Game._buildHunterViewArm()`, duas cápsulas sem dedos entrando do canto inferior direito —
  mesmo material "upper" do jogador, então acompanha a cor de camuflagem escolhida) pra não
  parecer uma arma flutuando sozinha. Limitação conhecida: sem passo de render separado para
  o viewmodel, a arma (e o braço) podem cravar visualmente numa parede se o jogador chegar
  bem perto dela.
* **Campo de Visão (FOV):** FOV estreito de 80° (dentro do range 75°–85° pedido), gerando
  pontos cegos intencionais nas laterais — em contraste com o FOV de 60° que o Camaleão
  continua usando em 3ª pessoa. Aplicado no construtor de `HunterCamera` via `camera.fov =
  HUNTER_FOV; camera.updateProjectionMatrix()`.
* **Sem contornos ou realces em objetos:** a renderização é fiel à textura real, para não
  denunciar Camaleões por falha de shader. O outline toon "inverted-hull" (`Character.js:40-48`
  / `AnimationManager.js:145-185`) segue **desligado por padrão no `Player`** do Camaleão e
  **ligado no `Seeker`** (IA do Caçador, de propósito, para ele "saltar" como ameaça visível) —
  isso não muda. O que mudou: `ChameleonTarget.js` (os alvos-camaleão do modo Caçador jogável)
  não passa mais `{ outline: true }` para `animationManager.createInstance(...)` — o bug que
  denunciava a posição deles à distância foi corrigido.
* **Lanterna/Luz Direcional suave:** acoplada à visão do jogador, com atenuação quadrática,
  gerando sombras dinâmicas que podem trair Camaleões ao redor. `Game._addHunterFlashlight()`
  cria um `THREE.SpotLight(..., decay=2)` — `decay=2` é a atenuação quadrática nativa do
  Three.js, mapeamento direto do pedido de design. A luz e seu `target` são filhos da própria
  `this.camera` (que agora é filha de `this.scene` — mudança de fundação em `Game.js`, logo
  após criar a câmera — para poder pendurar coisas nela e ver renderizado), então seguem a
  mira sozinhos, sem sync manual por frame. `castShadow = !this.isMobile`, mesmo guard de
  custo já usado na key light principal (`Game.js:229`).

---

## 2. Armamento: Mecânica da Arma de Água/Revelação

| Item | Status | Referência atual / Gap |
| --- | --- | --- |
| Projétil de alta dispersão (splatter/shotgun) | parcialmente implementado | hoje é hitscan por cone de mira, não dispersão real |
| Tanque de 5–8 cargas | ✅ implementado (mais flexível) | `waterAmmo` configurável 1–30, padrão 5 — ver `MECANICA_CACADOR.md §3.2` |
| Penalidade de tiro errado (cooldown de bomba 2–3s) | ✅ implementado | `HUNTER_MISS_COOLDOWN_MS = 2600` em `Game.js`, aplicado só quando `best` é `null` |
| Quebra do shader de camuflagem + tinta neon fluorescente ao acertar | parcialmente implementado | elimina/desbota, mas sem o flash neon |

* **Tipo de Projétil:** disparo de água líquida / projétil de alta dispersão (splatter /
  shotgun de água). Hoje o disparo do Caçador jogável (`fireHunterShot`, `Game.js:543-600`) é
  um **hitscan por cone de mira** a partir do centro da câmera (`HUNTER_AIM_HALF_ANGLE =
  degToRad(9)`, ~18° de cone total, `Game.js:18`) contra a posição conhecida de cada alvo
  (`JET_RANGE = 15`, `Game.js:20`) — não uma dispersão física real de partículas. O comentário
  em `Game.js:543-545` explica a escolha: evita raycast contra a malha animada (`SkinnedMesh`
  usa bind pose no raycast). O efeito visual (`Effects.waterJetBeam`) desenha um traço
  instantâneo cobrindo o trajeto inteiro (leitura imediata do disparo) + 12 gotículas
  viajando atrás dele + um respingo de impacto ao acertar — reaproveitável como base do
  visual de "splatter" mesmo mantendo o hit-test por cone. Antes eram só 4 gotículas
  espalhadas sem traço, quase imperceptíveis (fix real: "não dá pra ver o jato saindo da
  arma"). No modo Online, o efeito não existia (só som+HUD, `_fireOnline` nunca chamava
  `waterJetBeam`) — agora o servidor faz broadcast de `S2C.SHOT` (`{hunterId, hit,
  targetId, from, to}`, já estava no protocolo, nunca tinha sido usado) pra todo mundo
  na sala, e cada cliente desenha o mesmo jato localmente ao receber — Caçador e
  Camaleões veem o mesmo tiro, não só quem atirou.
* **Sistema de Pressão/Cartucho:** tanque de 5 a 8 cargas. **Já implementado com folga maior**:
  `waterAmmo` é configurável no menu (`#ammo-select`, `Game.js:131-134`) de 1 a 30, com padrão
  5 (dentro do range 5-8 pedido), mais um toggle `infiniteAmmo` para treino
  (`MECANICA_CACADOR.md §3.2`, já documentado — não duplicar essa regra aqui).
* **Penalidade de Disparo Errado:** cada tiro que só atinge parede/objeto aplica um cooldown de
  bomba de pressão de 2-3s, para impedir spam — decisão de escopo: só cooldown extra, **sem**
  consumir munição adicional (a normal do disparo já foi debitada; a economia de água já é
  escassa por padrão — ver `MECANICA_CACADOR.md §3.2`). Implementado em `fireHunterShot`:
  o cooldown normal (`HUNTER_FIRE_COOLDOWN_MS = 300`) é setado antes do hit-test (como já
  era), e se `best` for `null` depois de checar todos os alvos, `_nextFireAt` é reescrito para
  `now + HUNTER_MISS_COOLDOWN_MS` (2600ms). O botão `#btn-fire` ganha a classe CSS `cooling`
  (esmaecido) enquanto o cooldown corre, calculado a cada frame em `_updateHud()` — feedback
  visual de por que o disparo não responde, sem precisar de um timer dedicado. Escopo desta
  fase não toca o caminho da IA (`fireWaterJet`, `Game.js:627-689`): ali quem decide atirar é
  o algoritmo, não um jogador podendo "spammar", então a penalidade não se aplica.
* **Detecção de Acerto (Hitbox & Raycast):** ao atingir um Camaleão camuflado (mesmo estático),
  o shader de camuflagem deveria quebrar imediatamente, cobrindo o boneco de água fluorescente
  contrastante (neon) e desativando o mimetismo. Hoje `ChameleonTarget.hit()`
  (`ChameleonTarget.js:52-59`) já marca `eliminated = true` e toca a animação `prone`, e o
  caminho da IA-vs-jogador já usa `player.washPaint(dt)` (`Player.js:186-201`) para desbotar
  progressivamente a cor de volta ao branco base — mas **não existe o flash cosmético de tinta
  neon fluorescente** em nenhum dos dois caminhos hoje; seria um material/emissive temporário
  aplicado no momento do hit, antes do fade/elimina.

---

## 3. Mecânica do Scanner / Visão Reveladora (Habilidade Secundária)

**Escopo atual — "ping simplificado":** desde o Plano 3, os `ChameleonTarget` deixaram de
ser bonecos parados — agora vagueiam pela própria rota, fogem ao serem avistados pela
lanterna do Caçador e recolorem periodicamente pra combinar com o entorno
(`ChameleonTarget.js`). O pulso do Scanner, porém, **continua revelando direção/distância
de todo alvo vivo dentro do alcance**, sem diferenciar um alvo bem camuflado (parado,
cor combinando) de um mal camuflado (em fuga, cor destoante) — não mais por FALTA de sinal
nos alvos (que agora existe: `state`/velocidade/cor real), e sim por **decisão de escopo**
desta rodada, documentada como pendência pra uma rodada futura.

| Item | Status | Referência atual |
| --- | --- | --- |
| Pulso de 8m revela direção/distância dos alvos vivos | ✅ implementado (ping simplificado) | `Game.activateScanner()` / `Game._updateScanner()` |
| Vinheta azulada durante o pulso | ✅ implementado | `#vignette.scanning`, `css/style.css` |
| Duração 3s / cooldown 20s | ✅ implementado | `SCANNER_DURATION_MS=3000`, `SCANNER_COOLDOWN_MS=20000` |
| Distorção/eco por Camaleão em movimento/trocando de cor | 🔲 fora de escopo (decisão, não mais falta de sinal — ver acima) | `ChameleonTarget` já expõe `state`/velocidade/cor real; scanner ainda não os consulta |

* **Lente Térmica / Sonar Acústico:** botão dedicado (`#btn-scan`, 📡) — toque ativa (não
  segurar; a duração é fixa em 3s, então "hold" e "toggle" dão no mesmo). `Game.
  activateScanner()` checa `performance.now() < this._scannerReadyAt` (cooldown ainda
  correndo → nega com `audio.emptyClick()`, mesmo som já usado pra munição vazia); se
  liberado, arma `_scannerActiveUntil`/`_scannerReadyAt` e toca `audio.camo()` (o chime já
  usado ao entrar em camuflagem, reaproveitado como stinger de "ligou"). A tela ganha
  `#vignette.scanning` — mesmo padrão CSS-only já usado por `.danger`/`.almost`/`.spotted`
  (sem `EffectComposer`, respeitando a restrição de `docs/PLANO_VERTICAL_SLICE.md:8`).
* **Revelação (mini-radar):** em vez de um efeito 3D na cena (que ficaria oculto atrás de
  paredes — o oposto do que um sonar deveria fazer), a revelação é um **HUD 2D**:
  `#scanner-radar` mostra "você" no centro e um ponto por alvo vivo dentro de
  `SCANNER_RANGE=8`, posicionado por bearing (ângulo relativo ao "pra frente" da câmera,
  via produto vetorial/escalar no plano XZ) e distância normalizada — mesma ideia de
  amostragem por alcance do `Seeker._canSee` (`Seeker.js:328-360`), mas sem cone (360°) e
  sem checagem de oclusão (o ponto no radar É a informação "tem alguém ali", oclusão
  visual não se aplica a um HUD). Pontos reaproveitam um pool de `<div class="scanner-dot">`
  (`this._scannerDots`), criado sob demanda e escondido/reposicionado por frame — mesmo
  espírito de reaproveitamento do `Effects.waterJetBeam` (`Effects.js`), só que em DOM
  em vez de malhas Three.js.
* **Duração / Cooldown:** `SCANNER_DURATION_MS=3000`, `SCANNER_COOLDOWN_MS=20000` — timers
  próprios em `performance.now()`, mesmo padrão de `_nextFireAt` do disparo. O badge
  `#scanner-hud-badge` (topo, junto dos outros badges) mostra "Pronto" ou o cooldown restante
  em segundos; `#btn-scan` ganha a classe `.cooling` (compartilhada com `#btn-fire`) enquanto
  não libera.

---

## Ver também

* [`docs/MECANICA_CACADOR.md`](MECANICA_CACADOR.md) — munição/vitória-derrota/HUD/placar
  anti-cheat/sorteio no lobby (regras já implementadas, não repetidas aqui).
* [`docs/PLANO_VERTICAL_SLICE.md`](PLANO_VERTICAL_SLICE.md) — restrição de performance mobile
  (sem EffectComposer/Bloom) relevante a qualquer efeito novo de câmera/scanner.
