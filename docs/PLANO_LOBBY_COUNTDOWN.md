# Matchmaking online com preenchimento por IA

> Complementa `PLANO_LOBBY_MULTIPLAYER.md`. Este documento descreve o comportamento
> atual da formação de partidas online.

## Regra da sala

A primeira pessoa abre uma busca de 30 segundos (`MATCHMAKING_WAIT_MS`). Durante esse
período, todas as vagas ficam disponíveis para jogadores reais. A caçada ainda não
começou e o relógio de 180 segundos permanece parado.

- Com 5 jogadores reais, a partida começa imediatamente e nenhuma IA é criada.
- Ao fim dos 30 segundos, o servidor completa somente as vagas restantes com
  Camaleões de IA.
- O primeiro jogador real continua sendo o Caçador; humanos seguintes e IAs são
  Camaleões.
- Depois do início, a composição fica fechada. Reconexões retomam a mesma vaga, mas
  novas entradas não substituem uma IA durante a rodada.
- Se um Camaleão humano não voltar dentro da janela de reconexão, uma IA assume sua
  vaga. Se o Caçador não voltar, os Camaleões vencem a rodada.
- A revanche espera a confirmação de todos os humanos conectados, remove as IAs e
  abre uma nova busca de 30 segundos. Pessoas que entrarem nessa busca ocupam as
  vagas antes de qualquer nova IA.
- Se o Caçador sair durante a busca e não voltar na janela de reconexão, um
  Camaleão conectado assume o papel; a fila não fica parada.

Na entrada pública, `server/index.js` procura primeiro uma sala ainda em busca. Se
todas já começaram, cria outra fila pública automaticamente. Salas com código mantêm
um lobby próprio para que amigos usando o mesmo código se encontrem.

## Autoridade e protocolo

`server/room.js` mantém humanos em `clients` e IAs em `bots`. As IAs são simuladas no
tick do servidor e viajam nos mesmos `WELCOME`, `PLAYER_JOIN` e `SNAPSHOT` dos demais
participantes, marcadas com `isBot: true` e um nome como `IA 1`.

O protocolo envia dois relógios distintos:

- `matchmakingDeadline`: fim da busca reservada a humanos;
- `matchStartAt`: início efetivo da caçada, que permanece zero durante a busca.

O cliente usa a hora `t` do snapshot para mostrar a contagem sem depender do relógio
do aparelho. Enquanto busca, o HUD informa o tempo restante, a quantidade de pessoas
encontradas e que as vagas livres receberão IA. O estado também inclui a fase e o
número da rodada para recuperar corretamente uma reconexão ou revanche.

## Comportamento da IA

Os Camaleões artificiais escolhem destinos que podem alcançar sem cruzar os obstáculos
conhecidos pelo servidor. Eles procuram pontos fora da visão do Caçador, param e copiam
uma cor compatível ao se esconder e escolhem outra rota quando são vistos. A etiqueta
flutuante foi retirada porque revelava o esconderijo; `isBot` continua disponível para
listas e resultados. O servidor inclui as IAs na validação de tiro, portanto todos os
clientes observam o mesmo resultado.

## Verificação

A suíte cobre o bloqueio de IAs antes do prazo, preenchimento de quatro vagas para um
jogador sozinho, preenchimento somente das três vagas restantes quando há duas pessoas
e início antecipado sem IA quando a sala chega a 5/5. Também cobre rota/esconderijo da
IA, prontidão coletiva para revanche, promoção do Caçador e preservação de uma captura
quando a vaga desconectada passa à IA. Os testes anteriores de tiro, reconexão,
capacidade e segurança continuam ativos.
