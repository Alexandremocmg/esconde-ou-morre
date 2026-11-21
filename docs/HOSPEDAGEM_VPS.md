# Hospedagem na VPS

**Verificado em 2026-11-21.** Além da produção original (cliente na Vercel e servidor no Render, veja `docs/PLANO_MULTIPLAYER.md`, seção "Hospedagem"), o jogo roda numa VPS da Hostinger, com cliente **e** servidor, em **https://esconde.kabemmanager.online**. As duas hospedagens são independentes. Este documento descreve só o que é específico do Esconde ou Morre. A infraestrutura compartilhada (usuário `jogos`, nginx, rotas do Traefik, firewall) e os passos para desfazer tudo estão no [runbook da VPS](https://github.com/Alexandremocmg/kabemjunto/blob/main/docs/OPERACAO-VPS.md#6-outros-jogos-hospedados-nesta-vps).

> Não registre neste repositório o IP da VPS, o link do terminal web da Hostinger, tokens ou senhas.

## Onde roda

| Item                | Valor                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endereço            | `https://esconde.kabemmanager.online` (HTTPS pelo Traefik, certificado Let's Encrypt renovado sozinho)                                                   |
| Código              | `/srv/jogos/esconde-ou-morre`, clone da branch `main`, de propriedade do usuário `jogos`                                                                |
| Cliente             | arquivos estáticos servidos pelo nginx dos jogos (`jogos-static.service`), escutando só em `172.18.0.1:8081`. Sem build: a raiz do repositório           |
| Servidor do Online  | `esconde-ou-morre-server.service`: `node index.js` em `server/`, `User=jogos`, `PORT=8787`, `MemoryMax=300M`, `Restart=always`                          |
| Rotas do Traefik    | `/etc/easypanel/traefik/config/jogos-esconde.yaml`: o host vai para o nginx; o caminho `/ws` (prioridade maior) vai para o servidor na porta 8787          |
| Firewall            | a 8787 é bloqueada para fora (aceita só `127.0.0.0/8` e `172.16.0.0/12` em IPv4, e `::1` em IPv6); só o Traefik chega nela                              |
| DNS                 | registro `A` `esconde` em `kabemmanager.online`, no hPanel da Hostinger                                                                                 |

## Como o cliente acha o servidor

`resolveWsUrl()` (`src/Net.js`) escolhe, nesta ordem: `?ws=` explícito na URL; o próprio host na porta 8787 (localhost e LAN); **`wss://<host>/ws`** quando a página é servida por `*.kabemmanager.online`; e, em qualquer outro domínio, `PROD_WS_URL` (o servidor do Render). Por isso a Vercel segue falando com o Render e a VPS fala com o próprio servidor, sem configuração por ambiente. Há testes em `server/test/wsurl.test.mjs`.

## O que o servidor da VPS faz

- **Cliente estático:** só `GET` e `HEAD` (os outros métodos recebem `403`). `html`, `js`, `mjs`, `css`, `json` e `webmanifest` saem com `no-cache` e revalidam por ETag, o que combina com o `?v=N` dos módulos. Caminhos com `/.` e também `/server`, `/node_modules`, `/scripts` e `/.claude` devolvem `404`.
- **Servidor WebSocket:** é o mesmo `server/index.js` do Render, sem alterações. As salas ficam **só em memória**.
- **Segurança:** o servidor `ws` **aceita qualquer `Origin`** (confirmado em 2026-11-21 com um `Origin` inventado) e escuta em todas as interfaces; a proteção é o firewall mais o fato de a porta não ser publicada. Quem tem o endereço consegue abrir uma conexão.

## Publicar uma nova versão

Nada atualiza sozinho: um `git push` ou o merge de um PR **não** muda o que está no ar (a Vercel atualiza o cliente dela, mas não a VPS). Como `root` no terminal da VPS:

```bash
J="runuser -u jogos -- env HOME=/srv/jogos"
$J git -C /srv/jogos/esconde-ou-morre pull --ff-only

# só se server/package-lock.json mudou:
$J npm --prefix /srv/jogos/esconde-ou-morre/server ci --omit=dev

# reinicie o servidor SOMENTE se algo em server/ ou src/net/ mudou
# (o servidor importa ../src/net/, então uma mudança lá também conta):
git -C /srv/jogos/esconde-ou-morre diff --name-only ORIG_HEAD HEAD | grep -E '^(server|src/net)/' \
  && systemctl restart esconde-ou-morre-server.service
```

- O cliente estático atualiza sozinho no navegador (ETag). Não há build.
- **Reiniciar o servidor derruba as salas em andamento**, porque o estado é só em memória. O servidor segura a vaga de quem caiu por 30 segundos (`RECONNECT_GRACE_MS`), mas isso não sobrevive a um reinício do processo. Reinicie quando ninguém estiver jogando.
- Se o `pull` falhar com `--ff-only`, há divergência local na VPS; pare e investigue, não force.

## Conferir

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://esconde.kabemmanager.online/         # 200 text/html
curl -s -o /dev/null -w "%{http_code}\n" https://esconde.kabemmanager.online/server/index.js            # 404
curl -s -o /dev/null -w "%{http_code}\n" https://esconde.kabemmanager.online/.git/config               # 404
systemctl is-active esconde-ou-morre-server.service jogos-static.service
```

O WebSocket: conecte em `wss://esconde.kabemmanager.online/ws`. O servidor responde com uma mensagem `welcome` (com `role`, `spawn`, `layout`, `token`). Num navegador, clique em **JOGAR**, escolha **Online** e confira a mensagem "Procurando jogadores" e o jogo começando. O parâmetro `?room=CODIGO` chega ao servidor: dois clientes com o mesmo código entram na mesma sala, e um terceiro sem código cai em outra.

## Voltar atrás

```bash
J="runuser -u jogos -- env HOME=/srv/jogos"
$J git -C /srv/jogos/esconde-ou-morre log --oneline -5
$J git -C /srv/jogos/esconde-ou-morre checkout --detach <sha>
systemctl restart esconde-ou-morre-server.service        # se a versão antiga mexia em server/ ou src/net/
$J git -C /srv/jogos/esconde-ou-morre switch main        # depois, volta à main
```

Para tirar o jogo da VPS por completo (rota, servidor e firewall, **nesta ordem**), veja o [runbook](https://github.com/Alexandremocmg/kabemjunto/blob/main/docs/OPERACAO-VPS.md#6-outros-jogos-hospedados-nesta-vps). A produção da Vercel e do Render continua funcionando sozinha.

## Pontos de atenção

- **Login (Supabase):** o cliente usa um projeto Supabase para conta, Ranking e Missões (`docs/PLANO_CONTAS.md`). Se o login redirecionar o jogador de volta à página, o endereço novo pode precisar ser adicionado em *Authentication > URL Configuration* no painel do Supabase. **Não foi verificado.** O jogo funciona sem login.
- **Dependências externas do navegador:** o Three.js (`unpkg.com`) e o `@supabase/supabase-js` (`esm.sh`) vêm por CDN, como em qualquer outro ambiente.
- **Origem do WebSocket aceita sem checagem:** ver "O que o servidor da VPS faz".

## O que foi verificado

Em 2026-11-21, de fora da VPS, em Chromium: o menu carregou com **0** erros de console e **0** respostas 4xx/5xx; ao escolher **Online**, o cliente abriu `wss://esconde.kabemmanager.online/ws`, recebeu `welcome`, mais de 400 `snapshot` e as entradas de jogadores, e a partida do Caçador começou. O certificado é válido até 2027-02-19; `/server/`, `/.git/` e `/node_modules/` devolvem 404; as portas 8081 e 8787 pelo IP público não respondem. **Não** foram testados celular físico, Safari, Firefox nem uma sala com vários jogadores humanos ao mesmo tempo.
