---
title: Appearance
---

# Appearance and shareable themes

Vixl ships with a built-in appearance and a Light / Dark / System color mode. On top of that baseline, Vixl supports **named, shareable appearance themes**: versioned JSON files that customize semantic UI colors, typography, the app canvas background, glass (translucent) surfaces, icon styling, and editor/code colors.

This page documents the version 2 theme file format, bundled themes, v1 compatibility, accessibility behavior, and the boundaries of the theming system.

## Color modes

The existing color mode setting is unchanged:

| Mode | Behavior |
| --- | --- |
| `light` | Forces the light variant of the active theme |
| `dark` | Forces the dark variant of the active theme |
| `system` (default) | Follows the OS setting; light and dark variants of the active theme both matter |

Color mode and themes are independent: switching Light/Dark/System changes which **variant** of the active theme is shown, it does not change which theme is active.

## Bundled themes

Vixl bundles nine themes that are always available and never stored in your library:

1. **Vixl Default**, the unchanged neutral baseline
2. **Midnight Aurora**, indigo/cyan aurora mesh with crystal glass
3. **Nordic Frost**, cool slate/ice palette with restrained frosted panels
4. **Solar Flare**, warm amber/coral gradients
5. **Rose Quartz**, soft rose/lilac editorial palette
6. **Ocean Depths**, deep teal/blue surfaces
7. **Cyber Lime**, dark graphite with lime/violet accents
8. **Paper & Ink**, warm paper light mode and ink-like dark mode
9. **High Contrast**, strong boundaries with no transparency

Bundled themes are:

- **Immutable**: they can be previewed, exported, and used, but never edited or deleted. Use **Customize** to duplicate one into an editable personal theme.
- **Outside the library cap**: they do not consume any of the 50 personal theme slots.
- **Reserved**: their ids (`vixl-default`, `midnight-aurora`, `nordic-frost`, `solar-flare`, `rose-quartz`, `ocean-depths`, `cyber-lime`, `paper-ink`, `high-contrast`) can never be taken by a custom or imported theme. Importing a file that claims a reserved id is rejected; ids that collide with your existing themes are rewritten (`sunset` becomes `sunset-2`) while the display name is preserved.
- **Consistent at runtime**: only Vixl Default relies on the hard-coded CSS cascade defaults (variables are cleared so the shipped palette stays authoritative). The other bundled themes are read-only but still apply their own runtime variables, so their canvas, glass, and icon settings are visible.

## The `.vixl-theme.json` format

Themes are shared as a single self-contained JSON file with the `.vixl-theme.json` extension. A theme file is a flat, versioned `vixl-theme` payload describing exactly one theme. Files are strictly validated on import: unknown fields, malformed values, and unsafe content are rejected rather than partially applied. The top-level keys are `format` (always `"vixl-theme"`), `version` (currently `2`), `id`, `name`, `typography`, and `variants`. Files with unsupported versions (older than 1 or newer than 2) are rejected with an explicit error.

- `id`: a stable, lowercase slug identifier, reserved as described above.
- `name`: a user-facing display name (length-limited, no control characters or angle brackets).
- `typography`: one shared typography block (primary UI and monospace font family names plus bounded UI and editor font sizes).
- `variants`: required `light` and `dark` variants, so System mode stays meaningful.

### Variants

Each variant carries:

- `tokens`: **semantic UI colors**, a complete token map corresponding to the shadcn/Tailwind semantic variables used by the app: core tokens (background/foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring), the sidebar group (`sidebar`, `sidebarForeground`, `sidebarPrimary`, `sidebarPrimaryForeground`, `sidebarAccent`, `sidebarAccentForeground`, `sidebarBorder`, `sidebarRing`), and the chart palette (`chart1` … `chart5`). Incomplete token maps are rejected.
- `background`: the canvas, an explicit solid `fallback` color plus **up to four ordered gradient layers**. Each layer is one of:
  - `linear` with an `angle` (0-360 degrees);
  - `radial` with a center (`x`, `y` in percent) and a bounded size preset;
  - `conic` with an origin (`angle`, `x`, `y`).
  
  Every layer has 2-6 color stops with positions in 0-100, sorted by ascending position. Layers paint in order (the first layer paints on top), which allows mesh/aurora-style backgrounds. A canvas with zero layers is a solid color.
