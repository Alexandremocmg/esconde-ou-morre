# Contas de jogador (Supabase) — Ranking, Missões, Personalização

## 1. Por que existe

O menu principal tinha 8 itens ("Loja", "Continuar Partida", "Instalar Aplicativo",
"Ranking", "Missões", "Personalização", "Novidades", "Créditos") que só abriam um
modal genérico "Em breve" (`src/MenuUI.js`, `[data-soon]`). Fechar Ranking, Missões e
Personalização de verdade precisa de uma identidade de jogador que sobreviva entre
sessões — e isso **não existia em nenhum lugar do projeto**: o servidor Online
(`server/room.js`) é uma sala única em memória, sem banco, sem login, que zera sozinha
quando esvazia (ver `docs/PLANO_MULTIPLAYER.md`). Perguntado, o usuário escolheu conta
de verdade (backend + banco), não armazenamento só local no aparelho.

**Loja** fica "Em breve" por decisão do usuário (pagamento com dinheiro real não é algo
que o assistente processa sozinho) — pendência de negócio, não de código.

**Continuar Partida** foi deliberadamente **desacoplado** de conta — ver §6.

## 2. Por que Supabase

Resolve os dois lados de uma vez sem sair do "ES Modules puros, sem bundler" do
projeto: Auth (email+senha, sem escrever hash/sessão do zero) e Postgres (ranking,
missões, perfil), com um client que roda direto do navegador via CDN/ESM — mesmo
padrão do `three` no importmap de `index.html`:

```html
"@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
```

Projeto: **`esconde-ou-morre`** (novo, org `alexandre.14r@gmail.com's Org`, região
`sa-east-1`, plano free). Nenhum projeto Supabase existente antes deste era deste jogo.

`src/Auth.js` encapsula o client (`SUPABASE_URL`/publishable key — seguros de expor no
cliente por design, a segurança de verdade é a RLS abaixo) e as funções
`signUp/signIn/signOut/getSession/onAuthStateChange/getProfile/updateProfile`.

**Confirmação de e-mail: desligada** (reduz fricção pra um joguinho casual). Se quiser
ligar depois, é uma configuração no painel do Supabase, sem mudança de código.

## 3. Schema (migration `contas_fundacao`, projeto `nqcjlnqutujxyctkglkh`)

| Tabela | Papel | RLS |
| --- | --- | --- |
| `profiles` | `id`=`auth.users.id`, `username`, `body_kind` (Personalização, Fase D) | leitura pública (ranking mostra nome); escrita só do dono |
| `match_results` | Ranking (Fase E): `user_id`, `mode`, `won`, `camo_time_seconds`, `verified` | leitura pública; insert só do dono |
| `missions` | Missões (Fase F): conteúdo estático, `code`/`title`/`description`/`goal_count` | leitura pública; sem insert/update de cliente (só migration/service role) |
| `mission_progress` | Missões (Fase F): `user_id`+`mission_id` → `progress`/`completed_at` | leitura/escrita só do dono |

`profiles` nasce sozinho no signup via trigger `handle_new_user` (`SECURITY DEFINER`,
`EXECUTE` revogado de `anon`/`authenticated` — só roda como efeito do insert em
`auth.users`, não é chamável via RPC pelo cliente). Evita corrida entre confirmar
conta e o cliente tentar criar o profile por conta própria.

## 4. Confiabilidade dos dados (`match_results.verified`) — decisão da Fase E

A ideia original era o **servidor** gravar partidas Online (`verified=true`,
autoritativo), e só o solo ser client-reported. Na hora de implementar, perguntei —
fazer isso direito exige o servidor (`server/room.js`) saber qual conta Supabase é
cada jogador: nova dependência (`@supabase/supabase-js` no servidor), guardar a
service role key como segredo em produção (Render), e verificar o JWT de cada
jogador antes de confiar nele. Escopo real, não só UI.

