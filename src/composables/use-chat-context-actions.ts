import { ref } from 'vue'

type ContextAction = () => void | Promise<void>

const onCompact = ref<ContextAction | null>(null)
const onHandoff = ref<ContextAction | null>(null)
const actionsDisabled = ref(false)
const triggerDisabled = ref(false)
const available = ref(false)
const compacting = ref(false)

const register = (handlers: {
  onCompact?: ContextAction
  onHandoff?: ContextAction
}): void => {
  onCompact.value = handlers.onCompact ?? null
  onHandoff.value = handlers.onHandoff ?? null
  available.value = true
}

const clear = (): void => {
  onCompact.value = null
  onHandoff.value = null
  available.value = false
  actionsDisabled.value = false
  triggerDisabled.value = false
  compacting.value = false
}

const setDisabled = (next: {
  actionsDisabled?: boolean
  triggerDisabled?: boolean
}): void => {
  if (next.actionsDisabled !== undefined) {
    actionsDisabled.value = next.actionsDisabled
  }
  if (next.triggerDisabled !== undefined) {
    triggerDisabled.value = next.triggerDisabled
  }
}

export default () => ({
  onCompact,
  onHandoff,
  actionsDisabled,
  triggerDisabled,
  available,
  compacting,
  register,
  clear,
  setDisabled,
})
