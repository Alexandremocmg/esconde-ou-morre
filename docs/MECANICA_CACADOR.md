# Especificação Técnica: Mecânica do Caçador (Estilo Meccha Chameleon)

Documentação oficial da arquitetura, regras de combate, condições de vitória/derrota, gestão de munição de água, placa anti-cheat e sorteio do Caçador no *Esconde ou Morre*.

> Para a especificação de visão/câmera, mecânica de disparo e scanner (design-alvo, com
> status de implementação por item), ver
> [`docs/MECANICA_CACADOR_VISAO.md`](MECANICA_CACADOR_VISAO.md).

---

## 1. Resumo do Papel (Overview)

O **Caçador** é o personagem encarregado de encontrar e eliminar os **Camaleões** (jogadores escondidos que pintam e grudam no cenário imitando suas cores).
Para evitar que o Caçador atire desordenadamente por todo o mapa, ele opera com **munição de água contada e limitada**.

---

## 2. Condições de Vitória e Derrota

* **Vitória do Caçador:** Atingir e lavar a tinta de todos os Camaleões da partida com o jato d'água dentro do tempo limite.
* **Vitória dos Camaleões (Derrota Imediata do Caçador):**
  1. O cronômetro da partida chegar a zero (`elapsed >= surviveTime`).
  2. A munição de jatos de água do Caçador chegar a zero (`waterAmmo == 0`) enquanto restarem Camaleões vivos escondidos.

---

## 3. Sistema de Combate e Munição de Água

### 3.1. Arma Base & Modelo 3D
* **Water Blaster 3D:** Acoplado ao braço do Caçador (`Seeker.js`).
* **Jato de Água (Particle Beam):** Feixe contínuo de gotículas translúcidas (`Effects.waterJetBeam`) combinado a som procedural de pressão líquida (`Audio.waterBlast()`).

### 3.2. Regras de Disparo & Hitbox Check
* **Disparo no Vazio (Erro):** Se o jato de água atingir uma parede ou o chão sem acertar um Camaleão, o Caçador perde 1 jato de água (`waterAmmo--`).
* **Disparo no Camaleão (Acerto):** 
  * Aciona a função `player.washPaint(dt)`, desbotando progressivamente a cor do Camaleão de volta ao branco original (`0xeef0f2`) em ~1.5s.
  * Se a tinta for 100% lavada e o feixe continuar em contato, o Camaleão é eliminado (vira espectador).
* **Parâmetros Configuráveis no Menu (`index.html` / `Game.js`):**
  * `waterAmmo`: Quantidade inicial de disparos (min: 1, max: 30; **padrão: 8 jatos**). A configuração padrão deixa dois erros possíveis para os 6 alvos do modo Caçador solo.
  * `infiniteAmmo`: Booleano (true/false) para liberar munição ilimitada em treinos.
* **Modo Online:** as mesmas regras de munição valem para o Caçador Online, mas a
  contagem é **autoritativa no servidor** (`server/room.js:_handleFire`), não só no
  cliente — evita que editar o JS local dê munição infinita e garante que as duas
  pontas concordem sobre o fim da partida por falta de água. Ver
  [`docs/PLANO_MULTIPLAYER.md`](PLANO_MULTIPLAYER.md).

---

## 4. Loop de Gameplay (Modo Clássico de Eliminação)

* Ao ser atingido e ter sua tinta completamente lavada pelo Caçador, o Camaleão é eliminado.
* O jogador eliminado entra no estado de **Espectador**, podendo acompanhar a câmera dos demais Camaleões sobreviventes até o encerramento da rodada.

---

## 5. Interface & Regras de Anti-Cheat (UI/UX)

* **HUD de Munição (`#water-ammo-hud`):** Badge Glassmorphic no canto superior esquerdo exibindo `💧 X / Y`. Quando a munição chega a 0, o badge pisca em vermelho de alerta.
* **Placar com Atraso de 30 Segundos (`scoreHistory` FIFO):**
  * O tempo camuflado exibido no HUD do Caçador é defasado intencionalmente em 30 segundos (`delayedCamoTime`).
  * **Motivo:** Impede que o Caçador descubra se acabou de passar perto de um Camaleão escondido através do aumento em tempo real da pontuação na tela.

---

## 6. Escolha do Caçador

* **Sem sorteio ponderado por zona:** houve um anel decorativo no chão do hall que
  sugeria uma "zona de sorteio" (+50% de chance de virar Caçador para quem estivesse
  dentro dele), mas o método que testaria isso nunca foi ligado a nada — foi removido
  (atrapalhava a leitura do hall central, ver commit que tira `Level.js:_lobbyRing`).
  Não existe sorteio ponderado por peso implementado.
* **Modo Online (o que de fato decide o papel):** o primeiro jogador a entrar na
  sala vira Caçador; o segundo vira Camaleão (`server/room.js:_freshJoin`,
  `role = takenRoles.has(ROLE.HUNTER) ? ROLE.CHAMELEON : ROLE.HUNTER`). Sem
  contagem regressiva nem sorteio — é ordem de chegada. Ver
  [`docs/PLANO_MULTIPLAYER.md`](PLANO_MULTIPLAYER.md).
* **Modos solo (`chameleon`/`hunter`):** o papel é escolhido direto no menu inicial,
  não há lobby compartilhado nem sorteio — o jogador escolhe o próprio papel.
