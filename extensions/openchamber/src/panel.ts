import { connectHost, HostRequestError } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

interface HostEntry {
  ssh: string;
  port?: number;
  tags?: string[];
}

interface HostsFile {
  version?: number;
  hosts: Record<string, HostEntry>;
}

interface ProjectFile {
  version?: number;
  name: string;
  hosts: string[];
  roots?: Record<string, string>;
  excludes?: string[];
  env?: Record<string, string>;
  shell?: string;
}

interface ConfigDocuments {
  projectId: string;
  hostsFile: string;
  projectFile: string;
  hosts: HostsFile;
  project: ProjectFile;
  legacy: boolean;
  revision: string;
}

const host = connectHost();
const directory = document.querySelector<HTMLParagraphElement>('#directory')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
const hostsView = document.querySelector<HTMLDivElement>('#hosts')!;
const hostsConfig = document.querySelector<HTMLTextAreaElement>('#hosts-config')!;
const projectConfig = document.querySelector<HTMLTextAreaElement>('#project-config')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;

let currentDirectory: string | null = null;
let loadVersion = 0;
let revision: string | null = null;
const drafts = new Map<string, { hosts: string; project: string }>();

function showNotice(message: string, tone: 'info' | 'warning' | 'error' | 'success' = 'info'): void {
  notice.className = tone === 'error' ? 'error' : tone === 'success' ? 'ok' : tone === 'warning' ? 'warning' : '';
  notice.textContent = message;
}

