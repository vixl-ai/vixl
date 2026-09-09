# Conventions

## Writing

- **No em dashes.** Do not use `—` (U+2014) in docs, comments, UI strings, toasts, commits, or PR text. Prefer commas, periods, colons, or parentheses.
- **No dot separators.** Do not use middle-dot or interpunct separators (`·`, inline ` • `, or `Foo · Bar` / `Foo • Bar` label chains). Prefer plain words, commas, or separate lines/labels.
- **No emojis.** Do not use emoji in docs, comments, UI strings, toasts, commits, PR text, or agent output. An emoji costs about 4 tokens; prefer plain text.
- **No vibe text.** No filler, throat-clearing, or AI-flavored prose ("let's dive in", "in today's fast-paced…", "robust/seamless/delightful" fluff, performative empathy, padded summaries). Be direct, concrete, and specific.

## Components

First-party Vue SFCs under `src/components/**` (outside vendored trees) are auto-imported by `unplugin-vue-components`. **Do not** write manual `import` statements for first-party components used in templates.

Vendored shadcn components under `src/components/shadcn/**` are **not** auto-imported (excluded from the plugin scan). Import them via the existing `@/components/ui` alias.

Do not mix: never both rely on auto-import and also write a manual import of the same component.

### Path-based names

Namespace components with folders; keep the **filename** as a clear, specific PascalCase name. When referring to a component conceptually (e.g. in comments or docs), build the name from folder segments plus filename, duplicate segments removed:

```text
src/components/navigation/header/AppHeader.vue  →  NavigationHeaderAppHeader
src/components/posts/card/PostCard.vue          →  PostsCardPostCard
```

Path-based conceptual names in docs may remain; runtime resolution follows the Components plugin (filename-based).

- Use **lowercase folder segments** for namespaces (`navigation/`, `posts/`, `layout/`).
- Use **PascalCase** for component files (`AppHeader.vue`, `PostCard.vue`).
- Prefer filenames that read well with their path (e.g. `AppHeader` under `navigation/header/`, not a vague `Index.vue` unless the path already disambiguates).

### Usage in templates and scripts

- **Static usage:** use the PascalCase filename tag in templates (e.g. `<AppHeader />`). First-party components resolve via auto-import; do not add a manual import for them.
- **Lazy / code-split:** use `defineAsyncComponent` when an explicit async boundary is required:

```ts
const AppHeader = defineAsyncComponent(
  () => import('@/components/navigation/header/AppHeader.vue'),
)
```

- **Dynamic `:is`:** pass a component reference directly to `:is` rather than resolving by string name. Prefer template tags for auto-imported first-party components; when a script reference is required for a non-auto-imported component (for example shadcn via `@/components/ui`), import it explicitly.
- **Suspense boundaries:** wrap async component trees in `<Suspense>` with an explicit `#fallback` when a component uses `async setup()` or top-level `await`.

### Scope and vendored UI

- These rules apply to **first-party** components (everything under `src/components/` outside generated/vendor trees).
- Do not reorganize or rename `src/components/shadcn/**` or other vendored component sets to satisfy first-party naming; follow upstream / library conventions and customize at call sites or via thin wrappers in a namespaced folder (e.g. `src/components/navigation/header/AppHeader.vue` composing shadcn primitives).

### Client-only concerns (browser APIs, widgets)

This is a client-rendered Vite SPA by default, so there is no server/client split to manage per component. For code that must only run in the browser (e.g. depends on `window`, `document`, third-party widgets):

- Guard access inside `onMounted` / lifecycle hooks rather than at module scope, so the code never runs during any build-time prerendering step.
- If the project uses `vite-plugin-ssr`, `@vitejs/plugin-vue` SSR, or similar for server rendering, treat any such code as needing an explicit client-only boundary (e.g. a wrapper component that only renders after mount): confirm the project's SSR setup before assuming plain CSR.
- Set page `<title>` / meta tags via `@vueuse/head` (or `unhead`) inside `setup()`; keep this logic in the component/page itself rather than scattering DOM manipulation across the app.

## File naming (TypeScript and modules)

- Use **kebab-case** for essentially all first-party non-Vue source filenames: `my-service.ts`, `pending-team-checkout-payload.ts`, `use-billing.ts`, `team-role.ts`.
- Applies to `src/services/**`, `src/composables`, `src/utils`, `src/router`, `src/stores`, `src/plugins`, and any `types` / `interfaces` directories (for example `src/types/teams/team-role.ts`).
- **Exceptions** where the existing layer conventions take precedence:
  - Vue single-file components (for example under `src/components`, `src/views` or `src/pages`)
