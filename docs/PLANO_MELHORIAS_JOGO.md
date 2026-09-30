# Plano de melhorias — Esconde ou Morre

Data: 10/09/2026. Execução iniciada em 11/09/2026.

## Estado da execução

- **Etapa 1 — concluída no que o código pode entregar:** repetição de reconexão,
  restauração do estado, promoção de Caçador na busca, preservação de captura, regras
  públicas, fases/rodadas e revanche por prontidão foram implementadas, e em 2026-09-30
  entraram a **rotação do Caçador entre rodadas** (`room.js:_rotateHunter`, critério de
  justiça, cliente trata promoção *e* rebaixamento) e o **limite de velocidade/teleporte**
  no servidor (`room.js:_validateMove`). Seguem em aberto, por dependerem de medição:
  ensaio de carga, instalação com cache anterior e playtest com sessões simultâneas
  maiores; e, fora desta etapa, a re-simulação de colisão (Débito 1 do multiplayer).
- **Etapa 2 — concluída no térreo dos três mapas do Online (2026-09-30):** as IAs
  escolhem esconderijos reais (extraídos do jogo com o próprio `Player`), caminham
  contornando paredes e móveis numa grade de navegação, copiam a cor medida na
  superfície, têm percepção limitada (alcance, campo de visão, parede, audição,
  memória) e fogem para abrigos longe da última posição vista. Detalhes e limites em
  [`PLANO_IA_ESCONDERIJOS.md`](PLANO_IA_ESCONDERIJOS.md). Seguem pendentes: navegação
  vertical (porão, andares e ático do Chameleon Manor), a IA solo (`ChameleonTarget`),
  calibrar a dificuldade com playtest e um aviso quando `navdata.js` ficar velho em
  relação ao `Level.js`.
- **Etapas 3 e 4 — correções essenciais concluídas:** tutorial não consome a rodada,
  dica de cor funciona no chão, dicas aparecem no celular e relógio/medição não usam
  mais o intervalo limitado da física. Tutorial dirigido por ações, preferências de
  controle e perfis graduais de qualidade continuam pendentes.
- **Etapas 5 e 6 — dependem de playtest e serviço de contas:** não marcadas como
  concluídas sem as medições e a validação externa previstas neste documento.

## Objetivo

Fazer cada partida começar e terminar corretamente, oferecer adversários que realmente se escondem e tornar as regras fáceis de entender no computador e no celular. Aumentar conteúdo e progressão depois de validar essa experiência.

Este é o plano vigente para as próximas entregas. O [plano de correções anterior](PLANO_CORRECOES.md) permanece como registro do diagnóstico original, com entregas parcialmente implementadas.

## Base da revisão

- Revisão do código local, incluindo as mudanças ainda não publicadas do matchmaking com IA. Na consulta desta revisão, `HEAD` e `origin/main` estavam em `eb52f23`; o complemento com IA estava na árvore de trabalho.
- Os **22 testes existentes do servidor passaram** nesta revisão. Eles não cobrem todos os problemas abaixo nem demonstram qualidade da IA ou desempenho no celular.
- Já existem: modos solo por papel, salas por código, busca pública de 30 segundos, preenchimento de vagas com IA, HUD por papel, tutorial de instruções e redução automática de resolução em celulares.
- Não houve novo playtest entre pessoas, medição em aparelho físico ou ensaio de carga nesta revisão. Metas de desempenho e diversão abaixo são propostas, não resultados medidos.

### Problemas encontrados no código

