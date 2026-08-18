# Multiplayer — Fatia Vertical (v1)

> Avaliação e implementação de uma especificação técnica de multiplayer trazida pelo
> usuário (servidor autoritativo, sincronização de camuflagem, hitreg validado,
> anti-cheat). A spec original citava Photon Fusion/Mirror (exclusivos de Unity) e UDP
> (indisponível no navegador) — este documento registra o que foi adaptado e por quê.

---

## 1. Avaliação da spec original

| Item da spec | Veredito nesta v1 |
| --- | --- |
| Servidor autoritativo, 20-30 Hz, interpolação 50-100ms | ✅ Adotado |
| Photon Fusion / Mirror | ❌ Unity-only — sem caminho neste stack (Three.js/ES Modules) |
| UDP | ❌ Indisponível no navegador. WebSocket (TCP) nesta v1 |
| Client-side prediction + reconciliação | ⚠️ Fora de escopo — ver Débito 1 |
| `ChameleonState` (pos/rot/pose/cores/isLocked) | ✅ Adotado, com 2 zonas de cor (upper/lower — `Player.js:99`), não 4 quadrantes |
| `roughness`/`metallic` no payload | ❌ Descartado: `MeshToonMaterial` ignora ambos (`Player.setFinish()` já é no-op) |
| Cor só por evento pontual, não por frame | ✅ Já é assim: o input carrega a cor corrente a cada tick, mas ela só muda quando o jogador pinta |
| Hitreg validado no servidor | ✅ **Núcleo desta v1** |
| Lag compensation / rewind | ⚠️ Fora de escopo — compensado por uma tolerância angular fixa (ver §4) |
| Lobby 4-10 jogadores, 4 fases de partida | ⚠️ Fora de escopo — v1 é sala fixa de 2 |
| Interest Management (anti-ESP) | ⚠️ Fora de escopo — a arquitetura (payload pequeno, servidor dono do papel) já reserva o ponto de corte |
| Validação de amostragem de cor no servidor | ⚠️ Fora de escopo — viável depois, a paleta é determinística |

## 2. Arquitetura

```
navegador (WebSocket nativo)                    Node + ws (server/)
  Game.js  ──input 20Hz──►  Room: papel, spawn, tiro, eliminação, fim de partida
  Net.js   ◄──snapshot 20Hz──
  RemotePlayer.js (interpolado, buffer 100ms)
        ▲
        └── src/net/hittest.js — importado pelos DOIS lados, verbatim
```

- **Topologia:** servidor Node próprio (`server/`), não uma plataforma gerenciada nem P2P.
- **Transporte:** `ws` no servidor (única dependência, isolada em `server/package.json`);
  **`WebSocket` nativo** no cliente — zero dependência nova, `index.html`'s importmap
  intocado. Preserva a invariante documentada "ES Modules puros, sem bundler"
  (`docs/PLANO_VERTICAL_SLICE.md:8`).
- **A peça que faz cliente e servidor nunca discordarem sobre acerto:**
  `src/net/hittest.js` — módulo ESM **sem nenhum import** (nem `three`, nem DOM),
  operando sobre `{x,y,z}` simples. `server/room.js` e `Game.js` importam o mesmo
  arquivo. `src/net/protocol.js` guarda as constantes de gameplay compartilhadas
  (`JET_RANGE`, ângulo do cone, cooldowns) pelo mesmo motivo.
- **Autoridade do servidor nesta v1:** sala, papel, spawn, tiro e fim de partida. **Não**
  movimento — ver Débito 1.

## 3. O que existe hoje

| Peça | Arquivo | O que faz |
| --- | --- | --- |
| Protocolo compartilhado | `src/net/protocol.js` | Tipos de mensagem, constantes de gameplay, `makeInputPayload()` |
| Hitreg compartilhado | `src/net/hittest.js` | Cone de mira + alcance, sem imports |
| Cliente de rede | `src/Net.js` | Conecta, envia input/tiro, expõe eventos |
| Avatar remoto | `src/RemotePlayer.js` | Interpola snapshots (buffer 100ms), escolhe animação pelo estado recebido |
| Servidor | `server/index.js` + `server/room.js` | Sala única, papel por ordem de entrada, tick 20Hz, valida tiro, decide fim de partida |
| Integração no jogo | `src/Game.js` (`this.mode === 'online'`) | 3º modo ao lado de `chameleon`/`hunter`; reaproveita `HunterCamera` p/ o papel Caçador |