- Do not add new `PascalCase.ts` or `camelCase.ts` module names outside those exceptions.

## File Layout (TypeScript and modules)

In addition to kebab-case filenames (already covered), first-party service and composable code uses nested domain folders, not flat kebab filenames that encode a path in the name.

### Good

```text
src/services/harness/write/file.ts
src/services/harness/write/plan.ts
src/services/harness/read/file.ts
src/services/harness/git/status.ts
```

### Bad

```text
src/services/harness/write-file.ts
src/services/harness/gate-tool-permission.ts
```

Nest by domain verb/object. One export per implementation file. Do one thing well; if a file needs "and", split it.

### File size

First-party TypeScript and Vue files must not exceed 300 lines (excluding blank lines and comments). Enforced by ESLint `max-lines`. Files exceeding this limit should be split by concern. Vendored shadcn components are excluded from this rule.

## Imports

- **No dynamic imports.** Use static `import` statements at the top of the file. Do not use `await import()` or dynamic `import()` expressions.
- All imports that are not covered by auto-import must be declared at the module level, before any other code.
- This applies to all first-party code: composables, services, components, utilities, and stores.
- **Exception:** Code-splitting for route-level components or heavy third-party libraries that are only needed on specific routes may use dynamic imports, but this should be rare and explicitly justified.

### Auto-import

`unplugin-auto-import` is installed and active. Vue APIs (`ref`, `computed`, `watch`, and related), `@vueuse/core` APIs, and first-party composables under `src/composables/**` are auto-imported.

- **Do not** write manual imports for auto-imported symbols. Do not both auto-import and manually import the same symbol.
- The "No dynamic `import()`" rule still applies. The plugin injects static imports at build time; that is not a dynamic import.
- Services (`@/services/**`), utils (`@/utils/**`), schemas, and types **must** still be imported explicitly.

## Vue SFC Block Order

- Vue single-file components must use `<script setup lang="ts">` for script blocks.
- When a Vue file has script logic, put `<script setup lang="ts">` first, then `<template>`, then `<style scoped>` only if needed.
- Do not use plain `<script>`, non-setup scripts, or JavaScript-only script blocks in first-party Vue files.

## Script Setup Content Order

Group `script setup` content in this order:

1. Imports (only symbols that are not auto-imported: services, utils, schemas, types, shadcn, etc.)
2. Types and interfaces
3. Generic constants or static data: `const pageName = 'test'`
4. Composables
5. Reactive state (`ref`, `reactive`, `shallowRef`) and then `computed`
   - Such as

   ```ts
   const state = reactive<{ page: number }>({ page: 1 })
   ```
6. Method constants
7. Watchers and lifecycle / event hooks

Keep each group contiguous. Do not interleave methods with computed values or watchers.

## Methods

- Declare component and composable methods as constants.
- Prefer:

```ts
const handleSubmit = async (): Promise<void> => {
  // ...
}
```

- Avoid:

```ts
async function handleSubmit(): Promise<void> {
  // ...
}
```

### Parameters

- Omit parameters that are not needed. Do not add unused arguments "for future use" or to document intent at the call site.
- Do not prefix unused parameters with `_` (for example `_reason`). If a parameter is not used in the function body, remove it from the signature and update call sites.
- If a parameter is part of the signature, use it in the implementation.

## Composables

- Name composable files in kebab-case, for example `use-example.ts`.
- Use a **default export**. With auto-import `dirs: ['src/composables/**']`, composables are resolved automatically. **Do not** manually import composables that are covered by auto-import.

```ts
// use-example.ts
export default () => {
  // ...
}
```

```ts
// consumer (no manual import)
const example = useExample()
```

- Factory-style composables also default-export from the composable file:

```ts
export default createUseWidget()
```

- Keep the composable body ordered as:
  - composables
  - state
  - computed
  - method constants
  - watchers / lifecycle hooks
  - return

## Persisted CRUD forms (client-side data fetching)

For first-party forms that **read and write persisted server state** (settings, billing, entity editors, and similar), treat data fetching as an explicit client-side concern (no build-time SSR to lean on):

