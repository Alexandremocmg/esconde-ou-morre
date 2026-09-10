# Multiplayer — Fatia Vertical (v1)

> Avaliação e implementação de uma especificação técnica de multiplayer trazida pelo
> usuário (servidor autoritativo, sincronização de camuflagem, hitreg validado,
> anti-cheat). A spec original citava Photon Fusion/Mirror (exclusivos de Unity) e UDP
> (indisponível no navegador) — este documento registra o que foi adaptado e por quê.
>
> **Atualização:** a sala fixa de 2 (1 Caçador + 1 Camaleão) descrita aqui evoluiu para
> 1 Caçador + até 4 Camaleões na MESMA partida — ver
> [`docs/PLANO_LOBBY_MULTIPLAYER.md`](PLANO_LOBBY_MULTIPLAYER.md). Arquitetura, protocolo
> e hospedagem abaixo continuam valendo; só a capacidade da sala (§3.1 "O que existe
> hoje" e a tabela de avaliação §1) mudou. Depois disso, a partida ganhou uma contagem
> regressiva de 12s antes de ficar ativa (endereça parte do item "Lobby 4-10 jogadores,
> 4 fases de partida" da tabela §1) — ver
> [`docs/PLANO_LOBBY_COUNTDOWN.md`](PLANO_LOBBY_COUNTDOWN.md).

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
| Hitreg validado no servidor | ✅ **Núcleo desta v1** — inclui oclusão de parede (`src/net/occluders.js`, ver §4.2) |
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
| Pincel Livre (rede) | `protocol.js` (`C2S.PAINT`/`S2C.PLAYER_PAINT`), `server/room.js` (`_handlePaint`), `RemotePlayer.js` (`applyPaintStrokes`) | Lista compacta de traços (não pixels — mesma regra do §4.4), evento por-ação em vez de por-tick; servidor guarda o acumulado de cada jogador só pra repassar a quem entra depois (WELCOME) |
| Servidor | `server/index.js` + `server/room.js` | Salas em memória por código (com entrada pública padrão), papel por ordem de entrada, tick 20Hz, valida tiro, decide fim de partida, segura vaga de quem reconecta |
| Integração no jogo | `src/Game.js` (`this.mode === 'online'`) | 3º modo ao lado de `chameleon`/`hunter`; reaproveita `HunterCamera` p/ o papel Caçador |
| Reconexão | `src/Net.js` + `server/room.js` (`_reattach`/`_purgeStale`) | Backoff automático + retomada via `sessionStorage` — ver §3.2 |

**Papel → câmera:** o Caçador do modo online usa a mesma `HunterCamera` (1ª pessoa, FOV,
lanterna, viewmodel — `docs/MECANICA_CACADOR_VISAO.md`) do single-player. Isso não é só
estética: uma câmera de 3ª pessoa (`FollowCamera`) sempre faz `lookAt()` no próprio
jogador, então `camera.getWorldDirection()` para mirar sempre apontaria pra si mesmo — a
troca de câmera só acontece depois do `welcome` do servidor, quando o papel é conhecido
(`Game._connectOnline()`).

**Munição e Scanner têm paridade com o Caçador solo.** Munição é AUTORITATIVA no
servidor (`room.js:_handleFire`, mesma ordem de `Game.js:fireHunterShot`) — mesmo
princípio de "as duas abas nunca podem divergir sobre o resultado" já usado pro
cooldown; ficar sem munição encerra a partida a favor do Camaleão. Scanner é
100% client-side, sem participação do servidor: a posição de todo jogador já
viaja a 20Hz no SNAPSHOT independente de camuflagem (Interest Management
continua fora de escopo, ver tabela acima), então o Scanner não revela nada que
o cliente não tivesse — é só a mesma affordance de radar do solo, reaproveitada
com `RemotePlayer` no lugar de `ChameleonTarget`.

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
tempo ainda pode ser derrubada) — é mitigação, não uma garantia. Foi essa lacuna que
motivou a reconexão de verdade, descrita a seguir.

## 3.2. Reconexão

Uma queda de conexão não encerra mais a partida na hora. Cobre dois casos:

1. **WS cai com a aba viva** (wifi pisca, app vai brevemente pro fundo) — `Net.js`
   detecta o `close` inesperado e tenta reconectar sozinho (backoff 1s/2s/3s/5s...),
   sem tocar em posição/câmera (que nunca pararam de rodar localmente — Débito 1: o
   cliente sempre se auto-simula).
2. **O navegador mata a aba de vez e recarrega** (mais comum no celular do que
   parece — foi o que aconteceu nos próprios testes desta sessão com múltiplas
   abas). `id`+`token` da sessão ficam em `sessionStorage` (mesmo padrão de
   `eom-body`/`eom-stage`) e sobrevivem ao reload; ao entrar em Online de novo,
   `Net.connect()` tenta retomar essa sessão antes de pedir uma nova.

**Como funciona:** a identidade viaja na própria URL de upgrade do WebSocket
(`?rejoin=<id>:<token>`), resolvida de forma síncrona em `room.js:addClient` —
sem mensagem nova no protocolo. O servidor segura a vaga (papel, munição,
`eliminated`) por `RECONNECT_GRACE_MS` (30s, `protocol.js`) antes de dar a sessão
como perdida de vez (`_purgeStale`, chamado a cada tick). O `token` (gerado
junto do `id`, nunca broadcastado — só vai pro próprio dono na mensagem
`welcome`) impede que qualquer um que veja o `id` de outro jogador (visível pra
todo mundo via SNAPSHOT) sequestre a sessão dele — não é segurança de verdade
(sem TLS mútuo/assinatura), só o suficiente pra não ser trivial; mesmo nível de
confiança do resto da v1.

**Um bug real evitado ao desenhar isto:** contar só clientes `connected` pra
decidir se a sala está cheia/qual papel sobrou deixaria um 3º dispositivo roubar
a vaga de alguém em plena reconexão (a checagem original só olhava clientes
ativos, e um cliente caído-mas-dentro-da-janela não contava como "ocupando" nada).
`_freshJoin` agora conta TODO cliente ainda na sala (conectado ou em espera de
reconexão) pra capacidade/atribuição de papel — só `_purgeStale` de fato libera a
vaga. Verificado com um script que conecta como Caçador, mata a conexão, tenta
entrar fresco enquanto a janela ainda está aberta (recebe Camaleão, não rouba o
papel) e confirma que uma 4ª tentativa é recusada por sala cheia.

**O que NÃO é preservado num reload completo:** posição/pose/cor exatas — o
`Player` local também reseta pro spawn (não é só a rede que perde estado, é o
processo JS inteiro que recomeça). Papel, munição e status de eliminado
continuam corretos; só a posição "esquece" o último instante antes da queda —
o jogador reaparece no spawn do seu papel, visualmente como se tivesse acabado
de entrar, mas DENTRO da mesma partida/sessão (sem trocar de papel, sem
resetar munição, sem reviver se já estava eliminado).

## 4. Pontos de atenção (decisões, não descuidos)

1. **Yaw no payload é do BONECO, não da câmera.** `Player._orientTo` já gira o objeto
   pra direção do movimento — `_sendOnlineInput()` só extrai o Y do quaternion. Isso
   basta pra orientar o avatar remoto; não serve pra re-simular o movimento no servidor
   (ver Débito 1).
2. **`AIM_TOLERANCE_DEG` (protocol.js) existe porque o cliente mira num alvo
   interpolado e atrasado** (`INTERP_DELAY_MS`), enquanto o servidor valida contra a
   última posição que conhece. Sem essa folga, tiros honestos na borda do cone seriam
   recusados — é o substituto barato do lag compensation/rewind da spec original.
   **Recalibrado de 6° pra 2.5°**: por ser um ÂNGULO compensando uma DERIVA em METROS
   fixa (`INTERP_DELAY_MS` × velocidade ≈ 0,83m, não muda com a distância), o perdão
   que ele dava crescia com o alcance do tiro — a 15m (`JET_RANGE`) chegava a ~1,64m,
   quase o dobro do necessário, lido como "acertei sem estar mirando, de longe". Em
   2.5° o perdão no alcance máximo cai pra ~0,67m.
   2.1. **Oclusão de parede** (`src/net/occluders.js`, novo): antes disso, o servidor
        não tinha NENHUMA noção de geometria da mansão — um Camaleão atrás de parede
        dentro do cone/alcance contava como acerto (`hittest.js` já documentava essa
        lacuna como pendência do servidor). `LAYOUT_1_OCCLUDERS`/`LAYOUT_4_OCCLUDERS`
        são snapshots estáticos (AABBs de `level.climbables`, um por layout elegível
        pro Online — `protocol.js:ONLINE_LAYOUTS`) extraídos uma vez cada via harness
        Playwright headless; `isOccluded()` faz o teste ray-AABB pelo método dos
        slabs, sem `three`/DOM (mesma regra de zero-imports de `protocol.js`/
        `hittest.js`). `server/room.js:_handleFire` escolhe a tabela certa por
        `OCCLUDERS_BY_LAYOUT[this._layout]` e filtra os candidatos de `coneCandidates`
        por isto antes de escolher o `best`. Fragilidade registrada no próprio
        arquivo: se a geometria de um layout mudar em `Level.js`, o snapshot
        correspondente fica desatualizado em silêncio — precisa ser regerado
        manualmente.
3. **Mapas no Online definidos pela sala.** `onlineLayoutFor()` ainda escolhe um
   mapa inicial quando a cena precisa ser montada antes da conexão, mas o servidor
   fixa `this._layout` ao formar a sala e envia esse valor no `WELCOME`. O cliente
   compara os dois valores, salva o layout da sessão e recria a cena quando houver
   divergência; assim relógios diferentes ou uma virada de hora não deixam jogadores
   na geometria errada. `Level` continua sendo função pura do número do layout, com
   PRNG semeado, e os spawns/oclusores seguem a tabela do servidor.
4. **Cor nunca vai pela rede como pixels.** A "estampa" da camuflagem
   (`Player._stampZone`) é derivada de `(material, texSize, aniso)`, não de dados por
   pixel — os canvases usam `Math.random()` não semeado (`textures.js`), então dois
   clientes nunca teriam pixels idênticos mesmo se tentássemos. Só o `mat.color` (2
   valores hex) viaja — é o que a métrica de camuflagem (`isCamouflaged()`) realmente lê.
   O Pincel Livre (pintura por UV, ver tabela do §3 e `src/UVPaint.js`) segue a mesma
   regra por um motivo diferente, mas com a mesma solução: manda uma LISTA DE COMANDOS
   de traço (posição UV + cor + raio), nunca a textura/pixels em si — cada cliente
   redesenha os mesmos comandos no seu próprio canvas, o que é determinístico (ao
   contrário do carimbo de ambiente acima).

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
validação server-side de amostragem de cor.

## Hospedagem (produção)

Cliente e servidor moram em plataformas diferentes, porque só o servidor precisa de
processo persistente (estado da sala em memória) — os alvos estáticos que o README
cita (GitHub Pages/Netlify/Vercel/S3) não seguram isso.

- **Servidor** → Render.com, via Blueprint (`render.yaml` na raiz do repo):
  `rootDir: server`, `npm install` / `npm start`, plano free. Free tier dorme após
  15min de inatividade — primeira conexão depois disso demora ~30-50s pra acordar
  (o `#hint` já mostra "Conectando à sala..." nesse meio tempo, `Game.js`).
- **Cliente** → Vercel, projeto ligado ao repo do GitHub (branch `main`), deploy
  automático a cada push. `.vercelignore` na raiz exclui os artefatos brutos do
  Tripo em `public/models/` que não são carregados em runtime.
- **Como o cliente acha o servidor:** `_wsUrl()` (`Game.js`) continua aceitando
  `?ws=host` pra testes (LAN/túnel), mas fora de localhost/LAN cai em
  `PROD_WS_URL` (`net/protocol.js`) — a URL fixa do serviço no Render. Precisa
  ficar em sincronia manual com a URL real que o Render atribuir ao criar o
  serviço (só muda se o serviço for recriado com outro nome).

**Status: em produção e verificado (2026-08-18).** Cliente ao vivo em
`https://esconde-ou-morre.vercel.app` (deploy `8c28758` promovido automaticamente pelo
webhook do GitHub e aliasado em produção) e servidor no Render respondendo — handshake
WS real testado (mensagem `welcome` recebida com papel/spawn/token). Pegadinha já
resolvida nessa checagem: um deploy da Vercel pode ficar `READY` com `target: null`
(preview, não produção) mesmo em cima do commit certo — confirmar sempre pelo alias de
produção, não só pelo status do deploy mais recente.

## Como rodar

```bash
cd server && npm install && npm start   # servidor autoritativo, porta 8787
python3 dev_server.py                   # cliente, porta 8000 (noutro terminal)
```

Abra `http://localhost:8000` em até 5 abas, escolha o modo **Online** em todas, clique
**JOGAR**. O servidor atribui Caçador ao 1º que entrar, Camaleão aos próximos (até 4) —
sala de 1 Caçador + N Camaleões desde `docs/PLANO_LOBBY_MULTIPLAYER.md`, que evoluiu a
sala fixa de 2 desta v1 original (tabela §1 abaixo reflete a avaliação da ÉPOCA, antes
dessa evolução).

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
