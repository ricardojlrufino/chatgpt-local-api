import test from 'node:test';
import assert from 'node:assert/strict';
import { toResponsesInput, toResponsesTools, fromResponsesOutput } from '../src/chat-translate.ts';

test('mensagens, imagens e tool calls viram itens da Responses API', () => {
  const { instructions, input } = toResponsesInput([
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: 'oi' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'get_chain_state', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
  ]);
  assert.equal(instructions, 'sys');
  assert.deepEqual(input[0].content, [{ type: 'input_text', text: 'oi' }, { type: 'input_image', image_url: 'data:image/png;base64,AA' }]);
  assert.deepEqual(input[1], { type: 'function_call', call_id: 'c1', name: 'get_chain_state', arguments: '{}' });
  assert.deepEqual(input[2], { type: 'function_call_output', call_id: 'c1', output: 'ok' });
});

test('áudio é recusado', () => {
  assert.throws(() => toResponsesInput([{ role: 'user', content: [{ type: 'input_audio' }] }]), /áudio/);
});

test('tools e saída', () => {
  assert.deepEqual(toResponsesTools([{ type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'object' } } }]),
    [{ type: 'function', name: 'x', description: 'd', parameters: { type: 'object' } }]);
  const r = fromResponsesOutput({ text: '', output: [{ type: 'function_call', call_id: 'c9', name: 'x', arguments: '{"a":1}' }], usage: { inputTokens: 3, outputTokens: 4 } }, 'm');
  assert.equal(r.finish_reason, 'tool_calls');
  assert.equal(r.message.tool_calls[0].id, 'c9');
  assert.deepEqual(r.usage, { promptTokens: 3, completionTokens: 4 });
});
