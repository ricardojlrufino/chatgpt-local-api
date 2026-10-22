# chatgpt-local-api

API local **OpenAI-compatible** e **Ollama-compatible** que usa a sua conta ChatGPT (*Sign in with ChatGPT*). Você entra uma vez e qualquer app (web ou desktop) consome a sua assinatura por HTTP, em `127.0.0.1`.

---

# Para usuários

## Instalação

Baixe o arquivo da sua plataforma na página de **Releases** e extraia:

| Plataforma | Arquivo |
| --- | --- |
| Windows (x64) | `chatgpt-local-api-windows-x64.zip` |
| macOS (Apple Silicon / Intel) | `chatgpt-local-api-darwin-arm64.tar.gz` / `chatgpt-local-api-darwin-x64.tar.gz` |
| Linux (x64 / arm64) | `chatgpt-local-api-linux-x64.tar.gz` / `chatgpt-local-api-linux-arm64.tar.gz` |
| Qualquer sistema com Node >= 22 | `chatgpt-local-api-node.zip` |

- Os binários não precisam de Node. No Windows exigem o **Windows 10 versão 1809 ou mais novo**; em versões anteriores aparece o erro "ponto de entrada ClosePseudoConsole não encontrado". Use o pacote Node nesse caso.
- Cada release traz um `SHA256SUMS.txt` para conferir os downloads.
- No macOS/Linux, se necessário, dê permissão de execução: `chmod +x chatgpt-local-api`.

## Como usar

1. **Inicie o programa.**
   - Binário: execute `chatgpt-local-api` (duplo clique no Windows, ou `./chatgpt-local-api` no terminal).
   - Pacote Node: execute `start.bat` (Windows) ou `./start.sh` (macOS/Linux).
2. **Entre na sua conta.** O painel abre sozinho em `http://127.0.0.1:8788/`. Clique para entrar e conclua o login do ChatGPT no navegador. (Sem navegador, por exemplo via SSH, o link de login é impresso no terminal; também dá para usar `chatgpt-local-api login`, ou `login.bat` no pacote Node.)
3. **Use a API nos seus apps.** No painel você vê os modelos disponíveis, copia os endereços e testa a conexão. Configure o seu app com:

   | Campo | Valor |
   | --- | --- |
   | Base URL (OpenAI) | `http://127.0.0.1:8788/v1` |
   | Host (Ollama) | `http://127.0.0.1:8788` |
   | API key | qualquer texto (não é validada em uso local) |
   | Modelo | um dos listados no painel (ex.: `gpt-5`) |

   Teste rápido:

   ```js
   await fetch('http://127.0.0.1:8788/v1/chat/completions', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Oi' }] }),
   });
   ```

O programa precisa ficar rodando enquanto os apps o usam. Para fechar, encerre o processo (Ctrl+C no terminal).

## Comandos

```sh
chatgpt-local-api            # sobe a API (padrão, igual a "serve")
chatgpt-local-api login      # entra na conta pelo navegador
chatgpt-local-api logout     # sai da conta
chatgpt-local-api status     # mostra a sessão
chatgpt-local-api token      # mostra o token Bearer da API
```

Use `--no-open` (ou `CHATGPT_API_NO_OPEN=1`) para não abrir o painel ao subir. Também dá para entrar por `POST /v1/auth/sign-in` com a API no ar.

## Configuração

| Variável | Padrão | Função |
| --- | --- | --- |
| `CHATGPT_API_PORT` | `8788` | porta da API |
| `CHATGPT_API_ORIGINS` | qualquer origem | lista de origens permitidas, separadas por vírgula |
| `CHATGPT_API_REDIRECT_PORT` | `8787` | porta do retorno do login |
| `CHATGPT_API_DATA_DIR` | `~/.config/chatgpt-local-api` | tokens, chave e token da API |

## Rotas

| Rota | Função |
| --- | --- |
| `GET /` | painel web |
| `GET /health` | liveness (sem auth) |
| `GET /v1/status` | sessão + modelos |
| `POST /v1/auth/sign-in` | abre o login no navegador e responde ao concluir (privilegiada) |
| `POST /v1/auth/cancel` | cancela um login em andamento (privilegiada) |
| `POST /v1/auth/disconnect` | desconecta (privilegiada) |
| `GET /v1/models` | modelos da conta |
| `POST /v1/chat/completions` | chat estilo OpenAI (tools e imagens; `stream: true` devolve a resposta num único chunk SSE) |
| `GET /api/tags`, `POST /api/show`, `POST /api/chat`, `GET /api/version` | formato do Ollama (NDJSON, tools, imagens em `images`, `think`); também em um único chunk |

