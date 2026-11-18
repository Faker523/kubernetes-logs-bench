import type { ClusterConfig, FilterState, SelectedTarget } from '../types/k8s';

const KEYS = {
  theme: 'kubelog.theme',
  sidebarOpen: 'kubelog.sidebarOpen',
  activeCluster: 'kubelog.activeCluster',
  savedClusters: 'kubelog.savedClusters',
  selectedNamespace: 'kubelog.selectedNamespace',
  selectedTarget: 'kubelog.selectedTarget',
  displayPrefs: 'kubelog.displayPrefs',
} as const;

export type DisplayPrefs = Pick<
  FilterState,
  'tailLines' | 'showTimestamp' | 'showLineNumbers' | 'wrapLines' | 'contextLines' | 'jsonPreview'
>;

function safeGetJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSetJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function loadPersistedTheme(): 'dark' | 'light' {
  try {
    const val = window.localStorage.getItem(KEYS.theme);
    return val === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function savePersistedTheme(theme: 'dark' | 'light'): void {
  try {
    window.localStorage.setItem(KEYS.theme, theme);
  } catch {
    // Ignore
  }
}

export function loadPersistedSidebarOpen(): boolean {
  const val = safeGetJson<boolean>(KEYS.sidebarOpen);
  return typeof val === 'boolean' ? val : true;
}

export function savePersistedSidebarOpen(open: boolean): void {
  safeSetJson(KEYS.sidebarOpen, open);
}

export function loadSavedClusters(): ClusterConfig[] {
  const list = safeGetJson<ClusterConfig[]>(KEYS.savedClusters);
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && c.mode === 'k8s-api' && Boolean(c.apiServer));
}

export function saveSavedClusters(clusters: ClusterConfig[]): void {
  safeSetJson(KEYS.savedClusters, clusters);
}

export function loadActiveCluster(): ClusterConfig | null {
  const c = safeGetJson<ClusterConfig>(KEYS.activeCluster);
  if (!c) return null;
  if (c.mode === 'k8s-api' && !c.apiServer) return null;
  if (c.mode === 'imported-file') return null;
  return c;
}

export function saveActiveCluster(cluster: ClusterConfig | null): void {
  if (!cluster || cluster.mode === 'imported-file') {
    safeSetJson(KEYS.activeCluster, null);
    return;
  }
  safeSetJson(KEYS.activeCluster, cluster);
}

export function loadSelectedNamespace(): string | null {
  try {
    return window.localStorage.getItem(KEYS.selectedNamespace);
  } catch {
    return null;
  }
}

export function saveSelectedNamespace(ns: string): void {
  try {
    window.localStorage.setItem(KEYS.selectedNamespace, ns);
  } catch {
    // Ignore
  }
}

interface PersistedTarget {
  clusterId: string;
  target: SelectedTarget;
}

export function loadSelectedTarget(clusterId: string): SelectedTarget | null {
  const saved = safeGetJson<PersistedTarget | SelectedTarget>(KEYS.selectedTarget);
  if (!saved || typeof saved !== 'object') return null;
  if (!('clusterId' in saved) || !('target' in saved)) {
    return null;
  }
  if (saved.clusterId !== clusterId) return null;
  const t = saved.target;
  if (!t || !t.pod || !t.namespace) return null;
  return t;
}

export function saveSelectedTarget(clusterId: string, target: SelectedTarget | null): void {
  if (!target) {
    safeSetJson(KEYS.selectedTarget, null);
    return;
  }
  safeSetJson(KEYS.selectedTarget, { clusterId, target } satisfies PersistedTarget);
}

export function loadDisplayPrefs(): Partial<DisplayPrefs> {
  return safeGetJson<Partial<DisplayPrefs>>(KEYS.displayPrefs) || {};
}

export function saveDisplayPrefs(prefs: DisplayPrefs): void {
  safeSetJson(KEYS.displayPrefs, prefs);
}
