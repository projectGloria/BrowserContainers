# Repository Guidelines

## Project Structure & Module Organization

Gloria Containers is a Manifest V3 Chromium extension using TypeScript, React, Vite, and CRXJS.

- `src/background/` contains the service worker, tab bindings, groups, and context menus; `isolation/` implements cookie jars and declarative network rules.
- `src/content/relay.iife.ts` bridges page cookie access to the background worker.
- `src/popup/` and `src/options/` contain React interfaces and HTML entry points.
- `src/shared/` holds storage, messages, types, and image processing; `src/ui/` holds reusable components, icons, and CSS.
- `src/manifest.ts` defines extension permissions and entry points. Tests live beside source files. Generated extension files go in ignored `dist/`; uploaded icon assets are stored in IndexedDB.

## Build, Test, and Development Commands

- `npm ci`: install from `package-lock.json`.
- `npm run dev`: start the Vite development server with CRXJS.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm test`: run the Vitest suite once.
- `npm run build`: typecheck and produce the extension in `dist/`.

For browser validation, build, open `chrome://extensions`, enable Developer mode, and load unpacked `dist/`.

## Coding Style & Naming Conventions

Use two-space indentation, single-quoted TypeScript strings, semicolons, and trailing commas in multiline structures. Use PascalCase for React components and component filenames, camelCase for functions, local bindings, and utility modules, and UPPER_SNAKE_CASE for configuration constants. Use explicit type imports. Keep strict TypeScript checks enabled. No formatter or linter is configured.

## Testing Guidelines

Vitest runs in Node and discovers `src/**/*.test.ts`. Use colocated tests with `describe` and behavior-focused `it` names. Existing suites cover cookie-rule compilation and icon geometry; no coverage threshold is configured. Add regression tests for changed isolation rules or image calculations.

Run `npm test` and `npm run build` before submitting code. For browser-facing changes, follow the README manual checklist: separate accounts, default-tab cookies, inherited tabs, icon previews, and container deletion. For isolation changes, verify that logins persist in the target Chromium build.

## Commit & Pull Request Guidelines

No commit convention is established yet. Use imperative subjects, such as `Fix inherited tab rule cleanup`. Pull requests should explain behavior changes, link relevant issues, report automated and manual checks, and include screenshots for UI changes.

## Isolation Constraints

Only cookies are isolated; other origin storage remains shared. Preserve tab-scoped rules. Chromium serializes `installCookieShim`; never reference imports or outer-scope helpers inside it. Preserve the serialization safeguards in `vite.config.ts` (`target: 'esnext'`, `minify: false`). Document changed isolation guarantees or browser assumptions in `README.md`.
