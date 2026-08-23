# Esconde ou Morre

Protótipo mobile-first em **Three.js** (ES Modules puros, sem bundler). No **modo
Camaleão** (padrão) você é um **boneco de vinil branco** (estilo art toy / Pop Mart) que
**gruda em superfícies**, **pinta o próprio corpo com a cor do ambiente para se
camuflar** e precisa **sobreviver ao(s) Caçador(es)** até o tempo acabar. No **modo
Caçador** (jogável) você vira o caçador: câmera em **1ª pessoa** com FOV estreito e
lanterna, arma de água com penalidade de tiro errado, e uma habilidade de **Scanner**
para revelar Camaleões próximos — ver `docs/MECANICA_CACADOR_VISAO.md` abaixo. Um 3º
modo, **Online**, coloca jogadores de verdade na mesma sala (1 Caçador + até 4
Camaleões) via um servidor autoritativo, com munição/Scanner e reconexão automática
(troca de app, queda de rede ou reload da página) — ver `docs/PLANO_MULTIPLAYER.md` e
`docs/PLANO_LOBBY_MULTIPLAYER.md`.

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
> [`docs/PLANO_MANSAO.md`](docs/PLANO_MANSAO.md). Um 3º modo, **Online** (multiplayer,
> servidor autoritativo em `server/`), está documentado em
> [`docs/PLANO_MULTIPLAYER.md`](docs/PLANO_MULTIPLAYER.md) — a evolução da sala fixa de
> 2 para 1 Caçador + até 4 Camaleões na mesma partida está em
> [`docs/PLANO_LOBBY_MULTIPLAYER.md`](docs/PLANO_LOBBY_MULTIPLAYER.md). O pipeline que
> gera o personagem 3D (Mixamo → Blender → GLB único), incluindo o reunwrap de UV por
> região usado pelo Pincel Livre, está em
> [`docs/PIPELINE_PERSONAGEM.md`](docs/PIPELINE_PERSONAGEM.md). O acesso configurado ao
> Tripo3D para gerar assets 3D por IA sob demanda (props/cenário, não usado no
> personagem principal) está em [`docs/TRIPO_3D.md`](docs/TRIPO_3D.md). Os parâmetros de
> movimento (deadzone/curva do joystick, giro, velocidade) são calibrados ao vivo por um
> painel de dev (`?tune=1` na URL) documentado em
> [`docs/PAINEL_AJUSTE.md`](docs/PAINEL_AJUSTE.md). Contas de jogador (Ranking,
> Missões, Personalização — Supabase Auth + Postgres) estão em
> [`docs/PLANO_CONTAS.md`](docs/PLANO_CONTAS.md).

## Como rodar (build estática)

Não há passo de build. Sirva a pasta por HTTP (ES Modules exigem `http://`, não abrem
via `file://`). **Use o `dev_server.py`** — ele manda `Cache-Control: no-store`, então o
navegador nunca serve JS/CSS antigos (os módulos ES são importados sem `?v=`):

```bash
python3 dev_server.py        # porta 8000
python3 dev_server.py 8123   # outra porta
```

Abra `http://localhost:8000` e clique em **JOGAR**.

> 🌐 **Modo Online**: além do `dev_server.py`, precisa do servidor autoritativo rodando
> (`cd server && npm install && npm start`, porta 8787). Até 5 abas escolhendo "Online"
> entram na mesma sala (1º = Caçador, os próximos até 4 = Camaleão) — detalhes em
> `docs/PLANO_MULTIPLAYER.md` e `docs/PLANO_LOBBY_MULTIPLAYER.md`.

> ⚠️ Evite `python -m http.server`: sem os headers no-store, o navegador (e um eventual
> túnel) servem módulos ES em cache — misturando versões e podendo travar a inicialização.

> Única dependência externa: `three@0.161.0` (build + `addons/`) via CDN (unpkg),
> declarada no `importmap` do `index.html`. O restante — texturas, geometria e áudio —
> é 100% procedural.

## Deploy

**Em produção:** cliente na Vercel — https://esconde-ou-morre.vercel.app (deploy
automático a cada push em `main`) — e servidor autoritativo do modo Online no
Render.com (Blueprint `render.yaml`, serviço `esconde-ou-morre-server`). Detalhes e
histórico de verificação em `docs/PLANO_MULTIPLAYER.md`, seção "Hospedagem
(produção)".

Fora do modo Online, qualquer host de arquivos estáticos serve a pasta como está
(GitHub Pages, Netlify, Vercel, S3, etc.) — publique a raiz do repositório.

## Recursos Principais e Mecânicas

