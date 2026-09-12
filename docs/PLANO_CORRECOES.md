# Plano de correções — Esconde ou Morre

Data original: 09/09/2026. Status em 10/09/2026: parcialmente implementado.

Este documento preserva o diagnóstico e a proposta originais; os problemas abaixo não devem ser interpretados como uma lista atual de pendências. As próximas entregas e os critérios revisados estão no [Plano de melhorias do jogo](PLANO_MELHORIAS_JOGO.md); o histórico de implementação está em [_log.md](_log.md).

## Objetivo e evidências

Garantir partidas vencíveis, regras compreensíveis e estado online consistente. Depois, melhorar aprendizado, apresentação e vontade de jogar novamente.

Base: revisão do código local, documentação, inspeção no navegador dos modos Caçador e Camaleão e execução dos testes existentes na análise anterior (16/16 passaram). Não houve playtest multiplayer entre pessoas nem medição em celular real. Os testes atuais não cobrem integralmente gameplay, pintura, desempenho ou justiça das regras.

Problemas confirmados na revisão:

- Caçador solo inicia com 6 alvos e 5 tiros; cada tiro consome água e elimina no máximo um alvo. A configuração padrão impede a vitória.
- HUD do Caçador mostra “SOBREVIVA”; dicas da tela de carregamento também precisam acompanhar o papel escolhido.
- A detecção de camuflagem solo consulta cores de duas zonas; a textura do pincel livre não participa diretamente dessa comparação.
- O cliente constrói o mapa online pelo próprio relógio; o servidor mantém o mapa da sala e já o informa em WELCOME.
- O HUD usa a duração calculada pelo estágio solo, enquanto o servidor informa uma duração online própria. Corrigir e reproduzir a divergência em duas sessões.
- O servidor aceita posições declaradas pelo cliente e configurações de munição por JOIN. O ranking recebe resultados declarados pelo cliente.

Hipóteses que exigem playtest: esconderijos podem resultar em espera excessiva; o mapa maior pode dispersar os encontros; o tutorial atual pode ser insuficiente; o custo gráfico em celulares pode prejudicar os controles. Não tratar essas hipóteses como medições já realizadas.

## Ordem e tamanho das entregas

Esforço relativo: pequeno = mudança localizada; médio = envolve vários fluxos; grande = exige nova arquitetura ou validação ampla. Não são estimativas de calendário.

| Ordem | Entrega | Prioridade | Esforço | Dependência |
| --- | --- | --- | --- | --- |
| 1 | Partida vencível e HUD por papel | P0/P1 | Pequeno | Nenhuma |
| 2 | Mapa, relógio e regras online consistentes | P1 | Grande | 1 |
| 3 | Camuflagem compreensível e tutorial | P1 | Médio/grande | 1 |
| 4 | Apresentação e desempenho medido | P2 | Médio | 3 |
| 5 | Salas com amigos e revanche coordenada | P2 | Grande | 2 |
| 6 | Balanceamento e progressão por evidências | P2 | Médio | 3–5 |

Concluir a correção urgente da etapa 1 antes de iniciar a próxima. Cada etapa deve gerar uma entrega verificável; não juntar todas em uma única alteração.

## 1. Partida vencível e informações corretas

### C01 — Munição do Caçador solo

- Adotar inicialmente 8 tiros para os 6 alvos: dois erros permitidos. É uma proposta de balanceamento a validar.
- Definir regras por modo. Não alterar silenciosamente a munição dos Caçadores IA ou do online ao mudar o padrão do solo.
- Na configuração normal, garantir munição suficiente para o número de alvos; configurações com menos tiros ficam explicitamente como desafio personalizado, fora de comparação competitiva.
- Centralizar a regra usada na criação, configuração e reinício da partida. Evitar corrigir só o valor visível do seletor.
- Preservar prioridade de vitória quando o último tiro elimina o último alvo.

Arquivos: `src/Game.js`, `index.html`, `src/MenuUI.js`; módulo de regras pequeno se necessário, sem extrair o jogo inteiro.