**Papel → câmera:** o Caçador do modo online usa a mesma `HunterCamera` (1ª pessoa, FOV,
lanterna, viewmodel — `docs/MECANICA_CACADOR_VISAO.md`) do single-player. Isso não é só
estética: uma câmera de 3ª pessoa (`FollowCamera`) sempre faz `lookAt()` no próprio
jogador, então `camera.getWorldDirection()` para mirar sempre apontaria pra si mesmo — a
troca de câmera só acontece depois do `welcome` do servidor, quando o papel é conhecido
(`Game._connectOnline()`).

**Sem ammo/scanner no online:** o servidor da v1 não tem conceito de munição — só
cooldown (300ms normal / 2600ms ao errar, mesmos valores do single-player, agora vindos
de `protocol.js`). Scanner fica fora de escopo (fase futura).

## 3.1. Bugs reais encontrados no primeiro teste em celular (corrigidos)

O teste headless (Playwright, duas abas no mesmo processo) não pegou nenhum dos dois —
só apareceram testando em dois aparelhos de verdade pela rede/túnel:

* **Avatares remotos flutuando 2×GROUND_Y acima do chão** (bem visível/quebrado em
  escadas, onde a altura varia degrau a degrau). Causa: `Player.position` (o que viaja
  na rede) já é a altura do CENTRO da cápsula — `RemotePlayer.js` estava somando
  `GROUND_Y` de novo em cima disso, e `server/room.js` mandava spawns com `y: 0` em vez
  de `y: GROUND_Y`, agravando o erro no primeiro frame. `GROUND_Y` agora é uma constante
  única em `protocol.js`, importada pelos dois lados — sem cópia solta pra divergir.
* **Os dois jogadores viraram Caçador.** Não era bug na atribuição de papel (que é
  síncrona e correta — `server/room.js` só dá `HUNTER` se ninguém mais na sala já for
  `HUNTER`). O log do servidor mostrou que as duas conexões **nunca estiveram na sala ao
  mesmo tempo**: cada uma entrou, achou a sala vazia (virou Caçador, correto) e saiu
  antes da outra entrar. Causa provável: `renderer.setAnimationLoop` (rAF) **para** quando
  a aba fica em segundo plano — comportamento padrão de todo navegador, mais agressivo no
  celular — e como `_sendOnlineInput()` só roda dentro do loop de render, o servidor parava
  de ver input e derrubava o cliente por `CLIENT_TIMEOUT_MS` assim que alguém trocava de
  app/aba pra abrir a segunda ponta do teste. Corrigido com duas mudanças em conjunto:
  1. `Net.js` ganhou um **keepalive por `setInterval`** (3s) que reenvia o último payload
     conhecido independente do loop de render — `setInterval` sobrevive em segundo plano
     (só fica mais lento), diferente de `requestAnimationFrame`.
  2. `CLIENT_TIMEOUT_MS` subiu de 10s pra 20s (`protocol.js`) — folga extra pro keepalive.
  3. Novo `Game._updateOnlineHint()`: quando `remotePlayers.size === 0`, o `#hint` mostra
     "Sozinho na sala — aguardando outro jogador" em vez de deixar o jogador sem
     nenhum sinal de que está esperando. `#hint` some em telas estreitas por padrão
     (`@media max-width:720px`) — exatamente a tela de um celular — então
     `body.mode-online #hint { display: block; }` (`css/style.css`) sobrepõe isso.

Nenhuma das duas correções elimina o risco por completo (uma aba minimizada por muito
tempo ainda pode ser derrubada) — é mitigação, não uma garantia. Reconexão de verdade
(retomar a MESMA sessão/papel depois de cair) fica fora de escopo desta v1.

## 4. Pontos de atenção (decisões, não descuidos)

1. **Yaw no payload é do BONECO, não da câmera.** `Player._orientTo` já gira o objeto
   pra direção do movimento — `_sendOnlineInput()` só extrai o Y do quaternion. Isso
   basta pra orientar o avatar remoto; não serve pra re-simular o movimento no servidor
   (ver Débito 1).
