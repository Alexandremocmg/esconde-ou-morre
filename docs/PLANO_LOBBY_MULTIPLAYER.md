# Lobby maior — 1 Caçador + N Camaleões (avaliação e plano)

> Segue de `docs/PLANO_MULTIPLAYER.md` (v1: sala fixa de 1 Caçador + 1 Camaleão). Este
> documento avalia o caminho para várias pessoas na MESMA partida — não confundir com
> "vários pares jogando ao mesmo tempo" (isso seria várias salas, outro problema,
> descartado nesta rodada a pedido do usuário).

---

## 1. Escopo escolhido

Da spec original (`PLANO_MULTIPLAYER.md` §1), dois itens ficaram "fora de escopo": lobby
4-10 jogadores e as 4 fases de partida. Esta fase resolve o primeiro **parcialmente**:
**1 Caçador + N Camaleões** na mesma sala/partida. Times / múltiplos Caçadores ficam de
fora (ver §6) — é um problema bem maior (câmera, munição e HUD hoje são todos desenhados
em torno de "existe exatamente um Caçador").

## 2. Avaliação: o que já funciona de graça

Antes de desenhar qualquer coisa nova, vale registrar o quanto do código **já foi escrito
pensando em N Camaleões**, mesmo com `MAX_PLAYERS = 2` travando isso hoje. Isso muda a
decisão: não é um redesenho, é destravar + fechar lacunas pontuais.

| Peça | Estado atual | Evidência |
| --- | --- | --- |
| Atribuição de papel | Já correta para N: 1º = Caçador, **todo o resto** = Camaleão | `room.js:129` — `takenRoles.has(HUNTER) ? CHAMELEON : HUNTER`, sem checar quantidade |
| Hitreg / candidatos | Já filtra e mira entre **múltiplos** Camaleões | `room.js:282-294` — `candidates` é uma lista, `coneCandidates` escolhe o mais próximo no cone |
| Condição de vitória do Caçador | Já checa "todos eliminados", não "o único" | `room.js:304` — `remaining.length === 0`, comentário já diz "todos os Camaleões eliminados" |
| Protocolo | Já modela o vencedor no plural | `protocol.js:S2C.MATCH_OVER` — `winner: 'hunter'|'chameleons'` |
| Avatares remotos (cliente) | Já é um `Map` genérico, iterado sem assumir só 1 | `Game.js:175,437-466,586` — `this.remotePlayers`, `_spawnRemotePlayer`/`_removeRemotePlayer` por id |
| Scanner do Caçador | Já recebe uma lista de alvos, não um alvo fixo | `Game.js:580-581` — `[...remotePlayers.values()].filter(role===CHAMELEON)` |
| Textos de HUD (modo Caçador solo) | Já escritos no plural ("todos os Camaleões") | `Game.js:238,867,877,994,1042` |
| Munição configurável | Já vai de 1 a 30, não fixo em 5 | `index.html:187-195`, autoritativo em `room.js:_handleJoin` |

**Conclusão da avaliação:** a melhor solução é a **evolução direta do código atual**, não
uma reescrita. As lacunas reais são pequenas e localizadas — listadas em §3. Não há
motivo para trocar de arquitetura (continua servidor Node + `ws`, mesmo `hittest.js`
compartilhado, mesmo modelo de snapshot 20Hz).

## 3. Mudanças necessárias

### 3.1. `server/room.js` — capacidade e spawns (obrigatório)

- **`MAX_PLAYERS = 2` → `ROOM_CAPACITY`** configurável (proposta: `1 + MAX_CHAMELEONS`,
  ver §4 para o número). A lógica de atribuição de papel não muda — só o limite que barra
  `_freshJoin`.