Aceite: vencer acertando os 6 alvos; vencer com 2 erros e 6 acertos; perder após esgotar água com alvos vivos; reiniciar e avançar estágio com valores corretos; configurações dos demais modos preservadas. Cobrir a regra com teste de regressão e confirmar o fluxo no navegador.

### C02 — Objetivo e HUD por papel

- Camaleão: sobrevivência, estado do disfarce e ameaça.
- Caçador: “ENCONTRE OS CAMALEÕES”, alvos restantes, água, scanner e tempo restante. Remover indicadores de camuflagem sem utilidade nesse papel.
- Dicas e ajuda específicas por modo; carregamento solo não deve anunciar sincronização de jogadores.
- Explicar a derrota: sem água, tempo esgotado ou captura.

Arquivos: `index.html`, `css/style.css`, `src/Game.js`, `src/MenuUI.js`.

Aceite: seleção de modo, início, vitória, derrota e reinício mostram o objetivo correto; troca de papel online atualiza todo o HUD; instruções legíveis sobre piso claro.

## 2. Consistência e integridade online

### C03 — Mapa e tempo definidos pela sala

- Usar `WELCOME.layout` antes de criar o cenário online. A rotação por hora continua podendo escolher o mapa de uma sala nova, mas o mapa fica fixo durante a rodada.
- Separar a preparação assíncrona online do início solo. Exibir estado de conexão e erro recuperável enquanto aguarda a sala.
- Usar `matchDuration`, `matchStartAt` e referência de tempo do servidor para o cronômetro. Evitar depender da hora configurada no aparelho; estimar a diferença dos relógios a partir das mensagens do servidor.
- Na reconexão, restaurar mapa, duração, papel e fase da rodada; se o cenário precisar ser reconstruído, descartar recursos e listeners antigos.
- Revisar versão do protocolo e impedir entrada de cliente incompatível com mensagem para atualizar o jogo.

Arquivos: `src/Game.js`, `src/Net.js`, `src/net/protocol.js`, `server/room.js`.

Aceite: duas sessões com relógios diferentes entram no mesmo mapa; uma entrada após a virada de hora segue a sala existente; lobby não consome tempo de partida; reconexão não reinicia cronômetro; HUD online corresponde aos 180 segundos atuais; servidor continua decidindo o resultado.

### C04 — Fechar alterações indevidas de estado

- Fixar regras públicas no servidor. Validar configurações de sala privada no lobby e congelá-las durante a rodada.
- Impedir que JOIN repetido reponha água ou habilite munição infinita durante a partida.
- Validar origem e direção de tiro: componentes finitos, direção válida e origem compatível com posição/pose aceita pelo servidor, antes de gastar água.
- Impedir que REVIVE elimine o estado de capturado durante uma rodada ativa. Revanche precisa ser transição de estado da sala.
- Validar deslocamento por tempo decorrido e limites do mapa, contemplando salto, escalada, spawn e reconexão. Corrigir a posição no cliente quando rejeitada.
- Tratar limites de velocidade como proteção inicial, não como validação completa de colisão. Avaliar colisores compartilhados para impedir atravessar paredes; reservar simulação autoritativa completa para uma evolução própria.

Arquivos: `server/room.js`, `src/net/protocol.js`, `src/net/hittest.js`, `src/Game.js`, testes de servidor.

Aceite: JOIN não recarrega uma rodada ativa; REVIVE não ressuscita um eliminado; tiro com origem forjada não acerta; mensagens inválidas não alteram munição; deslocamento impossível é rejeitado sem quebrar salto/escalada legítimos; reconexão preserva penalidades e estado.

### C05 — Resultados confiáveis

- Separar resultados solo/casuais dos online verificados na apresentação do ranking.
- Para resultados online verificados, autenticar a identidade no servidor e registrar vencedor/papel a partir do estado da sala, com identificador único de partida e participante para evitar duplicação.
- Validar a política de escrita no banco: o cliente não pode marcar um resultado como verificado. Credenciais privilegiadas ficam exclusivamente no servidor.
- Não apresentar tempo camuflado como verificado enquanto essa métrica depender apenas do cliente.
- Falha de gravação não deve interromper a partida; reenvio deve ser idempotente.

