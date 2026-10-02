# Matriz de variáveis — v30

| Variável | Browser pode receber? | LOCAL | HML Preview | PROD |
|---|---:|---|---|---|
| `APP_ENV` | sim | `local` | `homolog` | `production` |
| `USE_FIREBASE_EMULATORS` | sim | `true` | `false` | `false` |
| `FIREBASE_PROJECT_ID` | sim | demo | HML | PROD |
| `FIREBASE_API_KEY` | sim | demo | Web config HML | Web config PROD |
| `FIREBASE_AUTH_DOMAIN` | sim | demo | HML | PROD |
| `FIREBASE_DATABASE_URL` | sim | demo | HML | PROD |
| `FIREBASE_STORAGE_BUCKET` | sim | demo | HML | PROD |
| `FIREBASE_MESSAGING_SENDER_ID` | sim | demo | HML | PROD |
| `FIREBASE_APP_ID` | sim | demo | HML | PROD |
| `FIREBASE_SERVICE_ACCOUNT_B64` | **NÃO** | não necessário no Emulator | segredo Vercel | segredo Vercel |
| `LOGIN_RATE_LIMIT_SECRET` | **NÃO** | segredo local | segredo Vercel | segredo Vercel |
| `LOCAL_DEV_PASSWORD_BASE` | **NÃO** | somente local | proibido/desnecessário | proibido/desnecessário |

## Observações

- Configuração Web do Firebase não concede acesso sozinha; acesso é controlado por Authentication + Security Rules.
- Service account é credencial privilegiada e nunca deve entrar no frontend.
- HML e PROD devem usar projetos Firebase diferentes.
- Vercel Preview recebe somente HML; Vercel Production recebe somente PROD.
