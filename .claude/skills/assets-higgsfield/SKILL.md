---
name: assets-higgsfield
description: Gerar arte para este jogo com o MCP do Higgsfield (imagens, texturas, quadros, céu, 3D) mantendo coerência visual e sem quebrar a camuflagem. Use ao criar ou trocar qualquer asset visual, ao escrever prompts de geração, ou antes de gastar créditos. Traz a STYLE FORMULA fixa do projeto, o que pode e o que NÃO pode virar asset gerado, e o fluxo de empacotamento offline.
---

# Assets gerados (Higgsfield MCP)

## A restrição que manda em tudo: camuflagem

O jogo é de **camuflagem por cor**. `Player.isCamouflaged()` compara
`material.color` do boneco com a cor da superfície. Logo:

| Superfície | Pode ser arte gerada? |
|---|---|
| Paredes, pisos, móveis **camufláveis** | **NÃO** — precisam de albedo CLARO que multiplica `material.color`. Arte rica quebra a leitura da cor. |
| Quadros, céu/fundo, decoração `colorable: false` | **SIM** — nunca são alvo de camuflagem. |
| Corpo do jogador | Mapa base CLARO; a cor vem de `material.color`. |

Na dúvida: se `Level._addBox` aceita a superfície como colorável, ela fica
procedural (`src/textures.js`).

## STYLE FORMULA (inserir BYTE A BYTE em todo prompt 2D)

> Flat cel-shaded toon rendering with crisp flat colors, minimal soft gradients and a matte vinyl art-toy finish; rounded chunky blobby shapes with thick dark ink outlines; environment in bright creamy pastel pop tones (cream, sky-blue, coral, mint, lavender, warm gold) with gentle soft shadows, the white vinyl-toy hero kept clean and neutral so any camouflage color reads true, the Hunter villain in a saturated warning red-orange that pops as a threat; bright, clear, playful luxury-mansion daylight, flat ambient light, no gloom; high contrast between characters and backgrounds, clean readable silhouettes, consistent hand-drawn look.

Nunca parafrasear entre gerações — é o que mantém os assets parecendo o mesmo
jogo. Retentativa = **re-roll do mesmo prompt** (variância de amostragem),
orçamento 2 por asset. Só edite a descrição se o CONTEÚDO estiver errado.

## Fluxo

1. `models_explore` / `get_website_creation_instructions` quando estiver em dúvida
   de modelo ou de regra (o bundle traz `game-stylization`, `game-textures`,
   `game-meshy-input-rules`).
2. Gerar: `generate_image_batch` para vários prompts independentes;
   `generate_image` com `count` só para variantes do MESMO prompt.
   Modelo padrão daqui: `nano_banana_2`, resolução 1k.
3. Conferir por visão ANTES de usar (uma figura? corpo inteiro? fundo limpo?).
4. Baixar, redimensionar e empacotar em `assets/` — **o jogo tem que continuar
   rodando offline; nada de hotlink.**
   - Ilustração sem transparência → **JPEG q88** (as pinturas caíram de ~800 KB
     para ~140 KB cada).
   - Alvo: ≤1024 px; mobile é o público-alvo.
5. Carregar com cache (`Level._img()` usa `THREE.TextureLoader` + `SRGBColorSpace`).

## Créditos

- Preflight com `get_cost: true` antes de qualquer 3D.
- Referência: imagem 1k ≈ 1–2; `image_to_3d` com rig ≈ 38; `3d_rigging` ≈ 8.
- `balance` para checar o saldo. **Não gaste sem avisar quando o saldo estiver
  perto de acabar** — o usuário decide.
- Falha "Out of credits" logo após uma submissão múltipla pode ser reserva
  concorrente; confira `balance` antes de concluir que acabou.

## 3D

Ver a skill `personagem-glb` — image-to-3D tem regras próprias (membros
separados, pose_mode, polycount) e várias armadilhas de integração.

## Onde está o que já foi gerado

```
assets/painting-1..4.jpg   pinturas toon dos quadros da mansão
assets/sky.jpg             céu toon (scene.background)
assets/player.glb          boneco (malha + Casual_Walk embutido)
assets/player-run*.glb     clipes de locomoção extraídos (~30 KB)
```
