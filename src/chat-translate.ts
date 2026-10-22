// Traduz o formato de chat OpenAI-compatible usado pelo webapp (`src/ai/aiChat.ts`) para a
// Responses API do ChatGPT e de volta. Roda no processo principal; o webapp só vê o formato antigo.

export interface ChatToolCall { id: string; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}
export interface ChatResult {
  message: { role: 'assistant'; content: string | null; tool_calls?: Array<ChatToolCall & { type: 'function' }> };
  finish_reason: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part && typeof part === 'object' && (part as { type?: string }).type === 'text'
    ? String((part as { text?: unknown }).text ?? '') : '')).join('\n');
}

function userParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ type: 'input_text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'input_text', text: '' }];
  return content.map((part) => {
    const block = part as { type?: string; text?: string; image_url?: { url?: string } };
    if (block.type === 'text') return { type: 'input_text', text: block.text ?? '' };
    if (block.type === 'image_url' && block.image_url?.url) return { type: 'input_image', image_url: block.image_url.url };
    throw new Error('O ChatGPT só aceita texto e imagens neste app (áudio não é suportado).');
  });
}

export function toResponsesInput(messages: ChatMessage[]): { instructions: string; input: Array<Record<string, unknown>> } {
  const instructions: string[] = [];
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') {
      instructions.push(textOf(message.content));
    } else if (message.role === 'user') {
      input.push({ role: 'user', content: userParts(message.content) });
    } else if (message.role === 'assistant') {
      const text = textOf(message.content);
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      for (const call of message.tool_calls ?? []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    } else if (message.role === 'tool' && message.tool_call_id) {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: textOf(message.content) || String(message.content ?? '') });
    }
  }
  return { instructions: instructions.filter(Boolean).join('\n\n') || 'You are a helpful assistant.', input };
}

/** `{type:'function', function:{name,description,parameters}}` (chat) -> `{type:'function', name, ...}` (Responses). */
export function toResponsesTools(tools: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    const fn = (tool as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
    return fn?.name ? [{ type: 'function', name: fn.name, description: fn.description ?? '', parameters: fn.parameters ?? { type: 'object', properties: {} } }] : [];
  });
}

export function fromResponsesOutput(
  result: { text: string; output: Array<Record<string, unknown>>; usage?: { inputTokens?: number; outputTokens?: number } },
  model: string,
): ChatResult {
  const toolCalls = result.output.flatMap((item) => item.type === 'function_call' && typeof item.name === 'string'
    ? [{ id: String(item.call_id ?? item.id), type: 'function' as const, function: { name: item.name, arguments: String(item.arguments ?? '{}') } }]
    : []);
  return {
    message: { role: 'assistant', content: result.text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
    finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    model,
    ...(result.usage ? { usage: { promptTokens: result.usage.inputTokens, completionTokens: result.usage.outputTokens } } : {}),
  };
}