- **Personagem 3D Rigged + 9 Animações num GLB único:** Modelo 3D com skinning Toon carregado de `public/models/character_animated.glb` (uma malha, um esqueleto, 9 clipes embutidos: `idle`, `run`, `crouch`, `hide`, `prone`, `climb`, `jump`, `rifleRun`, `shoot`). Os FBX originais do Mixamo continuam versionados em `public/animation/` como fonte, mas o jogo não os baixa mais — ver `docs/PIPELINE_PERSONAGEM.md`.
- **Pré-carregador 3D em Tempo Real:** Tela inicial com barra de progresso (`0% → 100%`) garantindo entrada instantânea na partida sem troca de modelo.
- **Controles Mobile em Arco Ergonômico (Glassmorphism):**
  - **Joystick Flutuante Dinâmico:** Invisível em repouso; surge exatamente sob o polegar esquerdo ao tocar na tela. Resposta **analógica** (zona morta + curva de potência com saturação perto do máximo, não liga/desliga) — deflexão parcial dá microajuste fino, útil pra se posicionar rente a quinas; parâmetros calibrados ao vivo, ver `docs/PAINEL_AJUSTE.md`.
  - **Botões Glassmorphism:** Vidro translúcido com `backdrop-filter: blur(8px)`, bordas brancas de 1.5px, resposta tátil (*Haptic Vibration*) e disposição em arco.
  - **Pinch to Zoom (Multitouch):** Gesto de 2 dedos para aproximar/afastar a câmera (1.8m a 7.5m) e 1 dedo para girar a visão.
  - **Oclusão de Câmera:** pilares/móveis/lajes entre a câmera 3ª pessoa e o jogador desvanecem (`Game._updateOcclusion`) pra ele nunca sumir 100% atrás da própria geometria — cobre tanto quem está grudado numa parede quanto parado no chão encostado num obstáculo.
- **Menus Radiais Duplos (2 Modos em 1 Botão):**
  - **Pintar (🎨):** *Toque rápido* para amostragem automática (*Quick Match*) e onda de tinta; *Segurar* para Menu Radial com Histórico de 4 Cores recentes e acabamento (Fosco/Brilhante) — e o botão **PINCEL** no centro desse menu abre o **Pincel Livre**.
- **Pincel Livre (pintura 3D por UV):** pintura à mão livre sobre o próprio personagem — raycast da câmera contra a malha ANIMADA (não a bind pose, ver `src/UVPaint.js`) devolve a UV do ponto tocado, carimbada num canvas 2D usado como textura dinâmica (`CanvasTexture`, 512×512, mantendo o `gradientMap` toon). Painel com tamanho de pincel, paleta + histórico de amostras, conta-gotas (sem copiar a textura da superfície), desfazer/limpar, brilho emissivo (`MeshToonMaterial.emissive`, sem PBR real) e raio-X. No modo Online, os traços são sincronizados automaticamente entre jogadores (lista compacta de comandos — nunca pixels, mesma regra do resto do protocolo — mandada sozinha ao pintar, sem botão de enviar); quem entra depois de uma pintura já começada recebe o histórico acumulado. Ver `src/UVPaint.js`, `Game.js` (`_setupPaintPanel`/`_flushAndSendPaint`) e a seção "UV por região" em `docs/PIPELINE_PERSONAGEM.md`.
  - **Poses (🧍):** *Toque rápido* para congelar no **Modo Estátua/Mimetismo**; *Segurar & Deslizar* para Roda de 6 Poses 3D.
  - **Escalar (🧱):** Botão contextual com brilho ativado ao aproximar-se de superfícies escaláveis.
  - **Pular (🟢):** Salto físico responsivo com animação `Jump.fbx`.
- **Mecânica do Caçador (Estilo Meccha Chameleon):**
  - **Arma de Água 3D:** modelo `water_gun.glb` preso ao osso da mão direita do Caçador (não é mais um cilindro procedural), disparando jatos de água com feixe de partículas e som de pressão.
  - **Munição Contada (`💧 5/5` Padrão):** O Caçador inicia com 5 jatos de água (configurável de 1 a 30 no menu, com toggle de munição infinita). Cada disparo no vazio perde 1 jato. Se os jatos chegarem a 0 e restarem Camaleões vivos, dispara **Vitória dos Camaleões**! Vale para o Caçador solo **e** para o modo Online (autoritativo no servidor, ver `docs/PLANO_MULTIPLAYER.md`).
  - **Remoção de Tinta (`washPaint`):** O jato de água desbota a tinta do jogador de volta ao branco original em ~1.5s de contato, forçando o movimento e dando uma janela de fuga/esquiva.
  - **Placar com Atraso de 30s (Anti-Cheat):** O tempo camuflado exibido no HUD do Caçador possui um atraso intencional de 30 segundos, impedindo a localização de esconderijos por leitura de pontos em tempo real.
  - **Escolha do Caçador:** sem sorteio nem zona no mapa — no modo Online é simplesmente o primeiro a entrar na sala; os próximos, até 4, viram Camaleão (ver `docs/MECANICA_CACADOR.md` e `docs/PLANO_LOBBY_MULTIPLAYER.md`).
