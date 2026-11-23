/** A plan hint: generated output that is about to be replicated usually means a missing exclude. */

import type { PlanEntry } from './plan.js';

const BUILD_OUTPUT = /(^|\/)(dist|build|out|target|node_modules|\.next|\.nuxt|coverage|\.venv|__pycache__|\.cache|\.turbo)(\/|$)/;

/**
 * Name the top-level directories in a plan that look like generated output. The tool does not
 * guess excludes: the agent or the user sees the hint and passes `excludes` on the sync call.
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
