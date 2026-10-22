import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createChatGPT, ChatGPTError, type SessionError, type SessionState } from '@siwc/local';
import { createApiToken, startApiServer } from './api-server.js';
import { fromResponsesOutput, toResponsesInput, toResponsesTools, type ChatMessage } from './chat-translate.js';
import { createFileKeyEncryption } from './credential-encryption.js';

const APP_NAME = 'ChatGPT Local API';
const APP_ID = 'chatgpt-local-api';
const apiPort = Number(process.env.CHATGPT_API_PORT ?? 8788);
// Por padrão qualquer origem pode usar a API ('*'); CHATGPT_API_ORIGINS=a,b restringe a uma lista.
const apiOrigins = process.env.CHATGPT_API_ORIGINS
  ? process.env.CHATGPT_API_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['*'];
const dataDir = process.env.CHATGPT_API_DATA_DIR
  ? resolve(process.env.CHATGPT_API_DATA_DIR)
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_ID);

let lastSession: SessionState = { status: 'disconnected', sharing: false };
let models: Array<{ slug: string; displayName: string }> = [];
const chatRequests = new Set<AbortController>();

let pendingLoginUrl: string | undefined;

function openUrl(url: string): void {
  const [command, args]: [string, string[]] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];
  // Se não houver navegador/xdg-open (servidor, SSH), o link impresso no terminal basta.
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

function openBrowser(url: string): void {
  const target = new URL(url);
  if (target.origin !== 'https://auth.openai.com') throw new Error('Unexpected sign-in destination.');
  pendingLoginUrl = target.href;
  process.stderr.write(`Abra no navegador para entrar com o ChatGPT:\n${target.href}\n`);
  openUrl(target.href);
}

const chatgpt = createChatGPT({
  appName: APP_NAME,
  appId: APP_ID,
  redirectPort: Number(process.env.CHATGPT_API_REDIRECT_PORT ?? 8787),
  storageDir: join(dataDir, 'chatgpt'),
  credentialEncryption: createFileKeyEncryption(join(dataDir, 'credentials.key')),
  openBrowser,
});

function safeError(error: unknown): SessionError {
  if (error instanceof ChatGPTError) return error.toJSON();
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', message: 'Cancelado.', retryable: false };
  return { code: 'unexpected_error', message: 'Algo deu errado. Tente novamente.', retryable: true };
}

function snapshot() {
  return {
    session: lastSession, models: models.map((model) => model.slug),
    ...(lastSession.status === 'connecting' && pendingLoginUrl ? { loginUrl: pendingLoginUrl } : {}),
  };
}

async function refreshModels(): Promise<string[]> {
  if (lastSession.status !== 'connected' || !lastSession.sharing) { models = []; return []; }
  try { models = await chatgpt.listModels(); }
  catch { models = []; }
  return models.map((model) => model.slug);
}

type ChatOptions = { model?: unknown; tools?: unknown; reasoning?: { effort?: unknown }; session_id?: unknown };

async function chat(messages: ChatMessage[], options: ChatOptions = {}) {
  if (!models.length) await refreshModels();
  // Modelo desconhecido (ex.: nome de outro provedor): cai no primeiro disponível da conta.
  const model = models.find((candidate) => candidate.slug === options.model) ?? models[0];
  if (!model) throw new Error('Nenhum modelo disponível: faça login (POST /v1/auth/sign-in ou `chatgpt-local-api login`).');
  const controller = new AbortController();
  chatRequests.add(controller);
  try {
    const { instructions, input } = toResponsesInput(messages);
    const effort = typeof options.reasoning?.effort === 'string' ? options.reasoning.effort : undefined;
    const result = await chatgpt.streamResponse({
      model: model.slug, instructions, input, structuredInput: true, tools: toResponsesTools(options.tools),
      ...(effort ? { reasoning: { effort } } : {}),
      ...(typeof options.session_id === 'string' ? { promptCacheKey: options.session_id } : {}),
      signal: controller.signal,
    });
    return fromResponsesOutput(result, model.slug);
  } catch (error) {
    throw new Error(safeError(error).message);
  } finally {
    chatRequests.delete(controller);
  }
}

