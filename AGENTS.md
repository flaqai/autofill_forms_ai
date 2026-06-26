# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Chat4o AI Plugin is a Chrome browser extension that provides an AI conversational assistant in a native side panel. It uses Chrome's official Side Panel API (Chrome 114+) for the sidebar interface.

## Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Development mode - starts Vite dev server
pnpm run dev

# Build for production - outputs to dist/
pnpm run build

# Lint code
pnpm run lint

# Preview production build
pnpm run preview
```

## Chrome Extension Development Workflow

1. Run `pnpm run build` to create the `dist/` directory
2. Load the extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist/` directory
3. After code changes, rebuild and click the refresh button in `chrome://extensions/`
4. Reopen the side panel to see changes

## Architecture

### Chrome Extension Structure

This is a Manifest V3 Chrome extension using the **Side Panel API**:

- **manifest.json**: Defines `side_panel` with `default_path: "index.html"` and requires `sidePanel` permission
- **Background Service Worker** (`src/background/index.ts`): Handles extension icon clicks and keyboard shortcuts to open the side panel via `chrome.sidePanel.open()`
- **Side Panel UI** (`index.html` → `src/main.tsx` → `src/App.tsx`): The React app that renders in Chrome's native side panel
- **Standalone Mode** (`standalone.html` → `src/standalone.tsx` → `src/App.tsx`): Full-screen version that opens in a new tab
- **No content scripts**: This extension does NOT inject content into web pages

### Standalone Mode

The extension supports opening in a full-screen tab for better experience:

- **Entry point**: `standalone.html` (separate build output)
- **Opening**: Use `openStandalonePage(from, sessionId?)` from `src/utils/standalone.ts`
- **Detection**: Use `isStandaloneMode()` to check if running in standalone mode
- **URL format**: `chrome-extension://[id]/standalone.html?from=sidebar&sessionId=[id]`
- **UI differences**:
  - Hides right sidebar navigation
  - Shows horizontal navigation in header
  - Centers content with max-width on large screens
  - Displays "Fullscreen" badge in header

### Routing

Uses **React Router** for client-side routing with **hash-based routing**:

- **Configuration-based routing**: Routes are defined in `src/router/routes.tsx` using `RouteObject[]` configuration
- **Hash router**: Uses `createHashRouter` for Chrome extension compatibility
  - Chrome extension URLs (`chrome-extension://xxx/index.html`) require hash-based routing
  - Without hash routing, the app would show errors on first load
- **Router setup**: `src/router/index.tsx` creates and exports the router instance
- **App.tsx**: Main layout component with `<Outlet />` for nested routes
- **Routes**:
  - `/` - Redirects to `/chat`
  - `/chat` - Chat interface
  - `/settings` - Settings page
- **Navigation**: Use `useNavigate()` hook for programmatic navigation and `useLocation()` for current route
- **Layout**: Fixed header + dynamic content area + sidebar (position depends on standalone mode)

### State Management

Uses **Zustand with immer middleware** for all state management:

- **`src/store/chatStore.ts`**: Main chat state (sessions, messages, loading state, view switching)
  - Manages multiple chat sessions
  - Handles message sending via `sendMessage()` action
  - Uses immer for immutable updates
- **`src/store/settingsStore.ts`**: API configuration (API key, base URL, model)
  - Uses `persist` middleware for localStorage persistence
  - Automatically updates `chatAPI` singleton when settings change

### API Layer

- **`src/services/api.ts`**: Singleton `chatAPI` instance using **ky** (not fetch)
  - Configurable API key and base URL
  - OpenAI-compatible chat completion interface
  - Automatically configured by `settingsStore`

### Component Organization

- **`src/pages/`**: Page components (HomePage, ChatPage, SettingsPage)
- **`src/components/layout/`**: Layout components (RightSidebar)
- **`src/components/chat/`**: Chat UI (MessageList, MessageBubble, ChatInput)
- **`src/components/sidebar/`**: Legacy sidebar component (deprecated, use layout/RightSidebar)
- **`src/components/tools/`**: Tool grid and cards for the home view
- **`src/components/agent/`**: Agent list and cards
- **`src/components/settings/`**: Settings panel for API configuration
- **`src/components/ui/`**: Reusable UI components (Button, Input, Card, ScrollArea) using Radix UI primitives

### Path Aliases

The project uses `@/` as an alias for `src/`:
- Configured in `tsconfig.app.json` (`"@/*": ["./src/*"]`)
- Configured in `vite.config.ts` (`alias: { '@': path.resolve(__dirname, './src') }`)

### Build System

- **Vite** with **@crxjs/vite-plugin** for Chrome extension bundling
- The plugin automatically handles manifest.json and generates proper extension structure
- TypeScript compilation happens before Vite build (`tsc -b && vite build`)

## Key Technical Decisions

1. **Side Panel API over content script injection**: Uses Chrome's native side panel for better performance and user experience
2. **Zustand over Redux**: Simpler API, less boilerplate, better TypeScript support
3. **ky over fetch**: Better error handling, automatic retries, cleaner API
4. **immer middleware**: Enables mutable-style updates while maintaining immutability
5. **Radix UI**: Accessible, unstyled primitives for building custom UI components
6. **i18next for internationalization**: Supports English, Simplified Chinese, and Traditional Chinese with automatic browser language detection
7. **React Router with hash routing**: Configuration-based routing with `createHashRouter` for Chrome extension compatibility
8. **Configuration constants**: All hardcoded values centralized in `src/config/constants.ts`
9. **No hardcoding pattern**: All functions accept parameters instead of using hardcoded values (e.g., `createSession({ title, initialMessage })` not `createSession()` with defaults)

## Internationalization (i18n)

The project uses **i18next** and **react-i18next** for multi-language support:

- **Supported languages**: English (en), Simplified Chinese (zh-CN), Traditional Chinese (zh-TW)
- **Translation files**: Located in `src/locales/` (en.ts, zh-CN.ts, zh-TW.ts)
- **Configuration**: `src/i18n.ts` handles initialization and language detection
- **Language persistence**: User's language choice is saved to localStorage
- **Auto-detection**: Automatically detects browser language on first load
- **Usage in components**: Import `useTranslation` hook from `react-i18next`

Example usage:
```typescript
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation()
  return <div>{t('common.welcome')}</div>
}
```

## Important Notes

- The extension requires Chrome 114+ for Side Panel API support
- API key and base URL are stored in localStorage via Zustand persist middleware
- The keyboard shortcut `Ctrl+Shift+Y` (Mac: `Command+Shift+Y`) opens the side panel
- Files in `public/` are served from root path (e.g., `/icons/icon.png`, not `/public/icons/icon.png`)

## Code Style Guidelines

### Comments

- **Use English comments only** - All code comments must be written in English
- Chinese comments are only allowed in exceptional cases where they provide critical context that cannot be expressed in English
- This ensures code maintainability and accessibility for international developers
- When translating existing Chinese comments, preserve the technical meaning accurately
