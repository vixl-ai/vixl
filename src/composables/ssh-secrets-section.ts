import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  labelForSavedIdentity,
  listSavedSecretRows,
  parsePasswordIdentity,
  removeSavedPassphrase,
  removeSavedPassword,
  replaceSavedPassphrase,
  replaceSavedPassword,
  type SshSavedSecretRow,
} from '@/services/ssh/ssh-secrets'

export default () => {
  const rows = ref<SshSavedSecretRow[]>([])
  const replaceOpen = ref(false)
  const replaceRow = ref<SshSavedSecretRow | null>(null)
  const replaceValue = ref('')
  const replaceError = ref('')
  const saving = ref(false)

  const refresh = async (): Promise<void> => {
    try {
      rows.value = await listSavedSecretRows()
    } catch (error) {
      toast.error('Could not open the keychain.', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const openReplace = (row: SshSavedSecretRow): void => {
    replaceRow.value = row
    replaceValue.value = ''
    replaceError.value = ''
    replaceOpen.value = true
  }

  const hostnameFor = (row: SshSavedSecretRow): string => {
    if (row.kind === 'passphrase') {
      return labelForSavedIdentity({ kind: row.kind, identity: row.identity })
    }
    return parsePasswordIdentity(row.identity)?.hostname ?? row.identity
  }

  const saveReplace = async (): Promise<void> => {
    const row = replaceRow.value
    if (!row) {
      return
    }
    saving.value = true
    replaceError.value = ''
    try {
      if (row.kind === 'password') {
        const parsed = parsePasswordIdentity(row.identity)
        if (!parsed) {
          throw new Error('Could not read the saved password identity.')
        }
        await replaceSavedPassword(parsed.user, parsed.hostname, parsed.port, replaceValue.value)
      } else {
        await replaceSavedPassphrase(row.identity, replaceValue.value)
      }
      replaceOpen.value = false
      await refresh()
    } catch (error) {
      replaceError.value = error instanceof Error ? error.message : String(error)
    } finally {
      saving.value = false
    }
  }

  const removeRow = async (row: SshSavedSecretRow): Promise<void> => {
    try {
      if (row.kind === 'password') {
        const parsed = parsePasswordIdentity(row.identity)
        if (!parsed) {
          throw new Error('Could not read the saved password identity.')
        }
        await removeSavedPassword(parsed.user, parsed.hostname, parsed.port)
        toast.success(`Removed the saved password for ${parsed.hostname}.`)
      } else {
        await removeSavedPassphrase(row.identity)
        toast.success(`Removed the saved passphrase for ${row.label}.`)
      }
      await refresh()
    } catch (error) {
      toast.error(
        row.kind === 'password'
          ? `Could not remove the saved password for ${hostnameFor(row)}.`
          : `Could not remove ${row.label}.`,
        {
          description: error instanceof Error ? error.message : 'Unknown error',
        },
      )
    }
  }

  onMounted(() => {
    void refresh()
  })

  return {
    rows,
    replaceOpen,
    replaceRow,
    replaceValue,
    replaceError,
    saving,
    hostnameFor,
    openReplace,
    saveReplace,
    removeRow,
  }
}
