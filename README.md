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

## Vercel

Use a raiz do repositório como Root Directory, a branch de produção main e o preset Other. O arquivo vercel.json roteia a página inicial, os arquivos e a API para uma função Node.js 24. Deixe as configurações de Build Command e Output Directory sem sobrescrita.

## Supabase na Vercel

1. No SQL Editor do projeto Supabase, execute a migração em [supabase/migrations/20261123000000_lanceball.sql](supabase/migrations/20261123000000_lanceball.sql).
2. Na raiz do projeto, crie um arquivo local `.env.local` com `SUPABASE_URL` (URL do projeto) e `SUPABASE_SECRET_KEY` (chave secreta de servidor).
3. Importe o catálogo com `node --env-file=.env.local seed-supabase.mjs`. O script confirma os 908 registros.
4. Adicione as duas variáveis nas configurações de ambiente da Vercel para Production e faça um novo deploy. Guarde a chave apenas no servidor.

Com essas variáveis, a Vercel lê os jogadores no Supabase e compartilha salas, leilões, escalações e campeonatos entre instâncias. As salas expiram depois de 30 minutos sem atividade. Partidas já abertas antes da ativação continuam na versão anterior. O servidor local continua usando SQLite.
