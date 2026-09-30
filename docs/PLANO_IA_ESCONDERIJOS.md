# IA dos Camaleões do Online: esconderijos de verdade

Etapa 2 do [plano de melhorias](PLANO_MELHORIAS_JOGO.md). Entregue em 2026-09-30 para os
três mapas do Online (mansão, fábrica e Chameleon Manor), só no **térreo** de cada um.

## O que mudou

| Antes | Agora |
| --- | --- |
| Sorteava pontos livres no chão do mapa e ia em linha reta até eles. | Escolhe um **esconderijo real** do mapa e caminha até ele contornando paredes, móveis e escadas (A* numa grade de navegação). |
| Ao chegar, deitava e trocava a cor por um sorteio de paleta. | Ao chegar, gruda na parede (ou deita num tapete) e **copia a cor que o jogo mede naquela superfície**. |
| Via o Caçador por um critério único (`< 10 m` e sem parede). | Percepção limitada: alcance, campo de visão, parede no meio, audição de perto e memória curta. |
| Fugia para outro ponto livre qualquer. | Reage com atraso e foge para um abrigo longe, fora da vista do último ponto onde viu o Caçador. |

O que o Caçador humano enxerga, portanto, é o que enxergaria de um Camaleão camuflado de
verdade: uma figura da cor exata da parede, rente ao rodapé.

## Como funciona

### Dados (`server/navdata.js`, gerado)

O servidor nunca roda `Level.js` (depende de canvas/DOM), então a geometria chega como
snapshot, como já acontece com os oclusores de tiro (`src/net/occluders.js`). Por layout:

- **Grade de navegação** em células de 0,5 m do térreo. `.` é chão onde a IA pode pisar
  (já descontado o raio dela; só o que é alcançável a partir do spawn), `#` é parede,
  móvel, escada, buraco de escada ou ilhota inalcançável.
- **Esconderijos**: `[tipo, x, z, yaw, corSuperior, corInferior]`. `w` = grudado numa
  parede, `p` = deitado num tapete colorável.

Os dados saem do **jogo real rodando no navegador**, usando o próprio `Player`
(`toggleLatch`, `_surfaceBehindZone`, `_surfaceBelowColor`). Um esconderijo extraído assim é,
por construção, um lugar onde um humano consegue se esconder com as mesmas regras, e a cor
é a que o jogo compara. Fluxo completo em [`scripts/navdata/README.md`](../scripts/navdata/README.md).

| Layout | Grade | Células alcançáveis | Esconderijos |
| --- | --- | --- | --- |
| 1 (mansão) | 60×60 | 2 646 | 134 |
| 4 (fábrica) | 60×60 | 2 454 | 162 |
| 5 (Chameleon Manor) | 242×162 | 35 146 | 220 |

### Navegação (`server/nav.js`)

Dijkstra em 8 vizinhos sem cortar quina de obstáculo, e "string pulling" para trocar a
escada de células por poucos pontos. Um Dijkstra completo no maior mapa custa ~10 ms;
a IA limita a busca a 45 m de caminho (~5 ms) e só cai para o mapa inteiro se nada
qualificar. Além disso há no máximo **uma decisão cara por tick**: sem isso, as 4 IAs
decidindo juntas no início da partida estouravam o tick de 50 ms (medido: 115 ms).

### Comportamento (`server/botAI.js`)

```
procurar → ir → gruda/copia a cor → [observar] → fugir → (volta a procurar)
```

| Estado | O que faz |
| --- | --- |
| `seeking` | Escolhe o esconderijo (abaixo). Sem destino possível, tenta de novo em 1,5 s. |
| `moving` | Anda a 2,4 m/s pelo caminho. Se dá de cara com o Caçador, vira `fleeing` na hora. |
| `fleeing` | Anda a 3,8 m/s para um abrigo longe do último ponto onde viu o Caçador. |
| `hiding` | Parada, camuflada. Troca de lugar após 14–30 s (uma IA que nunca sai é varrida pelo Scanner). |
| `alert` | Percebeu ameaça enquanto escondida. Reage depois de 450–1000 ms; se o Caçador sumiu, foi alarme falso. |