| Evidência | Impacto para quem joga |
| --- | --- |
| `src/Net.js`, `_scheduleReconnect`: a flag de reconexão bloqueia a tentativa seguinte após uma falha; o horário da queda não é zerado após recuperar. | Pode ficar tentando reconectar indefinidamente ou desistir cedo numa segunda queda. |
| `server/room.js`, `_startMatch` e `_purgeStale`: a partida exige Caçador conectado, mas sua saída durante a espera não redistribui o papel. | A fila pode ficar parada mesmo depois do prazo. |
| `server/room.js`, `_fillBotSlots` e contagem de vivos: uma vaga removida pode virar uma IA viva mesmo se já estava eliminada; desconectados deixam de contar como vivos. | Uma queda pode alterar indevidamente as condições de vitória. |
| `server/room.js`, `_onRevive`: o primeiro pedido reinicia a sala, mantém IAs e papéis e não reabre a busca pública; `Game.restartInPlace` reinicia estado local separadamente. | Revanche pode começar sem todos preparados e manter bots apesar de haver humanos buscando. |
| `server/room.js`, `_updateBots`: bots percorrem círculos no ponto inicial e alternam cores por tempo, sem decisões de abrigo ou checagem de colisão nesse movimento. | O preenchimento da sala funciona, mas os adversários ainda não jogam esconde-esconde de forma convincente. |
| `src/Game.js` e `css/style.css`: o tutorial cobre controles enquanto a rodada continua; dicas de camuflagem ficam ocultas no solo em telas pequenas. | Iniciantes podem perder enquanto leem e ficar sem entender como se camuflar. |
| `src/Player.js` e `src/Game.js`: deitar com cor incompatível pode produzir dica para grudar; o pincel livre não participa diretamente da comparação de camuflagem. | A orientação e a aparência podem divergir da regra usada pelo jogo. |
| `src/Game.js`, `_tick` e `_updateAdaptiveQuality`: o mesmo intervalo limitado a 0,05 s alimenta o relógio solo e a estimativa de FPS. | Em baixa taxa de quadros, o tempo solo fica mais lento e a medição de desempenho fica incorreta. |
| `src/Auth.js`: resultados são enviados pelo navegador e rankings agregam modalidades distintas. | O ranking ainda precisa de validação e categorias antes de ser tratado como competição justa. |

## Ordem das entregas

P0 bloqueia uma partida confiável; P1 afeta diretamente jogar e aprender; P2 melhora conforto, equilíbrio e retorno. Esforço relativo, sem promessa de calendário: médio envolve vários fluxos; grande exige mudanças compartilhadas ou validação ampla.

| Etapa | Entrega | Prioridade | Esforço | Dependência |
| --- | --- | --- | --- | --- |
| 1 | Online confiável, inclusive reconexão e revanche | P0 | Grande | Nenhuma |
| 2 | IA que procura abrigo e reage ao Caçador | P1 | Grande | 1 para integração online |
| 3 | Tutorial prático e camuflagem compreensível | P1 | Médio/grande | Correções básicas podem ocorrer junto de 1 |
| 4 | Relógio correto, medição e conforto no celular | P1/P2 | Médio | Relógio pode ocorrer junto de 1; otimização depende de medição |
| 5 | Ritmo, mapas e equilíbrio validados com jogadores | P2 | Médio | 1–4 |
| 6 | Resultados confiáveis e motivos para voltar | P2 | Grande | 1 e 5 |

## 1. Tornar o online confiável

**Entrega:** busca, rodada, resultado e próxima partida passam a ter estados coordenados pelo servidor e uma identificação própria por rodada.

- Manter a regra solicitada: procurar humanos por **30 segundos**, iniciar antes se houver cinco humanos e completar somente as vagas restantes com Camaleões de IA ao terminar o prazo. Uma rodada iniciada admite retorno dos seus participantes; novos humanos entram na próxima busca.
- Repetir reconexões com intervalo limitado até a janela de recuperação acabar; cancelar tentativas antigas ao sair; reiniciar a contagem de recuperação em cada nova queda.
- Ao reconectar, reaplicar mapa, papel, posição, eliminação, participantes, fase e tempo do servidor. Montar a cena online depois da confirmação inicial do mapa, evitando depender de recarregar a página para corrigir divergências.
- Se o Caçador sair durante a busca, reservar sua vaga durante a recuperação. Após o prazo de recuperação, atribuir o papel a um humano presente, sincronizar os controles e iniciar quando as condições estiverem cumpridas. Se ninguém permanecer, encerrar a sala. Durante uma rodada ativa, manter o encerramento previsto para saída definitiva do Caçador.
- Manter identidade e estado da vaga ao desconectar: capturado continua capturado; uma vaga viva continua contando para a rodada durante a recuperação e eventual controle por IA. A substituição não cria um alvo adicional, não renova recursos nem muda a condição de vitória.
- Revanche: resultado → confirmação dos participantes → nova busca → início sincronizado. O clique de uma pessoa não reinicia os demais. Reabrir vagas de IA para humanos entre rodadas, alternar o Caçador entre participantes disponíveis e limpar estados de todos no mesmo início.
- Fixar as regras públicas no servidor, incluindo munição e permissões de reinício. Validar identidade/sala na reconexão, mensagens de rodada antiga e movimentos incompatíveis com limites do jogo. Deixar ajustes de treino restritos ao contexto apropriado.
- Revisar versões dos módulos, protocolo e atualização do cache para que uma instalação já usada carregue cliente compatível com o servidor novo.

