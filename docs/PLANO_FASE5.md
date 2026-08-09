# Fase 5 — Polimento Visual, Feedback & Múltiplos Caçadores

Status: **implementado**, pronto para teste em `localhost:8000`.

Arquitetura: mantida 100% em **ES Modules**. Dois módulos novos —
`src/Effects.js` e `src/Audio.js` — orquestrados pelo `Game.js`.

## 1. Juice — efeitos visuais (`src/Effects.js`)
Pool de "anéis" (torus) que expandem e desvanecem, sempre encarando a câmera.
- **Trocar de cor / camuflar**: pulso na **cor copiada**, disparado em
  `Game._tryCamouflage`.
- **Grudar na parede**: pulso ciano suave (`0x9fe8ff`) na transição
  `chão → parede`, detectada por mudança de `player.state` no loop.
- 8 pulsos reutilizáveis, vida de 0,55 s, sem alocação por frame.

## 2. Cone investigando pisca em laranja (`src/Seeker.js`)
Quando o Caçador perde o alvo e corre até a última posição memorizada
(`chase` sem `validTarget`), a opacidade do cone oscila suavemente
(`0.16 ± 0.09 · sin(t·9)`) em laranja — deixa claro que ele está "procurando",
não travado em você.

## 3. Segundo Caçador nos estágios avançados (`src/Seeker.js` + `Game.js`)
- A partir do **Estágio 3** (`SECOND_SEEKER_STAGE`), o `Game` instancia um
  **2º Caçador** com **rota de patrulha alternada** (`WAYPOINTS_ALT`, diagonal e
  sentido oposto) e **cor distinta** (magenta `0xb01ecb`) para diferenciá-lo.
- O `Seeker` agora aceita `{ waypoints, color }` além de `{ difficulty }`.
  Todas as rotas usam `this.waypoints` (sem constantes fixas).
- Qualquer um dos Caçadores dispara o Game Over ao capturar.

## 4. Feedback de tensão — vinheta + som (`Game._updateFeedback`)
Janela de aviso: `WARN_WINDOW = 5 s`.
- **Perigo (prestes a ser pego)**: estima o tempo até captura via
  `Seeker.timeToCatch()` (só conta Caçadores em perseguição que te veem e quando
  você **não** está camuflado). Se `< 5 s` → **vinheta vermelha pulsante** +
  **batida (heartbeat)** cuja cadência acelera conforme a ameaça (0,55 s → ~0,23 s).
- **Quase vencendo**: se faltam `≤ 5 s` para a meta (e sem perigo ativo) →
  **vinheta verde-menta pulsante** + **bip de contagem regressiva** por segundo,
  subindo de tom.
- Perigo tem prioridade sobre "quase vencendo". A vinheta é limpa na
  vitória/derrota.

## 5. Áudio procedural (`src/Audio.js`)
Web Audio API, sem assets. Osciladores com envelope curto:
`heartbeat`, `countdown`, `win` (arpejo) e `caught` (sawtooth grave).
O `AudioContext` é retomado no gesto de iniciar (`Game.start → audio.resume()`).

## Parâmetros de tuning rápido
- `Game.js`: `SECOND_SEEKER_STAGE`, `WARN_WINDOW`, cadência do heartbeat.
- `Seeker.js`: `WAYPOINTS_ALT`, amplitude/velocidade do pulso do cone.
- `Effects.js`: `POOL`, `LIFE`, `START_SCALE`/`END_SCALE`.
- `Audio.js`: frequências e ganhos de cada cue.

## Como testar
1. Recarregue `localhost:8000` (arquivos estáticos — basta refresh).
2. Toque para copiar cor e ao grudar na parede → veja os **pulsos**.
3. Deixe o Caçador te perder atrás de um bloco → o **cone pisca laranja**.
4. Deixe-o chegar perto te vendo → **vinheta vermelha + batida**.
5. Sobreviva até faltarem 5 s → **vinheta verde + contagem regressiva**.
6. **Estágio 3** (vença 1 e 2, ou force `sessionStorage['eom-stage']=3`) →
   entra o **2º Caçador magenta** com rota alternada.

## Próximos passos sugeridos (Fase 6)
- Recorde persistente (`localStorage`): melhor % camuflado / estágio máximo.
- Variações de layout por estágio no `Level`.
- Partículas reais (points) no lugar dos anéis, se quiser mais densidade visual.