2. **`AIM_TOLERANCE_DEG` (protocol.js) existe porque o cliente mira num alvo
   interpolado e atrasado** (`INTERP_DELAY_MS`), enquanto o servidor valida contra a
   última posição que conhece. Sem essa folga, tiros honestos na borda do cone seriam
   recusados — é o substituto barato do lag compensation/rewind da spec original.
3. **Layout fixo (`FIXED_LAYOUT` em protocol.js).** `Level` é função pura do número do
   layout, com PRNG semeado (`mulberry32`, `Level.js`) — os dois clientes produzem
   geometria/`solids`/cores idênticos sem o servidor precisar rodar `Level.js` (que
   depende de `canvas`/DOM e não roda em Node). Os spawns em `server/room.js` foram
   copiados manualmente do `spawn` do layout 1.
4. **Cor nunca vai pela rede como pixels.** A "estampa" da camuflagem
   (`Player._stampZone`) é derivada de `(material, texSize, aniso)`, não de dados por
   pixel — os canvases usam `Math.random()` não semeado (`textures.js`), então dois
   clientes nunca teriam pixels idênticos mesmo se tentássemos. Só o `mat.color` (2
   valores hex) viaja — é o que a métrica de camuflagem (`isCamouflaged()`) realmente lê.

## 5. Débito registrado

**Movimento é forjável na v1** — o cliente simula a si mesmo e o servidor só retransmite
a posição recebida. Caminho para fechar isso: extrair de `Player.js` um núcleo de
simulação (posição, colisão AABB, gravidade, latch) sem `three`/DOM — hoje o construtor
cria `canvas` (`Player.js:90`), lê `sessionStorage` e escreve no DOM
(`_saveColorHistory`) — para o servidor poder re-simular e comparar contra o que o
cliente relata, em vez de confiar cegamente.

## Fora de escopo (registrado para não perder contexto)

Lag compensation/rewind, lobby e matchmaking 4-10 jogadores, as 4 fases de partida da
spec original (hoje a partida começa assim que o 1º jogador entra), Interest Management,
validação server-side de amostragem de cor, hospedagem em produção (a v1 roda em
`localhost` — nenhum dos alvos que `README.md` cita hoje, GitHub Pages/Netlify/Vercel
estático/S3, roda processo com estado).

## Como rodar

```bash
cd server && npm install && npm start   # servidor autoritativo, porta 8787
python3 dev_server.py                   # cliente, porta 8000 (noutro terminal)
```

Abra `http://localhost:8000` em duas abas, escolha o modo **Online** nas duas, clique
**JOGAR**. O servidor atribui Caçador ao 1º que entrar, Camaleão ao 2º.

`?ws=host:porta` na URL do cliente aponta pra outro servidor sem editar código (ex.:
testar celular + PC na mesma rede: `?ws=192.168.x.x:8787`).

**Testando por túnel (cloudflared, mesmo padrão já usado no projeto — ver
`dev_server.py`):** cliente e servidor precisam de **dois túneis separados** (o túnel do
cliente não repassa a porta 8787), e o cliente precisa do `?ws=` apontando pro túnel do
servidor:

```bash
cloudflared tunnel --url http://localhost:8000 --no-autoupdate   # cliente
cloudflared tunnel --url http://localhost:8787 --no-autoupdate   # servidor
```

Abra `https://<túnel-do-cliente>/?ws=<túnel-do-servidor>` no celular. `_wsUrl()`
(`Game.js`) já troca `ws://` por `wss://` sozinho quando a página é `https` (senão o
navegador bloqueia como conteúdo misto).

## Verificação (feita nesta sessão, headless)

- Duas abas conectam, papéis atribuídos corretamente (1ª = Caçador, 2ª = Camaleão),
  cada uma vê o avatar remota da outra se mover com interpolação (posição convergiu em
  ~2-3 ticks de rede após um deslocamento simulado).
- Caçador mira e acerta o Camaleão remoto → **as duas abas concordam** sobre o resultado
  (`won`/`over`) — a decisão veio só do servidor.
- Teste de protocolo isolado (`ws` cru, sem navegador): tiro errado aplica o cooldown de
  2,6s, spam durante o cooldown é ignorado, tiro certo após o cooldown acerta e encerra
  a partida com o motivo correto.
- Regressão: modos Camaleão e Caçador single-player continuam funcionando sem nenhum
  erro de console **com o servidor multiplayer desligado**.
