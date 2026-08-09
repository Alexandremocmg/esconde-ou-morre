# Fase 3 — Balanceamento & Sensação de Gameplay

Status: **implementado**, pronto para teste em `localhost:8000`.

## 1. Dificuldade e ajustes do Caçador (`src/Seeker.js`)

### Reação ao perder a visão / camuflar
- Antes, em `chase`, o Caçador era **onisciente**: perseguia a posição do jogador mesmo
  atrás de paredes; só a camuflagem o fazia desistir.
- Agora ele memoriza a **última posição vista** (`lastKnown`). Ao perder o alvo
  (você camuflou **ou** saiu da linha de visão), corre até esse ponto e **desiste
  após `LOSE_TIME = 0.8 s`**. Fica coerente com "Esconde ou Morre": esconder-se
  atrás de um bloco também funciona.
- Feedback visual do cone: **amarelo** = travado em você · **laranja** = procurando
  (última posição) · **vermelho suave** = patrulha.

### Tolerância de cor (badge/camuflagem) — `src/Player.js`
- Substituído o limiar único por **histerese**: entra camuflado com folga
  `CAMO_ENTER = 0.07` e só sai com `CAMO_EXIT = 0.13` por canal.
- Elimina o "piscar" do badge (PAREDE ↔ CAMUFLADO) e da detecção no limiar.

### Velocidade de perseguição justa
- Adicionada **rampa de aceleração** ao entrar em caça: acelera de `PATROL_SPEED`
  até `CHASE_SPEED` em `CHASE_RAMP = 0.5 s`, dando janela para reagir e grudar.
- Mantidos `CHASE_SPEED = 6.2` (< 7.0 do jogador no chão) e `TURN_RATE = 3.5 rad/s`.
- Camuflagem **sempre protege**: a captura só ocorre com o jogador visível e não camuflado.

## 2. Desvio simples de obstáculos (`src/Seeker.js`)
- *Whiskers* por raycast: raio frontal + laterais (`±0.45 / 0.9 / 1.35 rad`),
  alcance `AVOID_PROBE = 2.4 m`. Se a frente estiver bloqueada, escolhe o menor
  desvio livre, com **viés de lado** persistente para não oscilar.
- Só considera obstáculos **entre o Caçador e o alvo** (`probeFar = dist - AVOID_MARGIN`),
  então ele nunca deixa de fechar a captura contra a parede onde você está grudado.
- Aplicado tanto na patrulha quanto na perseguição.

## Parâmetros de tuning rápido
`Seeker.js`: `LOSE_TIME`, `CHASE_SPEED`, `CHASE_RAMP`, `TURN_RATE`, `AVOID_PROBE`, `AVOID_ANGLES`.
`Player.js`: `CAMO_ENTER`, `CAMO_EXIT`, `MOVE_SPEED`, `CLIMB_SPEED`.