- `glass`: the translucent-surface configuration: `enabled`, target `scopes` (any of `sidebar`, `panels`, `overlays`), `surfaceOpacity` (0-100%), `blur` (0-48px), `saturation` (100-200%), `borderOpacity` (0-100%), and named `shadow` (`none`, `subtle`, `medium`, `strong`) and `radius` (`none`, `sm`, `md`, `lg`) presets.
- `icons`: the icon appearance: `pack` (`lucide`, `tabler`, or `phosphor`), `weight` (1-2.5 in half steps), `sizeScale` (0.75-1.5), and `tint` (`inherit`, which keeps `currentColor` semantics for status colors, or a safe hex color).
- `editor`: the code colors consumed by Monaco and Shiki (background, foreground, comments, keywords, strings, numbers, and so on). Hover/suggest widget colors are runtime-only: they are not part of the file and are filled from the built-in theme on import.

### Value rules

- **Colors** are hex only (`#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`): CSS color functions, named colors, and URLs are rejected. These are the same forms the Appearance editor accepts, so any editor-created theme exports unchanged.
- **Font sizes** are bounded numeric values between 8 and 32 in half-point steps, shared by the editor and the file format.
- **Names and identifiers** are length-limited (64 characters); font family strings are limited to 200 characters of letters, digits, spaces, and a small punctuation set, treated as data, not CSS.
- **Files** are size-capped at 1 MiB (rejected before parsing if oversized), and the saved theme library is capped at 50 themes.

Imports never accept raw CSS, URLs, HTML, scripts, image data, SVG, icon names or paths from files, or remote font sources. Imported values are data-only. Font fallback stacks are also runtime-only and filled from the built-in theme on import.

### Canonical exports

Exports are serialized in a stable, canonical shape: schema-versioned v2 payload with fixed key order, no runtime-only preview state, stable pretty printing with a trailing newline. Export → import round trips produce byte-identical files. Exports are always version 2, even when the theme started life as a v1 file.

