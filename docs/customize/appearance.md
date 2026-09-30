---
title: Appearance
description: Set Vixl theme and window transparency from Settings > General.
---

# Appearance

Theme and window transparency live in Settings > General. The Settings UI writes personal `settings.json`. Keys and defaults are on [settings.json](/reference/settings-json).

The same Settings section also has a shortcuts list and the GitHub Releases updater. See [Shortcuts and the command palette](/using/shortcuts-and-the-command-palette) and [Installation](/getting-started/installation).

## Theme

Choose **Light**, **Dark**, or **System**. The default is System. The title-bar control toggles Light and Dark only (not System) and writes the same `appearance.theme` key.

## Transparency

Turn **Enabled** on to tint the window (`appearance.transparency`, default on). Hue runs 0 to 360 (default 265). Intensity runs 0 to 100 (default 0). The preview updates while you drag the sliders.

These keys are `appearance.transparencyHue` and `appearance.transparencyIntensity`.
