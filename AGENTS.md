# AGENTS.md

This file provides repository-specific guidance for coding agents working on Chat4o AI Plugin.

## Project overview

Chat4o AI Plugin is a Manifest V3 Chrome/Chromium extension for AI chat, product-profile management, web-form autofill, and batch submission. It uses React, TypeScript, Vite, CRXJS, Zustand, and Chrome extension APIs.

The checked-in source is the source of truth. Keep this document and `README.md` synchronized with behavior when the architecture changes.

## Toolchain and commands

Use Node.js 20+ and pnpm 10. Install dependencies from the lockfile:

```bash
pnpm install --frozen-lockfile
```

Available commands:

```bash
pnpm run dev       # Start the Vite development server
pnpm run lint      # Run ESLint
pnpm run build     # Run TypeScript project builds and create dist/
pnpm run preview   # Preview the Vite production build
pnpm run package   # Build and create releases/chat4o-ai-plugin-v<version>.zip
```

Before handing off code changes, run both:

```bash
pnpm run lint
pnpm run build
```

There is currently no automated test suite. Treat the build, lint, and targeted manual extension checks as the required validation baseline.

## Current extension architecture

### Manifest and entry points

- `manifest.json` is the Manifest V3 source consumed by CRXJS.
- `sidepanel.html` loads `src/main.tsx`, which mounts the React router and `src/App.tsx`.
- The manifest side panel path is `sidepanel.html`.
- `src/background/index.ts` is the background service worker.
- `src/content/floatingButton.ts` and `src/content/formHandler.ts` are content scripts injected on `<all_urls>` at `document_idle`.
- Assets under `public/` are copied to the build root. Reference them as `/icons/...` or `/product-assets/...`, never `/public/...`.

### Side panel and standalone window

The same `sidepanel.html` React application serves both modes:

- Chrome may show it as the configured native side-panel page.
- Toolbar clicks open it in a popup window with `mode=standalone` in the query string.
- `src/utils/standalone.ts` sends requests to the background worker to open or focus this window.
- `src/background/index.ts` owns popup discovery, positioning, deduplication, and target-tab tracking.
- `isStandaloneMode()` detects the `mode=standalone` query parameter.

Do not introduce a separate `standalone.html` entry unless the build configuration, manifest, background URL handling, and documentation are updated together.

### Routing and UI

`src/router/index.tsx` uses `createHashRouter` because extension pages must not depend on server-side history fallback. Routes are declared in `src/router/routes.tsx`:

- `/` redirects to `/chat`.
- `/chat` provides AI chat and current-page autofill.
- `/batch` provides batch discovery and submission.
- `/settings` manages API settings, product profiles, assets, field layouts, and backups.
- Unknown routes redirect to `/chat`.

`src/App.tsx` owns the shared header, route navigation, standalone-mode UI, and page-level runtime recovery. Page components live under `src/pages/`; reusable components live under `src/components/`.

### Content and background automation

- `src/content/floatingButton.ts` renders the page-level launcher.
- `src/content/formHandler.ts` discovers, diagnoses, and fills form controls in the page context.
- `src/content/imageUploadOptimizer.ts` handles upload preparation.
- `src/background/urlBasedFill.ts` coordinates URL-based extraction, AI mapping, and filling through extension messages.
- `src/utils/formAutomation.ts` coordinates current-tab fills from the React UI.
- `src/utils/batchRunner.ts` owns the batch-submission state machine, human gates, and resume behavior.
- `src/utils/submissionDiscovery.ts` ranks candidate submission pages.
- `src/utils/evaluationLogs.ts` and `src/utils/runLogs.ts` persist diagnostics and run outcomes.

Preserve cancellation and request-ID checks when changing asynchronous fill behavior. Verify both the toolbar popup flow and the floating-button flow when modifying target-tab selection or extension messaging.

### State and storage

Zustand stores are under `src/store/`:

- `chatStore.ts` persists sessions and messages.
- `settingsStore.ts` persists API configuration, product profiles, field order, hidden fields, and browser preferences.
- `chromeStorage.ts` implements Zustand's async storage adapter with `chrome.storage.local` and migrates legacy `localStorage` values when present.

Imported image assets and full backups also use `chrome.storage.local`. Do not add API keys, exported backups, user profiles, or other private runtime data to the repository. The settings page's full-backup export may contain secrets and must be treated as a private file.

### API layer

`src/services/api.ts` exposes the singleton `chatAPI` client built on `ky`. Settings hydrate its API key, base URL, default model, and temperature. It supports an OpenAI-compatible chat-completions path and model-specific Gemini handling.

Keep endpoints configurable. Never hardcode credentials or log authorization headers.

### Internationalization

i18next is initialized in `src/i18n.ts`. Translation resources live in:

- `src/locales/en.ts`
- `src/locales/zh-CN.ts`
- `src/locales/zh-TW.ts`

When changing an existing translated UI surface, update all three resources. Some newer operational UI strings are currently inline Chinese; avoid expanding that inconsistency when a translation key is practical.

### Configuration and aliases

- Shared constants live in `src/config/constants.ts`.
- Product-profile matching guidance lives in `src/config/productProfileGuidance.ts`.
- The `@/` alias maps to `src/` in both `tsconfig.app.json` and `vite.config.ts`.
- TypeScript strict mode and unused-code checks are enabled.

## ESLint policy

The project uses ESLint flat config. `eslint-plugin-react-hooks@5.2.0` exposes its flat-compatible preset as `configs['recommended-latest']`; do not change it back to `configs.flat.recommended` without upgrading and verifying the plugin API.

`@typescript-eslint/no-explicit-any` is disabled because DOM automation and Chrome message payloads cross dynamically typed boundaries throughout the existing code. Prefer `unknown`, narrow interfaces, and Chrome-provided types for new code whenever practical. React Hooks rules remain enabled and warnings should be resolved rather than suppressed without a concrete reason.

## Chrome extension development workflow

1. Run `pnpm run build`.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Choose Load unpacked and select `dist/`.
5. After source changes, rebuild and refresh the extension card.
6. Reopen the extension window or side panel; refresh target pages when content-script code changes.

Manual verification should be proportional to the change. For form automation, test a normal text field, a select/radio/checkbox control when relevant, cancellation, and a page that should not be filled. For storage changes, test a fresh profile and an existing persisted profile.

## Code conventions

- Write code comments in English. Chinese comments are allowed only when they carry critical product context that cannot be expressed clearly in English.
- Preserve strict TypeScript compilation and avoid non-null assertions unless lifecycle guarantees are explicit.
- Prefer small typed message contracts over ad hoc message shapes for new background/content communication.
- Keep hardcoded configuration in `src/config/` where possible.
- Do not edit generated `dist/` files directly; change source and rebuild.
- Do not commit `node_modules/`, `.pnpm-store/`, `dist/`, `releases/`, logs, exported backups, or user data.
- Preserve unrelated user changes in a dirty worktree.
