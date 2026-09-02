import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import { Input } from '@/components/shadcn/ui/input'
import { TooltipProvider } from '@/components/shadcn/ui/tooltip'
import ManageProviderDialog from '@/components/settings/providers/ManageProviderDialog.vue'
import type { VixlCustomProvider } from '@/types/vixl/vixl-settings'

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => string | number>(),
    dismiss: vi.fn<(id?: string | number) => void>(),
  },
}))

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

const setPricingNumber = async (
  wrapper: VueWrapper,
  id: string,
  value: number,
): Promise<void> => {
  const inputRoot = document.body.querySelector(`#${id}`)
  const input = wrapper.findAllComponents(Input).find((component) => {
    const el = component.element
    return el === inputRoot || (el instanceof Node && inputRoot !== null && el.contains(inputRoot))
  })
  if (!input) {
    throw new Error(`Pricing input ${id} was not found`)
  }
  input.vm.$emit('update:modelValue', value)
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
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.success).mockClear()
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

  it('persists number pricing inputs into the emitted provider payload', async () => {
    const mounted = await mountDialog()
    wrapper = mounted.wrapper

    await setPricingNumber(wrapper, 'model-price-input-0', 3)
    await setPricingNumber(wrapper, 'model-price-output-0', 15)
    await clickSave(wrapper)

    expect(mounted.saved).toHaveLength(1)
    expect(mounted.saved[0]?.provider.models?.[0]?.pricing?.inputPerMillion).toBe(3)
    expect(mounted.saved[0]?.provider.models?.[0]?.pricing?.outputPerMillion).toBe(15)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
