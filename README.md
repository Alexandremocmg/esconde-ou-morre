# Esconde ou Morre

Protótipo mobile-first em **Three.js** (ES Modules puros, sem bundler). No **modo
Camaleão** (padrão) você é um **boneco de vinil branco** (estilo art toy / Pop Mart) que
**gruda em superfícies**, **pinta o próprio corpo com a cor do ambiente para se
camuflar** e precisa **sobreviver ao(s) Caçador(es)** até o tempo acabar. No **modo
Caçador** (jogável) você vira o caçador: câmera em **1ª pessoa** com FOV estreito e
lanterna, arma de água com penalidade de tiro errado, e uma habilidade de **Scanner**
para revelar Camaleões próximos — ver `docs/MECANICA_CACADOR_VISAO.md` abaixo.

O visual é **toon / cel-shaded** no espírito do **Meccha Chameleon**: ambiente claro e
legível, superfícies chapadas com paleta pop (creme, azul-céu, coral, roxo, menta,
laranja, amarelo-ouro) e **contorno de desenho** nos Caçadores para lê-los como ameaça.
O cenário é uma **mansão de 2 andares** (salão com pilares, corredor de quartos,
galeria, mezanino e escadaria) cujos cômodos coloridos funcionam como **cabines de
camuflagem**. Todo o visual é **procedural** — sem assets externos.

> A direção de arte e o histórico das fases estão em
> [`docs/PLANO_TOON.md`](docs/PLANO_TOON.md) (virada toon, com status de implementação).
> A especificação técnica da mecânica do Caçador (munição de água, 30s delay anti-cheat) está em
> [`docs/MECANICA_CACADOR.md`](docs/MECANICA_CACADOR.md). A especificação de design de
> visão/câmera, arma e scanner do Caçador (proposta, com status de implementação por item)
> está em [`docs/MECANICA_CACADOR_VISAO.md`](docs/MECANICA_CACADOR_VISAO.md).
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

## Recursos Principais e Mecânicas

- **Personagem 3D Rigged + 7 Animações FBX (Mixamo):** Modelo 3D com skinning Toon e 7 animações sanitizadas *In-Place* (`Idle`, `Running`, `Crouch`, `Sleeping Idle`, `Laying Sleeping`, `Climbing Up Wall`, `Jump`).
- **Pré-carregador 3D em Tempo Real:** Tela inicial com barra de progresso (`0% → 100%`) garantindo entrada instantânea na partida sem troca de modelo.
- **Controles Mobile em Arco Ergonômico (Glassmorphism):**
  - **Joystick Flutuante Dinâmico:** Invisível em repouso; surge exatamente sob o polegar esquerdo ao tocar na tela.
  - **Botões Glassmorphism:** Vidro translúcido com `backdrop-filter: blur(8px)`, bordas brancas de 1.5px, resposta tátil (*Haptic Vibration*) e disposição em arco.
  - **Pinch to Zoom (Multitouch):** Gesto de 2 dedos para aproximar/afastar a câmera (1.8m a 7.5m) e 1 dedo para girar a visão.
- **Menus Radiais Duplos (2 Modos em 1 Botão):**
  - **Pintar (🎨):** *Toque rápido* para amostragem automática (*Quick Match*) e onda de tinta; *Segurar* para Menu Radial com Histórico de 4 Cores recentes e acabamento (Fosco/Brilhante).
  - **Poses (🧍):** *Toque rápido* para congelar no **Modo Estátua/Mimetismo**; *Segurar & Deslizar* para Roda de 6 Poses 3D.
  - **Escalar (🧱):** Botão contextual com brilho ativado ao aproximar-se de superfícies escaláveis.
  - **Pular (🟢):** Salto físico responsivo com animação `Jump.fbx`.