**Aceite:** testar fila com 1, 2 e 5 humanos; chegada pouco antes e depois do prazo; sexta pessoa encaminhada a outra sala; isolamento por código; saída do Caçador na busca; duas tentativas de reconexão que falham antes de recuperar; duas quedas na mesma rodada; queda de Camaleão vivo e eliminado; três rodadas seguidas com todos vendo o mesmo estado; entrada humana substituindo vaga de IA na busca da revanche. Testar navegador com cache anterior, além de instalação limpa.

Arquivos principais: `server/index.js`, `server/room.js`, `server/test/room.test.mjs`, `src/Net.js`, `src/net/protocol.js`, `src/Game.js`, `src/main.js`, `index.html`, `sw.js`.

## 2. Fazer a IA jogar esconde-esconde

**Entrega:** substituir círculos e mudança de cor por tempo por decisões observáveis de procurar abrigo, se esconder e fugir.

- Criar dados de navegação e esconderijos válidos por mapa: piso, altura, obstáculos, conexões entre áreas, superfície e poses compatíveis. O servidor precisa desses dados sem depender da renderização do navegador.
- Usar estados simples: procurar esconderijo → deslocar-se → copiar a superfície e parar → observar ameaça → fugir para outro abrigo. Incluir recuperação quando um caminho não puder ser completado.
- Limitar percepção por distância, campo de visão e obstáculos. A IA não deve conhecer permanentemente a localização do Caçador; dificuldade vem do tempo de reação e da qualidade das escolhas.
- Aplicar as mesmas restrições relevantes de movimento, superfície e captura dos humanos. Reaproveitar conceitos da IA solo, mas extrair lógica e dados compartilháveis: a implementação atual depende de objetos gráficos e não pode ser simplesmente importada no servidor.
- Identificar IA na lista de participantes e no resultado. Retirar a etiqueta persistente acima do esconderijo quando ela revelar o alvo ao adversário.
- Validar primeiro em um mapa; expandir para todos os mapas da rotação antes da liberação geral. Depois aplicar os comportamentos úteis à IA solo, que hoje principalmente vagueia ou foge.

**Aceite:** cada IA alcança esconderijos válidos, para para se ocultar, escolhe uma superfície compatível, reage apenas ao que consegue perceber e troca de abrigo sem atravessar obstáculos. Executar trajetórias reproduzíveis, testar acessos verticais e rodadas completas em todos os mapas habilitados. Capturas, vitória e desconexões continuam obedecendo às regras da etapa 1.

Arquivos principais: `server/room.js`, `src/ChameleonTarget.js`, `src/RemotePlayer.js`, módulos dos mapas e novos dados compartilhados de navegação.

## 3. Ensinar jogando e explicar a camuflagem

**Entrega:** um iniciante entende seu objetivo e recebe uma instrução correta quando a camuflagem falha.

- Separar treino e partida. No treino de Camaleão, avançar ao mover, copiar cor, escolher apoio/pose e camuflar. No de Caçador, ensinar busca, mira, jato e recursos. Permitir pular e repetir pelo menu, salvando a conclusão.
- Não consumir tempo, água ou vidas enquanto o tutorial bloqueia a interação. Para online, oferecer treino antes de entrar na fila e ajuda por papel sem interromper uma rodada coletiva.
- Mostrar estado compacto com texto e ícone em qualquer tamanho de tela: sem apoio, cor incompatível ou camuflagem válida. Corrigir a dica para quem já está deitado e explicar qual zona do corpo precisa de ajuste.
- Explicar toque longo para pintura e poses, além das ações de toque curto.
- Definir e testar a relação entre pintura visível e detecção. Primeiro esclarecer a regra atual; depois fazer um protótipo que considere a pintura final nas zonas relevantes, com tolerância documentada e custo medido. Evitar prometer que camuflagem impede uma pessoa de enxergar o avatar no online.

**Aceite:** permanecer 60 segundos na instrução não provoca perda; concluir ou pular começa a rodada em estado correto; as dicas para parede, chão e cor errada funcionam no PC e celular; o tutorial depende de ações reais; pinturas visualmente equivalentes não produzem resultados inexplicavelmente diferentes.

Arquivos principais: `src/Game.js`, `src/Player.js`, `index.html`, `css/style.css` e documentação da mecânica.

## 4. Corrigir o tempo e melhorar o celular com medições

**Entrega:** duração correta das partidas, métricas reais e controles ajustáveis.

