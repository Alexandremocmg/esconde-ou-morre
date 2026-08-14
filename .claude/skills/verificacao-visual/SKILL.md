---
name: verificacao-visual
description: Verificar mudanças visuais deste jogo Three.js com screenshots reais (Playwright + chromium headless), em vez de confiar na leitura do código. Use ao mexer em personagem, animação, materiais, iluminação, texturas ou cenário; para comparar variações de um parâmetro antes de decidir; ou para provar que uma correção funcionou. Também explica como isolar um objeto (jogador/Caçador) num HTML de teste.
---

# Verificação visual (headless)

Regra deste projeto: **defeito visual não se diagnostica lendo código.** Toda
correção de personagem/animação aqui só foi encontrada renderizando e olhando —
várias vezes o "conserto" óbvio piorou o resultado.

## Ambiente (já disponível)

- **Servidor:** `python3 dev_server.py 8000` (manda `Cache-Control: no-store`, então
  edições valem sem bump de `?v=`). Se der `Address already in use`, já há um
  rodando — use.
- **Browser:** chromium do Playwright em
  `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
  Driver: `npm i --no-save playwright-core` (`node_modules/` é gitignored).
- **Flags obrigatórias p/ WebGL headless:**
  `--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`

Os scripts de exemplo ficam em `scratchpad/` (fora do versionamento).

## Bootar o jogo

```js
await p.goto('http://localhost:8000/', { waitUntil: 'networkidle' });
await p.click('#start-btn');
await p.waitForTimeout(5000);   // o GLB tem 4,5 MB — dê tempo
```

Controles por mouse:
- **Mover:** arraste e SEGURE na metade esquerda (`#joystick-zone`, ~x=200,y=520).
- **Olhar:** arraste na metade direita (`#look-zone`, ~x=960,y=360).
  Arrastar para BAIXO = olhar para CIMA.
- Botões: `#btn-latch`, `#btn-paint`, `#btn-crouch`, `#btn-prone`, `#tune-btn`.

Capture sempre `pageerror`, `console` (tipo error) e `requestfailed` filtrando
`/assets/` — é assim que se prova que a arte carregou.

## Isolar um objeto (o mais útil)

Um HTML de teste em `scratchpad/` que instancia SÓ a classe, com fakes:

- `Seeker`: aceita `level = {}` e
  `player = { isCamouflaged: () => false, position: new THREE.Vector3() }` —
  o construtor não chama métodos do level. `seeker.visionMat.opacity = 0`
  esconde o cone de visão.
- `Player`: `level = { spawn: new THREE.Vector3(), climbables: [], colorables: [] }`.
- Exponha helpers em `window` (`__yaw`, `__setPhase`, `__pose`, `__clip`) para o
  script de captura varrer estados sem depender do gameplay.

⚠️ `renderer.setSize(w, h, false)` no HTML de teste e o **mesmo** `viewport` no
Playwright, senão a imagem sai cortada.

## Comparar variações (economiza crédito e rodada)

Para escolher um número (ângulo de braço, amortecimento, cadência), **renderize
as variações e monte uma tira** em vez de decidir no escuro:

```python
from PIL import Image   # PIL existe; ImageMagick não
ims = [Image.open(f).convert('RGB').crop(box) for f in arquivos]
sheet = Image.new('RGB', (w*len(ims), h)); ...
```

Foi assim que saíram os valores de `armDrop`, do agachar e do amortecimento — e
foi comparando tiras que se descobriu que o amortecimento causava a "pedalada".

## Ciclo de animação

Varra a fase com `mixer.setTime(dur * f)` para f em 0..1 — mas **despause a ação
antes**, senão todos os quadros saem idênticos (ação pausada não é reavaliada).
Capture de **perfil** (mostra a passada e se o pé alcança o chão) e de **trás**
(mostra deformação nas costas/ombros).

## Provar que não é regressão

Quando um defeito parecer causado por uma mudança sua, teste o código **anterior**
antes de acusar:

```bash
git stash push src/Arquivo.js -m wip && <rodar teste> && git stash pop
```

Foi assim que se confirmou que a camuflagem por zonas já não fechava antes dos
painéis — evitando "consertar" o que não estava quebrado.

## Túnel (playtest no celular)

`cloudflared tunnel --url http://localhost:8000` já roda nesta máquina; a URL
pública sai no log apontado por `/proc/<pid>/fd/1`. Testar a URL pública com o
browser headless valida a cadeia inteira (assets, cache, boot).
