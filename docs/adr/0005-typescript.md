# ADR-0005: TypeScript, compiled to ESM

**Status:** amended by ADR-0006 — controller stays TypeScript; the node agent is Rust

## Context

The first sketch was plain JavaScript with JSDoc types. That keeps the plugin loadable without a
build, but this project's defect surface is exactly the kind a type system catches: a manifest entry
that may or may not carry a link target, a lease that may be absent, a config value that crossed a
JSON boundary as `unknown`, a plan action union with six members.

## Decision

Write the core, CLI and plugin in **TypeScript (strict, `verbatimModuleSyntax`,
`noUncheckedIndexedAccess`)**, compile with `tsc` to ESM in `dist/`, and publish both JavaScript and
declarations. Runtime dependencies remain zero; `typescript` and `@types/node` are development
dependencies only.

The plugin ships compiled ESM rather than raw TypeScript: OpenCode runs on Bun and would accept
either, but a package that also loads under Node is worth the one build step.

## Consequences

- `npm run build` is a prerequisite for running the CLI from a checkout; published artifacts include
  `dist/`.
- Types are part of the public API: `exports` points at `dist/index.d.ts`.
- The build is `tsc` alone — no bundler, no transform, no source-map server.
- A contributor can still read the source; the compiled output is a faithful translation.

## Alternatives rejected

- **JavaScript + JSDoc:** no build, but weaker narrowing and no declaration output for consumers.
- **Raw TypeScript as the published entry:** works under Bun, fails under Node and in CI matrices
  that do not transpile dependencies.
- **Bundler (esbuild/tsup):** another tool in the chain for a package that is already a handful of
  small modules.
