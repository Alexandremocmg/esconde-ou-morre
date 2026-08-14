# Boneco em GLB — personagem, rig e animação

Estado: **implementado**. Substitui a malha procedural do jogador por um modelo 3D
gerado no Higgsfield a partir de uma imagem de referência do usuário.

O detalhe operacional (como gerar, quanto custa, como verificar) está nas skills do
projeto: [`personagem-glb`](../.claude/skills/personagem-glb/SKILL.md),
[`assets-higgsfield`](../.claude/skills/assets-higgsfield/SKILL.md) e
[`verificacao-visual`](../.claude/skills/verificacao-visual/SKILL.md).
Este documento registra **o que foi decidido e por quê**.

## 1. O que mudou

| Antes | Agora |
|---|---|
| `buildBody()` montava o jogador com primitivas | `assets/player.glb` (20 662 tri, com skin e esqueleto) |
| `Gait` animava o rig procedural | `AnimationMixer` com 3 clipes trocáveis |
| `MeshToonMaterial` | `MeshPhysicalMaterial` (cerâmica polida) + IBL |
| Constantes fixas no código | Painel `⚙` (`src/Tuner.js`), salvo no navegador |

O corpo procedural **continua no código como fallback**: se o GLB não carregar, o
jogo não pode ficar sem personagem (`Player._useModel` só troca no sucesso).

## 2. Arquitetura

```
Player.js ──── constrói corpo procedural (fallback) e pede o GLB
   │
   ├── PlayerModel.js
   │      loadPlayerModel(url, altura, { animUrls })
   │        • troca materiais por MeshPhysicalMaterial (mapa base claro)
   │        • normaliza escala e assenta os pés em -altura/2
   │        • cria uma ação por clipe e mede a PASSADA de cada uma
   │        • devolve applyPose(idle, lean, armDrop, crouch) e setClip(nome)
   │
   └── Tuner.js ── TUNE lido a cada quadro no update()
```

Clipes disponíveis: `walk` (Casual_Walk, embutido no próprio `player.glb`), `run1`
(RunFast) e `run2` (Run_02) — estes dois em arquivos de ~30 KB contendo **só a
animação**, extraídos com `tools/extract-anim.py`.

## 3. Decisões e seus porquês

**Por que corrida, e não caminhada.** O jogador tem 1,44 de altura e anda a 7,0/s =
**~4,9 alturas de corpo por segundo**. Humano andando faz ~1; correndo, 3–5. Nenhum
ajuste de cadência salva um clipe de caminhada nessa velocidade.

**Por que a animação avança pela distância.** Com `timeScale` fixo o pé patina. O
mixer avança `(distância / passada) × duração`, com a velocidade **suavizada** —
o deslocamento bruto por quadro oscila (colisão, degrau, latch) e isso lê como tremor.

**Por que existe um ganho de passada.** A passada é medida pela excursão do pé, que
**subestima** a real: na corrida há fase aérea, em que o corpo avança com os dois pés
no ar. Sem o ganho (~2,0) a cadência dava 4,8 ciclos/s; velocista real faz ~2,4.

**Por que a inclinação do sprint NÃO é corrigida.** Tentado e revertido: amortecer o
quadril tira os pés do chão (vira "pedalar bicicleta"); amortecer a coluna é pior,
porque no sprint a inclinação mora no quadril e a coluna faz a contra-rotação que
segura o tronco. Só pescoço/cabeça é ajustado, para ele olhar à frente.

**Por que o painel de ajustes existe.** Cada número do movimento (cadência, poses,
transição) precisou de várias tentativas visuais. Calibrar jogando é ordens de
grandeza mais rápido que uma rodada de código por número.

## 3b. Locomoção natural (mistura andar↔correr)

Baseado no exemplo `webgl_animation_skinning_blending` do three.js, adaptado ao
avanço por distância. Detalhe e armadilhas na skill
[`locomocao-natural`](../.claude/skills/locomocao-natural/SKILL.md).

- Andar e correr tocam JUNTOS, com pesos somando 1, definidos por uma rampa entre
  duas velocidades (`walkAt`/`runAt` no painel) e suavizados.
- **Uma fase normalizada única** alimenta `action.time` dos dois clipes. Sem isso
  cada um roda no seu ritmo e a mistura vira "nadando"; com isso o meio da rampa
  vira um trote legítimo.
- A passada usada para avançar a fase é interpolada entre as dos dois clipes —
  senão a cadência salta no meio da mistura.
- Ficar parado continua sendo `applyPose(idle)` misturando com a pose de repouso:
  não há clipe de idle, e os pesos de locomoção precisam continuar somando 1 para
  o mixer nunca parar de reescrever a pose.

## 4. Impacto na mecânica (regressões conhecidas)

- **Camuflagem de zona única.** O GLB tem uma malha e um material, então as duas
  zonas (tronco/pernas) colapsaram em uma: não dá mais para casar parede e rodapé ao
  mesmo tempo (feature P1). A camuflagem em si continua funcionando — a métrica
  compara `material.color`, que é tingido normalmente.
- **Os 4 corpos do menu** (Boneco/Manequim/Blob/Cubo) não mudam mais o visual: o GLB
  sempre vence. Os botões seguem no menu sem efeito.
- **Deformação residual** nas costas/ombros em poses extremas, vinda dos **pesos de
  skinning** do auto-rig (assados no GLB). Só se resolve pintando pesos num editor 3D.
- **Peso:** `player.glb` tem 4,5 MB — candidato a Draco/meshopt.

## 5. Próximos passos possíveis

- Comprimir o GLB (Draco/meshopt) — antes de mesclar, para não deixar o arquivo
  grande no histórico.
- Reativar a camuflagem por zonas separando a malha em dois materiais.
- Trocar automaticamente para `walk` quando o jogador estiver agachado (a velocidade
  cai à metade, então o clipe de caminhada casaria melhor).
- Remover ou reaproveitar os botões de forma do menu.