Arquivos: `src/Auth.js`, `src/Game.js`, `server/room.js`, integração de autenticação/persistência no servidor e migração das políticas do banco.

Aceite: uma partida gera no máximo um resultado por jogador; reenvio não duplica pontos; resultado forjado pelo cliente não entra na categoria verificada; histórico existente continua disponível como casual. Validar a migração em ambiente de teste antes de produção.

## 3. Camuflagem e aprendizado

### C06 — Estado de disfarce explicável

- Reaproveitar o indicador “CAMUFLADO” existente e acrescentar o motivo quando falhar: sem apoio, superfície inválida ou cor incompatível.
- Usar texto e ícone além da cor; manter tolerâncias de entrada/saída para evitar oscilações rápidas.
- Distinguir o significado entre modos: no solo o estado influencia a IA; no online pessoas ainda podem reconhecer o personagem. Não prometer invisibilidade ou imunidade contra humanos.
- Exibir retorno breve ao copiar uma cor e ao conseguir camuflagem; não mostrar porcentagem de precisão sem uma métrica definida.

### C07 — Alinhar pincel e detecção

- Primeira entrega: explicar na interface que o pincel é pintura visual e que a IA atual usa as cores-base. Corrige a expectativa enquanto se prepara a integração.
- Segunda entrega: construir um protótipo de amostragem da aparência final por regiões visíveis, incluindo textura, cor-base e superfície de fundo. Começar com paredes chapadas e tapetes; padrões e poses exigem validação própria.
- Incluir área incompatível na comparação, evitando que uma média de cores esconda manchas contrastantes.
- Recalcular quando pintura, pose ou superfície mudar, com limite de frequência; aproveitar o canvas da pintura, evitando leitura de pixels da GPU a cada quadro.
- Só substituir o cálculo atual após comparar comportamento, aparência e custo em aparelhos reais.

Arquivos de C06/C07: `src/Player.js`, `src/UVPaint.js`, `src/AnimationManager.js`, `src/Seeker.js`, `src/Game.js`, `index.html`, `css/style.css`.

Aceite: duas zonas com uma cor errada não aparecem como seguras; pincel contrastante produz resposta coerente na versão integrada; padrão e pose não geram indicação enganosa; nenhuma promessa de imunidade no online; registrar casos visuais antes/depois.

### C08 — Tutorial interativo

- Sequência Camaleão: mover → copiar cor → grudar → confirmar disfarce → observar um caçador passar.
- Sequência Caçador: localizar um alvo → mirar/disparar → entender água → usar scanner.
- Ambiente controlado, sem derrota antes de ensinar a ação necessária. Reutilizar um trecho simples do mapa existente.
- Oferecer pular e repetir; salvar conclusão localmente. Apresentar gestos de segurar e pincel depois do domínio das ações básicas.

Aceite: cada passo avança pela ação real, não apenas pelo tempo; abandonar/reabrir não bloqueia o menu; iniciante consegue completar sem instrução externa; tutorial não registra vitória ou missão competitiva.

## 4. Apresentação e desempenho

### C09 — Coerência visual

- Usar imagens do cenário/personagem reais nos cartões dos modos e aproximar a arte do menu do estilo de brinquedo do jogo.
- Priorizar um mapa compacto: cores de cômodos, pontos de referência e oportunidades claras de esconderijo.
- Dar contraste às instruções, hierarquia ao HUD e rótulos consistentes aos controles; avaliar tamanho e alcance dos botões em celular.

### C10 — Medir antes de otimizar

- Registrar carregamento, estabilidade de quadros e memória em desktop e celular intermediário, nos três mapas, incluindo pintura e vários personagens.
- Adotar como meta inicial 30 FPS sustentados no celular de referência e 60 FPS no desktop de referência, registrando aparelho, resolução e condições. Não são resultados já alcançados.
- Se necessário, implementar qualidade baixa/média/alta com ajuste de resolução, sombras e efeitos; otimizar o gargalo medido.
- Verificar dez reinícios/trocas de modo e liberação de recursos; desempenho não deve degradar progressivamente.