- **Shared schemas:** If a change touches a form, review the existing form implementation patterns and use the shadcn Vue MCP before implementing. Define the form validation schema in `src/schemas` (or a shared package if the frontend and backend live in the same repo) when the same payload is submitted to the backend, and use that schema from both the form and the API layer.
- **Data fetching:** Use a small composable wrapping `fetch`/`axios` (or `@tanstack/vue-query` if the project already depends on it) that returns `data`, `status`/`pending`, `error`, and a `refresh` function. Call the fetch inside `onMounted` (or immediately in `setup()` if it should start before the component mounts) rather than at module scope.
- **After a successful mutation** (`POST` / `PUT` / `PATCH` / `DELETE`): reconcile the UI with the server by calling **`await refresh()`** (or the equivalent refetch) on the **same** query/composable instance that backs the read model. Local `data` should match what the user just saved; avoid leaving the form on stale client-only state.
- **Loading:** Use a dedicated `ref` (or the composable's `pending`/`isFetching` where it fits) so the flow is: set loading **`true`** → perform mutation → **`await refresh()`** so data matches the server → set loading **`false`**.
- **Control flow:** Wrap mutation + `refresh()` in **`try` / `catch` / `finally`**. Always clear loading in **`finally`** so it resets whether the mutation or refresh succeeds or throws.
- **Toasts:** On failure, always show **`toast.error()`** from `vue-sonner`. On success, show **`toast.success()`** when the user needs confirmation (save, delete, copy, etc.). Skip a success toast when navigation or the UI already makes the outcome obvious (e.g. `router.push`).

## Tables And Filtered Lists

For first-party tables, paginated lists, filters, search, and data browsing flows such as projects, users, teams, and similar:

- Use shadcn Vue table primitives and consult the shadcn Vue MCP before implementing or substantially changing a table.
- Keep component-owned table state in a single `reactive` object where practical, for example page number, query, filters, sort, and user/team scope.
- Fetch the first page in `onMounted` (or via a composable that fires immediately in `setup()`) so the table has an explicit, single entry point for its initial load instead of scattering fetch calls.
- Prefer a small `useApi`-style composable (wrapping `fetch`/`axios`) for simple endpoint-backed tables and filters; use `@tanstack/vue-query` when the project already depends on it and needs caching, retries, or request de-duplication across components.
- Drive refetching by passing computed query params and explicit `watch` sources for the state fields that should refetch.
- Prefer this pattern:

```vue
<script setup lang="ts">
// You handle component state.
const state = reactive<{
  page: number
  query: string
}>({
  page: 1,
  query: '',
})

// The composable handles fetching, loading state, and refetches.
// reactive, computed, watch, and useApi are auto-imported.
const {
  data: posts,
  status,
  error,
  refresh,
} = useApi('/api/posts', {
  query: computed(() => ({
    page: state.page,
    query: state.query,
  })),
})

watch(
  [() => state.page, () => state.query],
  () => refresh(),
)
</script>
```

- When a request should be cancellable, pass an `AbortController`/`signal` through to `fetch` (or the underlying client) so stale requests can be cancelled when params change:

```ts
const controller = new AbortController()

const { data: posts } = useApi('/api/posts', {
  query: computed(() => ({ page: state.page, query: state.query })),
  signal: controller.signal,
})
```

## Styling And shadcn

First-party UI must be built with **shadcn-vue** primitives and **Tailwind utility classes** in templates only.

- Do **not** add `<style>` blocks (scoped or unscoped) to first-party Vue components.
- Do **not** use `@apply` in first-party component code.
- Do **not** use `:deep()` or other CSS overrides to patch shadcn internals: pass supported `class` props, compose wrappers, or consult the shadcn Vue MCP for the correct primitive.
- Prefer shadcn layout patterns (for example sidebar blocks with `SidebarMenuButton`, icons beside labels, `variant="floating"`) over bespoke markup.
- Glass / translucent surfaces: use the centralized `glass-surface-sidebar`, `glass-surface-panel`, and `glass-surface-overlay` utility classes on top-level shadcn primitives (they only activate when the active theme opts the scope in). Never add ad-hoc `backdrop-blur-*` classes or hard-coded Zinc backgrounds.
- Global base styles and design tokens belong in `src/assets/css/` only (`tailwind.css`, `main.css`).
- Consult the **shadcn Vue MCP** before adding or substantially changing UI.

## Icons

App icons render through the semantic icon registry in `src/icons` so the active theme's icon pack (Lucide, Tabler, Phosphor) applies everywhere:

- Render icons with `<AppIcon>` (or `resolveIconComponent` for dynamic maps). **Never** import `@lucide/vue`, `@tabler/icons-vue`, or `@phosphor-icons/vue` directly; pack packages may only be imported inside `src/icons/adapters/**` (enforced by the `app/icon-pack-boundary` ESLint rule and a repository icon-boundary test in `spec/src/icons`).
- A new app glyph needs a new semantic name in `src/icons/icon-names.ts` mapped in **all three** adapters; do not bypass the registry with raw components or inline SVG for app chrome.
- Keep `currentColor` semantics: destructive/success/warning coloring happens at the call site, not inside the icon.
- Exclusions that stay outside the pack system: `vscode-material-icons` file-type glyphs, provider/server/product logos, user- or content-supplied artwork, and Monaco editor internals. Use the specialized components for those.
- Bundle budget: adapters import mapped glyphs only, so tree shaking keeps unmapped icons out. Measured at this feature's introduction: ~498 kB raw / ~105 KiB gzip added to the initial main chunk for the three adapters plus the appearance gallery/editor runtime (vs the pre-adapter baseline), and ~4 kB raw CSS for glass utilities. Accepted budget for the icon/appearance system: **≤ 600 kB raw / ≤ 150 KiB gzip added to the initial main chunk**. When adding glyphs, keep adapters explicit named imports and re-measure `vite build` output if the delta grows toward the budget.

## Appearance themes

Theme data is strictly data-only and schema-bounded. When extending the theme model (new token, canvas, glass, or icon fields), extend in one pass: the runtime schema (`src/schemas/appearance/theme.ts`), the shareable file schema (`src/schemas/appearance/theme-file.ts`), the canonical serializer and summary (`src/services/appearance/theme-file-utils.ts`), the v1 migration (`src/services/appearance/theme-migration.ts`), the editor/preview surfaces, and `docs/guide/appearance.md`. Never accept raw CSS, URLs, SVG, images, or font sources from theme files, and never bypass the shared canvas/glass serializers (`src/utils/appearance/appearance-css.ts`) with duplicate gradient logic in previews or editors.

## Scope

These conventions apply to first-party app code. Do not rewrite vendored-style `shadcn` internals just to force this structure.

## Generated And Vendored Code

- Do not edit generated or vendored-style components directly.
- Prefer customizing behavior at the call site or through first-party wrapper components.
- Use upstream docs, MCP references, or local examples before changing how generated-style primitives are used.

## User Feedback, Loading, And Errors

- For user-triggered async actions, use explicit loading state that makes the UI look intentional while work is in progress.
- **Never use the `void` operator in TypeScript** (e.g. `void saveSettings()`). It discards the promise and gives the user no feedback when something fails. `void` is allowed only as a **type** (`Promise<void>`, `: void`, `() => void`). Always `await` inside `try` / `catch` (and `finally` when loading state must be cleared), or attach an explicit `.catch(...)` that toasts, recovers, or re-throws.
- Wrap async mutations and user actions in **`try` / `catch`**. Add **`finally`** only when needed: typically to reset loading state so buttons and controls recover whether the action succeeds or throws.
- **On failure:** always notify with **`toast.error()`** from `vue-sonner`, or surface the error in chat / agent UI. Include a brief title and, when available, the error message in the `description` field.
- **On success:** show **`toast.success()`** when the user needs confirmation the action completed (save, delete, copy, test connection, etc.). Skip a success toast when the outcome is already obvious from the UI: for example `router.push` to another page, closing a dialog, or inline state that updates immediately.
- Keep toast messages short, specific, and user-facing.

## Error Handling

- **No `void` operator.** Do not use `void` to silence floating-promise lint warnings or fire-and-forget async work. Handle the promise with `await` in `try` / `catch`, or `.catch(...)` that notifies the user, recovers, or re-throws.
- **No empty catch blocks under any circumstances.** Every `catch` must notify the user with `toast.error()`, recover with real handling logic, or re-throw. Never leave a `catch` empty, comment-only, or filled with `console.log` / `console.error` as a substitute for user feedback.
- **Use `finally` only when needed.** Prefer `try` / `catch` alone when there is no loading flag or other cleanup. Use `try` / `catch` / `finally` when a `ref` (or similar) must be cleared whether the action succeeds or throws.
- **Example: mutation with loading and success toast:**
  ```ts
  const saving = ref(false)

  const handleSave = async (): Promise<void> => {
    saving.value = true
    try {
      await saveSettings()
      await refresh()
      toast.success('Settings saved')
    } catch (error) {
      toast.error('Failed to save settings', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      saving.value = false
    }
  }
  ```
- **Example: navigation without success toast:**
  ```ts
  const handleOpenSettings = async (): Promise<void> => {
    try {
      await router.push({ name: 'settings' })
    } catch (error) {
      toast.error('Navigation failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
  ```
- For non-critical errors (e.g., optional features, background tasks), still notify with `toast.error()` rather than silently swallowing the exception.

## Logging

- **No `console.log` (or `console.warn`, `console.error`, `console.debug`, etc.) in first-party app code under any circumstances.** Do not add client-side logging for debugging, error handling, or any other reason. Remove any `console.*` calls before finishing a task; do not leave them behind "temporarily."
- Logging belongs on the backend/API only, where logs can use a scoped server logger and avoid leaking browser/user details.
- Do not prefix log messages with service names such as `[service-name]`.
- If the backend has a logger utility, create a scoped logger per file with `logger.withTag('name')` and use that tagged logger for all logs in the file.
- Keep log messages focused on the event itself, not the file name.

## Types And Interfaces

- Types and interfaces that are reused across files **must** live in dedicated `src/types/` or `src/interfaces/` directories, nested by domain (e.g. `src/types/harness/permission.ts`).
- A Vue SFC or composable may keep a local `type State = { ... }` or computed helper type that is never imported elsewhere. The moment a second file imports it, move it under `src/types` or `src/interfaces`.
- Do not use `any` types. Use precise types, existing inferred types, generics, `unknown` with narrowing, or small local interfaces instead.
- Use:
  - `src/types` and `src/interfaces`
  - A shared package/directory (e.g. `shared/types`) if the frontend and backend live in the same repo and share contracts
- Keep local inline typing minimal. It is fine to use small local param or return annotations for one-off helpers.
- Types and interfaces directories also use barrels (`index.ts`) when they group siblings.
- Do not export types from service implementation files.
- Do not declare `interface` or `type` aliases in API client files, route handlers, or worker files. Put request bodies, job shapes, and other contracts in the appropriate `types` or `interfaces` directories.

## API Input Validation

- Validate every input crossing an API boundary at runtime before using it, on whichever side owns that boundary. Do not use TypeScript generics as a substitute for validation.
- Define reusable request/response schemas (e.g. with `zod`) in `src/schemas` (or a shared package) when the shape is part of an API contract or shared between the Vue app and its backend.
- For one-off, purely local validation, a small local schema is acceptable, but prefer shared schemas for forms, API contracts, and anything reused across the app.
- When adding or touching forms, the frontend and backend must use the same shared schema wherever practical.

## Exports

- Files should export one thing only.
- The only exception is a barrel file such as `index.ts`.
- Services should not bundle multiple methods in a single implementation file.
- For service modules, put each method in its own file and re-export from a barrel.

## Barrels

Domain folders that group sibling implementation files require an `index.ts` barrel (TypeScript) or `mod.rs` (Rust) that re-exports those siblings. Implementation files stay single-export; barrels only re-export.

### Good

```text
src/services/harness/write/file.ts
src/services/harness/write/plan.ts
src/services/harness/write/index.ts
```

### Bad

```text
src/services/harness/write-file.ts
src/services/harness/write/file.ts  (missing write/index.ts)
```

Assemblers and consumers import from the folder barrel (`@/services/harness/write`), not deep paths to every leaf, unless a deep import is justified.

Example barrel:

```ts
// src/services/harness/write/index.ts
export { default as writeFile } from './file'
export { default as writePlan } from './plan'
```

## Service/API Client File Structure

- Service and API client filenames must use kebab-case, for example `my-service.ts`. The same kebab-case rule applies to `types` and `interfaces` module filenames (see **File naming (TypeScript and modules)** and **File Layout** above).
- Use directories for namespacing related files, for example `src/services/pusher/credits/team-channel.ts`. Prefer nested domain folders over flat kebab names that encode a path (see **File Layout**).
- Client modules such as S3 or Pusher clients should default export the configured client instance from a dedicated file rather than exporting getter helpers.

## Rust / Tauri

- Rust domain folders use `mod.rs` (or a thin parent module file) as the barrel, re-exporting public items from sibling modules.
- Prefer one primary item per file where practical (one command fn, one struct, one pure helper module).
- Stable `#[tauri::command]` names and payloads must not change during refactoring.

## Environment / config (`import.meta.env`)

- Access Vite env variables via `import.meta.env` **once at module scope** in any file that needs config, immediately after imports. Destructure what you need from that result, and pass values into functions as needed. Do not read `import.meta.env` inside nested helpers, utilities, or deep call chains.
- Only variables prefixed `VITE_` are exposed to client code by Vite; keep secrets out of the client bundle and behind the backend/API instead.
- Resolve config at the top of `<script setup>` or at the start of a composable / store factory (before other setup logic), not inside nested functions or callbacks.
