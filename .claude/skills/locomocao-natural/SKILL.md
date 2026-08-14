---
name: locomocao-natural
description: Fazer a locomoção do personagem parecer natural no Three.js — transições parado→andar→correr, mistura de clipes por velocidade, sincronia de passada e desaceleração. Use ao mexer em como o boneco começa/para de se mover, ao adicionar um estado de movimento (trote, agachado, subir escada), ou quando o movimento parecer "robótico", "nadando", "patinando", "tremendo" ou trocar de estado num corte seco.
---

# Locomoção natural (Three.js)

Base: exemplo oficial `webgl_animation_skinning_blending` + `AnimationAction` do
three.js, **adaptado** ao fato de que aqui a animação avança por DISTÂNCIA, não
pelo relógio. Implementado em `PlayerModel.setLocomotion` + `Player.update`.

## O modelo mental

Naturalidade em locomoção vem de **três camadas**, nesta ordem de importância:

1. **A animação acompanha o deslocamento real** (senão o pé patina).
2. **Estados vizinhos se misturam por peso** (senão a troca é um corte).
3. **Tudo que alimenta as duas camadas acima é suavizado** (senão treme).

Faltando qualquer uma, o resto não salva.

## 1. Mistura por peso (blend tree)

Todas as ações tocam ao mesmo tempo; quem manda é o peso:

```js
a.enabled = w > 0;
a.setEffectiveWeight(w);   // pesos somam 1
```

**Peso NÃO basta: a ação precisa estar TOCANDO.** Uma ação criada com
`clipAction()` mas nunca `play()`-ada é ignorada pelo mixer — o clipe some da
mistura sem erro nenhum. Sintoma: o personagem desliza em pé (você está vendo a
pose de repouso). Garanta `if (!a.isRunning()) a.play();`.

Alternativa para trocas discretas (não contínuas): `crossFadeTo(alvo, dur, true)`
— o `warp = true` acerta a velocidade das duas durante a fusão.

## 2. Sincronia de fase — o que separa mistura boa de "nadando"

Dois clipes de locomoção têm **durações diferentes**. Avançá-los pelo relógio faz
cada um rodar num ritmo, e misturar pés fora de fase produz aquele andar mole,
tipo nadando.

Solução usada aqui: **uma fase normalizada única** para todos os clipes.

```js
this._phase = (this._phase + dist / strideCombinada) % 1;   // avança pela DISTÂNCIA
for (const a of acoesAtivas) a.time = this._phase * a.getClip().duration;
mixer.update(0);   // só aplica; o tempo já foi escrito à mão
```

Os contatos do pé ficam alinhados e o meio da mistura vira um **trote** legítimo,
não uma média borrada.

**A passada também tem que ser interpolada** (`lerp(passadaAndar, passadaCorrer,
peso)`), senão a cadência salta no meio da mistura e o pé volta a patinar.

## 3. Suavização (tudo que entra na animação)

- **Velocidade:** use passa-baixa, nunca o deslocamento bruto do quadro. Colisão,
  degrau e latch fazem `dist` oscilar → lê como **tremor**.
- **Peso da mistura:** interpole o alvo (taxa ~3/s). Trocar de peso em degrau
  reintroduz o corte que a mistura veio resolver.
- **Rampa por velocidade:** defina duas velocidades (100% andar / 100% correr) e
  interpole entre elas. Exponha no painel — o valor certo é gosto, não teoria.

## 4. Parar e sair do lugar

- **Sem clipe de idle?** Misture com a **pose de repouso** capturada antes de
  qualquer animação. Sem isso o personagem congela no meio da passada (a famosa
  "estátua correndo").
- **NUNCA pause a ação** para segurar a pose: pausada, o mixer para de reescrever
  os ossos e qualquer blend seu passa a operar sobre o próprio resultado do
  quadro anterior — **acumula** e a transição salta. Use `mixer.update(0)`.
- Some **respiração** senoidal parado; sem ela, "em pé" lê como estátua.
- Taxa de entrada/saída do parado ~3,5/s. Mais rápido lê como corte.

## 5. Escolher o clipe certo (antes de ajustar qualquer coisa)

Calcule **alturas de corpo por segundo** = velocidade ÷ altura do personagem:

| ~1 | caminhada |
| 3–5 | corrida |

Aqui deu **4,9** — nenhum ajuste de cadência faria um clipe de caminhada
funcionar. Fazer essa conta primeiro evita gastar horas calibrando o clipe errado.

## 6. Não tente "consertar" a pose de um clipe

Amortecer a inclinação de um sprint para deixá-lo ereto **quebra a passada**:
mexer no quadril tira os pés do chão (vira pedalar bicicleta) e mexer na coluna
piora (no sprint a inclinação mora no quadril, e a coluna faz a contra-rotação que
segura o tronco). Só pescoço/cabeça é seguro. Se a postura não serve, **troque o
clipe** — não conserte no código.

## 7. Verificar

Sempre com render (skill `verificacao-visual`). O teste que pega problema de
mistura: **fixe a mesma fase** e renderize `peso = 0 / 0,5 / 1`. Em cada fase, a
perna à frente tem que ser a MESMA nas três — se divergir, a fase está
dessincronizada. Foi assim que se descobriu a ação sem `play()`.
