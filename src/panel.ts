// Painel web servido em `GET /`. HTML único e sem dependências, embutido como string para entrar
// no bundle e nos binários. Todo texto vindo da API é inserido com `textContent`.

export const PANEL_HTML = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT Local API</title>
<style>
  :root {
    --bg: #f5f6f8; --card: #ffffff; --text: #1c1e21; --muted: #666d78; --border: #dfe2e7;
    --accent: #10a37f; --accent-text: #ffffff; --danger: #c0392b; --ok: #12805c; --warn: #9a6700; --code: #eef0f3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17181b; --card: #212327; --text: #ececf0; --muted: #9aa0aa; --border: #34373d;
      --accent: #19c37d; --accent-text: #08130f; --danger: #ff7b6e; --ok: #4cd9a3; --warn: #e3b341; --code: #2b2d33;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 12px; }
  .status { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 600; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.err { background: var(--danger); }
  .hint { color: var(--muted); margin: 6px 0 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  button { font: inherit; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); padding: 8px 14px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--muted); }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
  button.danger { color: var(--danger); }
  .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  .row label { flex: none; width: 92px; color: var(--muted); font-size: 13px; }
  code { flex: 1; min-width: 0; background: var(--code); padding: 6px 10px; border-radius: 6px; font: 13px ui-monospace, Menlo, Consolas, monospace; overflow-x: auto; white-space: nowrap; }
  .row button { padding: 5px 10px; font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { background: var(--code); border-radius: 999px; padding: 3px 10px; font-size: 13px; }
  .msg { margin-top: 12px; font-size: 14px; white-space: pre-wrap; }
  .msg.err { color: var(--danger); } .msg.ok { color: var(--ok); }
  a { color: var(--accent); }
  [hidden] { display: none !important; }
  @media (max-width: 480px) { .row { flex-wrap: wrap; } .row label { width: 100%; } }
</style>
</head>
<body>
<main>
  <h1>ChatGPT Local API</h1>
  <p class="sub">Use a sua assinatura do ChatGPT em outros programas deste computador.</p>

  <section class="card">
    <h2>Conta</h2>
    <div class="status"><span class="dot" id="dot"></span><span id="status-text">Verificando…</span></div>
    <p class="hint" id="status-hint"></p>
    <p class="hint" id="login-link-wrap" hidden>O navegador não abriu? <a id="login-link" href="#" target="_blank" rel="noopener noreferrer">Clique aqui para entrar</a>.</p>
    <div class="actions">
      <button class="primary" id="btn-login" hidden>Entrar com o ChatGPT</button>
      <button id="btn-cancel" hidden>Cancelar</button>
      <button id="btn-test" hidden>Testar conexão</button>
      <button class="danger" id="btn-logout" hidden>Sair da conta</button>
    </div>
    <p class="hint" id="close-note" hidden>Pode fechar esta página: ela só é necessária para entrar ou sair da conta. A API continua funcionando enquanto o programa estiver rodando.</p>
    <div class="msg" id="msg" role="status"></div>
  </section>

  <section class="card" id="models-card" hidden>
    <h2>Modelos disponíveis</h2>
    <div class="chips" id="models"></div>
  </section>

  <section class="card">
    <h2>Como usar em outros programas</h2>
    <p class="hint" style="margin-top:0">Aponte o programa para um destes endereços. Se ele pedir uma chave de API, escreva qualquer coisa (por exemplo, <b>local</b>).</p>
    <div class="row"><label>Estilo OpenAI</label><code id="url-openai"></code><button data-copy="url-openai">Copiar</button></div>
    <div class="row"><label>Estilo Ollama</label><code id="url-ollama"></code><button data-copy="url-ollama">Copiar</button></div>
    <p class="hint">Outros sites e programas só conseguem conversar; entrar e sair da conta só é possível por aqui.</p>
  </section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const origin = location.origin;
  $('url-openai').textContent = origin + '/v1';
  $('url-ollama').textContent = origin;

  let busy = false;
  let lastStatus = null;

  function say(text, kind) {
    const el = $('msg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  async function api(path, options) {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error((body && body.error && body.error.message) || ('Erro ' + response.status));
    return body;
  }

  function render(data) {
    lastStatus = data;
    const session = data.session || {};
    const connected = session.status === 'connected' && session.sharing !== false;
    const connecting = session.status === 'connecting';
    const reauth = session.status === 'reauth_required';
    const dot = $('dot');
    dot.className = 'dot' + (connected ? ' ok' : connecting ? ' warn' : reauth ? ' err' : '');
    const who = session.identity && (session.identity.email || session.identity.name);
    $('status-text').textContent = connected ? 'Conectado' : connecting ? 'Aguardando o login no navegador…' : reauth ? 'É preciso entrar de novo' : 'Desconectado';
    $('status-hint').textContent = connected ? (who ? 'Conta: ' + who : 'Conta do ChatGPT conectada.')
      : connecting ? 'Conclua o login na janela do navegador que abriu.'
      : 'Entre com a sua conta do ChatGPT para começar.';
    $('close-note').hidden = !connected;
    $('btn-login').hidden = connected || connecting;
    $('btn-login').textContent = reauth ? 'Entrar de novo' : 'Entrar com o ChatGPT';
    $('btn-cancel').hidden = !connecting;
    $('btn-test').hidden = !connected;
    $('btn-logout').hidden = !(connected || reauth);
    const link = $('login-link');
    $('login-link-wrap').hidden = !(connecting && data.loginUrl);
    if (connecting && data.loginUrl) link.href = data.loginUrl;
    const models = data.models || [];
    $('models-card').hidden = !(connected && models.length);
    const list = $('models');
    list.replaceChildren(...models.map((name) => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = name; return chip; }));
    for (const id of ['btn-login', 'btn-logout', 'btn-test']) $(id).disabled = busy;
  }

  async function refresh() {
    try { render(await api('/v1/status')); }
    catch (error) { $('dot').className = 'dot err'; $('status-text').textContent = 'Sem conexão com o servidor'; $('status-hint').textContent = 'Verifique se o programa continua aberto.'; }
  }

  async function run(label, action) {
    busy = true; say(label); if (lastStatus) render(lastStatus);
    try { await action(); } catch (error) { say(error.message, 'err'); }
    busy = false; await refresh();
  }

  $('btn-login').onclick = () => run('Abrindo o navegador…', async () => {
    const poll = setInterval(refresh, 1000);
    try {
      const session = await api('/v1/auth/sign-in', { method: 'POST' });
      if (session.status === 'connected') say('Conectado!', 'ok');
      else throw new Error((session.error && session.error.message) || 'Não foi possível conectar. Tente de novo.');
    } finally { clearInterval(poll); }
  });
  $('btn-cancel').onclick = () => api('/v1/auth/cancel', { method: 'POST' }).then(refresh).catch((error) => say(error.message, 'err'));
  $('btn-logout').onclick = () => run('Saindo…', async () => { await api('/v1/auth/disconnect', { method: 'POST' }); say('Você saiu da conta.', 'ok'); });
  $('btn-test').onclick = () => run('Enviando uma mensagem de teste…', async () => {
    const result = await api('/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Responda apenas: tudo certo' }] }),
    });
    const text = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    say('Funcionou. Resposta: ' + (text || '(vazia)'), 'ok');
  });
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.onclick = async () => {
      try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); button.textContent = 'Copiado'; }
      catch { button.textContent = 'Selecione e copie'; }
      setTimeout(() => { button.textContent = 'Copiar'; }, 1500);
    };
  });

  refresh();
  setInterval(() => { if (!busy && document.visibilityState === 'visible') refresh(); }, 3000);
})();
</script>
</body>
</html>
`;
