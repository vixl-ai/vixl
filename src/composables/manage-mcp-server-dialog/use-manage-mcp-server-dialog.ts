import { onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type {
  McpConfig,
  McpHttpServer,
  McpInputDefinition,
  McpServerConfig,
  McpStdioServer,
} from '@/types/vixl/mcp-config'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'
import { mcpInputKey } from '@/services/mcp/mcp-keychain-keys'
import { getSecret } from '@/services/vixl/vixl-tauri'

type SecretRow = {
  key: string
  /** New secret value. Empty means keep existing keychain value when configured. */
  value: string
  configured: boolean
}

type Transport = 'stdio' | 'http' | 'sse'

const INPUT_TEMPLATE = /^\$\{input:([^}]+)\}$/


export type ManageMcpServerDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  serverId?: string | null
  initialConfig?: McpServerConfig | null
  mcpConfig: McpConfig
}

export type ManageMcpServerDialogEmit = {
  (event: 'update:open', open: boolean): void
  (
    event: 'save',
    payload: {
      serverId: string
      previousId?: string
      config: McpServerConfig
      inputs: McpInputDefinition[]
      secretValues: Record<string, string>
    },
  ): void
}

export default (props: ManageMcpServerDialogProps, emit: ManageMcpServerDialogEmit) => {
  const draftId = ref('')
  const transport = ref<Transport>('stdio')
  const command = ref('npx')
  const argsText = ref('')
  const url = ref('')
  const envRows = ref<SecretRow[]>([])
  const headerRows = ref<SecretRow[]>([])
  const oauthClientId = ref('')
  const asAllowlistText = ref('')

  const templateRef = (key: string): string => `\${input:${key}}`

  const inputIdFromValue = (value: string): string | null => {
    const match = value.trim().match(INPUT_TEMPLATE)
    return match?.[1] ?? null
  }

  const probeConfigured = async (
    serverId: string,
    inputId: string,
  ): Promise<boolean> => {
    const stored = await getSecret(mcpInputKey(serverId, inputId))
    return stored !== null && stored.length > 0
  }

  const recordToSecretRows = async (
    record: Record<string, string> | undefined,
    serverId: string | null,
  ): Promise<SecretRow[]> => {
    const entries = Object.entries(record ?? {})
    const rows: SecretRow[] = []
    for (const [key, rawValue] of entries) {
      const inputId = inputIdFromValue(rawValue) ?? key
      const configured =
        serverId !== null && serverId.length > 0
          ? await probeConfigured(serverId, inputId)
          : false
      rows.push({
        key,
        value: '',
        configured,
      })
    }
    return rows
  }

  const resetFromProps = async (): Promise<void> => {
    draftId.value = props.serverId ?? ''
    const config = props.initialConfig
    if (!config) {
      transport.value = 'stdio'
      command.value = 'npx'
      argsText.value = ''
      url.value = ''
      envRows.value = []
      headerRows.value = []
      oauthClientId.value = ''
      asAllowlistText.value = ''
      return
    }

    const serverId = props.serverId ?? null

    if (isMcpHttpServer(config)) {
      transport.value = config.type
      url.value = config.url
      headerRows.value = await recordToSecretRows(config.headers, serverId)
      envRows.value = []
      command.value = 'npx'
      argsText.value = ''
      oauthClientId.value = config.oauth?.clientId ?? ''
      asAllowlistText.value = (config.oauth?.allowedAuthorizationServers ?? []).join('\n')
      return
    }

    if (isMcpStdioServer(config)) {
      transport.value = 'stdio'
      command.value = config.command
      argsText.value = (config.args ?? []).join(', ')
      envRows.value = await recordToSecretRows(config.env, serverId)
      headerRows.value = []
      oauthClientId.value = ''
      asAllowlistText.value = ''
    }
  }

  watch(
    () => [props.open, props.serverId, props.initialConfig] as const,
    ([open]) => {
      if (!open) {
        return
      }
      resetFromProps().catch((error: unknown) => {
        toast.error('Failed to load server', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
  )

  onMounted(() => {
    if (props.open) {
      resetFromProps().catch((error: unknown) => {
        toast.error('Failed to load server', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
  })

  const addEnvRow = (): void => {
    envRows.value = [...envRows.value, { key: '', value: '', configured: false }]
  }

  const addHeaderRow = (): void => {
    headerRows.value = [
      ...headerRows.value,
      { key: '', value: '', configured: false },
    ]
  }

  const buildSecretRecord = (
    rows: SecretRow[],
  ): {
    record?: Record<string, string>
    inputs: McpInputDefinition[]
    secretValues: Record<string, string>
  } => {
    const record: Record<string, string> = {}
    const inputs: McpInputDefinition[] = []
    const secretValues: Record<string, string> = {}
    const seenInputs = new Set<string>()

    for (const row of rows) {
      const key = row.key.trim()
      if (!key) {
        continue
      }
      const inputId = key
      record[key] = templateRef(inputId)
      if (!seenInputs.has(inputId)) {
        seenInputs.add(inputId)
        inputs.push({
          id: inputId,
          type: 'promptString',
          description: inputId,
          password: true,
        })
      }
      const nextValue = row.value.trim()
      if (nextValue.length > 0) {
        secretValues[inputId] = nextValue
      } else if (!row.configured) {
        // New unset secret: still wire the template; value can be filled via Edit secrets.
      }
    }

    return {
      record: Object.keys(record).length > 0 ? record : undefined,
      inputs,
      secretValues,
    }
  }

  const handleSave = (): void => {
    const serverId = draftId.value.trim()
    if (!serverId) {
      toast.error('Server ID is required')
      return
    }

    let config: McpServerConfig
    let inputs: McpInputDefinition[] = []
    let secretValues: Record<string, string> = {}

    if (transport.value === 'stdio') {
      const built = buildSecretRecord(envRows.value)
      inputs = built.inputs
      secretValues = built.secretValues
      const stdio: McpStdioServer = {
        command: command.value.trim(),
        args: argsText.value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
        env: built.record,
      }
      if (!stdio.command) {
        toast.error('Command is required')
        return
      }
      for (const row of envRows.value) {
        const key = row.key.trim()
        if (!key) {
          continue
        }
        if (!row.configured && row.value.trim().length === 0) {
          toast.error('Secret value required', {
            description: `Enter a value for ${key}, or remove that row.`,
          })
          return
        }
      }
      config = stdio
    } else {
      const built = buildSecretRecord(headerRows.value)
      inputs = built.inputs
      secretValues = built.secretValues
      const http: McpHttpServer = {
        type: transport.value,
        url: url.value.trim(),
        headers: built.record,
      }
      if (!http.url) {
        toast.error('URL is required')
        return
      }
      for (const row of headerRows.value) {
        const key = row.key.trim()
        if (!key) {
          continue
        }
        if (!row.configured && row.value.trim().length === 0) {
          toast.error('Secret value required', {
            description: `Enter a value for ${key}, or remove that row.`,
          })
          return
        }
      }
      const allowlist = asAllowlistText.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (oauthClientId.value.trim() || allowlist.length > 0) {
        http.oauth = {
          ...(oauthClientId.value.trim()
            ? { clientId: oauthClientId.value.trim() }
            : {}),
          ...(allowlist.length > 0 ? { allowedAuthorizationServers: allowlist } : {}),
        }
      }
      config = http
    }

    emit('save', {
      serverId,
      previousId: props.mode === 'edit' ? (props.serverId ?? undefined) : undefined,
      config,
      inputs,
      secretValues,
    })
    emit('update:open', false)
  }

  return {
    draftId,
    transport,
    command,
    argsText,
    url,
    envRows,
    headerRows,
    oauthClientId,
    asAllowlistText,
    addEnvRow,
    addHeaderRow,
    handleSave,
  }
}
