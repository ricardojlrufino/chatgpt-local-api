// Traduz o formato nativo do Ollama (`/api/chat`) para o chat OpenAI-compatible usado pelo
// backend (`chat-translate.ts` converte dali para a Responses API) e de volta.

import type { ChatMessage, ChatResult, ChatToolCall } from './chat-translate.js';

interface OllamaToolCall { function?: { name?: string; arguments?: unknown } }
interface OllamaMessage { role?: string; content?: string; images?: string[]; tool_calls?: OllamaToolCall[]; tool_name?: string }

export function fromOllamaMessages(messages: OllamaMessage[]): ChatMessage[] {
  // O Ollama liga resultado de tool só pelo nome; geramos ids e casamos na ordem das chamadas.
  const pending: Array<{ id: string; name: string }> = [];
  let counter = 0;
  return messages.flatMap((message): ChatMessage[] => {
    if (message.role === 'tool') {
      const index = Math.max(0, pending.findIndex((call) => call.name === message.tool_name));
      const call = pending.splice(index, 1)[0];
      return [{ role: 'tool', tool_call_id: call?.id ?? `call_${counter++}`, content: message.content ?? '' }];
    }
    if (message.role === 'assistant') {
      const calls: ChatToolCall[] = (message.tool_calls ?? []).flatMap((call) => {
        const name = call.function?.name;
        if (!name) return [];
        const id = `call_${counter++}`;
        pending.push({ id, name });
        const args = call.function?.arguments;
        return [{ id, function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) } }];
      });
      return [{ role: 'assistant', content: message.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) }];
    }
    const role = message.role === 'system' ? 'system' : 'user';
    if (role === 'user' && message.images?.length) {
      return [{
        role,
        content: [
          { type: 'text', text: message.content ?? '' },
          ...message.images.map((image) => ({
            type: 'image_url',
            image_url: { url: image.startsWith('data:') ? image : `data:image/png;base64,${image}` },
          })),
        ],
      }];
    }
    return [{ role, content: message.content ?? '' }];
  });
}

/** `think` do Ollama (boolean ou "low"/"medium"/"high") -> `reasoning.effort`. */
export function reasoningFromThink(think: unknown): { effort: string } | undefined {
  if (think === true) return { effort: 'medium' };
  return typeof think === 'string' && think ? { effort: think } : undefined;
}

export function toOllamaMessage(message: ChatResult['message']) {
  const toolCalls = message.tool_calls?.map((call) => {
    let args: unknown = {};
    try { args = JSON.parse(call.function.arguments); } catch { /* argumentos inválidos viram {} */ }
    return { function: { name: call.function.name, arguments: args } };
  });
  return { role: 'assistant' as const, content: message.content ?? '', ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) };
}

export function ollamaDoneReason(finishReason: string): string {
  return finishReason === 'length' ? 'length' : 'stop';
}

/** Entrada de `/api/tags`; o app não tem tamanho/digest reais, então vão valores fixos. */
export function ollamaModelEntry(slug: string) {
  return {
    name: slug, model: slug, modified_at: new Date(0).toISOString(), size: 0, digest: '',
    details: { parent_model: '', format: 'remote', family: 'chatgpt', families: ['chatgpt'], parameter_size: '', quantization_level: '' },
  };
}
