import type { LogLevel } from './k8s';

export interface RedactionCounts {
  tokens: number;
  secrets: number;
  ips: number;
  privateKeys: number;
  emails: number;
  total: number;
}

export interface SanitizedPatternSummary {
  level: LogLevel;
  count: number;
  sharePct: number;
  template: string;
}

export interface SanitizedLogExcerpt {
  lineNumber: number;
  timeDisplay: string;
  level: LogLevel;
  pod: string;
  container: string;
  message: string;
  stackPreview?: string;
}

export interface SanitizedLogContext {
  target: {
    clusterName: string;
    mode: string;
    namespace: string;
    pod: string;
    container: string;
    previous?: boolean;
    isMultiPod: boolean;
    multiPodCount?: number;
  };
  stats: {
    totalLines: number;
    visibleLines: number;
    errorCount: number;
    warnCount: number;
    infoCount: number;
    debugCount: number;
    alertHitCount: number;
  };
  topPatterns: SanitizedPatternSummary[];
  excerpts: SanitizedLogExcerpt[];
  redaction: RedactionCounts;
}

export interface AiEntryExplainPayload {
  target: SanitizedLogContext['target'];
  entry: {
    lineNumber: number;
    timestampIso: string;
    level: LogLevel;
    namespace: string;
    pod: string;
    container: string;
    message: string;
    raw: string;
    jsonFields?: string;
    stackTrace?: string;
  };
  surroundingLines: Array<{
    lineNumber: number;
    level: LogLevel;
    timeDisplay: string;
    message: string;
  }>;
  redaction: RedactionCounts;
}

export interface AiRootCause {
  title: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  relatedLineNumbers: number[];
}

export interface AiSuggestedCommand {
  description: string;
  command: string;
}

export interface AiDiagnosisReport {
  severity: 'critical' | 'warning' | 'healthy';
  summary: string;
  rootCauses: AiRootCause[];
  suggestedCommands: AiSuggestedCommand[];
  nextSteps: string[];
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestampMs: number;
  isStreaming?: boolean;
  error?: string;
  entryLineNumber?: number;
}