function showResult(value: unknown): void {
  result.hidden = false;
  result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function parseObject(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${what} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

async function service(path: string, body: Record<string, unknown>): Promise<unknown> {
  if (!currentDirectory) throw new Error('Open a project first.');
  const response = await host.serviceRequest({
    method: 'POST',
    path,
    body: JSON.stringify({ ...body, directory: currentDirectory }),
  });
  const parsed = JSON.parse(response.body || '{}') as { ok?: boolean; error?: { message?: string }; result?: unknown };
  if (response.status < 200 || response.status >= 300 || parsed.ok === false) {
    throw new Error(parsed.error?.message ?? `Fleet service returned HTTP ${response.status}`);
  }
  return parsed.result ?? parsed;
}

async function loadDocuments(directory: string): Promise<ConfigDocuments> {
  const response = await host.serviceRequest({
    method: 'GET',
    path: `/config?directory=${encodeURIComponent(directory)}`,
    body: '',
  });
  const parsed = JSON.parse(response.body || '{}') as { ok?: boolean; error?: { message?: string }; result?: ConfigDocuments };
  if (response.status < 200 || response.status >= 300 || parsed.ok === false || !parsed.result) {
    throw new Error(parsed.error?.message ?? `Fleet service returned HTTP ${response.status}`);
  }
  return parsed.result;
}

function parseHosts(text: string): HostsFile {
  const value = parseObject(text, 'Host registry');
  if (!value.hosts || typeof value.hosts !== 'object' || Array.isArray(value.hosts)) {
    throw new Error('Host registry needs a hosts object.');
  }
  return value as unknown as HostsFile;
}

function parseProject(text: string): ProjectFile {
  const value = parseObject(text, 'Project configuration');
  if (typeof value.name !== 'string' || !value.name || !Array.isArray(value.hosts)) {
    throw new Error('Project configuration needs a name and a hosts array.');
  }
  return value as unknown as ProjectFile;
}

function renderHosts(documents: ConfigDocuments): void {
  hostsView.replaceChildren();
  const selected = documents.project.hosts ?? [];
  if (selected.length === 0) {
    const note = document.createElement('p');
    note.textContent = 'No hosts selected for this project yet.';
    hostsView.append(note);
    return;
  }
  for (const alias of selected) {
    const entry = documents.hosts.hosts?.[alias];
    const row = document.createElement('div');
    row.className = 'host';
    const title = document.createElement('div');
    title.className = 'row';
    const name = document.createElement('strong');
    name.textContent = alias;
    const ssh = document.createElement('small');
    ssh.textContent = entry
      ? `${entry.ssh}${entry.tags && entry.tags.length > 0 ? ` · ${entry.tags.join(', ')}` : ''}`
      : 'missing from host registry';
    title.append(name, ssh);
    const actions = document.createElement('div');
    actions.className = 'row';
    actions.style.marginTop = '8px';
    if (entry) {
      for (const [label, action] of [['Status', 'status'], ['Plan', 'plan'], ['Inspect recovery', 'recovery']] as const) {
        const button = document.createElement('button');
        button.textContent = label;
        button.dataset.action = action;
        button.dataset.host = alias;
        actions.append(button);
      }
    }
    row.append(title, actions);
    hostsView.append(row);
  }
}

function fill(documents: ConfigDocuments, directory: string): void {
  const draft = drafts.get(directory);
  revision = documents.revision;
  hostsConfig.value = draft?.hosts ?? `${JSON.stringify(documents.hosts, null, 2)}\n`;
  projectConfig.value = draft?.project ?? `${JSON.stringify(documents.project, null, 2)}\n`;
  renderHosts(documents);
  const count = Object.keys(documents.hosts.hosts ?? {}).length;
  const selected = documents.project.hosts?.length ?? 0;
  const legacy = documents.legacy ? ' Legacy fleet.json detected; saving migrates it to local configuration.' : '';
  showNotice(`${count} host(s), ${selected} selected for this project.${legacy}`, 'success');
}

async function load(): Promise<void> {
  const active = currentDirectory;
  if (!active) return;
  const version = ++loadVersion;
  showNotice('Loading Fleet configuration…');
  try {
    const documents = await loadDocuments(active);
    if (currentDirectory !== active || version !== loadVersion) return;
    fill(documents, active);
  } catch (error) {
    if (currentDirectory !== active || version !== loadVersion) return;
    revision = null;
    const draft = drafts.get(active);
    hostsConfig.value = draft?.hosts ?? '';
    projectConfig.value = draft?.project ?? '';
    hostsView.replaceChildren();
    if (error instanceof HostRequestError && /not found/i.test(error.message)) {
      showNotice('No local Fleet project configuration yet. Add a host and save.', 'warning');
    } else {
      showNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  }
}

host.onReady((ready) => {
  applyHostReady(ready, document.documentElement);
  currentDirectory = ready.directory;
  directory.textContent = currentDirectory ?? 'Open a project to configure Fleet.';
  if (currentDirectory) void load();
});

host.onDirectory((value) => {
  loadVersion += 1;
  currentDirectory = value;
  directory.textContent = value ?? 'Open a project to configure Fleet.';
  result.hidden = true;
  if (value) void load();
  else {
    revision = null;
    hostsConfig.value = '';
    projectConfig.value = '';
    hostsView.replaceChildren();
  }
});

function rememberDraft(): void {
  if (currentDirectory) {
    drafts.set(currentDirectory, { hosts: hostsConfig.value, project: projectConfig.value });
  }
}

hostsConfig.addEventListener('input', rememberDraft);
projectConfig.addEventListener('input', rememberDraft);
reload.addEventListener('click', () => void load());
save.addEventListener('click', () => {
  void (async () => {
    const active = currentDirectory;
    if (!active) {
      showNotice('Open a project first.', 'error');
      return;
    }
    try {
      const hosts = parseHosts(hostsConfig.value);
      const project = parseProject(projectConfig.value);
      const saved = await service('/config', {
        hosts,
        project,
        ...(revision ? { revision } : {}),
      }) as ConfigDocuments;
      if (currentDirectory !== active) return;
      drafts.delete(active);
      fill(saved, active);
      showNotice('Local Fleet configuration saved. Nothing was written to the repository.', 'success');
    } catch (error) {
      if (currentDirectory !== active) return;
      showNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  })();
});

hostsView.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const alias = button.dataset.host;
  if (!action || !alias) return;
  button.disabled = true;
  showNotice(`${action} on ${alias}…`);
  void (async () => {
    try {
      const path = action === 'status' ? '/status' : action === 'plan' ? '/plan' : '/recovery';
      showResult(await service(path, { host: alias }));
      showNotice(`${action} completed.`, 'success');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      button.disabled = false;
    }
  })();
});