- **Mecânica do Caçador (Estilo Meccha Chameleon):**
  - **Arma de Água 3D (Water Blaster):** Caçador equipado com arma 3D que dispara jatos de água com feixe de partículas e som de pressão.
  - **Munição Contada (`💧 5/5` Padrão):** O Caçador inicia com 5 jatos de água (configurável de 1 a 30 no menu, com toggle de munição infinita). Cada disparo no vazio perde 1 jato. Se os jatos chegarem a 0 e restarem Camaleões vivos, dispara **Vitória dos Camaleões**!
  - **Remoção de Tinta (`washPaint`):** O jato de água desbota a tinta do jogador de volta ao branco original em ~1.5s de contato, forçando o movimento e dando uma janela de fuga/esquiva.
  - **Placar com Atraso de 30s (Anti-Cheat):** O tempo camuflado exibido no HUD do Caçador possui um atraso intencional de 30 segundos, impedindo a localização de esconderijos por leitura de pontos em tempo real.
  - **Zona de Sorteio do Lobby (+50% Peso):** Anel circular emissivo demarcado no mapa do Lobby. Jogadores posicionados dentro da zona no fim da contagem recebem +50% de peso no sorteio do Caçador.
- **Modo Caçador Jogável — Visão/Câmera, Arma e Scanner** (`docs/MECANICA_CACADOR_VISAO.md`):
  - **Câmera 1ª Pessoa (`HunterCamera.js`):** FOV 80° (pontos cegos laterais de propósito), arma-viewmodel presa à câmera, corpo do Caçador invisível na própria visão.
  - **Lanterna:** `SpotLight` acoplada à câmera com atenuação quadrática nativa (`decay=2`), sombra dinâmica em desktop.
  - **Penalidade de Tiro Errado:** cada disparo que não acerta um Camaleão-alvo aplica um cooldown de "bomba de pressão" de ~2,6s (em vez do cooldown normal de 300ms), sem consumir munição extra.
  - **Scanner (📡):** pulso de 8m (3s de duração, 20s de cooldown) que revela direção/distância dos Camaleões-alvo vivos num mini-radar, com vinheta azulada na tela.
- **Reinício Instantâneo em Memória (0ms de Espera):** Botão **Jogar Novamente** na tela de Game Over/Vitória reseta o estado da partida instantaneamente em memória sem recarregar a página ou refazer downloads 3D.

## Estrutura

```
index.html        # HUD Glassmorphic, menus radiais, preloader 3D, overlays e importmap
css/style.css     # Estilização Glassmorphism, botões em arco, menus radiais
dev_server.py     # Servidor de dev com Cache-Control: no-store (use este)
public/
  animation/      # Arquivos FBX das 7 animações Mixamo (Idle, Run, Crouch, Hide, Prone, Climb, Jump)
  models/         # Modelos 3D base (FBX, OBJ, GLB)
src/
  main.js         # Boot, preloader 3D, gestos e fullscreen
  AnimationManager.js # Loader, sanitizador In-Place e gerenciador de instâncias FBX
  Game.js         # Orquestra partida, menus radiais, pinch zoom e reinício em memória
  Player.js       # Física do jogador, amostragem de cor, modos de pose e pulo
  Seeker.js       # IA dos Caçadores: patrulha/caça, visão Toon, reset em memória
  ChameleonTarget.js # Alvos-camaleão parados do modo Caçador jogável (fase 1, sem IA própria)
  Level.js        # Mansão de 2 andares, mobília e áreas de camuflagem
  FollowCamera.js # Câmera 3ª pessoa (Camaleão) com colisão e suporte a Pinch to Zoom
  HunterCamera.js # Câmera 1ª pessoa do Caçador jogável (FOV, olhar livre)
  Joystick.js     # Joystick flutuante dinâmico com vibração haptática
  ColorPicker.js  # Roda de cor HSV para ajuste fino
  Audio.js        # Efeitos de áudio procedurais (Web Audio API)
```

## Como rodar

```bash
python dev_server.py        # porta 8000
```
Abra `http://localhost:8000` no navegador ou dispositivo mobile.