- **`SPAWNS[ROLE.CHAMELEON]` é um ponto único hoje** (`room.js:41`) — com N Camaleões,
  todos nasceriam empilhados no mesmo lugar. Proposta: manter o mesmo ponto-base ("canto
  SW aberto", já validado como espaço livre) e espalhar por um **anel determinístico**
  ao redor dele, indexado pela ordem de entrada:
  ```js
  function chameleonSpawn(index) {
    const angle = (index * 2 * Math.PI) / MAX_CHAMELEONS;
    const r = 2.2; // metros — testado como livre de colisão em Level.js layout 1
    return { x: BASE.x + r * Math.cos(angle), y: GROUND_Y, z: BASE.z + r * Math.sin(angle) };
  }
  ```
  Sem validação contra geometria (Débito 1 do plano original já aceita isso — o
  controlador do jogador resolve colisão a partir do 1º frame, igual já acontece hoje).

### 3.2. Camaleão eliminado precisa de um estado próprio (lacuna real, não é só infra)

Hoje, eliminação de UM Camaleão sempre = fim de partida (sala fixa de 2). Com N
Camaleões isso deixa de ser verdade, e aparece um buraco: `Game.js:_onPlayerHit` (linha
473) só tem efeito cosmético (vibração + vinheta) quando `targetId === this.net.id` — não
existe um estado "fui pego, aguarde o fim da partida" no cliente. Um Camaleão eliminado
continuaria andando, camuflando e mandando input normalmente, enquanto nas OUTRAS telas
seu avatar já sumiu (`RemotePlayer.js` funde a escala a zero). Isso é confuso e
potencialmente exploitável (o Camaleão eliminado ainda vê o mapa, o Caçador e os outros
Camaleões via Scanner/posição, sem estar mais "em jogo").

**Proposta:** quando `_onPlayerHit` chega com `targetId === this.net.id` e
`this.onlineRole === ROLE.CHAMELEON`, o cliente entra em modo espectador local:
- Congela input de movimento (reaproveita o mesmo travamento que `_gameOver`/`_win` já
  fazem — ver `Game.js:1212`).
- Mostra uma tela leve "Você foi flagrado — aguardando o fim da partida" (nova, pequena;
  reaproveita o estilo de `#hint`/overlay existente).
- Continua recebendo `SNAPSHOT`/`MATCH_OVER` normalmente para saber quando a partida
  encerrar e mostrar a tela final de vitória/derrota real.

Isso é o item de maior risco de esquecimento do plano — sem ele, N>1 Camaleões "funciona"
tecnicamente mas a experiência de quem morre primeiro fica quebrada.

### 3.3. Início de partida vs. sala vazia de Camaleões

Hoje o timer da partida (`_matchStartAt`) começa assim que o **1º jogador** entra
(`room.js:151`), que sempre é o Caçador. Em v1 (sala de 2) isso não incomodava muito — o
2º jogador chegava rápido. Com uma sala maior, o Caçador pode ficar sozinho queimando os
180s do timer enquanto espera Camaleões aparecerem.

**Proposta mínima (sem lobby de verdade, que continua fora de escopo):** só iniciar/reiniciar
`_matchStartAt` quando o primeiro **Camaleão** entrar, não no primeiro jogador. O hint
"Sozinho na sala — aguardando outro jogador" (`Game.js:428-434`) já existe e já cobre a
espera visualmente — só precisa continuar valendo enquanto `remotePlayers.size === 0`, o
que já é o caso.

### 3.4. Ajustes pequenos de HUD (opcional, mas barato)

- Caçador: mostrar contagem "N Camaleões restantes" (dado já existe no `SNAPSHOT`, é só
  contar `!eliminated` do lado do cliente) — hoje o Caçador não tem nenhum sinal de quantos
  faltam além de "acabou ou não acabou".
- Sem mudança nenhuma necessária no Scanner nem no `RemotePlayer.js` — já generalizam.

## 4. Decisões de design (não só código)

- **Quantos Camaleões?** Proposta: `MAX_CHAMELEONS = 4` (sala de 5 no total) como
  primeiro corte. Suficiente para mudar a dinâmica (o Caçador não pode mais assumir "o
  próximo vulto camuflado é o alvo certo") sem exigir redesenho de munição/tempo de
  partida ainda. Pode subir depois que houver teste real.
- **Munição por padrão continua manual (1-30 no menu).** Não precisa virar "munição
  escala com N Camaleões" automaticamente — quem cria a sala já escolhe hoje, e o texto
  do `<select>` pode ganhar uma dica ("Online com mais Camaleões? considere 10+").
- **Duração da partida (`MATCH_DURATION_S = 180`) fica igual** nesta fase — mexer nisso é
  balanceamento de jogo, melhor avaliar depois de um teste real com 3-4 Camaleões.

## 5. Débito e riscos herdados (não pioram, não melhoram nesta fase)

- Débito 1 (`PLANO_MULTIPLAYER.md` §5) continua igual: movimento não é validado no
  servidor. Com mais jogadores na sala, a superfície pra um cliente desonesto forjar
  posição cresce proporcionalmente, mas a mitigação (ou falta dela) não muda nesta fase.
- Interest Management continua fora de escopo: todo mundo recebe a posição de todo mundo
  a cada tick, camuflado ou não — com N Camaleões isso vira um Scanner "de graça" via
  DevTools pra quem quiser trapacear. Registrado, não resolvido aqui (mesma posição do
  documento original).

## 6. Fora de escopo (registrado para não perder contexto)

- **Múltiplos Caçadores / times.** Muito maior que N Camaleões: câmera (`HunterCamera` é
  1ª pessoa pensada pra um Caçador só), munição/scanner por Caçador, HUD, e a própria
  atribuição de papel (`takenRoles.has(HUNTER)`) precisariam de redesenho. Fica como
  possível próxima fase, não parte desta.
- Lobby com fases / "pronto?" antes de começar (spec original §4) — a mitigação do §3.3
  (só começar o timer quando o 1º Camaleão entrar) resolve o caso prático sem precisar
  disso.
- Várias salas simultâneas (pares independentes jogando ao mesmo tempo) — descartado
  explicitamente nesta rodada; a pergunta que abriu esta sessão já filtrou por isso.
- Validação server-side de amostragem de cor, lag compensation/rewind — mesma posição do
  plano original, não afetados por N Camaleões.

## 7. Passos de implementação (nesta ordem)

1. `protocol.js`: adicionar `MAX_CHAMELEONS` (constante compartilhada, hoje só existe
   `MAX_PLAYERS` local a `room.js`).
2. `room.js`: trocar `MAX_PLAYERS` por `1 + MAX_CHAMELEONS`; implementar `chameleonSpawn(index)`
   no lugar do ponto único; `_matchStartAt` só arma no 1º Camaleão (§3.3).
3. `Game.js`: estado de espectador local pro Camaleão eliminado (§3.2) — o item que mais
   importa pra experiência.
4. `Game.js`/HUD: contador "N Camaleões restantes" pro Caçador (§3.4, opcional).
5. Testar headless (Playwright, N abas) igual ao padrão já usado na v1
   (`PLANO_MULTIPLAYER.md` §"Verificação") — especialmente: papel atribuído certo pra
   3-4 entradas seguidas, spawns sem sobreposição visível, Camaleão eliminado não
   consegue mais se mover nem atrapalhar o resultado, `matchOver` com o motivo certo
   quando o ÚLTIMO Camaleão cai.
6. Testar em dispositivos reais (padrão já estabelecido — túnel cloudflared ou produção
   direto) com 3+ pessoas de verdade antes de considerar fechado.

## 8. Status da implementação

**Passos 1-4 implementados** (`protocol.js`, `room.js`, `Game.js`, `style.css`):

- `MAX_CHAMELEONS = 4` (`protocol.js`) — sala vira `1 + MAX_CHAMELEONS` (5 no total).
- `room.js`: `ROOM_CAPACITY`, `_chameleonSpawn(index)` em anel (raio 2.2m) ao redor do
  ponto-base antigo, `client.spawn` guardado por cliente (reconexão reusa o mesmo ponto,
  não recalcula por índice), timer só arma no 1º Camaleão de verdade (não no Caçador
  sozinho).
- `Game.js`: `_eliminatedSpectating` — Camaleão flagrado congela (mesmo gate de
  `over`/`won` no loop principal), vê "🫥 Você foi flagrado — aguardando o fim da
  partida...", e some da lógica sem antecipar a tela final (`_win`/`_gameOver` real só
  roda quando o `MATCH_OVER` da PARTIDA chega). Coberto também o caso de reload/
  reconexão no meio da partida já eliminado (`welcome.eliminated`, novo campo do
  `WELCOME`) — sem isso o Camaleão reconectado voltaria a andar normalmente sem saber
  que já estava fora.
- HUD do Caçador ganhou contador "N Camaleões restantes" (reaproveita `#targets-hud`,
  antes exclusivo do modo Caçador solo contra alvos-boneco).

**Verificado (passo 5, headless, protocolo `ws` cru sem navegador — script novo,
não commitado, reflexo do padrão já usado na v1):** contra o `Room` real —
1 Caçador + 4 Camaleões, papéis corretos, spawns todos distintos, 6º cliente recusado
por sala cheia, timer não arma com o Caçador sozinho e arma no 1º Camaleão, eliminar os
3 primeiros Camaleões NÃO encerra a partida, eliminar o último encerra com
`winner=hunter` e o motivo certo, e todo mundo (incluindo os já eliminados) recebe o
`MATCH_OVER`. 25/25 checagens passaram.

**Não verificado ainda (precisa de navegador de verdade — passo 6):** o estado de
espectador local (`_eliminatedSpectating`), o texto do hint e o contador de HUD no
cliente foram implementados e revisados linha a linha, mas não exercitados numa sessão
de navegador real (Playwright multi-aba ou dispositivos físicos). Recomendado antes de
considerar esta fase fechada de vez.

## 9. Em produção

Commit `337e281` subiu pra `main` a pedido do usuário e os dois lados autodeployaram:
Vercel promoveu o cliente em produção (`target: "production"`, sem cair na pegadinha
`target:null` de [[production-hosting-status]]) e o Render serviu o código novo pouco
depois — confirmado ao vivo por um script `ws` cru contra
`wss://esconde-ou-morre-server.onrender.com`: 5 conexões entram (1 Caçador + 4
Camaleões, spawns no anel exatamente nos pontos calculados por `_chameleonSpawn`), a 6ª
é recusada por "sala cheia".

Verificação visual adicional (Playwright, local, duas abas em modo Online) confirma
papel/spawn corretos. O fluxo de eliminação → espectador (§3.2) especificamente
**continua não testado num navegador real** — é o item mais importante pra fechar antes
de considerar o lobby maior 100% validado.
