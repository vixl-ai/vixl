import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AppearanceThemeGallery from '@/components/settings/appearance/AppearanceThemeGallery.vue'
import { groupGalleryThemes } from '@/components/settings/appearance/appearance-gallery-ui'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { BUNDLED_THEMES } from '@/constants/appearance/built-in-theme-registry'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

const makeTheme = (overrides: Partial<VixlThemeDefinition> = {}): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id: 'my-theme',
  name: 'My Theme',
  ...overrides,
})

const mountGallery = async (
  options: {
    custom?: VixlThemeDefinition[]
    activeId?: string
    previewingId?: string | null
    editing?: boolean
  } = {},
) => {
  const groups = groupGalleryThemes(BUNDLED_THEMES, options.custom ?? [])
  const wrapper = mount(AppearanceThemeGallery, {
    props: {
      builtIn: groups.builtIn,
      custom: groups.custom,
      activeId: options.activeId ?? builtInVixlTheme.id,
      previewingId: options.previewingId ?? null,
      editing: options.editing ?? false,
    },
    attachTo: document.body,
  })
  await nextTick()
  return wrapper
}

const cardSelectors = (wrapper: VueWrapper) => wrapper.findAll('[data-theme-card-button]')

const groupCards = (wrapper: VueWrapper, group: 'builtin' | 'custom') =>
  wrapper.findAll(
    `[data-testid="appearance-gallery-${group}"] [data-testid="appearance-theme-card"]`,
  )

/** Non-null indexing for strict mode; fails the test loudly instead. */
const nth = <T>(items: T[], index: number): T => {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`missing item at index ${index}`)
  }
  return item
}

