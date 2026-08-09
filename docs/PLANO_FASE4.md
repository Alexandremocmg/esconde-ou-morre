# Fase 4 — Loop de Partida & Condição de Vitória (Win State)

Status: **implementado**, pronto para teste em `localhost:8000`.

## Objetivo da fase
Sobreviver ao Caçador até o cronômetro chegar à meta. Sem coleta de itens nesta
versão — o desafio é resistir usando parede + camuflagem.

- Meta de sobrevivência: `BASE_SURVIVE = 45 s` no estágio 1,
  `+15 s` por estágio (`SURVIVE_PER_STAGE`).
- Vitória dispara `_win()` quando `elapsed >= surviveTime`.

## 1. Placar no HUD (`src/Game.js` + `index.html` + `css/style.css`)
Novo bloco de placar no canto superior direito com:
- **FASE `n`** (estágio atual).
- **Tempo decorrido / meta** (`0:12 / 0:45`) com **barra de progresso**
  (amarelo → verde-menta).
- **Tempo total camuflado** (`🫥 0:07`), acumulado só nos frames em que
  `player.isCamouflaged()` é verdadeiro.

A dica (`#hint`) foi movida para o rodapé central para liberar a faixa do topo.

## 2. Tela de Vitória (`#victory`)
Overlay no mesmo padrão do Game Over, em verde-menta (`--accent`):
- Título **FASE CONCLUÍDA** + subtítulo.
- Três stats: **tempo sobrevivido**, **tempo camuflado** e **% camuflado**.
- Ações: **Próximo estágio ›** e **Recomeçar**.

## 3. Progressão de estágio
O estágio persiste em `sessionStorage['eom-stage']` (sobrevive ao `location.reload`):
- **Próximo estágio**: incrementa o estágio e recarrega.
- **Recomeçar**: volta ao estágio 1 e recarrega.
- **Game Over → Tentar de novo**: recarrega mantendo o estágio atual (repete a fase).

### Escalonamento de dificuldade (`src/Seeker.js`)
O `Seeker` agora aceita `{ difficulty }`:
- `difficulty = 1 + (stage - 1) * 0.12`.
- `patrolSpeed` sobe de leve; `chaseSpeed` sobe mais, mas **travado em
  `CHASE_SPEED_CAP = 6.8` (< 7.0 do jogador)** — a caça nunca alcança no plano,
  mantendo a justiça da Fase 3.

## Parâmetros de tuning rápido
`Game.js`: `BASE_SURVIVE`, `SURVIVE_PER_STAGE`, `DIFF_PER_STAGE`.
`Seeker.js`: `CHASE_SPEED_CAP` e o fator de dificuldade no construtor.

## Como testar
1. `python -m http.server 8000` (ou reinicie o servidor já rodando).
2. Abra `localhost:8000`, toque em iniciar.
3. Fuja/esconda-se por 45 s → deve aparecer **FASE CONCLUÍDA** com os stats.
4. **Próximo estágio** → recarrega como Fase 2 (60 s, Caçador um pouco mais rápido).

## Próximos passos sugeridos (Fase 5)
- Objetivo alternativo por coleta/pintura de N pontos (a infra de `colorables`
  do `Level` já ajuda).
- Som e feedback de "quase pego".
- Persistir recorde (melhor % camuflado) em `localStorage`.
