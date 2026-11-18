export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'UNKNOWN';

export type DataSourceMode = 'sandbox' | 'k8s-api' | 'imported-file';

export interface ClusterConfig {
  id: string;
  name: string;
  mode: DataSourceMode;
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureTls?: boolean;
  gitVersion?: string;
}

export interface ContainerInfo {
  name: string;
  image: string;
  isInit?: boolean;
  ready: boolean;
  restarts: number;
  state: string;
}

export interface PodInfo {
  name: string;
  namespace: string;
  nodeName: string;
  podIP: string;
  phase: string;
  restarts: number;
  createdAt: string;
  labels: Record<string, string>;
  containers: ContainerInfo[];
}

export interface LogEntry {
  id: string;
  lineNumber: number;
  timestampIso: string;
  timestampMs: number;
  timeDisplay: string;
  level: LogLevel;
  message: string;
  raw: string;
  pod: string;
  namespace: string;
  container: string;
  nodeName?: string;
  stream?: 'stdout' | 'stderr';
  jsonPayload?: Record<string, unknown>;
  stackLines?: string[];
  traceId?: string;
}

export interface FilterState {
  search: string;
  exclude: string;
  isRegex: boolean;
  caseSensitive: boolean;
  levels: LogLevel[]; // empty means all
  tailLines: number; // 100 | 500 | 2000 | 0 (all)
  showTimestamp: boolean;
  showLineNumbers: boolean;
  wrapLines: boolean;
  contextLines: boolean;
  jsonPreview: boolean;
  fieldFilter: { key: string; value: string; negate?: boolean } | null;
  timeBucketRange: { startMs: number; endMs: number } | null;
}

export interface SelectedTarget {
  namespace: string;
  pod: string;
  container: string;
  previous: boolean;
}
