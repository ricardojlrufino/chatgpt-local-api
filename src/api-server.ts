import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ChatMessage, ChatResult } from './chat-translate.js';
import { PANEL_HTML } from './panel.js';
import { fromOllamaMessages, ollamaDoneReason, ollamaModelEntry, reasoningFromThink, toOllamaMessage } from './ollama-translate.js';

// API HTTP local (OpenAI-compatible) que expõe a conta ChatGPT logada para apps web.
// Escuta só em 127.0.0.1. Quem chama precisa de uma Origin permitida (navegador) ou do token
// Bearer (curl/scripts); o header Host é validado contra DNS rebinding.
// O painel (`GET /`) e as rotas de controle (login, logout, cancelar) são "privilegiados": só a
// própria origem do servidor (ou o token Bearer) pode usá-los, mesmo com origens abertas ('*').

export interface ApiBackend {
  snapshot(): { session: { status?: string; sharing?: boolean; identity?: unknown }; models: string[]; loginUrl?: string };
  signIn(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  cancelSignIn(): Promise<void>;
  listModels(): Promise<string[]>;
  chat(messages: ChatMessage[], options: Record<string, unknown>): Promise<ChatResult>;
}

export interface ApiServerOptions {
  port: number;
  token: string;
  allowedOrigins: string[];
  backend: ApiBackend;
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function createApiToken(): string {
  return randomBytes(32).toString('base64url');
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'error') { super(message); }
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new HttpError(413, 'Corpo da requisição grande demais.', 'payload_too_large')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const parsed: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        resolve(parsed as Record<string, unknown>);
      } catch { reject(new HttpError(400, 'JSON inválido.', 'invalid_json')); }
    });
    request.on('error', reject);
  });
}

