import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauri } from '@/services/vixl/vixl-tauri'
import formatUnknownError from '@/utils/format-unknown-error'

type UpdateProgress = {
  downloaded: number
  contentLength: number
}

const checking = ref(false)
const updateAvailable = ref<Update | null>(null)
const downloading = ref(false)
const progress = ref<UpdateProgress | null>(null)
const lastCheckedAt = ref<Date | null>(null)

const canUseUpdater = (): boolean => !import.meta.env.DEV && isTauri()

export default () => {
  const checkForUpdates = async ({ silent }: { silent: boolean }): Promise<void> => {
    if (!canUseUpdater()) {
      return
    }
    if (checking.value) {
      return
    }

    checking.value = true
    try {
      const update = await check()
      lastCheckedAt.value = new Date()

      if (!update) {
        updateAvailable.value = null
        if (!silent) {
          toast.success('No updates available')
        }
        return
      }

      updateAvailable.value = update
      toast.success('A new version is ready', {
        description: 'View the GitHub release',
        cancel: {
          label: 'Ignore',
          onClick: () => {},
        },
        action: {
          label: 'Update',
          onClick: async () => {
            await downloadAndInstall()
          },
        },
      })
    } catch (error) {
      if (!silent) {
        toast.error('Failed to check for updates', {
          description: formatUnknownError(error),
        })
      }
    } finally {
      checking.value = false
    }
  }

  const downloadAndInstall = async (): Promise<void> => {
    if (!canUseUpdater()) {
      return
    }

    const update = updateAvailable.value
    if (!update) {
      toast.error('Failed to install update', {
        description: 'No update is available',
      })
      return
    }

    downloading.value = true
    progress.value = null
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          progress.value = {
            downloaded: 0,
            contentLength: event.data.contentLength ?? 0,
          }
          return
        }
        if (event.event === 'Progress') {
          const current = progress.value
          progress.value = {
            downloaded: (current?.downloaded ?? 0) + event.data.chunkLength,
            contentLength: current?.contentLength ?? 0,
          }
        }
      })
      await relaunch()
    } catch (error) {
      toast.error('Failed to install update', {
        description: formatUnknownError(error),
      })
    } finally {
      downloading.value = false
    }
  }

  return {
    checking,
    updateAvailable,
    downloading,
    progress,
    lastCheckedAt,
    checkForUpdates,
    downloadAndInstall,
  }
}