Não existem `pull`/`generate`/`embed`. A porta padrão difere da do Ollama (`11434`); use `CHATGPT_API_PORT=11434` se quiser que clientes o encontrem sozinhos e não houver um Ollama real na máquina.

```js
await fetch('http://127.0.0.1:8788/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Oi' }] }),
});
```

## Segurança

- Só escuta em 127.0.0.1 e valida o `Host` (contra DNS rebinding).
- Por padrão **qualquer origem** pode usar a API: qualquer site aberto no seu navegador consegue gastar a sua assinatura enquanto o processo estiver rodando. Para restringir, defina `CHATGPT_API_ORIGINS`; aí só essas origens, ou `Authorization: Bearer <token>` (`chatgpt-local-api token`), passam.
- Rotas **privilegiadas** (`sign-in`, `cancel`, `disconnect`) e os dados da conta (e-mail, link de login) só atendem a própria origem do servidor (`Sec-Fetch-Site: same-origin`) ou o token Bearer, mesmo com origens abertas. Outros sites só conseguem listar modelos e conversar; não conseguem entrar, sair nem ler o e-mail.
- Os tokens do ChatGPT ficam criptografados (AES-256-GCM) em `<dataDir>/chatgpt`, com a chave em `<dataDir>/credentials.key` (0600). Isso não é um keyring do SO: outro processo do mesmo usuário consegue ler os dois arquivos.

---

# Para desenvolvedores

## Rodando a partir do código

Requer Node >= 22.

```sh
npm i
npm run build
node dist/server.js login   # abre o navegador (retorno em localhost:8787)
node dist/server.js         # sobe a API em http://127.0.0.1:8788
```

Atalhos: `npm start` (build + servidor), `npm run login`, `npm run typecheck`, `npm test`.

## Gerando os pacotes

| Comando | Resultado |
| --- | --- |
| `npm run build:bin` | binário único (Bun) da plataforma atual em `dist/` |
| `npm run package` | binários de todas as plataformas em `dist/` (requer Bun) |
| `npm run package:node` | `dist/node/`: `server.js` + `start.bat`/`start.sh`/`login.bat` |

O workflow `release` roda ao enviar uma tag `v*`: compila, compacta, gera o `SHA256SUMS.txt`, testa os binários em cada SO e publica os arquivos.

## Atualização do SDK (siwc-local)

`vendor/siwc-local` é o pacote `packages/local` de https://github.com/openai/sign-in-with-chatgpt-devkit, compilado. O commit usado está em `vendor/siwc-local/UPSTREAM.json`.

- `npm run sync-siwc:check` diz se há versão nova (código de saída 10 quando há).
- `npm run sync-siwc` baixa o upstream, aplica `patches/siwc-local-extensions.patch`, compila e substitui `vendor/siwc-local`. Depois apague o `bun.lock`, rode `bun install`, o typecheck e `npm test`. `--ref <tag|branch|sha-completo>` usa outro ref.
- O workflow `update-siwc` faz isso toda segunda-feira e abre um **Pull Request**, que passa pelos testes e precisa de revisão. Nada é atualizado em tempo de execução nem é mesclado automaticamente (o pacote lida com os tokens do ChatGPT). Em *Settings → Actions → General*, habilite "Allow GitHub Actions to create and approve pull requests".

O upstream aceita só mensagens de texto. Este projeto também precisa de ferramentas, imagens, `reasoning` e `promptCacheKey`; essas extensões ficam no patch. Se o upstream alterar as mesmas linhas, o patch deixa de aplicar: o script para sem mexer em nada e o patch precisa ser portado à mão (edite os arquivos em `packages/local/src` de um clone do upstream e regenere com `git diff`).

## Testes

Testes: `npm test`. Para usar um checkout local já compilado do devkit: `SIWC_LOCAL_DIR=<devkit>/packages/local npm run sync-siwc`.
