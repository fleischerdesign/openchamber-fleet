import { connectHost, HostRequestError } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

interface FleetConfig {
  name: string;
  hosts: Record<string, { ssh: string; port?: number; root?: string }>;
  excludes?: string[];
}

const host = connectHost();
const directory = document.querySelector<HTMLParagraphElement>('#directory')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
const hosts = document.querySelector<HTMLDivElement>('#hosts')!;
const config = document.querySelector<HTMLTextAreaElement>('#config')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;

let currentDirectory: string | null = null;
let loadVersion = 0;
const drafts = new Map<string, string>();

function showNotice(message: string, tone: 'info' | 'error' | 'success' = 'info'): void {
  notice.className = tone === 'error' ? 'error' : tone === 'success' ? 'ok' : '';
  notice.textContent = message;
}

function showResult(value: unknown): void {
  result.hidden = false;
  result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
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

function parseConfig(text: string): FleetConfig {
  const value = JSON.parse(text) as Partial<FleetConfig>;
  if (!value || typeof value.name !== 'string' || !value.name || !value.hosts || typeof value.hosts !== 'object') {
    throw new Error('fleet.json needs a non-empty name and a hosts object.');
  }
  return value as FleetConfig;
}

function renderHosts(value: FleetConfig): void {
  hosts.replaceChildren();
  for (const [alias, entry] of Object.entries(value.hosts)) {
    const row = document.createElement('div');
    row.className = 'host';
    const title = document.createElement('div');
    title.className = 'row';
    const name = document.createElement('strong');
    name.textContent = alias;
    const ssh = document.createElement('small');
    ssh.textContent = entry.ssh;
    title.append(name, ssh);
    const actions = document.createElement('div');
    actions.className = 'row';
    actions.style.marginTop = '8px';
    for (const [label, action] of [['Status', 'status'], ['Plan', 'plan'], ['Inspect recovery', 'recovery']] as const) {
      const button = document.createElement('button');
      button.textContent = label;
      button.dataset.action = action;
      button.dataset.host = alias;
      actions.append(button);
    }
    row.append(title, actions);
    hosts.append(row);
  }
}

async function load(): Promise<void> {
  const directory = currentDirectory;
  if (!directory) return;
  const version = ++loadVersion;
  showNotice('Loading Fleet configuration…');
  try {
    const response = await host.readFile('fleet.json');
    if (currentDirectory !== directory || version !== loadVersion) return;
    const draft = drafts.get(directory);
    config.value = draft ?? response.content;
    const value = parseConfig(config.value);
    renderHosts(value);
    showNotice(`${Object.keys(value.hosts).length} configured host(s).`, 'success');
  } catch (error) {
    if (currentDirectory !== directory || version !== loadVersion) return;
    const draft = drafts.get(directory);
    config.value = draft ?? '';
    hosts.replaceChildren();
    if (error instanceof HostRequestError && /not found/i.test(error.message)) {
      showNotice('No fleet.json in this project. Create one below or run fleet init.');
    } else {
      showNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  }
}

host.onReady((ready) => {
  applyHostReady(ready, document.documentElement);
  currentDirectory = ready.directory;
  directory.textContent = currentDirectory ?? 'Open a project to load its fleet.json.';
  if (currentDirectory) void load();
});

host.onDirectory((value) => {
  loadVersion += 1;
  currentDirectory = value;
  directory.textContent = value ?? 'Open a project to load its fleet.json.';
  result.hidden = true;
  if (value) void load();
  else {
    config.value = '';
    hosts.replaceChildren();
  }
});

config.addEventListener('input', () => {
  if (currentDirectory) drafts.set(currentDirectory, config.value);
});
reload.addEventListener('click', () => void load());
save.addEventListener('click', () => {
  void (async () => {
    const directory = currentDirectory;
    if (!directory) {
      showNotice('Open a project first.', 'error');
      return;
    }
    try {
      const value = parseConfig(config.value);
      await host.writeFile('fleet.json', `${JSON.stringify(value, null, 2)}\n`);
      if (currentDirectory !== directory) return;
      drafts.delete(directory);
      renderHosts(value);
      showNotice('fleet.json saved.', 'success');
    } catch (error) {
      if (currentDirectory !== directory) return;
      showNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  })();
});

hosts.addEventListener('click', (event) => {
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
