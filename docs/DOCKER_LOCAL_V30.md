# Docker local — ERP Manuela Metais v30

Objetivo: todos os desenvolvedores usam a mesma versão de Node/Java e o mesmo fluxo LOCAL, sem substituir Vercel/Firebase de HML/PROD.

## Primeira execução

```powershell
Copy-Item .env.erp.local.example .env.erp.local
# edite somente valores locais/demo se necessário
docker compose up --build
```

Acesse:

- ERP: http://localhost:3000
- Firebase Emulator UI: http://127.0.0.1:4000
- RTDB Emulator: 127.0.0.1:9000
- Auth Emulator: 127.0.0.1:9099
- Storage Emulator: 127.0.0.1:9199

O volume `erp_emulator_data` mantém o export/import do Emulator entre recriações normais do container. Para apagar somente a massa LOCAL deliberadamente:

```powershell
docker compose down
docker volume rm manuela-erp-dev_erp_emulator_data
```

Não execute essa limpeza em HML/PROD.

## Vercel CLI

O ERP continua usando `vercel dev` localmente porque `/api/*` deve reproduzir as Functions usadas em HML/PROD. Se uma máquina nova exigir vínculo/autenticação da Vercel, faça o vínculo local da equipe sem colocar token no repositório. `VERCEL_TOKEN` pode ser fornecido ao Compose pelo ambiente do desenvolvedor quando necessário.

## Comandos úteis

```powershell
docker compose up --build
docker compose logs -f erp
docker compose exec erp npm test
docker compose exec erp npm run build
docker compose down
```

## Regra de arquitetura

Docker padroniza o ambiente de desenvolvimento. Não muda a interface, os cálculos ou o modelo de dados do legado. Firebase Auth/RTDB/Storage e Vercel continuam sendo a infraestrutura da aplicação.
