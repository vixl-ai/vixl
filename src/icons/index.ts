/**
 * Semantic icon system.
 *
 * Application code renders icons exclusively through `AppIcon` (or semantic
 * name maps resolved via `resolveIconComponent`). Direct imports from
 * `@lucide/vue`, `@tabler/icons-vue`, and `@phosphor-icons/vue` are restricted
 * to `src/icons/adapters/**` by ESLint so pack switching stays comprehensive.
 *
 * Out of scope by design: vscode-material-icons file glyphs, provider/product
 * logos, user/content artwork, and Monaco editor icons.
 */
export { default as AppIcon } from './AppIcon.vue'
export {
  APP_ICON_NAMES,
  APP_ICON_PREVIEW_GROUPS,
  type AppIconName,
  type AppIconGroup,
} from './icon-names'
export {
  DEFAULT_ICON_APPEARANCE,
  provideIconAppearance,
  setSharedIconAppearance,
  useIconAppearance,
} from './icon-appearance'
export { getIconPackAdapter, ICON_PACK_ADAPTERS, resolveIconComponent } from './resolve-icon'
