# LANCEBALL

Jogo web de leilão de jogadores e campeonato fut7. Monte uma equipe de sete atletas, escolha a tática e acompanhe partidas simuladas em uma Champions League adaptada para 4, 6 ou 8 equipes.

## Rodar localmente

Requer Node.js 26 com SQLite integrado. O projeto roda sem instalar dependências.

    node demo.mjs

Abra http://127.0.0.1:4173. O servidor cria o banco local do catálogo na primeira execução. As salas ficam em memória enquanto o servidor está ativo. Para configurar o endereço e a porta, use as variáveis de ambiente AUCTION_DEMO_HOST e AUCTION_DEMO_PORT.

## Testes

    node --test

## Créditos

O catálogo usa uma seleção dos dados de [FC 26 Player Data, de Rovnez](https://www.kaggle.com/datasets/rovnez/fc-26-fifa-26-player-data), publicado sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). As posições foram agrupadas para o fut7 e as notas foram preservadas. Cada fotografia de atleta exibe autoria, origem e licença na carta correspondente.

## Publicar na Vercel e no Supabase

O site fica estático na Vercel. A Edge Function **lanceball** valida as ações, guarda as salas no Supabase e envia avisos de mudança pelo Realtime. O navegador busca a versão autorizada do estado. Se o canal cair, a consulta periódica continua automaticamente.

1. No projeto Supabase dedicado ao LANCEBALL, execute [a migração](supabase/migrations/20261123000000_lanceball.sql). A função usa uma cópia de reserva dos 908 jogadores e tenta preencher os dados faltantes em `lanceball_players`. O script opcional `node --env-file=.env.local seed-supabase.mjs` importa a partir do catálogo usando as variáveis locais `SUPABASE_URL` e `SUPABASE_SECRET_KEY`.
2. No PowerShell, na raiz deste repositório, execute `npx supabase login` e `npx supabase functions deploy lanceball --project-ref SEU_PROJECT_ID`. A configuração da função está em [supabase/config.toml](supabase/config.toml). O servidor usa a chave de serviço que o Supabase fornece à função, e o acesso à sala é validado pelo token individual do participante.
3. Na Vercel, configure `LANCEBALL_SUPABASE_URL` e `LANCEBALL_SUPABASE_PUBLISHABLE_KEY` para Production. Use a chave pública que começa com `sb_publishable_`. O build só inclui essas credenciais públicas. A chave secreta pode ficar somente no Supabase quando o site estiver nesse modelo.
4. Envie a branch `main`. A Vercel usa `npm run build` e a pasta `dist`. Desative sobrescritas antigas de Build Command e Output Directory. Confira `/health` no site e teste uma sala nova em dois navegadores.

O servidor local continua usando SQLite. O deploy estático precisa de uma Edge Function publicada e de um projeto Supabase com as duas tabelas criadas.


## Retratos dos jogadores

O leilão exibe retratos com créditos quando uma licença aberta foi confirmada. Sem um retrato compatível, o card exibe uma silhueta. Para ampliar o catálogo, rode `python import-portraits.py CAMINHO_DO_CSV --contact SEU_CONTATO` usando o CSV de origem do FC 26. O importador cruza nomes e datas de nascimento no Wikidata e aceita apenas metadados de licenças compatíveis no Wikimedia Commons. Confira o arquivo gerado e publique novamente a função Supabase.