- **Modo Caçador Jogável — Visão/Câmera, Arma e Scanner** (`docs/MECANICA_CACADOR_VISAO.md`):
  - **Câmera 1ª Pessoa (`HunterCamera.js`):** FOV 80° (pontos cegos laterais de propósito), arma-viewmodel + antebraço/mão presos à câmera (cor acompanha a camuflagem do jogador), corpo do Caçador invisível na própria visão.
  - **Lanterna:** `SpotLight` acoplada à câmera com atenuação quadrática nativa (`decay=2`), sombra dinâmica em desktop.
  - **Penalidade de Tiro Errado:** cada disparo que não acerta um Camaleão-alvo aplica um cooldown de "bomba de pressão" de ~2,6s (em vez do cooldown normal de 300ms), sem consumir munição extra.
  - **Scanner (📡):** pulso de 8m (3s de duração, 20s de cooldown) que revela direção/distância dos Camaleões-alvo vivos num mini-radar, com vinheta azulada na tela. Disponível no Caçador solo e no Caçador Online.
- **Reconexão automática (modo Online):** queda de conexão (troca de app, rede instável) ou até um reload de página são recuperados sozinhos — o servidor segura a vaga por 30s (`RECONNECT_GRACE_MS`) e o cliente reconecta com backoff reaproveitando a mesma identidade (`?rejoin=id:token`). Posição/pose não sobrevivem a um reload de página; papel, munição e status de eliminado sim — ver `docs/PLANO_MULTIPLAYER.md`.
- **Reinício Instantâneo em Memória (0ms de Espera):** Botão **Jogar Novamente** na tela de Game Over/Vitória reseta o estado da partida instantaneamente em memória sem recarregar a página ou refazer downloads 3D.

## Estrutura

```
index.html        # HUD Glassmorphic, menus radiais, preloader 3D, overlays e importmap
css/style.css     # Estilização Glassmorphism, botões em arco, menus radiais
dev_server.py     # Servidor de dev com Cache-Control: no-store (use este)
server/           # Servidor autoritativo do modo Online (docs/PLANO_MULTIPLAYER.md) — Node + ws, isolado do cliente
public/
  animation/      # FBX originais do Mixamo (fonte do GLB — o jogo não os baixa mais)
  models/         # character_animated.glb (personagem + 9 clipes) e water_gun.glb (arma do Caçador)
assets/
  menu/           # Ilustração de fundo + recorte decorativo do menu (docs/TRIPO_3D.md não se aplica — arte 2D, não 3D)
scripts/
  gerar_personagem_glb.py # Pipeline Mixamo FBX → Blender → character_animated.glb (docs/PIPELINE_PERSONAGEM.md)
src/
  main.js         # Boot, preloader 3D, gestos e fullscreen
  MenuUI.js       # Telas do menu (principal/escolha de modo/loading) e modais (Config/Como Jogar/Em breve)
  AnimationManager.js # Loader do GLB único, instancia/clona o personagem e a arma (createBlaster)
  Game.js         # Orquestra partida, menus radiais, pinch zoom e reinício em memória
  Player.js       # Física do jogador, amostragem de cor, modos de pose e pulo
  UVPaint.js      # Pincel Livre: raycast na malha animada → UV → canvas 2D (textura de pintura)
  Seeker.js       # IA dos Caçadores: patrulha/caça, visão Toon, reset em memória
  ChameleonTarget.js # Alvos-camaleão parados do modo Caçador jogável (fase 1, sem IA própria)
  Level.js        # Mansão de 2 andares, mobília e áreas de camuflagem
  FollowCamera.js # Câmera 3ª pessoa (Camaleão) com colisão e suporte a Pinch to Zoom
  HunterCamera.js # Câmera 1ª pessoa do Caçador jogável (FOV, olhar livre)
  Net.js          # Cliente WebSocket do modo Online (WebSocket nativo, sem dependência nova)
  RemotePlayer.js # Avatar remoto interpolado do modo Online
  net/            # protocol.js + hittest.js — compartilhados verbatim com server/ (sem imports)
  Joystick.js     # Joystick flutuante dinâmico com vibração haptática (resposta analógica, ver Tuning.js)
  Tuning.js       # Parâmetros calibrados ao vivo (deadzone/curva/giro/velocidade) — docs/PAINEL_AJUSTE.md
  TunePanel.js    # Painel ⚙️ (?tune=1) que edita Tuning.js em runtime
  ColorPicker.js  # Roda de cor HSV para ajuste fino
  Audio.js        # Efeitos de áudio procedurais (Web Audio API)
```
