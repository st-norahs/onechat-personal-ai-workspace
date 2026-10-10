const MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';
let enginePromise;

export async function loadOfflineEngine(onProgress = () => {}) {
  if (!('gpu' in navigator)) throw new Error('This browser does not expose WebGPU. Use a recent Chrome or Edge browser on supported hardware.');
  if (!enginePromise) enginePromise = (async () => {
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    if (navigator.storage?.persist) await navigator.storage.persist();
    return CreateMLCEngine(MODEL_ID, { initProgressCallback: report => onProgress(report.text || 'Preparing the on-device model…'), logLevel:'WARN' }, { context_window_size:2048 });
  })().catch(error => { enginePromise=undefined; throw error; });
  return enginePromise;
}

export async function localReply(messages, onToken = () => {}, onProgress = () => {}) {
  const engine = await loadOfflineEngine(onProgress);
  const stream = await engine.chat.completions.create({ messages, stream:true, temperature:0.7, max_tokens:512 });
  let answer='';
  for await (const chunk of stream) { const token=chunk.choices?.[0]?.delta?.content||''; answer+=token; onToken(token); }
  return answer;
}

export function offlineModelId() { return MODEL_ID; }
