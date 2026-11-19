import type {
  AiDiagnosisReport,
  AiEntryExplainPayload,
  SanitizedLogContext,
} from '../types/ai';

async function safeReadJson<T extends { error?: string }>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: `服务端返回非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`,
    } as T;
  }
}

export async function diagnoseLogsWithAi(
  context: SanitizedLogContext,
  signal?: AbortSignal
): Promise<AiDiagnosisReport> {
  const res = await fetch('/api/ai/diagnose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
    signal,
  });

  const data = await safeReadJson<{ report?: AiDiagnosisReport; error?: string }>(res);
  if (!res.ok || !data.report) {
    throw new Error(data.error || `AI 根因诊断请求失败 (HTTP ${res.status})`);
  }
  return data.report;
}

async function consumeSseStream(
  res: Response,
  onChunk: (text: string) => void
): Promise<void> {
  if (!res.ok) {
    const errData = await safeReadJson<{ error?: string }>(res);
    throw new Error(errData.error || `AI 流式请求失败 (HTTP ${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('浏览器未收到流式响应体');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const processEventBlock = (rawEvent: string) => {
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());

    for (const payload of dataLines) {
      if (!payload || payload === '[DONE]') continue;
      let parsed: { text?: string; error?: string };
      try {
        parsed = JSON.parse(payload) as { text?: string; error?: string };
      } catch {
        continue;
      }
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (parsed.text) {
        onChunk(parsed.text);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';

    for (const rawEvent of events) {
      processEventBlock(rawEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processEventBlock(buffer);
  }
}

export async function streamExplainEntryWithAi(
  payload: AiEntryExplainPayload,
  opts: {
    onChunk: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const res = await fetch('/api/ai/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
    signal: opts.signal,
  });
  await consumeSseStream(res, opts.onChunk);
}

export async function streamChatWithAi(
  context: SanitizedLogContext,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  opts: {
    onChunk: (text: string) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
    signal: opts.signal,
  });
  await consumeSseStream(res, opts.onChunk);
}
