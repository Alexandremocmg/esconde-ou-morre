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
camuflagem**. Todo o visual é **procedural** — sem assets externos.

> A direção de arte e o histórico das fases estão em
> [`docs/PLANO_TOON.md`](docs/PLANO_TOON.md) (virada toon, com status de implementação).
> A arquitetura da mansão (andares/escada/colisão) está em
> [`docs/PLANO_MANSAO.md`](docs/PLANO_MANSAO.md).

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

> Única dependência externa: `three@0.161.0` (build + `addons/`) via CDN (unpkg),
> declarada no `importmap` do `index.html`. O restante — texturas, geometria e áudio —
> é 100% procedural.

## Deploy

Qualquer host de arquivos estáticos serve a pasta como está (GitHub Pages, Netlify,
Vercel, S3, etc.) — publique a raiz do repositório.

## Estrutura

```
index.html        # HUD, retícula, roda de cor, overlays (menu/vitória/game over), importmap
css/style.css     # HUD, joystick, retícula, roda de cor, overlays e menu
dev_server.py     # servidor de dev com Cache-Control: no-store (use este)
src/
  main.js         # boot: gesto do usuário → áudio + loop + fullscreen
  Game.js         # orquestra cena, partida, caçadores; render toon + iluminação plana
  Level.js        # mansão: casca, cômodos, mobília, 2 andares/escada, colisão; paleta
  textures.js     # texturas procedurais + toonGradient() (rampa cel) + normal maps
  Character.js    # base humanoide compartilhada (art toy) + contorno cel + caminhada
  Player.js       # cápsula: chão/parede, conta-gotas (sampleColor), camuflagem
  ColorPicker.js  # roda de cor HSV (ajuste fino do disfarce)
  Seeker.js       # IA do Caçador: patrulha/caça, visão, rotas alternadas
  Effects.js      # pulsos visuais (juice) ao pintar/grudar
  Audio.js        # áudio procedural (Web Audio API)
  FollowCamera.js # câmera de perseguição
  Joystick.js     # joystick virtual (touch)
docs/             # planos: PLANO_TOON (atual), PLANO_MANSAO, PLANO_REALISMO, FASE3..6
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

Progresso de estágio persiste em `sessionStorage['eom-stage']`.