export function startApiServer({ port, token, allowedOrigins, backend }: ApiServerOptions): Promise<Server> {
  const origins = new Set(allowedOrigins);
  const anyOrigin = origins.has('*');
  const allowed = (origin: unknown): origin is string => typeof origin === 'string' && (anyOrigin || origins.has(origin));
  const ownOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  const send = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };

  async function route(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    const method = request.method ?? 'GET';
    if (method === 'GET' && path === '/health') return send(response, 200, { ok: true });
    if (method === 'GET' && path === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'",
      });
      response.end(PANEL_HTML);
      return;
    }

    const bearer = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!anyOrigin && !allowed(request.headers.origin) && !(bearer && sameToken(bearer, token))) {
      throw new HttpError(401, 'Origem não autorizada. Use uma origem permitida ou o token da API.', 'unauthorized');
    }

    // GET do mesmo site não manda `Origin`; `Sec-Fetch-Site` é um cabeçalho que páginas não conseguem forjar.
    const privileged = ownOrigins.has(request.headers.origin ?? '') || request.headers['sec-fetch-site'] === 'same-origin'
      || Boolean(bearer && sameToken(bearer, token));
    const requirePrivileged = () => {
      if (!privileged) throw new HttpError(403, `Esta ação só pode ser feita pelo painel em http://127.0.0.1:${port}/ ou com o token da API.`, 'forbidden');
    };

    if (method === 'GET' && path === '/v1/status') {
      const { session, models, loginUrl } = backend.snapshot();
      // E-mail/nome e o link de login só vão para o painel: com origens abertas, qualquer site leria isso.
      if (privileged) return send(response, 200, { session, models, ...(loginUrl ? { loginUrl } : {}) });
      return send(response, 200, { session: { status: session.status, sharing: session.sharing }, models });
    }
    if (method === 'POST' && path === '/v1/auth/sign-in') { requirePrivileged(); return send(response, 200, await backend.signIn()); }
    if (method === 'POST' && path === '/v1/auth/cancel') { requirePrivileged(); await backend.cancelSignIn(); return send(response, 200, { ok: true }); }
    if (method === 'POST' && path === '/v1/auth/disconnect') { requirePrivileged(); return send(response, 200, await backend.disconnect()); }
    if (method === 'GET' && path === '/v1/models') {
      const models = await backend.listModels();
      return send(response, 200, { object: 'list', data: models.map((id) => ({ id, object: 'model', owned_by: 'chatgpt' })) });
    }
    if (method === 'POST' && path === '/v1/chat/completions') {
      const body = await readJson(request);
      if (!Array.isArray(body.messages)) throw new HttpError(400, 'Campo "messages" é obrigatório.', 'invalid_request');
      const { stream, messages, ...options } = body;
      const result = await backend.chat(messages as ChatMessage[], options);
      const base = { id: `chatcmpl-${randomBytes(8).toString('hex')}`, created: Math.floor(Date.now() / 1000), model: result.model };
      const usage = result.usage && {
        prompt_tokens: result.usage.promptTokens ?? 0,
        completion_tokens: result.usage.completionTokens ?? 0,
        total_tokens: (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0),
      };
      if (stream === true) {
        // O backend devolve a resposta inteira; emitimos num único chunk SSE compatível com clientes OpenAI.
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const { tool_calls, content } = result.message;
        const delta = { role: 'assistant', content, ...(tool_calls ? { tool_calls: tool_calls.map((call, index) => ({ index, ...call })) } : {}) };
        response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: result.finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
        response.end('data: [DONE]\n\n');
        return;
      }
      return send(response, 200, {
        ...base, object: 'chat.completion',
        choices: [{ index: 0, message: result.message, finish_reason: result.finish_reason }],
        ...(usage ? { usage } : {}),
      });
    }
    if (method === 'GET' && path === '/api/version') return send(response, 200, { version: '0.12.0' });
    if (method === 'GET' && path === '/api/tags') {
      return send(response, 200, { models: (await backend.listModels()).map(ollamaModelEntry) });
    }
    if (method === 'POST' && path === '/api/show') {
      const body = await readJson(request);
      const name = String(body.model ?? body.name ?? '');
      const models = await backend.listModels();
      if (!models.includes(name)) throw new HttpError(404, `model '${name}' not found`, 'not_found');
      return send(response, 200, {
        modelfile: '', parameters: '', template: '', details: ollamaModelEntry(name).details,
        model_info: { 'general.architecture': 'chatgpt' }, capabilities: ['completion', 'tools', 'vision'],
      });
    }
    if (method === 'POST' && path === '/api/chat') {
      const body = await readJson(request);
      if (!Array.isArray(body.messages)) throw new HttpError(400, 'Campo "messages" é obrigatório.', 'invalid_request');
      const reasoning = reasoningFromThink(body.think);
      const result = await backend.chat(fromOllamaMessages(body.messages), {
        ...(typeof body.model === 'string' ? { model: body.model } : {}),
        ...(Array.isArray(body.tools) ? { tools: body.tools } : {}),
        ...(reasoning ? { reasoning } : {}),
      });
      const final = {
        model: result.model, created_at: new Date().toISOString(), done: true, done_reason: ollamaDoneReason(result.finish_reason),
        ...(result.usage ? { prompt_eval_count: result.usage.promptTokens ?? 0, eval_count: result.usage.completionTokens ?? 0 } : {}),
      };
      const message = toOllamaMessage(result.message);
      // Ollama faz streaming por padrão (NDJSON); o backend entrega a resposta inteira, então vai num chunk só.
      if (body.stream === false) return send(response, 200, { ...final, message });
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.write(`${JSON.stringify({ model: result.model, created_at: final.created_at, message, done: false })}\n`);
      response.end(`${JSON.stringify({ ...final, message: { role: 'assistant', content: '' } })}\n`);
      return;
    }
    throw new HttpError(404, 'Rota não encontrada.', 'not_found');
  }

  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    if (allowed(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      // Chrome exige isto quando um site público acessa localhost (Private Network Access).
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    const host = request.headers.host ?? '';
    if (!hosts.has(host)) return send(response, 403, { error: { message: 'Host inválido.', code: 'forbidden' } });
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    route(request, response, path).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const body = { error: { message: error instanceof Error ? error.message : 'Erro interno.', code: error instanceof HttpError ? error.code : 'internal_error' } };
      if (response.headersSent) { response.end(); return; }
      send(response, status, body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
