/** Structural OpenCode V2 plugin contracts used by the dependency-free bundle. */

export interface ToolContext {
  readonly sessionID?: string;
  readonly agent?: string;
  readonly messageID?: string;
  readonly id?: string;
  readonly signal?: AbortSignal;
  readonly progress?: (update: Record<string, unknown>) => Promise<void>;
}

export interface ToolResult {
  content: string;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  options?: { codemode: boolean; permission?: string };
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context?: ToolContext) => Promise<ToolResult>;
}

export interface ToolList {
  add: (tool: ToolDefinition) => void;
}

export interface SessionInfo {
  location?: { directory?: string };
}

export interface SyntheticInput {
  sessionID: string;
  id?: string;
  text: string;
  description?: string;
  metadata?: Record<string, unknown>;
  delivery?: 'steer' | 'queue';
  resume?: boolean;
}

export interface PermissionInput {
  sessionID: string;
  agent?: string;
  source: { type: 'tool'; messageID?: string; id?: string };
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
}

export interface StoredJob {
  key: string;
  jobId: string;
  sessionID: string;
  workspace: string;
  directory: string;
  target?: 'workspace' | 'scratch';
  host: string;
  argv: string[];
  state: string;
  supervised?: boolean;
  remoteJobId?: string;
  exitCode?: number | null;
  signal?: number | null;
  notificationID: string;
  startedAt: number;
  updatedAt?: number;
  endedAt?: number;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTail: string;
  stderrTail: string;
  error?: string;
  notified?: boolean;
}

export interface PluginContext {
  location?: { directory?: string };
  tool: { transform: (edit: (tools: ToolList) => void | Promise<void>) => Promise<void> };
  session?: {
    get: (input: { sessionID: string }) => Promise<SessionInfo>;
    synthetic?: (input: SyntheticInput) => Promise<unknown>;
  };
  permission?: { assert: (input: PermissionInput) => Promise<void> };
  storage?: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
    scan: (options: { prefix: string; limit: number; after?: string }) => Promise<{ entries: Array<{ key: string; value: unknown }>; next?: string }>;
  };
  event?: {
    subscribe: (options: { types: string[]; signal?: AbortSignal }) => AsyncIterable<{ type: string; data?: Record<string, unknown> }>;
  };
}
