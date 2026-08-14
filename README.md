# Esconde ou Morre

Protótipo mobile-first em **Three.js** (ES Modules puros, sem bundler). Você é um
**boneco de vinil branco** (estilo art toy / Pop Mart) que **gruda em superfícies**,
**pinta o próprio corpo com a cor do ambiente para se camuflar** e precisa
**sobreviver ao(s) Caçador(es)** até o tempo acabar.

O visual é **toon / cel-shaded** no espírito do **Meccha Chameleon**: ambiente claro e
legível, superfícies chapadas com paleta pop (creme, azul-céu, coral, roxo, menta,
laranja, amarelo-ouro) e **contorno de desenho** nos Caçadores para lê-los como ameaça.
O cenário é uma **mansão de 2 andares** (salão com pilares, corredor de quartos,
galeria, mezanino e escadaria) cujos cômodos coloridos funcionam como **cabines de
camuflagem**.

O visual é **majoritariamente procedural**: paredes, pisos e móveis são gerados em
código (`src/textures.js`) — e **precisam** continuar assim, porque a camuflagem
compara a cor do boneco com a da superfície e um albedo rico quebraria essa leitura.
As exceções ficam em `assets/` e são superfícies **não-camufláveis**: o **boneco em
GLB**, os **quadros** e o **céu**. Tudo é servido localmente — o jogo roda **offline**,
sem hotlink.

> A direção de arte e o histórico das fases estão em
> [`docs/PLANO_TOON.md`](docs/PLANO_TOON.md) (virada toon, com status de implementação).
> A arquitetura da mansão (andares/escada/colisão) está em
> [`docs/PLANO_MANSAO.md`](docs/PLANO_MANSAO.md).
> O personagem em GLB (pipeline, rig, animação e armadilhas) está em
> [`docs/PLANO_BONECO_GLB.md`](docs/PLANO_BONECO_GLB.md).

## Como rodar (build estática)

Não há passo de build. Sirva a pasta por HTTP (ES Modules exigem `http://`, não abrem
via `file://`). **Use o `dev_server.py`** — ele manda `Cache-Control: no-store`, então o
navegador nunca serve JS/CSS antigos (os módulos ES são importados sem `?v=`):

```bash
python3 dev_server.py        # porta 8000
python3 dev_server.py 8123   # outra porta
```

Abra `http://localhost:8000` e clique em **JOGAR**.

> ⚠️ Evite `python -m http.server`: sem os headers no-store, o navegador (e um eventual
> túnel) servem módulos ES em cache — misturando versões e podendo travar a inicialização.

> Única dependência externa: `three@0.161.0` (build + `addons/` — `GLTFLoader`,
> `RoundedBoxGeometry`, `RoomEnvironment`) via CDN (unpkg), declarada no `importmap`
> do `index.html`. Os assets do jogo são locais (`assets/`); textura de cenário,
> geometria da mansão e áudio seguem 100% procedurais.

## Deploy

Qualquer host de arquivos estáticos serve a pasta como está (GitHub Pages, Netlify,
Vercel, S3, etc.) — publique a raiz do repositório.

## Estrutura

```
index.html        # HUD, retícula, roda de cor, overlays (menu/vitória/game over), importmap
css/style.css     # HUD, joystick, retícula, roda de cor, overlays, menu, painel de ajustes
dev_server.py     # servidor de dev com Cache-Control: no-store (use este)
src/
  main.js         # boot: gesto do usuário → áudio + loop + fullscreen
  Game.js         # orquestra cena, partida, caçadores; render toon + IBL do boneco
  Level.js        # mansão: casca, cômodos, mobília, 2 andares/escada, colisão; paleta
  textures.js     # texturas procedurais + toonGradient() (rampa cel) + normal maps
  Character.js    # base humanoide procedural (art toy) + contorno cel + caminhada
  Player.js       # cápsula: chão/parede, conta-gotas (sampleColor), camuflagem
  PlayerModel.js  # carrega o boneco GLB: material, escala, clipes, poses (agachar/parado)
  Tuner.js        # painel ⚙ de ajuste ao vivo (clipe, cadência, poses) — salva no navegador
  ColorPicker.js  # roda de cor HSV (ajuste fino do disfarce)
  Seeker.js       # IA do Caçador: patrulha/caça, visão, rotas alternadas
  Effects.js      # pulsos visuais (juice) ao pintar/grudar
  Audio.js        # áudio procedural (Web Audio API)
  FollowCamera.js # câmera de perseguição
  Joystick.js     # joystick virtual (touch)
assets/           # arte gerada, servida localmente: boneco GLB + clipes, quadros, céu
tools/
  extract-anim.py # extrai só a animação de um GLB (2,5 MB → ~30 KB)
docs/             # planos: PLANO_BONECO_GLB (personagem), PLANO_TOON, PLANO_MANSAO, FASE3..6
.claude/skills/   # skills: personagem-glb, locomocao-natural, verificacao-visual, assets-higgsfield
```

## Como jogar

- **Mover:** joystick na metade esquerda da tela. **Olhar:** arraste na metade direita.
- **🎨 Pintar (conta-gotas):** mire com a **retícula central** numa superfície e toque
  em 🎨 para **sugar a cor dela** (funciona no chão e grudado, alcance ~8 m — dá para
  planejar a cor antes de se mover).
- **🎛️ Cor (roda HSV):** ajuste fino do disfarce sobre a cor sugada (matiz/saturação na
  roda, brilho no slider).
- **🧱 Grudar/soltar:** gruda na superfície que o boneco encara. A camuflagem só **vale**
  quando você está grudado numa superfície **da mesma cor** do seu disfarce — a perícia
  é casar a cor certa com o esconderijo certo. Camuflado, o Caçador passa direto.
- **⬇ Agachar:** mais furtivo (o Caçador enxerga de mais perto), porém mais lento.
- **Objetivo:** sobreviva até o cronômetro chegar à meta. A cada estágio a meta cresce e
  o Caçador acelera; há um Caçador por domínio (térreo/andares) e um terceiro entra nos
  estágios mais altos.

- **⚙ Ajustes (canto inferior esquerdo):** painel de calibragem do boneco — clipe de
  locomoção (Andar / RunFast / Run_02), **mistura andar↔correr por velocidade**
  (com as velocidades de transição), cadência da passada, cabeça erguida, braços
  parado, suavidade ao parar, respiração e profundidade do agachar. Os valores valem
  no mesmo quadro e ficam salvos no navegador; **"Ver valores"** mostra o JSON para
  fixar como padrão. Se escolher **Andar**, suba a **Cadência para ~4,5** (a passada
  desse clipe é ~2,3× menor que a das corridas).

Progresso de estágio persiste em `sessionStorage['eom-stage']`; os ajustes do boneco,
em `localStorage['eom-tune']`.
