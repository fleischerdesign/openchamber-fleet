/** Exclude presets by project kind, and a hint when generated output would be replicated. */

import fs from 'node:fs';
import path from 'node:path';
import type { PlanEntry } from './plan.js';

export interface Preset {
  readonly name: string;
  readonly markers: readonly string[];
  readonly excludes: readonly string[];
}

export const PRESETS: readonly Preset[] = [
  {
    name: 'node',
    markers: ['package.json'],
    excludes: ['node_modules/', 'dist/', '.next/', '.turbo/', 'coverage/', '.cache/', '.parcel-cache/'],
  },
  { name: 'rust', markers: ['Cargo.toml'], excludes: ['target/'] },
  {
    name: 'python',
    markers: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    excludes: ['.venv/', '__pycache__/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', 'dist/', 'build/', '*.egg-info/'],
  },
  { name: 'nix', markers: ['flake.nix'], excludes: ['result', 'result-*'] },
];

export const PRESET_NAMES = PRESETS.map((preset) => preset.name);

/** Detect presets by marker files in a directory. */
export function detectPresets(dir: string): string[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const present = new Set(entries);
  return PRESETS.filter((preset) => preset.markers.some((marker) => present.has(marker))).map((preset) => preset.name);
}

/** Union of preset excludes, plus the two cache directories every project type can have. */
export function excludesFor(names: readonly string[]): string[] {
  const excludes = new Set<string>(['.direnv/']);
  for (const preset of PRESETS) {
    if (!names.includes(preset.name)) continue;
    for (const pattern of preset.excludes) excludes.add(pattern);
  }
  return [...excludes];
}

const BUILD_OUTPUT = /(^|\/)(dist|build|out|target|node_modules|\.next|\.nuxt|coverage|\.venv|__pycache__|\.cache|\.turbo)(\/|$)/;

/**
 * Plan entries that look like generated output. A sync that has to ship them is usually a missing
 * exclude, so the CLI and the plugin name them instead of silently transferring gigabytes.
 */
export function buildOutputHints(entries: readonly PlanEntry[]): string[] {
  const hits = new Set<string>();
  for (const entry of entries) {
    if (entry.action === 'delete') continue;
    const match = BUILD_OUTPUT.exec(entry.path);
    if (match) hits.add(match[2] ?? entry.path.split('/')[0] ?? entry.path);
  }
  return [...hits].sort();
}
