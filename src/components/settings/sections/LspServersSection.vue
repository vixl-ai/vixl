<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import { Switch } from '@/components/shadcn/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import useLspServersSection from '@/composables/lsp-servers-section'

const {
  catalog,
  installMessage,
  prefetching,
  autoDownload,
  activeRoot,
  workspaceTrusted,
  isBusy,
  extensionsHint,
  statusBadges,
  installServer,
  uninstallServer,
  setDisabled,
  prefetchDefaults,
  updateAutoDownload,
  trustWorkspace,
  lspServerIconName,
  isTauri,
  Ban,
  Download,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
} = useLspServersSection()
</script>

<template>
  <SettingsSectionScroll title="LSP">
    <template #actions>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-label="Install defaults"
            :disabled="!isTauri() || prefetching"
            @click="prefetchDefaults"
          >
            <Loader2
              v-if="prefetching"
              class="h-4 w-4 animate-spin"
            />
            <Download
              v-else
              class="h-4 w-4"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Install defaults</TooltipContent>
      </Tooltip>
    </template>

    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <div class="space-y-1">
          <Label>Auto-download language servers</Label>
          <p class="text-sm text-muted-foreground">
            Download default language support on project open. Disable for airgapped machines.
          </p>
        </div>
        <Switch :model-value="autoDownload" @update:model-value="updateAutoDownload" />
      </div>

      <div class="space-y-2 rounded-md border border-border/50 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="space-y-1">
            <Label>Workspace trust</Label>
            <p class="text-sm text-muted-foreground">
              Required only for project-local binaries (node_modules) and ESLint/Biome/Oxlint.
              Managed servers work without trust.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :aria-label="workspaceTrusted ? 'Workspace trusted' : 'Trust project'"
                :disabled="!activeRoot || workspaceTrusted"
                @click="trustWorkspace"
              >
                <ShieldCheck class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {{ workspaceTrusted ? 'Workspace trusted' : 'Trust project' }}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <p
        v-if="installMessage"
        class="text-sm text-muted-foreground"
      >
        {{ installMessage }}
      </p>
      <p
        v-else
        class="text-sm text-muted-foreground"
      >
        Language servers are available. They are not all started automatically.
        Install managed ones below, or disable a server globally.
      </p>

      <div class="space-y-2">
        <Label>Servers</Label>
        <ul class="divide-y divide-border/50 rounded-md border border-border/50">
          <li
            v-for="entry in catalog"
            :key="entry.id"
            class="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div class="flex min-w-0 items-start gap-2">
              <WorkbenchFileEntryIcon
                :name="lspServerIconName(entry.id, entry.extensions)"
                class="mt-0.5"
              />
              <div class="min-w-0 space-y-0.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <p class="truncate text-sm font-medium">{{ entry.label }}</p>
                  <div class="flex shrink-0 items-center gap-1">
                    <Tooltip
                      v-for="badge in statusBadges(entry)"
                      :key="badge.key"
                    >
                      <TooltipTrigger as-child>
                        <span
                          class="inline-flex"
                          :aria-label="badge.label"
                        >
                          <component
                            :is="badge.icon"
                            class="h-3.5 w-3.5"
                            :class="[
                              badge.className,
                              badge.key === 'state' ? 'animate-spin' : '',
                            ]"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{{ badge.label }}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <p
                  v-if="extensionsHint(entry)"
                  class="truncate text-xs text-muted-foreground"
                >
                  {{ extensionsHint(entry) }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    :aria-label="entry.disabled ? 'Enable' : 'Disable'"
                    :disabled="isBusy(entry.id)"
                    @click="setDisabled(entry.id, !entry.disabled)"
                  >
                    <Play
                      v-if="entry.disabled"
                      class="h-4 w-4"
                    />
                    <Ban
                      v-else
                      class="h-4 w-4"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {{ entry.disabled ? 'Enable' : 'Disable' }}
                </TooltipContent>
              </Tooltip>

              <Tooltip v-if="entry.installable && !entry.installed">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    aria-label="Install"
                    :disabled="isBusy(entry.id) || entry.disabled"
                    @click="installServer(entry.id)"
                  >
                    <Loader2
                      v-if="isBusy(entry.id)"
                      class="h-4 w-4 animate-spin"
                    />
                    <Download
                      v-else
                      class="h-4 w-4"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Install</TooltipContent>
              </Tooltip>

              <Tooltip v-else-if="entry.installable && entry.error">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    aria-label="Retry"
                    :disabled="isBusy(entry.id) || entry.disabled"
                    @click="installServer(entry.id)"
                  >
                    <Loader2
                      v-if="isBusy(entry.id)"
                      class="h-4 w-4 animate-spin"
                    />
                    <RotateCcw
                      v-else
                      class="h-4 w-4"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry</TooltipContent>
              </Tooltip>

              <Tooltip v-if="entry.installable && entry.installed && entry.source === 'managed'">
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    aria-label="Uninstall"
                    :disabled="isBusy(entry.id)"
                    @click="uninstallServer(entry.id)"
                  >
                    <Loader2
                      v-if="isBusy(entry.id)"
                      class="h-4 w-4 animate-spin"
                    />
                    <Trash2
                      v-else
                      class="h-4 w-4"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Uninstall</TooltipContent>
              </Tooltip>
            </div>
          </li>
        </ul>
        <p
          v-if="!isTauri()"
          class="text-sm text-muted-foreground"
        >
          Language servers require the desktop app.
        </p>
      </div>
    </div>
  </SettingsSectionScroll>
</template>