A structurally abbreviated example (the authoritative key layout is whatever the app's exporter produces: start from an exported theme when hand-editing):

```json
{
  "format": "vixl-theme",
  "version": 2,
  "id": "aurora-dusk",
  "name": "Aurora Dusk",
  "typography": {
    "uiFontFamily": "Inter Variable",
    "monoFontFamily": "JetBrains Mono",
    "uiFontSize": 13,
    "editorFontSize": 13
  },
  "variants": {
    "light": {
      "tokens": { "background": "#ffffff", "foreground": "#18181b", "...": "complete token map" },
      "background": {
        "fallback": "#f8fafc",
        "layers": [
          { "kind": "linear", "angle": 180, "stops": [ { "color": "#f8fafc", "position": 0 }, { "color": "#e2e8f0", "position": 100 } ] },
          { "kind": "radial", "x": 25, "y": 20, "size": "closest-side", "stops": [ { "color": "#c7d2fe", "position": 0 }, { "color": "#f8fafc00", "position": 100 } ] }
        ]
      },
      "glass": { "enabled": true, "scopes": ["sidebar", "panels"], "surfaceOpacity": 60, "blur": 16, "saturation": 120, "borderOpacity": 20, "shadow": "subtle", "radius": "md" },
      "icons": { "pack": "lucide", "weight": 2, "sizeScale": 1, "tint": "inherit" },
      "editor": { "...": "Monaco/Shiki palette" }
    },
    "dark": {
      "tokens": { "background": "#0b0b12", "foreground": "#fafafa", "...": "complete token map" },
      "background": { "fallback": "#0b0b12", "layers": [] },
      "glass": { "enabled": false, "scopes": [], "surfaceOpacity": 100, "blur": 0, "saturation": 100, "borderOpacity": 0, "shadow": "none", "radius": "none" },
      "icons": { "pack": "tabler", "weight": 1.5, "sizeScale": 1, "tint": "inherit" },
      "editor": { "...": "Monaco/Shiki palette" }
    }
  }
}
```

## v1 compatibility and migration

Theme format version 1 (semantic tokens, typography, a solid-or-single-gradient canvas, and editor colors) remains fully supported on import:

- Imported **v1 files** are validated against the strict v1 schema (still strict, not weakened) and migrated to v2 before the summary preview and persistence.
- Stored **v1 library entries** in your settings are migrated the same way on load.
- The migration is lossless and visually equivalent: colors, typography, and editor palettes pass through unchanged; a v1 linear gradient becomes one v2 linear layer; a v1 solid background becomes the v2 fallback with zero layers; glass defaults to off; icons default to Lucide with inherited tint and unchanged sizing.
- Library entries that are invalid in both supported versions are dropped on load rather than failing the whole settings parse.
- There is no v1 export. Exports are always canonical v2.

## Import review

Before anything is written, the import dialog summarizes what will change, per variant:

- the number of gradient layers and their kinds (or a solid canvas);
- the enabled glass scopes (or "off");
- the selected icon pack per variant;
- fonts, sizes, and the semantic token count.

On confirmation, the library update and the optional activation are persisted in a **single atomic settings write**: a failure leaves your settings untouched, and the theme never lands half-imported.

## Glass surfaces and accessibility

Glass makes sidebars, panels/cards, and overlays translucent with a backdrop blur. Behavior is centralized in three scope utilities (`sidebar`, `panels`, `overlays`) driven by the active theme; ad-hoc per-component blur is not used. Fallbacks are built in:

- **No `backdrop-filter` support** (older WebView): glass surfaces fall back to a more opaque semantic surface with a visible border, so text stays readable.
- **`prefers-reduced-transparency: reduce`**: blur is disabled and surfaces become opaque.
- **`prefers-contrast: more`**: transparency is disabled and borders are strengthened.
- Blur and saturation are capped at bounded schema values, and blur is never animated, so glass never becomes a per-frame GPU cost.

Glass can also be turned off entirely (High Contrast ships with it disabled).

## Icon packs

Themes choose among three bundled, locally installed icon packs: **Lucide** (the compatibility default), **Tabler**, and **Phosphor**. A theme file stores only the pack id plus normalized weight, size scale, and tint; it never ships icon SVG data, glyph names, or packages. App icons render through a semantic registry (`AppIcon`), so switching packs changes the whole app chrome consistently while preserving meaning, labels, and state colors.

Outside the icon pack system (never restyled by themes):

- specialized file-type icons (`vscode-material-icons`);
- provider, server, and product logos;
- user- or content-supplied artwork and images;
- Monaco editor internals.

## Personal-device scope

Themes are a personal, platform-wide preference. The theme library (`appearance.themeLibrary`) and active theme id (`appearance.activeThemeId`) are **personal-only settings**: they are stripped from project-level overrides, so a project's `.vixl/settings.json` cannot embed or replace your theme library. Project files may still set `appearance.theme` (the color mode). Nothing about themes is synced or shared beyond the explicit `.vixl-theme.json` files you export.

## Constraints and non-goals

To keep theme files safe, portable, and predictable, the format intentionally excludes:

- local or remote images and any binary assets;
- remote fonts or font downloads (only bundled/system stacks);
- arbitrary CSS, style strings, or links;
- custom icon packages, SVG paths, or scripts;
- a gallery or public marketplace: sharing is file-based only;
- per-project themes: themes are a personal, platform-wide preference.

Additional theming boundaries that theme files cannot cross:

- **Startup**: themes apply when the app shell loads; there is no startup/splash theming, and the native window title bar and OS chrome are controlled by the operating system.
- **Monaco**: themes drive the Monaco/Shiki editor palette, fonts, and sizes; deeper editor chrome (find widget, context menus, keybindings UI) is not themeable, and hover/suggest widget colors are runtime-only (restored from the built-in theme on import).
- **Mermaid**: rendered diagrams keep a fixed built-in Mermaid theme and are not restyled by appearance themes.

## Workflows

### Export

1. Open **Settings → Appearance** and select a saved (or bundled) theme.
2. Export validates the theme, strips runtime-only state, and writes a canonical, versioned JSON payload through a save dialog with a sanitized suggested filename (the theme name sanitized, e.g. `sunset.vixl-theme.json`).
3. Canceling the save dialog is a no-op, never an error.

### Import

1. **Settings → Appearance → Import** opens a file dialog filtered to JSON theme files.
2. The file is size-checked before parsing, parsed as JSON, and strictly validated against the versioned schema (v1 files are migrated to v2 first).
3. A summary preview is shown; files claiming reserved built-in ids are rejected, and ids colliding with your existing themes get a collision-safe rewrite while the display name is preserved.
4. On confirmation the theme is added to your personal library and can be activated immediately in the same atomic write.
5. Filesystem and validation failures are surfaced as errors without partially changing the active theme or library.

### Managing themes

The Appearance section provides create-from-current/default, rename, duplicate, delete, and reset actions, with confirmation for destructive actions. Built-in themes are immutable but can be duplicated into editable custom themes. Deleting the active theme falls back to the built-in Vixl Default theme. Experimental edits use explicit Apply/Save and Cancel semantics so settings are not written on every input.

## Compatibility and storage

- **Backward compatible settings key**: `appearance.theme` continues to store the color mode (`light` / `dark` / `system`). Existing settings files migrate without changes.
- **Personal-only settings**: see [Personal-device scope](#personal-device-scope).
- **Safe fallbacks**: a missing or malformed active theme id resolves to the built-in Vixl Default theme rather than erroring, and invalid custom-theme state (dangling ids, malformed library entries) is cleaned up on load.
- **Default appearance preserved**: with no custom theme selected you get exactly the built-in palettes, Inter Variable / JetBrains Mono fonts, and existing sizing.
- The theme file carries its own independent format `version`; it does not bump the general settings version.