- Separar relógio real, avanço da simulação e medição de quadros. O limite usado para estabilizar movimento não pode alongar a rodada nem falsear FPS.
- Definir comportamento de aba oculta: pausar solo de forma explícita e manter o relógio do servidor no online, recuperando o estado ao voltar.
- Medir tempo de quadro, carregamento, latência e memória nos mapas e modos existentes. Investigar atualização de HUD, sombras, efeitos e detecção da IA conforme os dados indicarem.
- Criar perfis de qualidade e redução gradual baseada na medição correta, preservando leitura de cores, superfícies e adversários.
- Oferecer sensibilidade, volume, tamanho/posição dos botões e opção para canhotos. Respeitar áreas seguras da tela e indicar ações de segurar; adicionar opção de vibração apenas onde houver suporte.

**Aceite:** duração coerente em 10, 20 e 60 FPS simulados; retorno da aba sem salto incorreto de estado; configurações persistentes; dez rodadas consecutivas sem crescimento contínuo de recursos. Meta proposta: 30 FPS sustentados nos celulares escolhidos para teste e 60 FPS no computador de referência, registrando aparelhos, mapas e qualidade usada. Não afirmar suporte amplo com base apenas em emulação.

Arquivos principais: `src/Game.js`, módulos de entrada, `index.html`, `css/style.css`, `src/Audio.js` e renderização conforme os resultados.

## 5. Ajustar o ritmo e a justiça das partidas

**Entrega:** mapas e regras calibrados pela experiência real, aproveitando primeiro o conteúdo existente.

- Observar partidas completas e medir tempo até primeiro encontro, duração, tiros usados, abandono e vitória por papel, mapa e composição de humanos/IA.
- Ajustar esconderijos, rotas de fuga, pontos iniciais e referências visuais. Verificar necessidade de uma breve preparação protegida dos Camaleões; não alterar a duração da busca de 30 segundos por suposição.
- Ajustar munição, scanner, percepção da IA e duração da caçada a partir dessas sessões. Evitar esconderijos sem resposta possível ou pistas que revelem automaticamente todo adversário.
- Melhorar feedback de acerto, erro, captura e final, com som, texto e animações discretas. Preservar legibilidade das cores usadas na camuflagem.
- Só adicionar novos mapas depois de confirmar que os atuais entregam encontros e estratégias variadas.

**Aceite:** realizar uma rodada exploratória com 5–10 pessoas, incluindo iniciantes, e pelo menos 20 partidas distribuídas entre papéis e composições. Registrar problemas e mudanças por mapa; repetir os cenários afetados. Essa amostra orienta decisões iniciais, não comprova equilíbrio estatístico nem justifica exigir exatamente 50% de vitórias.

## 6. Dar motivos para jogar novamente

**Entrega:** resultado útil, objetivos claros e progressão sem vantagem competitiva paga ou desbloqueável.

- Mostrar tempo sobrevivido, capturas, composição da partida e uma sugestão contextual de melhoria. Reutilizar o fluxo coordenado de próxima partida da etapa 1.
- Revisar missões e personalização existentes antes de adicionar sistemas: propor objetivos variados e recompensas cosméticas que não prejudiquem a leitura do personagem.
- Separar resultados solo/treino, partidas mistas e partidas apenas humanas. Não apresentar vitória contra IA como resultado competitivo equivalente.
- Antes de fortalecer ranking online, registrar resultado autoritativo pelo servidor, identificado por rodada e participante, com gravação idempotente e acesso validado. Verificar as políticas reais do serviço de contas; esta revisão não auditou o banco remoto.

**Aceite:** um mesmo resultado não pode ser creditado duas vezes; o navegador não escolhe livremente o vencedor creditado online; categorias e presença de IA ficam claras; recompensas não alteram munição, velocidade, visibilidade ou chance de vitória.

Arquivos principais: `src/Auth.js`, `src/Game.js`, servidor de partidas, interface de resultados e estrutura de dados de contas.

## Primeira entrega recomendada

Começar pela **etapa 1**, dividida em três alterações verificáveis:

1. Reconexão, saída do Caçador durante a busca e preservação das vagas/capturas.
2. Estados da rodada, sincronização dos participantes e revanche com nova prioridade humana.
3. Regras públicas, atualização de cliente/cache e testes integrados com múltiplas sessões.

O relógio solo e o tutorial que consome a partida podem ser corrigidos em paralelo. A próxima versão de melhoria da experiência deve reunir essa base estável, IA que usa esconderijos e feedback básico de camuflagem validado em celular. Balanceamento, mais conteúdo e progressão seguem após essa validação.

Cada entrega deve atualizar documentação, executar testes adequados ao comportamento alterado e, quando mudar gameplay ou interface, ser verificada no navegador. Conclusão exige evidência dos critérios de aceite, não apenas ausência de erros de sintaxe.
