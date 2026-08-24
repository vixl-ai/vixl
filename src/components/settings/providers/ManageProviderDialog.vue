<script setup lang="ts">
import { AlertTriangle, ChevronDown, Loader2, Plus, Trash2 } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { Switch } from '@/components/shadcn/ui/switch'
import { Textarea } from '@/components/shadcn/ui/textarea'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import SettingsInputPasswordInput from '@/components/settings/input/PasswordInput.vue'
import type { VixlCustomProvider } from '@/types/vixl/vixl-settings'
import useManageProviderDialog from '@/composables/manage-provider-dialog'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  providerId?: string | null
  initialProvider?: VixlCustomProvider | null
  initialApiKeyConfigured?: boolean
  resolveStoredApiKey?: () => Promise<string>
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  save: [
    payload: {
      providerId: string
      provider: VixlCustomProvider
      apiKey: string | null
      clearApiKey: boolean
    },
  ]
}>()

const {
  name,
  baseURL,
  apiKeyInput,
  clearApiKey,
  includeUsage,
  supportsStructuredOutputs,
  headers,
  queryParams,
  models,
  testing,
  importingModels,
  requestExtrasOpen,
  dialogSurfaceClass,
  fieldClass,
  flexFieldClass,
  title,
  configuredModelCount,
  showPricingWarning,
  handleOpenChange,
  addKeyValueRow,
  removeKeyValueRow,
  addModel,
  removeModel,
  importModelsFromEndpoint,
  handleTestConnection,
  handleSave,
} = useManageProviderDialog(props, emit)
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent :class="dialogSurfaceClass">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>

      <div class="max-h-[min(36rem,70vh)] min-w-0 space-y-4 overflow-x-hidden overflow-y-auto px-1 py-0.5">
        <p class="text-sm text-muted-foreground">
          Connect a private or self-hosted endpoint that speaks the OpenAI Chat Completions API.
        </p>

        <section class="space-y-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="min-w-0 space-y-1.5">
              <Label for="manage-provider-name">Name</Label>
              <Input id="manage-provider-name" v-model="name" placeholder="local" :class="fieldClass" />
            </div>
            <div class="min-w-0 space-y-1.5">
              <Label for="manage-provider-base-url">Base URL</Label>
              <Input
                id="manage-provider-base-url"
                v-model="baseURL"
                placeholder="http://localhost:1234/v1"
                :class="fieldClass"
              />
            </div>
          </div>
          <p v-if="mode === 'edit'" class="text-xs text-muted-foreground">
            Provider id stays
            <code class="text-xs">{{ providerId }}</code>
            ; renaming only changes the display label.
          </p>

          <div class="min-w-0 space-y-1.5">
            <Label for="manage-provider-api-key">API key (optional)</Label>
            <SettingsInputPasswordInput
              id="manage-provider-api-key"
              v-model="apiKeyInput"
              placeholder="sk-..."
            />
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p class="text-xs text-muted-foreground">
                Leave blank for local servers that do not require authentication.
              </p>
              <div
                v-if="initialApiKeyConfigured"
                class="flex items-center gap-2"
              >
                <Switch
                  id="manage-provider-clear-key"
                  :checked="clearApiKey"
                  @update:checked="clearApiKey = $event"
                />
                <Label for="manage-provider-clear-key" class="text-xs font-normal">
                  Clear stored key
                </Label>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div class="flex items-center gap-2">
              <Switch
                id="manage-provider-include-usage"
                :checked="includeUsage"
                @update:checked="includeUsage = $event"
              />
              <Label for="manage-provider-include-usage" class="text-sm font-normal">
                Include usage
              </Label>
            </div>
            <div class="flex items-center gap-2">
              <Switch
                id="manage-provider-structured-outputs"
                :checked="supportsStructuredOutputs"
                @update:checked="supportsStructuredOutputs = $event"
              />
              <Label for="manage-provider-structured-outputs" class="text-sm font-normal">
                Structured outputs
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="ml-auto"
              :disabled="testing"
              @click="handleTestConnection"
            >
              <Loader2 v-if="testing" class="mr-2 h-4 w-4 animate-spin" />
              Test connection
            </Button>
          </div>
        </section>

        <Collapsible v-model:open="requestExtrasOpen" class="min-w-0">
          <CollapsibleTrigger
            class="flex w-full items-center justify-between py-1 text-left text-sm font-medium hover:underline"
          >
            Request headers & query params
            <ChevronDown
              class="h-4 w-4 shrink-0 transition-transform"
              :class="requestExtrasOpen ? 'rotate-180' : ''"
            />
          </CollapsibleTrigger>
          <CollapsibleContent class="space-y-3 pt-2">
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-2">
                <Label>Headers</Label>
                <Button variant="ghost" size="sm" @click="addKeyValueRow(headers)">
                  <Plus class="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              <div
                v-for="(row, index) in headers"
                :key="`header-${index}`"
                class="flex min-w-0 gap-2"
              >
                <Input v-model="row.key" placeholder="Header name" :class="flexFieldClass" />
                <Input v-model="row.value" placeholder="Value" :class="flexFieldClass" />
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-9 w-9 shrink-0"
                  @click="removeKeyValueRow(headers, index)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between gap-2">
                <Label>Query params</Label>
                <Button variant="ghost" size="sm" @click="addKeyValueRow(queryParams)">
                  <Plus class="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
              <div
                v-for="(row, index) in queryParams"
                :key="`query-${index}`"
                class="flex min-w-0 gap-2"
              >
                <Input v-model="row.key" placeholder="Param name" :class="flexFieldClass" />
                <Input v-model="row.value" placeholder="Value" :class="flexFieldClass" />
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-9 w-9 shrink-0"
                  @click="removeKeyValueRow(queryParams, index)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <section class="min-w-0 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-sm font-medium">Models</h3>
              <p class="text-xs text-muted-foreground">
                Context, output limits, and sampling.
                {{
                  configuredModelCount > 0
                    ? `${configuredModelCount} configured.`
                    : 'None configured yet.'
                }}
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                :disabled="importingModels"
                @click="importModelsFromEndpoint"
              >
                <Loader2 v-if="importingModels" class="mr-1 h-3.5 w-3.5 animate-spin" />
                Import
              </Button>
              <Button variant="outline" size="sm" @click="addModel()">
                <Plus class="mr-1 h-3.5 w-3.5" />
                Add model
              </Button>
            </div>
          </div>

          <div
            v-if="models.length === 0"
            class="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground"
          >
            No models configured. Add manually, import from the endpoint, or rely on live
            <code class="text-xs">/models</code>
            listing.
          </div>

          <div
            v-for="(model, index) in models"
            :key="`model-${index}`"
            class="min-w-0 space-y-3 rounded-lg border border-border/50 p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <p class="text-sm font-medium">Model {{ index + 1 }}</p>
                <TooltipProvider v-if="showPricingWarning(model)">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="inline-flex text-amber-500 hover:text-amber-400"
                        aria-label="No pricing configured for this model"
                      >
                        <AlertTriangle class="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent class="max-w-xs">
                      No pricing configured for this model. Token usage is tracked; cost is unknown.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                @click="removeModel(index)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div class="min-w-0 space-y-1.5">
                <Label :for="`model-id-${index}`">Model ID</Label>
                <Input
                  :id="`model-id-${index}`"
                  v-model="model.id"
                  placeholder="model-id"
                  :class="fieldClass"
                />
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label :for="`model-name-${index}`">Display name</Label>
                <Input
                  :id="`model-name-${index}`"
                  v-model="model.name"
                  placeholder="Optional label"
                  :class="fieldClass"
                />
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label :for="`model-context-${index}`">Context window</Label>
                <Input
                  :id="`model-context-${index}`"
                  v-model="model.contextWindow"
                  inputmode="numeric"
                  placeholder="Optional"
                  :class="fieldClass"
                />
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label :for="`model-max-input-${index}`">Max input</Label>
                <Input
                  :id="`model-max-input-${index}`"
                  v-model="model.maxInputTokens"
                  inputmode="numeric"
                  placeholder="128000"
                  :class="fieldClass"
                />
              </div>
              <div class="min-w-0 space-y-1.5">
                <Label :for="`model-max-output-${index}`">Max output</Label>
                <Input
                  :id="`model-max-output-${index}`"
                  v-model="model.maxOutputTokens"
                  inputmode="numeric"
                  placeholder="8192"
                  :class="fieldClass"
                />
              </div>
              <div class="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2 pb-1">
                <div class="flex items-center gap-1.5">
                  <Checkbox
                    :id="`model-tools-${index}`"
                    v-model="model.toolCalling"
                  />
                  <Label :for="`model-tools-${index}`" class="text-xs font-normal">Tools</Label>
                </div>
                <div class="flex items-center gap-1.5">
                  <Checkbox
                    :id="`model-vision-${index}`"
                    v-model="model.vision"
                  />
                  <Label :for="`model-vision-${index}`" class="text-xs font-normal">Vision</Label>
                </div>
                <div class="flex items-center gap-1.5">
                  <Checkbox
                    :id="`model-thinking-${index}`"
                    v-model="model.thinking"
                  />
                  <Label :for="`model-thinking-${index}`" class="text-xs font-normal">
                    Thinking
                  </Label>
                </div>
                <div class="flex items-center gap-1.5">
                  <Checkbox
                    :id="`model-streaming-${index}`"
                    v-model="model.streaming"
                  />
                  <Label :for="`model-streaming-${index}`" class="text-xs font-normal">
                    Stream
                  </Label>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="min-w-0">
                <p class="text-sm font-medium">Pricing</p>
                <p class="text-xs text-muted-foreground">USD per 1M tokens</p>
              </div>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div class="min-w-0 space-y-1.5">
                  <Label :for="`model-price-input-${index}`">Input $/1M</Label>
                  <Input
                    :id="`model-price-input-${index}`"
                    v-model="model.pricing.inputPerMillion"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    :class="fieldClass"
                  />
                </div>
                <div class="min-w-0 space-y-1.5">
                  <Label :for="`model-price-output-${index}`">Output $/1M</Label>
                  <Input
                    :id="`model-price-output-${index}`"
                    v-model="model.pricing.outputPerMillion"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    :class="fieldClass"
                  />
                </div>
                <div class="min-w-0 space-y-1.5">
                  <Label :for="`model-price-cache-read-${index}`">Cache read $/1M</Label>
                  <Input
                    :id="`model-price-cache-read-${index}`"
                    v-model="model.pricing.cacheReadPerMillion"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Optional"
                    :class="fieldClass"
                  />
                </div>
                <div class="min-w-0 space-y-1.5">
                  <Label :for="`model-price-cache-write-${index}`">Cache write $/1M</Label>
                  <Input
                    :id="`model-price-cache-write-${index}`"
                    v-model="model.pricing.cacheWritePerMillion"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Optional"
                    :class="fieldClass"
                  />
                </div>
                <div class="min-w-0 space-y-1.5">
                  <Label :for="`model-price-reasoning-${index}`">Reasoning $/1M</Label>
                  <Input
                    :id="`model-price-reasoning-${index}`"
                    v-model="model.pricing.reasoningPerMillion"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Optional"
                    :class="fieldClass"
                  />
                </div>
              </div>
            </div>

            <Collapsible v-model:open="model.advancedOpen" class="min-w-0">
              <CollapsibleTrigger
                class="flex w-full items-center justify-between py-1 text-left text-sm font-medium hover:underline"
              >
                Advanced
                <ChevronDown
                  class="h-4 w-4 shrink-0 transition-transform"
                  :class="model.advancedOpen ? 'rotate-180' : ''"
                />
              </CollapsibleTrigger>
              <CollapsibleContent class="space-y-3 pt-2">
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-temp-${index}`">Temperature</Label>
                    <Input
                      :id="`model-temp-${index}`"
                      v-model="model.temperature"
                      inputmode="decimal"
                      placeholder="0.2"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-top-p-${index}`">Top P</Label>
                    <Input
                      :id="`model-top-p-${index}`"
                      v-model="model.topP"
                      inputmode="decimal"
                      placeholder="0.9"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-top-k-${index}`">Top K</Label>
                    <Input
                      :id="`model-top-k-${index}`"
                      v-model="model.topK"
                      inputmode="numeric"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-seed-${index}`">Seed</Label>
                    <Input
                      :id="`model-seed-${index}`"
                      v-model="model.seed"
                      inputmode="numeric"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-freq-${index}`">Freq. penalty</Label>
                    <Input
                      :id="`model-freq-${index}`"
                      v-model="model.frequencyPenalty"
                      inputmode="decimal"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-pres-${index}`">Pres. penalty</Label>
                    <Input
                      :id="`model-pres-${index}`"
                      v-model="model.presencePenalty"
                      inputmode="decimal"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-efforts-${index}`">Reasoning efforts</Label>
                    <Input
                      :id="`model-efforts-${index}`"
                      v-model="model.supportsReasoningEffort"
                      placeholder="none, minimal, low, medium, high, xhigh"
                      :class="fieldClass"
                />
                  </div>
                  <div class="min-w-0 space-y-1.5">
                    <Label :for="`model-effort-${index}`">Default effort</Label>
                    <Input
                      :id="`model-effort-${index}`"
                      v-model="model.reasoningEffort"
                      placeholder="provider-default, none, low, medium, high"
                      :class="fieldClass"
                />
                  </div>
                </div>
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <Label>Model headers</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      @click="addKeyValueRow(model.headers)"
                    >
                      <Plus class="mr-1 h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                  <div
                    v-for="(row, headerIndex) in model.headers"
                    :key="`model-header-${index}-${headerIndex}`"
                    class="flex min-w-0 gap-2"
                  >
                    <Input v-model="row.key" placeholder="Header name" :class="flexFieldClass" />
                    <Input v-model="row.value" placeholder="Value" :class="flexFieldClass" />
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-9 w-9 shrink-0"
                      @click="removeKeyValueRow(model.headers, headerIndex)"
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div class="min-w-0 space-y-1.5">
                  <Label :for="`model-options-${index}`">modelOptions (JSON)</Label>
                  <Textarea
                    :id="`model-options-${index}`"
                    v-model="model.modelOptionsJson"
                    class="min-h-20 w-full max-w-full font-mono text-xs focus-visible:ring-inset"
                    placeholder='{ "customOption": "value" }'
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </section>
      </div>

      <DialogFooter class="gap-2 sm:justify-end">
        <Button variant="outline" @click="handleOpenChange(false)">Cancel</Button>
        <Button @click="handleSave">
          {{ mode === 'create' ? 'Add provider' : 'Save' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