describe('AppearanceThemeGallery', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  it('renders grouped built-in and custom sections with all bundled themes', async () => {
    wrapper = await mountGallery({ custom: [makeTheme()] })

    expect(groupCards(wrapper, 'builtin')).toHaveLength(BUNDLED_THEMES.length)
    expect(groupCards(wrapper, 'custom')).toHaveLength(1)
    expect(wrapper.text()).toContain('Built-in themes')
    expect(wrapper.text()).toContain('My themes')
    expect(wrapper.text()).toContain('Vixl Default')
    expect(wrapper.text()).toContain('Midnight Aurora')
    expect(wrapper.text()).toContain('My Theme')
  })

  it('shows an empty-state hint when there are no custom themes', async () => {
    wrapper = await mountGallery()
    const empty = wrapper.find('[data-testid="appearance-gallery-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('No custom themes yet')
    expect(wrapper.find('[data-testid="appearance-gallery-custom"]').exists()).toBe(false)
  })

  it('shows dual light/dark swatch thumbnails with icon samples on every card', async () => {
    wrapper = await mountGallery()
    const cards = wrapper.findAll('[data-testid="appearance-theme-card"]')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const light = card.find('[data-variant="light"]')
      const dark = card.find('[data-variant="dark"]')
      expect(light.exists()).toBe(true)
      expect(dark.exists()).toBe(true)
      // Swatches are decorative; the card's select control names the theme.
      expect(light.attributes('aria-hidden')).toBe('true')
      expect(dark.attributes('aria-hidden')).toBe('true')
      const icons = card.findAll('[data-testid="appearance-swatch-icons"] [data-icon]')
      expect(icons.length).toBeGreaterThanOrEqual(8)
    }
  })

  it('marks the active theme card and leaves others unpressed', async () => {
    wrapper = await mountGallery({ activeId: 'midnight-aurora' })
    const cards = wrapper.findAll('[data-testid="appearance-theme-card"]')
    const active = cards.find((card) =>
      card.find('[data-testid="appearance-card-active-badge"]').exists(),
    )
    expect(active).toBeDefined()
    const activeButton = active?.find('[data-theme-card-button]')
    expect(activeButton?.attributes('aria-pressed')).toBe('true')
    expect(activeButton?.attributes('aria-label')).toContain('active')
    expect(activeButton?.attributes('aria-label')).toContain('built-in theme')
    for (const other of cards) {
      if (other === active) {
        continue
      }
      expect(other.find('[data-theme-card-button]').attributes('aria-pressed')).toBe('false')
      expect(other.find('[data-testid="appearance-card-active-badge"]').exists()).toBe(false)
    }
  })

  it('keeps built-ins immutable: Customize only, no Edit/Delete', async () => {
    wrapper = await mountGallery()
    for (const card of groupCards(wrapper, 'builtin')) {
      expect(card.find('[data-testid="appearance-card-customize"]').exists()).toBe(true)
      expect(card.find('[data-testid="appearance-card-edit"]').exists()).toBe(false)
      expect(card.find('[data-testid="appearance-card-delete"]').exists()).toBe(false)
      // The active card collapses Use into its select control.
      expect(card.find('[data-testid="appearance-card-use"]').exists()).toBe(
        card.attributes('data-active') !== 'true',
      )
      expect(card.find('[data-testid="appearance-card-preview"]').exists()).toBe(true)
    }
  })

  it('exposes Edit/Delete on custom theme cards', async () => {
    wrapper = await mountGallery({ custom: [makeTheme()] })
    const card = nth(groupCards(wrapper, 'custom'), 0)
    expect(card.find('[data-testid="appearance-card-customize"]').exists()).toBe(false)
    expect(card.find('[data-testid="appearance-card-edit"]').exists()).toBe(true)
    expect(card.find('[data-testid="appearance-card-delete"]').exists()).toBe(true)
    expect(card.find('[data-testid="appearance-card-use"]').exists()).toBe(true)
  })

  it('emits use/preview/customize for built-ins and edit/delete for customs with ids', async () => {
    wrapper = await mountGallery({ custom: [makeTheme()] })

    // A non-active built-in card: Use is a distinct quick action.
    const card = nth(groupCards(wrapper, 'builtin'), 1)
    await card.find('[data-testid="appearance-card-use"]').trigger('click')
    await card.find('[data-testid="appearance-card-preview"]').trigger('click')
    await card.find('[data-testid="appearance-card-customize"]').trigger('click')
    // Selecting via the card's main control applies the theme; never edits.
    await card.find('[data-theme-card-button]').trigger('click')

    const customCard = nth(groupCards(wrapper, 'custom'), 0)
    await customCard.find('[data-testid="appearance-card-edit"]').trigger('click')
    await customCard.find('[data-testid="appearance-card-delete"]').trigger('click')

    const activeId = BUNDLED_THEMES[1]?.id
    expect(wrapper.emitted('use')).toEqual([[activeId], [activeId]])
    expect(wrapper.emitted('preview')).toEqual([[activeId]])
    expect(wrapper.emitted('customize')).toEqual([[activeId]])
    expect(wrapper.emitted('edit')).toEqual([['my-theme']])
    expect(wrapper.emitted('delete')).toEqual([['my-theme']])
  })

  it('shows previewing state on the previewed card and exits via its button', async () => {
    const previewedId = BUNDLED_THEMES[1]?.id
    wrapper = await mountGallery({ previewingId: previewedId })
    const card = nth(groupCards(wrapper, 'builtin'), 1)
    expect(card.find('[data-testid="appearance-card-preview-badge"]').exists()).toBe(true)
    const exitButton = card.find('[data-testid="appearance-card-preview"]')
    expect(exitButton.text()).toContain('Exit preview')
    await exitButton.trigger('click')
    expect(wrapper.emitted('preview')).toEqual([[previewedId]])
  })

  it('disables card preview buttons while the draft editor is open', async () => {
    wrapper = await mountGallery({ editing: true })
    const previewButtons = wrapper.findAll('[data-testid="appearance-card-preview"]')
    expect(previewButtons.length).toBeGreaterThan(0)
    for (const button of previewButtons) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('moves focus between card controls with arrow keys, Home, and End', async () => {
    wrapper = await mountGallery()
    const buttons = cardSelectors(wrapper)
    expect(buttons.length).toBe(BUNDLED_THEMES.length)

    const root = wrapper.find('[data-testid="appearance-theme-gallery"]')
    const first = nth(buttons, 0)
    const second = nth(buttons, 1)
    const last = nth(buttons, buttons.length - 1)

    ;(first.element as HTMLElement).focus()
    await root.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(second.element)

    await root.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(first.element)

    await root.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(last.element)

    // Wrap around past the end.
    await root.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(first.element)

    await root.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(first.element)

    // Non-navigation keys are left alone.
    await root.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first.element)
  })

  it('activates themes from the card select control and exposes native keyboard activation', async () => {
    wrapper = await mountGallery()

    // Clicking the card's select control applies the theme (never edits).
    const selectButton = nth(cardSelectors(wrapper), 1)
    await selectButton.trigger('click')
    expect(wrapper.emitted('use')).toEqual([[BUNDLED_THEMES[1]?.id]])
    expect(selectButton.element.tagName).toBe('BUTTON')
    expect(selectButton.attributes('type')).toBe('button')

    // A native <button type="button"> gets Enter/Space activation from the
    // browser, so keyboard users can apply themes without a pointer.
    const custom = makeTheme({ id: 'second-theme', name: 'Second Theme' })
    wrapper.unmount()
    wrapper = await mountGallery({ custom: [custom] })
    const customButton = nth(cardSelectors(wrapper), cardSelectors(wrapper).length - 1)
    await customButton.trigger('click')
    expect(wrapper.emitted('use')?.at(-1)).toEqual(['second-theme'])
    expect(customButton.element.tagName).toBe('BUTTON')
  })

  it('labels the gallery group for assistive technology', async () => {
    wrapper = await mountGallery()
    const root = wrapper.find('[data-testid="appearance-theme-gallery"]')
    expect(root.attributes('role')).toBe('group')
    expect(root.attributes('aria-label')).toBe('Theme gallery')
  })
})
