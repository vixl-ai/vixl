import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import { TooltipProvider } from '@/components/shadcn/ui/tooltip'
import ManageProviderDialog from '@/components/settings/providers/ManageProviderDialog.vue'
import type { VixlCustomProvider } from '@/types/vixl/vixl-settings'

type SavePayload = {
  providerId: string
  provider: VixlCustomProvider
  apiKey: string | null
  clearApiKey: boolean
}

const evaProvider: VixlCustomProvider = {
  type: 'openai-compatible',
  name: 'Eva',
  baseURL: 'http://localhost:8000',
  apiKeyRef: 'eva',
  models: [{ id: 'qwen3.6-35b-a3b', vision: false }],
}

const mountDialog = async (): Promise<{
  wrapper: VueWrapper
  saved: SavePayload[]
}> => {
  const saved: SavePayload[] = []
  const Host = defineComponent({
    components: { ManageProviderDialog, TooltipProvider },
    setup() {
      const open = ref(false)
      const handleSave = (payload: SavePayload): void => {
        saved.push(payload)
      }
      return { open, initialProvider: evaProvider, handleSave }
    },
    template: `
      <TooltipProvider>
        <ManageProviderDialog
          :open="open"
          mode="edit"
          provider-id="eva"
          :initial-provider="initialProvider"
          @save="handleSave"
        />
      </TooltipProvider>
    `,
  })
  const wrapper = mount(Host, { attachTo: document.body })
  ;(wrapper.vm as { open: boolean }).open = true
  await nextTick()
  return { wrapper, saved }
}

const setVisionChecked = async (wrapper: VueWrapper): Promise<void> => {
  const visionRoot = document.body.querySelector('#model-vision-0')
  const vision = wrapper.findAllComponents(Checkbox).find((checkbox) => {
    const el = checkbox.element
    return el === visionRoot || (el instanceof Node && visionRoot !== null && el.contains(visionRoot))
  })
  if (!vision) {
    throw new Error('Vision checkbox model-vision-0 was not found')
  }
  vision.vm.$emit('update:modelValue', true)
  await nextTick()
}

const clickSave = async (wrapper: VueWrapper): Promise<void> => {
  const saveButton = wrapper
    .findAllComponents(Button)
    .find((button) => button.text() === 'Save')
  if (!saveButton) {
    throw new Error('Save button was not found')
  }
  await saveButton.trigger('click')
  await nextTick()
}

describe('ManageProviderDialog', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  it('persists Vision checkbox into the emitted provider payload', async () => {
    const mounted = await mountDialog()
    wrapper = mounted.wrapper

    expect(evaProvider.models?.[0]?.vision).toBe(false)

    await setVisionChecked(wrapper)
    await clickSave(wrapper)

    expect(mounted.saved).toHaveLength(1)
    expect(mounted.saved[0]?.provider.models?.[0]?.vision).toBe(true)
  })
})