**Decisão: por agora, TUDO é client-reported** — solo e Online, os dois. `verified`
sempre `false` (coluna continua existindo pra uma Fase futura server-authoritative,
se algum dia valer a pena o escopo acima). Um jogador só pode mentir sobre o
**PRÓPRIO** resultado — não dá pra creditar/incriminar a conta de outra pessoa sem
roubar a sessão dela, então o risco novo introduzido é zero além do que qualquer
stat client-reported já teria. Mesmo espírito honesto do "Débito registrado" que
`docs/PLANO_MULTIPLAYER.md` já documenta pra outras lacunas (ex.: "Movimento é
forjável na v1").

`Game.js._reportMatchResult(won)` é o único ponto que chama `reportMatchResult()` —
roda dentro de `_gameOver()`/`_win()` (os dois únicos chokepoints de fim de partida,
qualquer que seja o modo). `reportMatchResult()` (`src/Auth.js`) checa sessão
sozinho e não faz nada sem login — Game.js nunca precisa saber se o jogador está
logado.

**Bugs reais corrigidos ao implementar isto** (achados testando o hook, não coisa
que eu tava procurando):
- `Game.js:fireWaterJet` chamava `_gameOver("Vitória dos Camaleões!...")` em 2
  lugares — a mensagem dizia vitória, mas `_gameOver()` marca derrota
  (`this.won=false`) e mostra a tela de Game Over, não Vitória. Corrigido pra
  `_win(...)` nos dois — bug visível pro jogador (tela errada), não só o Ranking.
- `this.camoTime` só acumulava em Camaleão **solo** (`this.mode === 'chameleon'`) —
  Camaleão **Online** nunca acumulava nada, então o badge 🫥 no HUD ficava travado
  em 0:00 a partida inteira, e o Ranking de sobrevivência online sempre daria zero.
  Corrigido pra também acumular quando `this.mode === 'online' &amp;&amp; this.onlineRole
  === ROLE.CHAMELEON`.

## 5. Categorias do Ranking

2 abas, cada uma colapsando solo+Online pelo mesmo PAPEL (não por modo exato) —
simplificação deliberada: a melhor partida de um jogador conta, seja treino sozinho
ou jogo online de verdade.

- **Sobrevivência** (`chameleon` + `online_chameleon`): top 10 por
  `camo_time_seconds`, uma linha por partida (não agregado).
- **Caçador** (`hunter` + `online_hunter`): top 10 por número de vitórias — agregado
  no CLIENTE (Supabase JS não faz `GROUP BY` sem RPC/view), sobre até 500 partidas
  vencidas recentes. Suficiente pro volume de um joguinho casual; documentado aqui
  como limitação conhecida, não escondido.

## 6. Continuar Partida — por que NÃO usa conta

Investigado antes de desenhar: `RECONNECT_GRACE_MS` (`src/net/protocol.js`) é **30
segundos**; a sala é única, em memória, e some inteira num restart/deploy/sleep do
Render free tier (`server/room.js`, sem persistência nenhuma); uma partida inteira dura
**~60-90s** (timer `SOBREVIVA .../1:00`). Não existe cenário realista de "sair, trocar
de aparelho, voltar depois" pra uma partida que já teria terminado — ligar isso a conta
seria infraestrutura nova pra um caso de uso que praticamente não acontece.

O jogo já resolve o caso REAL (queda de wifi, app em segundo plano, reload da mesma
aba) com o mecanismo existente e automático (`src/Net.js`, `sessionStorage`, mesma
aba) — ver `docs/PLANO_MULTIPLAYER.md` §3.2. "Continuar Partida" no menu (Fase B do
Plano 2) só liga o botão a esse mecanismo já existente, sem tocar em conta/Supabase.
Se isso se mostrar insuficiente no uso real, revisitar.

## 7. "Confirm email" (resolvido)

O projeto Supabase nascia com confirmação de e-mail obrigatória por padrão — não é
algo editável por migration/SQL nem pelas ferramentas de MCP disponíveis nesta sessão
(é uma configuração de infra: Authentication → Sign In / Providers → Email → "Confirm
email"), então coube ao usuário desligar manualmente no painel. Feito e verificado em
browser (signup loga direto, sessão sobrevive a reload, sign out funciona).
`src/MenuUI.js` continua tratando o caso de conta pendente de confirmação com uma
mensagem clara (não finge sucesso), caso o toggle seja religado no futuro. Se muitas
contas forem criadas em pouco tempo, o rate limit do provedor SMTP embutido do
Supabase pode aparecer (bem baixo por padrão) — configurar SMTP próprio resolve, mas
é opcional pro volume de um joguinho.

## 8. Limitações conhecidas

- Progresso de Missões e resultado de partidas solo são **client-reported** — um
  jogador mal-intencionado pode forjar. Aceitável pra um ranking/missões casuais
  (mesmo trade-off já aceito pra "movimento" no modo Online); não é um sistema
  anti-cheat.
- Sem verificação de e-mail: uma conta pode ser criada com um e-mail que a pessoa não
  controla. Sem impacto de segurança real aqui (não há dados sensíveis nem dinheiro
  envolvido) — só afeta recuperação de senha por e-mail, se algum dia for usada.
- `body_kind` em `profiles` tem os mesmos 4 valores de `sessionStorage['eom-body']`
  (`toy`/`mannequin`/`blob`/`cube`) — Fase D decide como os dois convivem (conta
  sobrepõe sessionStorage quando logado, sessionStorage continua valendo deslogado).