Arquivos: `css/style.css`, `index.html`, `src/MenuUI.js`, `src/Game.js`, `src/Level.js`, `src/Effects.js`, conforme a medição. Ao editar geometria, seguir a skill de level design indicada em `CLAUDE.md`.

Aceite: textos e botões legíveis em tela pequena; arte corresponde ao jogo; controles respondem durante pintura/efeitos; registrar resultados por aparelho. Validar atualização da versão instalada/PWA sem mistura de módulos antigos.

## 5. Jogar com amigos e revanche

Esta etapa adiciona funcionalidades; não bloqueia a entrega das correções anteriores.

- Substituir a sala única por gerenciamento de salas: criar, entrar por código e encerrar salas vazias; manter uma entrada rápida pública. **Implementado:** `server/index.js` separa salas por código, o cliente envia o código escolhido e salas vazias são limpas periodicamente.
- Vincular identidade de reconexão à sala correta e limitar capacidade/configuração por sala.
- Estados explícitos: aguardando → preparados → contagem → partida → resultado → revanche.
- Exibir participantes, papel e regras; adicionar pronto e cancelar pronto antes do início.
- Alternar Caçador entre participantes elegíveis; não deixar o primeiro conectado ocupar sempre o papel.
- Revanche exige preparação dos participantes conectados, novo identificador de rodada e reinício coordenado de posição, pintura, água, scanner, eliminação e cronômetro.
- Definir saída e ausência: preservar vaga durante a janela de reconexão e informar quando alguém sair definitivamente.

Arquivos: `server/index.js`, `server/room.js`, `src/Net.js`, `src/net/protocol.js`, `src/Game.js`, `src/MenuUI.js`, `index.html`, `css/style.css`.

Aceite: duas salas não trocam jogadores/eventos; sala cheia responde claramente; reconexão retorna à sala correta; revanche começa simultaneamente; jogador despreparado não é colocado em partida por um clique alheio; papel alterna corretamente; salas sem participantes liberam recursos.

## 6. Balanceamento e progressão

- Testar primeiro o mapa compacto; observar tempo até primeiro encontro e períodos sem decisões.
- Registrar: início/fim de rodada, papel, mapa, regras, primeira camuflagem, tiros/acertos, motivo de término, desconexões, tutorial concluído e revanche. Começar com registros locais de playtest, sem coletar identificação pessoal desnecessária.
- Fazer sessões com 5–10 iniciantes e pelo menos 20 partidas exploratórias alternando papéis. Amostra inicial para encontrar problemas, não prova estatística de equilíbrio.
- Medir vitória por papel considerando quantidade de jogadores, mapa e experiência; evitar comparar modos e tamanhos de sala como se fossem iguais.
- Se houver espera excessiva, testar uma mudança por vez: investigação da última posição, bônus opcional por mudar de esconderijo ou objetivo secundário. Preservar a recompensa de um bom disfarce.
- Ajustar tempo, água e scanner com base nos registros; depois definir progressão por desempenho e recompensas cosméticas.

Aceite: relatório de playtest com dados, problemas observados e decisão de manter/reverter cada experimento. Novos mapas e sistemas de progressão só entram após o ciclo principal estar validado.

## Processo de implementação e conclusão

1. Reconfirmar estado local e divergência remota antes da implementação; preservar alterações de outras sessões.
2. Implementar uma entrega pequena com os testes relevantes ao comportamento alterado. A suíte atual é a base, não substitui os novos cenários de gameplay e online.
3. Rodar testes do servidor e checagem de sintaxe quando houver código alterado; verificar interface e gameplay no navegador e online em múltiplas sessões.
4. Para regras puras, testar o módulo real. Para renderização/colisão, usar integração real; não criar uma réplica de Three.js em mocks permanentes.
5. Atualizar versões de imports/cache conforme a convenção do projeto; revisar documentos e comentários afetados, índice e log.
6. Publicar somente após verificar a entrega e registrar o que foi validado, limitações e como reverter. A criação deste plano não executa implantação nem migração.

Primeiro marco: C01 e C02 concluídos — partida padrão vencível e interface correspondente ao papel. Próximo marco: C03 e C04 — partida online consistente, sem reposição indevida de água ou ressurreição no meio da rodada.