async function signIn(): Promise<unknown> {
  try { return await chatgpt.signIn(); }
  catch (error) { return { ...(await chatgpt.getSession()), error: safeError(error) }; }
}

async function disconnect(): Promise<unknown> {
  chatRequests.forEach((request) => request.abort());
  await chatgpt.disconnect();
  return chatgpt.getSession();
}

/** Token para clientes sem Origin (curl, scripts) quando CHATGPT_API_ORIGINS restringe a lista. */
function loadApiToken(): string {
  const file = join(dataDir, 'api-token');
  try { const saved = readFileSync(file, 'utf8').trim(); if (saved) return saved; } catch { /* primeira execução */ }
  const token = createApiToken();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

chatgpt.subscribe((current) => {
  const wasConnected = lastSession.status === 'connected' && lastSession.sharing;
  lastSession = current;
  if (current.status !== 'connecting') pendingLoginUrl = undefined;
  if (current.status === 'connected' && current.sharing && !wasConnected) void refreshModels();
  else if (current.status !== 'connected') models = [];
});

async function serve(): Promise<void> {
  lastSession = await chatgpt.getSession();
  await refreshModels();
  const server = await startApiServer({
    port: apiPort, token: loadApiToken(), allowedOrigins: apiOrigins,
    backend: { snapshot, signIn, disconnect, cancelSignIn: async () => { await chatgpt.cancelSignIn(); }, listModels: refreshModels, chat: (messages, options) => chat(messages, options) },
  });
  const panelUrl = `http://127.0.0.1:${apiPort}/`;
  const origins = apiOrigins.includes('*') ? 'qualquer origem' : apiOrigins.join(', ');
  process.stdout.write(`${APP_NAME} em http://127.0.0.1:${apiPort}  (OpenAI: /v1, Ollama: /api)\n`
    + `Painel: ${panelUrl}\n`
    + `Origens permitidas: ${origins} · token: ${join(dataDir, 'api-token')}\n`
    + (lastSession.status === 'connected' ? 'ChatGPT conectado.\n' : 'ChatGPT desconectado: rode `chatgpt-local-api login` ou POST /v1/auth/sign-in.\n'));
  if (process.env.CHATGPT_API_NO_OPEN !== '1' && !process.argv.includes('--no-open')) openUrl(panelUrl);
  const stop = () => {
    chatRequests.forEach((request) => request.abort());
    void chatgpt.cancelSignIn();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function login(): Promise<void> {
  const session = await signIn() as SessionState;
  if (session.status !== 'connected') throw new Error(session.error?.message ?? 'Não foi possível conectar com o ChatGPT.');
  process.stdout.write(`Conectado${session.identity?.email ? ` como ${session.identity.email}` : ''}.\n`);
}

const HELP = `${APP_NAME}

Uso: chatgpt-local-api [comando]

  serve    sobe a API local (padrão)
  login    entra com a conta ChatGPT (abre o navegador)
  logout   desconecta e apaga os tokens
  status   mostra a sessão e os modelos
  token    imprime o token Bearer da API

Opções do serve: --no-open (não abre o painel no navegador; ou CHATGPT_API_NO_OPEN=1)

Variáveis: CHATGPT_API_PORT (8788), CHATGPT_API_ORIGINS, CHATGPT_API_REDIRECT_PORT (8787), CHATGPT_API_DATA_DIR
`;

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'serve';
  if (command === 'serve') return serve();
  if (command === 'login') { await login(); return; }
  if (command === 'logout') { await disconnect(); process.stdout.write('Desconectado.\n'); return; }
  if (command === 'status') {
    lastSession = await chatgpt.getSession();
    await refreshModels();
    process.stdout.write(`${JSON.stringify(snapshot(), null, 2)}\n`);
    return;
  }
  if (command === 'token') { process.stdout.write(`${loadApiToken()}\n`); return; }
  process.stdout.write(HELP);
  if (command !== 'help' && command !== '--help' && command !== '-h') process.exitCode = 1;
}

main().then(() => {
  // Comandos pontuais não devem ficar presos a handles abertos do SDK.
  if ((process.argv[2] ?? 'serve') !== 'serve') process.exit(process.exitCode ?? 0);
}).catch((error: unknown) => {
  process.stderr.write(`${APP_NAME} falhou: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
