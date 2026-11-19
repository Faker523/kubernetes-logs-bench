import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  MessageSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiChatMessage,
  AiDiagnosisReport,
  AiEntryExplainPayload,
  SanitizedLogContext,
} from '../types/ai';
import {
  diagnoseLogsWithAi,
  streamChatWithAi,
  streamExplainEntryWithAi,
} from '../utils/aiClient';
import { copyTextToClipboard } from '../utils/clipboard';
import { formatContextPreview } from '../utils/logRedactor';

interface AiAssistantPanelProps {
  viewKey: string;
  context: SanitizedLogContext;
  hasLogs: boolean;
  autoDiagnoseSeq: number;
  explainRequest: { seq: number; payload: AiEntryExplainPayload } | null;
  onJumpToLine: (lineNumber: number) => void;
  onClose: () => void;
}

function renderInlineMarkdown(
  text: string,
  onJumpToLine: (lineNumber: number) => void
): React.ReactNode[] {
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*|#(\d{1,6})\b)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={keyIdx++}
          className="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 font-mono text-[11px] text-sky-700 dark:text-sky-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={keyIdx++} className="font-semibold text-slate-900 dark:text-slate-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (match[2]) {
      const lineNum = Number(match[2]);
      if (lineNum > 0) {
        nodes.push(
          <button
            key={keyIdx++}
            type="button"
            onClick={() => onJumpToLine(lineNum)}
            title={`跳转定位到第 ${lineNum} 行日志`}
            className="font-mono text-[11px] text-sky-600 dark:text-sky-400 hover:underline mx-0.5 tabular-nums"
          >
            #{lineNum}
          </button>
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function MarkdownMessage({
  content,
  onJumpToLine,
  onCopyCode,
  copiedCodeKey,
  msgId,
}: {
  content: string;
  onJumpToLine: (lineNumber: number) => void;
  onCopyCode: (key: string, code: string) => void;
  copiedCodeKey: string | null;
  msgId: string;
}) {
  const blocks = useMemo(() => {
    const parts: Array<{ type: 'code' | 'text'; lang?: string; body: string }> = [];
    const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(content)) !== null) {
      if (m.index > last) {
        parts.push({ type: 'text', body: content.slice(last, m.index) });
      }
      parts.push({ type: 'code', lang: m[1] || 'sh', body: m[2].replace(/\n$/, '') });
      last = m.index + m[0].length;
    }
    if (last < content.length) {
      parts.push({ type: 'text', body: content.slice(last) });
    }
    return parts;
  }, [content]);

  return (
    <div className="space-y-2.5 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
      {blocks.map((block, bIdx) => {
        if (block.type === 'code') {
          const codeKey = `${msgId}-code-${bIdx}`;
          const isCopied = copiedCodeKey === codeKey;
          return (
            <div
              key={bIdx}
              className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] overflow-hidden"
            >
              <div className="px-2.5 py-1 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
                <span>{block.lang}</span>
                <button
                  type="button"
                  onClick={() => onCopyCode(codeKey, block.body)}
                  className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{isCopied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <pre className="p-2.5 overflow-x-auto font-mono text-[11.5px] text-slate-800 dark:text-slate-200 whitespace-pre">
                {block.body}
              </pre>
            </div>
          );
        }

        const lines = block.body.split(/\r?\n/);
        return (
          <div key={bIdx} className="space-y-1">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lIdx} className="h-1" />;

              const hMatch = trimmed.match(/^#{1,4}\s+(.*)$/);
              if (hMatch) {
                return (
                  <div key={lIdx} className="font-semibold text-slate-900 dark:text-slate-100 pt-1">
                    {renderInlineMarkdown(hMatch[1], onJumpToLine)}
                  </div>
                );
              }

              const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
              if (ulMatch) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-1">
                    <span className="text-slate-400 dark:text-slate-500 select-none">•</span>
                    <span className="flex-1 min-w-0">{renderInlineMarkdown(ulMatch[1], onJumpToLine)}</span>
                  </div>
                );
              }

              const olMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
              if (olMatch) {
                return (
                  <div key={lIdx} className="flex items-start gap-1.5 pl-1">
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {olMatch[1]}
                    </span>
                    <span className="flex-1 min-w-0">{renderInlineMarkdown(olMatch[2], onJumpToLine)}</span>
                  </div>
                );
              }

              return (
                <p key={lIdx} className="break-words">
                  {renderInlineMarkdown(line, onJumpToLine)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function AiAssistantPanel({
  viewKey,
  context,
  hasLogs,
  autoDiagnoseSeq,
  explainRequest,
  onJumpToLine,
  onClose,
}: AiAssistantPanelProps) {
  const [activeTab, setActiveTab] = useState<'diagnose' | 'chat'>('diagnose');
  const [showRedactionPreview, setShowRedactionPreview] = useState(false);

  // Diagnosis state
  const [report, setReport] = useState<AiDiagnosisReport | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);
  const diagnoseAbortRef = useRef<AbortController | null>(null);

  // Chat & Single-entry explain state
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreamingChat, setIsStreamingChat] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const handledAutoDiagnoseRef = useRef(0);
  const handledExplainSeqRef = useRef(0);
  const prevViewKeyRef = useRef(viewKey);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      diagnoseAbortRef.current?.abort();
      chatAbortRef.current?.abort();
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // Reset AI state when switching target Pod / cluster / mode
  useEffect(() => {
    if (prevViewKeyRef.current === viewKey) return;
    prevViewKeyRef.current = viewKey;
    diagnoseAbortRef.current?.abort();
    chatAbortRef.current?.abort();
    setReport(null);
    setDiagnoseError(null);
    setIsDiagnosing(false);
    setMessages([]);
    setIsStreamingChat(false);
    setShowRedactionPreview(false);
  }, [viewKey]);

  // Auto-scroll chat to bottom during streaming
  useEffect(() => {
    if (activeTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, activeTab]);

  const handleCopy = async (key: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopiedKey(key);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedKey(null);
      copyTimerRef.current = null;
    }, 1500);
  };

  const runDiagnosis = async () => {
    if (!hasLogs) return;
    diagnoseAbortRef.current?.abort();
    const controller = new AbortController();
    diagnoseAbortRef.current = controller;

    setActiveTab('diagnose');
    setIsDiagnosing(true);
    setDiagnoseError(null);

    try {
      const nextReport = await diagnoseLogsWithAi(context, controller.signal);
      if (!controller.signal.aborted) {
        setReport(nextReport);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        setDiagnoseError(err instanceof Error ? err.message : 'AI 根因诊断失败');
      }
    } finally {
      if (diagnoseAbortRef.current === controller) {
        setIsDiagnosing(false);
      }
    }
  };

  // Trigger diagnosis automatically when user clicks "AI 分析异常" in the red alert banner
  useEffect(() => {
    if (autoDiagnoseSeq > 0 && autoDiagnoseSeq !== handledAutoDiagnoseRef.current) {
      handledAutoDiagnoseRef.current = autoDiagnoseSeq;
      runDiagnosis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDiagnoseSeq]);

  const runExplainEntry = async (payload: AiEntryExplainPayload) => {
    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    setActiveTab('chat');
    setIsStreamingChat(true);

    const userMsgId = `u-exp-${Date.now()}`;
    const assistantMsgId = `a-exp-${Date.now() + 1}`;
    const snippet = payload.entry.message.slice(0, 110);

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: `解读第 #${payload.entry.lineNumber} 行日志${payload.entry.stackTrace ? '与异常堆栈' : ''}：${snippet}${payload.entry.message.length > 110 ? '…' : ''}`,
        timestampMs: Date.now(),
        entryLineNumber: payload.entry.lineNumber,
      },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestampMs: Date.now(),
        isStreaming: true,
        entryLineNumber: payload.entry.lineNumber,
      },
    ]);

    try {
      await streamExplainEntryWithAi(payload, {
        signal: controller.signal,
        onChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m))
          );
        },
      });
      if (!controller.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m))
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, isStreaming: false, content: m.content || '已停止生成。' }
              : m
          )
        );
        return;
      }
      const errMsg = err instanceof Error ? err.message : '单条日志解读失败';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, isStreaming: false, error: errMsg } : m
        )
      );
    } finally {
      if (chatAbortRef.current === controller) {
        setIsStreamingChat(false);
      }
    }
  };

  // Trigger single-entry explanation when user clicks "AI 解读此行" in LogDetailDrawer
  useEffect(() => {
    if (explainRequest && explainRequest.seq !== handledExplainSeqRef.current) {
      handledExplainSeqRef.current = explainRequest.seq;
      runExplainEntry(explainRequest.payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explainRequest]);

  const sendChatMessage = async (textOverride?: string) => {
    const content = (textOverride ?? chatInput).trim();
    if (!content || isStreamingChat || !hasLogs) return;

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    if (!textOverride) setChatInput('');
    setActiveTab('chat');
    setIsStreamingChat(true);

    const userMsg: AiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      timestampMs: Date.now(),
    };
    const assistantMsgId = `a-${Date.now() + 1}`;
    const historyPayload = [
      ...messages
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content },
    ];

    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestampMs: Date.now(),
        isStreaming: true,
      },
    ]);

    try {
      await streamChatWithAi(context, historyPayload, {
        signal: controller.signal,
        onChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m))
          );
        },
      });
      if (!controller.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m))
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, isStreaming: false, content: m.content || '已停止生成。' }
              : m
          )
        );
        return;
      }
      const errMsg = err instanceof Error ? err.message : 'AI 对话请求失败';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, isStreaming: false, error: errMsg } : m
        )
      );
    } finally {
      if (chatAbortRef.current === controller) {
        setIsStreamingChat(false);
      }
    }
  };

  const stopGeneration = () => {
    chatAbortRef.current?.abort();
    setIsStreamingChat(false);
  };

  const quickPrompts = useMemo(() => {
    if (context.stats.errorCount > 0 || context.stats.alertHitCount > 0) {
      return [
        '按时间线梳理当前所有 ERROR 与异常的触发顺序',
        '这些报错最可能影响哪些上下游接口或业务？',
        '给出立即可执行的临时止血方案与回滚检查项',
        '生成用于验证集群节点和 Pod 资源的 kubectl 命令',
      ];
    }
    return [
      '总结当前容器日志的整体运行状态与潜在隐患',
      '排查日志中是否存在慢请求、重试或超时苗头',
      '给出该服务日常巡检与告警关键字配置建议',
    ];
  }, [context.stats.errorCount, context.stats.alertHitCount]);

  const previewText = useMemo(
    () => (showRedactionPreview ? formatContextPreview(context) : ''),
    [showRedactionPreview, context]
  );

  const severityMeta = report
    ? report.severity === 'critical'
      ? {
          label: '严重故障',
          textClass: 'text-red-600 dark:text-red-400',
          boxClass: 'border-red-200 dark:border-red-900/60 bg-red-500/[0.06]',
          Icon: AlertTriangle,
        }
      : report.severity === 'warning'
        ? {
            label: '存在异常风险',
            textClass: 'text-amber-600 dark:text-amber-400',
            boxClass: 'border-amber-200 dark:border-amber-900/60 bg-amber-500/[0.06]',
            Icon: AlertTriangle,
          }
        : {
            label: '运行基本平稳',
            textClass: 'text-emerald-600 dark:text-emerald-400',
            boxClass: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-500/[0.06]',
            Icon: CheckCircle2,
          }
    : null;

  return (
    <aside
      aria-label="AI 排障助手面板"
      className="w-[440px] xl:w-[480px] shrink-0 border-l border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F141F] flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 space-y-2.5 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              AI 日志排障助手
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
              <span>{context.target.pod}</span>
              <span className="mx-1.5 text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
              <span className="tabular-nums">精选 {context.excerpts.length} 行上下文</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 AI 助手面板"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Segmented Control */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-slate-100 dark:bg-slate-800/70">
            <button
              type="button"
              onClick={() => setActiveTab('diagnose')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                activeTab === 'diagnose'
                  ? 'bg-white dark:bg-[#1B2333] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>根因诊断</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                activeTab === 'chat'
                  ? 'bg-white dark:bg-[#1B2333] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              <span>上下文问答{messages.length > 0 ? ` (${messages.length})` : ''}</span>
            </button>
          </div>

          {activeTab === 'diagnose' && report && !isDiagnosing && (
            <button
              type="button"
              onClick={runDiagnosis}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重新诊断</span>
            </button>
          )}

          {activeTab === 'chat' && messages.length > 0 && !isStreamingChat && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 whitespace-nowrap"
            >
              <Trash2 className="w-3 h-3" />
              <span>清空对话</span>
            </button>
          )}
        </div>

        {/* Privacy Redaction Transparency Bar */}
        <div className="pt-0.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate font-mono tabular-nums">
                {context.redaction.total > 0
                  ? `发送前已自动脱敏 ${context.redaction.total} 处敏感项`
                  : '已开启 Token / 密钥 / IP 自动脱敏'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowRedactionPreview((v) => !v)}
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline shrink-0 whitespace-nowrap"
            >
              {showRedactionPreview ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span>{showRedactionPreview ? '收起预览' : '预览脱敏内容'}</span>
            </button>
          </div>

          {showRedactionPreview && (
            <pre className="max-h-40 overflow-auto log-scrollbar p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] font-mono text-[10.5px] leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all">
              {previewText}
            </pre>
          )}
        </div>
      </div>

      {/* Tab 1: Structured Root Cause Diagnosis */}
      {activeTab === 'diagnose' && (
        <div className="flex-1 overflow-y-auto log-scrollbar p-4 space-y-5">
          {!hasLogs ? (
            <div className="py-12 text-center space-y-2">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                当前视口暂无可分析的日志
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                请先从左侧选择 Pod 容器或导入日志文件后再发起 AI 诊断。
              </p>
            </div>
          ) : isDiagnosing ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <span className="font-medium">正在结合脱敏堆栈与高频模式分析根因...</span>
                <button
                  type="button"
                  onClick={() => {
                    diagnoseAbortRef.current?.abort();
                    setIsDiagnosing(false);
                  }}
                  className="text-[11px] text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                >
                  取消
                </button>
              </div>
              <div className="space-y-2.5">
                <div className="h-16 rounded-md bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
                <div className="h-24 rounded-md bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
                <div className="h-20 rounded-md bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
              </div>
            </div>
          ) : diagnoseError ? (
            <div className="space-y-3">
              <div className="p-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-500/[0.06] text-xs text-red-700 dark:text-red-300 space-y-1">
                <div className="font-semibold">诊断请求未完成</div>
                <p className="font-mono text-[11px] leading-relaxed break-words">{diagnoseError}</p>
              </div>
              <button
                type="button"
                onClick={runDiagnosis}
                className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重新诊断</span>
              </button>
            </div>
          ) : !report ? (
            <div className="py-6 space-y-4">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  一键异常根因诊断与命令建议
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  自动提取当前日志中的高频模式模板、ERROR 报错与异常堆栈，在脱敏 IP/Token/密钥后交由大模型输出根因依据、关键行号定位及可执行的 kubectl 排查命令。
                </p>
              </div>

              <dl className="grid grid-cols-3 gap-2 py-2.5 border-y border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums">
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">ERROR 行</dt>
                  <dd className="mt-0.5 font-semibold text-red-600 dark:text-red-400">{context.stats.errorCount}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">WARN 行</dt>
                  <dd className="mt-0.5 font-semibold text-amber-600 dark:text-amber-400">{context.stats.warnCount}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">提取模式</dt>
                  <dd className="mt-0.5 font-semibold text-slate-800 dark:text-slate-200">{context.topPatterns.length}</dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={runDiagnosis}
                className="w-full h-9 px-4 inline-flex items-center justify-center gap-2 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>开始根因诊断</span>
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Summary */}
              {severityMeta && (
                <div className={`p-3 rounded-md border space-y-1.5 ${severityMeta.boxClass}`}>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${severityMeta.textClass}`}>
                    <severityMeta.Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{severityMeta.label}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                    {report.summary}
                  </p>
                </div>
              )}

              {/* Root Causes */}
              {report.rootCauses.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    疑似根因 ({report.rootCauses.length})
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
                    {report.rootCauses.map((rc, idx) => {
                      const confLabel =
                        rc.confidence === 'high'
                          ? '高置信度'
                          : rc.confidence === 'medium'
                            ? '中置信度'
                            : '低置信度';
                      const confClass =
                        rc.confidence === 'high'
                          ? 'text-red-600 dark:text-red-400'
                          : rc.confidence === 'medium'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400';

                      return (
                        <div key={idx} className="py-3 space-y-1.5">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {idx + 1}. {rc.title}
                            </span>
                            <span className={`font-mono text-[11px] shrink-0 ${confClass}`}>
                              {confLabel}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            {rc.evidence}
                          </p>
                          {rc.relatedLineNumbers.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              <span>定位行号:</span>
                              {rc.relatedLineNumbers.map((lineNum) => (
                                <button
                                  key={lineNum}
                                  type="button"
                                  onClick={() => onJumpToLine(lineNum)}
                                  className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400 hover:underline tabular-nums"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>#{lineNum}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Suggested kubectl / Ops Commands */}
              {report.suggestedCommands.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <Terminal className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    <span>推荐排查命令</span>
                  </div>
                  <div className="space-y-2.5">
                    {report.suggestedCommands.map((item, idx) => {
                      const key = `cmd-${idx}`;
                      const isCopied = copiedKey === key;
                      return (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] overflow-hidden"
                        >
                          <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-600 dark:text-slate-300 truncate">
                              {item.description}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(key, item.command)}
                              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 shrink-0 whitespace-nowrap"
                            >
                              {isCopied ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>{isCopied ? '已复制' : '复制命令'}</span>
                            </button>
                          </div>
                          <pre className="px-3 py-2 font-mono text-[11.5px] text-sky-700 dark:text-sky-300 overflow-x-auto whitespace-pre">
                            {item.command}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Remediation Steps */}
              {report.nextSteps.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    修复与止血建议
                  </div>
                  <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    {report.nextSteps.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2 leading-relaxed">
                        <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500 tabular-nums shrink-0 pt-0.5">
                          {idx + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Handoff to Multi-turn Q&A */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('chat')}
                  className="w-full h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>基于当前日志继续追问</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Multi-turn Contextual Q&A & Single-Entry Explanation */}
      {activeTab === 'chat' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto log-scrollbar p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="space-y-4 py-2">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    结合当前日志上下文追问
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    直接提问或点击下方快捷问题；也可以在左侧点开任意日志行的详情面板，点击「AI 解读此行」解析单条报错与堆栈。
                  </p>
                </div>

                {hasLogs && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">快捷提问</div>
                    <div className="space-y-1.5">
                      {quickPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => sendChatMessage(prompt)}
                          className="w-full text-left px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#131926] hover:border-sky-500/50 hover:text-sky-700 dark:hover:text-sky-300 text-xs text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {msg.role === 'user' ? '你' : 'AI 排障助手'}
                    </span>
                    {msg.entryLineNumber && (
                      <button
                        type="button"
                        onClick={() => onJumpToLine(msg.entryLineNumber!)}
                        className="font-mono text-sky-600 dark:text-sky-400 hover:underline tabular-nums"
                      >
                        定位 #{msg.entryLineNumber}
                      </button>
                    )}
                  </div>

                  {msg.role === 'user' ? (
                    <div className="px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800/70 text-xs text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                  ) : msg.error ? (
                    <div className="p-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-500/[0.06] text-xs font-mono text-red-700 dark:text-red-300 break-words">
                      {msg.error}
                    </div>
                  ) : (
                    <div className="px-3 py-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17]">
                      {msg.content ? (
                        <MarkdownMessage
                          content={msg.content}
                          onJumpToLine={onJumpToLine}
                          onCopyCode={handleCopy}
                          copiedCodeKey={copiedKey}
                          msgId={msg.id}
                        />
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                          正在思考与分析日志...
                        </span>
                      )}
                      {msg.isStreaming && msg.content && (
                        <span className="inline-block w-1.5 h-3.5 ml-1 align-middle bg-sky-500 animate-pulse" />
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendChatMessage();
            }}
            className="p-3 border-t border-slate-200 dark:border-slate-800/90 bg-slate-50/70 dark:bg-[#0D121C] space-y-2 shrink-0"
          >
            <textarea
              rows={2}
              value={chatInput}
              disabled={!hasLogs || isStreamingChat}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder={
                hasLogs
                  ? '输入排障问题（Enter 发送，Shift+Enter 换行）...'
                  : '请先加载 Pod 日志后再开始问答'
              }
              className="w-full resize-none rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                自动携带脱敏后的日志摘要与行号
              </span>
              {isStreamingChat ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-900/70 bg-red-500/10 text-red-700 dark:text-red-300 text-xs font-medium hover:bg-red-500/20 whitespace-nowrap"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>停止生成</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!hasLogs || !chatInput.trim()}
                  className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  <Send className="w-3 h-3" />
                  <span>发送</span>
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