**Escolha do esconderijo**: pontuação = menos a distância de caminho (peso baixo) + sorteio
(para duas IAs na mesma situação não escolherem igual). Com memória do Caçador: descarta
abrigos a menos de 6 m dele e os que exigem passar por ele, e soma bônus por distância e
por estar fora da linha de visão do último ponto onde o viu. Nunca repete o último abrigo,
nunca dois bots no mesmo, e abandona destinos onde já travou.

**Percepção** (todos os valores em `AI`, no topo de `botAI.js`):

| | Valor |
| --- | --- |
| Enxerga o Caçador | até 12 m, campo de visão de 200°, sem parede no meio |
| Ouve o Caçador | até 3 m, mesmo de costas e através de parede |
| Se assusta | ouvindo, ou vendo a menos de 6,5 m |
| Memória | 10 s |

O servidor **não** sabe para onde a câmera do Caçador aponta (só o yaw do corpo), então a IA
não sabe se está sendo olhada: a percepção é dela, não do Caçador.

**Paridade com um humano**: só pisa em célula livre; anda bem abaixo dos 8,25 m/s de um
jogador; copia a cor medida pelo jogo; é alvo do mesmo tiro (cone + oclusão). Não tem
onisciência: não conhece o Caçador fora da percepção acima.

## Verificação

- **`server/test/botai.test.mjs`**, 38 testes, sem rede e com relógio sintético e semente
  fixa: dados coerentes e sem ilhotas, caminhos válidos que contornam parede, chegada a
  esconderijo com pose e cor corretas, **nunca atravessa obstáculo**, reservas exclusivas,
  tempo de esconderijo, reação e fuga, percepção (visão, campo de visão, parede, audição
  através de parede), travamento, eliminada parada, substituição de humano, determinismo
  e custo por tick. Tudo nos três mapas.
- **Mutação**: 14 defeitos deliberados (sem caminho, sem cópia de cor, sem reserva, sem
  percepção, sem campo de visão, enxerga através de parede, sem audição, sem detecção de
  travamento, reação instantânea, foge para perto do Caçador, nunca troca de lugar, não
  sai da pose, corta quina, amostragem de linha grossa). A suíte detecta os 14. Duas
  sobreviveram na primeira versão e mostraram testes fracos (um teste de audição que o
  Caçador "via" de qualquer jeito, e uma regra dura que a pontuação já mascarava); foram
  reescritos.
- **Navegador**, com um Caçador humano contra o servidor real nos mapas 1 e 5: as IAs se
  escondem grudadas, na cor exata da parede (`#ebd9a8`, `#63c98b`, `#3c8667`, `#9f7438`),
  o Caçador as vê rente ao rodapé, e um tiro em uma IA escondida a elimina (`4/4` → `3/4`).

## Limitações conhecidas

- **Só o térreo.** No Chameleon Manor, porão, 1º andar e ático não têm IA (a grade cobre
  só o piso do térreo e as escadas ficam bloqueadas). Navegação vertical é a próxima
  extensão natural.
- **Dificuldade não calibrada.** Alcances, tempos de reação e de esconderijo são valores
  iniciais razoáveis, não medidos. Precisam de playtest (etapa 5 do plano).
- **O início é um susto.** As IAs nascem coladas no Caçador e fogem na hora. É coerente com
  o resto do jogo (humanos também nascem juntos), mas vale observar em playtest.
- **Dado que envelhece em silêncio.** Se um mapa mudar em `Level.js` sem regerar
  `navdata.js`, a IA anda por dentro do que mudou. A suíte não enxerga o `Level.js`.
- **Só pose de parede e de tapete.** Não há esconderijo atrás de cortina, sob mesa etc.
- **IA solo** (`ChameleonTarget`) continua com a lógica antiga (vagueia e foge).
- O dia a dia do Online ainda carrega o [Débito 1](PLANO_MULTIPLAYER.md): o movimento dos
  humanos é validado só em velocidade.
