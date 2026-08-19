# Contagem regressiva de lobby (matchmaking leve)

> Segue de `docs/PLANO_LOBBY_MULTIPLAYER.md` (1 Caçador + até 4 Camaleões na mesma
> partida). Este documento cobre a fase seguinte: uma janela de espera fixa antes da
> partida ficar realmente ativa, endereçando parte do item "Lobby 4-10 jogadores, 4
> fases de partida" que a spec original (`docs/PLANO_MULTIPLAYER.md` §1) pedia e ficou
> fora de escopo da v1.

---

## 1. Problema

Até aqui, a partida começava **instantaneamente** assim que o 1º Camaleão conectava
(`server/room.js:_freshJoin`, bloco `chameleonsConnectedBefore === 0`, setava
`this._matchStartAt = Date.now()`). Sem janela de espera: se o Caçador e o 1º Camaleão
entrassem quase juntos, o Caçador já podia atirar antes de mais ninguém conseguir abrir
o link compartilhado — e não havia nenhum aviso visual de "a partida vai começar". Com
o lobby maior (até 5 jogadores, `docs/PLANO_LOBBY_MULTIPLAYER.md`) essa lacuna ficou
mais sentida: mais gente pra esperar chegar, mais chance de alguém ficar de fora do
início de fato competitivo.

## 2. Decisões

1. **Duração: 12s** (`LOBBY_COUNTDOWN_MS`, `protocol.js`) — tempo ADICIONAL antes dos
   180s de caçada (`MATCH_DURATION_S`), não descontado deles. Longo o bastante pra um
   2º/3º jogador abrir o link a frio e terminar o handshake, curto o bastante pra não
   virar tempo morto (~7% de overhead sobre uma partida de 180s).
2. **"Jogar novamente" (revanche instantânea) continua instantâneo** — `_onRevive`
   NÃO passa pela contagem, de propósito. Só a formação de uma sala NOVA espera; quem
   já estava jogando junto não precisa esperar de novo.
3. **Atalho de sala cheia:** se a sala encher (5/5) antes da contagem acabar, pula
   direto pro início — com todo mundo já presente não faz sentido esperar o resto dos
   12s à toa.
4. **O que dá pra fazer durante a contagem:** tudo — mover, olhar, pintar. Só o
   **tiro do Caçador** fica bloqueado (servidor recusa silenciosamente; cliente também
   não tenta, pra não gastar uma viagem de rede à toa). Sem tela de lobby separada —
   o mundo já carregado continua visível, é só uma restrição a mais em cima do que já
   existia.

## 3. Como funciona

**Ideia central: reaproveitar `_matchStartAt` como timestamp FUTURO** em vez de
introduzir um novo campo de estado. Antes, `_matchStartAt` só podia ser `0` (não
armado) ou "agora" (partida ativa). Agora ele também pode ser um timestamp no FUTURO —
"contando regressivamente" — e isso é praticamente de graça pro resto do código:
`_tick()` já calcula `elapsed = (now - this._matchStartAt) / 1000` pra decidir fim por
tempo; enquanto `_matchStartAt` está no futuro, `elapsed` é negativo, a checagem nunca
dispara, e os 180s só começam a contar de verdade quando `now` ultrapassa o timestamp.
**Nenhuma mudança nesse trecho.**

- `server/room.js:_freshJoin` arma `this._matchStartAt = Date.now() + LOBBY_COUNTDOWN_MS`
  no lugar do antigo `Date.now()` instantâneo (mesmo gatilho de sempre: só o 1º
  Camaleão de verdade arma).
- Atalho de sala cheia: logo depois, se `this._matchStartAt > Date.now()` e
  `this.clients.size === ROOM_CAPACITY`, colapsa pra `Date.now()`.
- `_handleFire` ganha um gate: `!this._matchStartAt || Date.now() < this._matchStartAt`
  — Caçador não atira antes da contagem zerar.
- `_onRevive` **não muda** — comentário explícito no código pra ninguém "consertar"
  isso pra usar `LOBBY_COUNTDOWN_MS` sem querer.
- `matchStartAt` viaja tanto no `WELCOME` quanto em todo `SNAPSHOT` (20Hz, já carrega
  `t` = hora do SERVIDOR). O cliente calcula "quantos segundos faltam" contra `t`, não
  contra `Date.now()` local — evita que um relógio de aparelho dessincronizado mostre
  um número errado.
- `Game.js:_updateLobbyCountdown()` (chamado no topo de `_onSnapshot`) escreve
  `⏳ Partida começa em Ns...` no `#hint` (mesmo elemento já usado pra "sozinho na
  sala"/"flagrado"/hint normal — sem UI nova), deduplicado por segundo inteiro pra não
  reescrever o DOM a 20Hz. Quando a contagem zera, devolve o `#hint` pro texto normal
  de papel via `_updateOnlineHint()`.
- `_updateOnlineHint()` ganha um guard de prioridade (mesmo padrão do guard de
  "flagrado" já existente): um `PLAYER_JOIN`/`PLAYER_LEAVE` no meio da contagem não
  pode apagar o texto dela.
- `_fireOnline()` espelha o mesmo gate do servidor, só por UX (o servidor já é quem
  decide de verdade).

## 4. Verificação

**Headless (protocolo `ws` cru contra o `Room` real, sem navegador — mesmo padrão já
usado no lobby maior):** 21/21 checagens passaram, cobrindo: Caçador sozinho não arma
nada; 1º Camaleão arma a contagem pro valor certo; tiro durante a contagem é ignorado
(sem `PLAYER_HIT`, sem gastar munição, sem `FIRE_DENIED`); 2º/3º Camaleão entrando no
meio não rearma; sala cheia (5/5) colapsa a contagem e libera o tiro na hora; contagem
natural (sem encher a sala) libera o tiro depois dos 12s reais; fim de partida por
tempo continua respeitando o deslocamento (`_tick` sem mudança, verificado poking
`_matchStartAt` pra simular o fim se aproximando, sem esperar os 192s reais); `_onRevive`
depois de uma partida concluída continua instantâneo, não passa pela contagem. **Não
testado neste script:** sala esvaziar e encher de novo do zero — é o mesmo caminho
`connectedBefore === 0` que já existia antes desta feature (não mudou), risco baixo o
bastante pra não justificar esperar `RECONNECT_GRACE_MS` (30s) num teste automatizado.

**Visual (Playwright, local, 2 abas em Online):** `#hint` mostra a contagem
decrescente pros dois papéis (Caçador e Camaleão) e transiciona sozinho pro texto
normal de papel quando termina, sem erros de console/página.

## Status

Implementado e verificado localmente (servidor headless + navegador). Ainda não testado
em produção nem com múltiplos dispositivos reais — próximo passo antes de considerar
esta fase fechada de vez.
