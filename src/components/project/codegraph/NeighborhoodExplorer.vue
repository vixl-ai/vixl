<script setup lang="ts">
import type { Edge, Node, NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MarkerType, Position, VueFlow } from '@vue-flow/core'
import { GitBranch, Loader2, Search } from '@lucide/vue'
import { useDebounceFn } from '@vueuse/core'
import { computed, markRaw, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Controls } from '@/components/ai-elements/controls'
import ProjectCodegraphNeighborhoodNode from '@/components/project/codegraph/NeighborhoodNode.vue'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/shadcn/ui/empty'
import { Input } from '@/components/shadcn/ui/input'
import useFleetRegistry from '@/composables/use-fleet-registry'
import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import type {
  CodebaseImpactResult,
  CodebaseToolSpan,
} from '@/types/codegraph/codebase-tool-result'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import invokeErrorMessage from '@/utils/invoke-error-message'
import openAtLine from '@/utils/open-at-line'
import toProjectRelativePath from '@/utils/to-project-relative-path'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

type NeighborhoodNodeRole = 'focus' | 'caller' | 'callee' | 'impact'

type NeighborhoodNodeData = {
  label: string
  path: string
  startLine: number
  role: NeighborhoodNodeRole
}

type NeighborhoodGraphNode = Node<NeighborhoodNodeData>

const GAP_X = 280
const GAP_Y = 96
const CENTER_X = 360
const CENTER_Y = 220
const SEARCH_DEBOUNCE_MS = 350
const EDGE_STROKE = 'var(--muted-foreground)'

const fleet = useFleetRegistry()

const state = reactive<{
  query: string
  hasSearched: boolean
}>({
  query: '',
  hasSearched: false,
})

const loading = ref(false)
const nodes = ref<NeighborhoodGraphNode[]>([])
const edges = ref<Edge[]>([])
const searchGeneration = ref(0)

const flowNodes = computed(() => nodes.value as unknown as Node[])
const flowEdges = computed(() => edges.value as unknown as Edge[])

const nodeTypes = {
  neighborhood: markRaw(ProjectCodegraphNeighborhoodNode),
}

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  animated: false,
  style: {
    stroke: EDGE_STROKE,
    strokeWidth: 1.5,
  },
  markerEnd: MarkerType.ArrowClosed,
}

const hasGraph = computed(() => nodes.value.length > 0)

const basename = (path: string): string => {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

const looksLikeFilePath = (value: string): boolean =>
  value.includes('/') || value.includes('\\') || /\.[A-Za-z0-9]+$/.test(value)

const spanKey = (span: CodebaseToolSpan): string =>
  `${span.path}|${span.symbol ?? ''}|${span.startLine}`

const pickFocusSpan = (
  query: string,
  results: CodebaseToolSpan[],
): CodebaseToolSpan => {
  const trimmed = query.trim()
  const exact = results.find(
    (span) =>
      (span.symbol && span.symbol.toLowerCase() === trimmed.toLowerCase()) ||
      span.path === trimmed ||
      span.path.endsWith(trimmed),
  )
  if (exact) {
    return exact
  }
  if (results[0]) {
    return results[0]
  }
  return {
    path: trimmed,
    startLine: 1,
    endLine: 1,
    symbol: looksLikeFilePath(trimmed) ? basename(trimmed) : trimmed,
  }
}

const columnY = (count: number, index: number, centerY: number): number => {
  if (count <= 1) {
    return centerY
  }
  const start = centerY - ((count - 1) * GAP_Y) / 2
  return start + index * GAP_Y
}

const pushEdge = (
  nextEdges: Edge[],
  seen: Set<string>,
  sourceId: string,
  targetId: string,
  label: string,
  dashed = false,
): void => {
  if (sourceId === targetId) {
    return
  }
  const id = `${label}-${sourceId}-${targetId}`
  if (seen.has(id)) {
    return
  }
  seen.add(id)
  nextEdges.push({
    id,
    source: sourceId,
    target: targetId,
    sourceHandle: 'source',
    targetHandle: 'target',
    label,
    markerEnd: MarkerType.ArrowClosed,
    style: dashed
      ? { stroke: EDGE_STROKE, strokeWidth: 1.5, strokeDasharray: '4 3' }
      : { stroke: EDGE_STROKE, strokeWidth: 1.5 },
  })
}

const buildGraph = (
  focus: CodebaseToolSpan,
  callers: CodebaseToolSpan[],
  callees: CodebaseToolSpan[],
  impact: CodebaseImpactResult,
  related: CodebaseToolSpan[],
): { nodes: NeighborhoodGraphNode[]; edges: Edge[] } => {
  const byKey = new Map<string, NeighborhoodGraphNode>()
  const nextEdges: Edge[] = []
  const seenEdgeIds = new Set<string>()

  const upsert = (
    span: CodebaseToolSpan,
    role: NeighborhoodNodeRole,
    position: { x: number; y: number },
  ): NeighborhoodGraphNode => {
    const key = spanKey(span)
    const existing = byKey.get(key)
    if (existing) {
      if (role === 'focus' && existing.data) {
        existing.data.role = 'focus'
        existing.position = position
      }
      return existing
    }
    const label = span.symbol?.trim() || basename(span.path)
    const node: NeighborhoodGraphNode = {
      id: key,
      type: 'neighborhood',
      position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label,
        path: span.path,
        startLine: span.startLine,
        role,
      },
    }
    byKey.set(key, node)
    return node
  }

  const focusNode = upsert(focus, 'focus', { x: CENTER_X, y: CENTER_Y })

  callers.forEach((span, index) => {
    const node = upsert(span, 'caller', {
      x: CENTER_X - GAP_X,
      y: columnY(callers.length, index, CENTER_Y),
    })
    pushEdge(nextEdges, seenEdgeIds, node.id, focusNode.id, 'calls')
  })

  callees.forEach((span, index) => {
    const node = upsert(span, 'callee', {
      x: CENTER_X + GAP_X,
      y: columnY(callees.length, index, CENTER_Y),
    })
    pushEdge(nextEdges, seenEdgeIds, focusNode.id, node.id, 'calls')
  })

  const relatedExtras = related.filter((span) => !byKey.has(spanKey(span)))
  relatedExtras.forEach((span, index) => {
    const node = upsert(span, 'impact', {
      x: CENTER_X + ((index % 3) - 1) * (GAP_X * 0.7),
      y: CENTER_Y + GAP_Y * 2 + Math.floor(index / 3) * GAP_Y,
    })
    pushEdge(nextEdges, seenEdgeIds, focusNode.id, node.id, 'related', true)
  })

  const impactExtras = impact.results.filter((span) => !byKey.has(spanKey(span)))
  impactExtras.forEach((span, index) => {
    const offset = relatedExtras.length + index
    const node = upsert(span, 'impact', {
      x: CENTER_X + ((offset % 3) - 1) * (GAP_X * 0.7),
      y: CENTER_Y + GAP_Y * 2 + Math.floor(offset / 3) * GAP_Y,
    })
    pushEdge(nextEdges, seenEdgeIds, focusNode.id, node.id, 'impact', true)
  })

  if (impact.edges) {
    const byLabel = new Map<string, NeighborhoodGraphNode[]>()
    for (const node of byKey.values()) {
      const label = node.data?.label
      if (!label) {
        continue
      }
      const list = byLabel.get(label) ?? []
      list.push(node)
      byLabel.set(label, list)
    }
    for (const edge of impact.edges) {
      const sources = byLabel.get(edge.from) ?? []
      const targets = byLabel.get(edge.to) ?? []
      const source = sources[0]
      const target = targets[0]
      if (!source || !target) {
        continue
      }
      pushEdge(
        nextEdges,
        seenEdgeIds,
        source.id,
        target.id,
        edge.kind ?? 'depends',
        true,
      )
    }
  }

  return {
    nodes: [...byKey.values()],
    edges: nextEdges,
  }
}

const callCodegraphTool = async (
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> => mcpRuntime.callTool(CODEGRAPH_SERVER_ID, tool, args)

const valuesOrThrow = <T>(results: PromiseSettledResult<T>[]): T[] => {
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failed) {
    throw failed.reason
  }
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}

const matchIndexedFiles = (
  files: CodebaseToolSpan[],
  query: string,
): CodebaseToolSpan[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return []
  }
  const exact: CodebaseToolSpan[] = []
  const suffix: CodebaseToolSpan[] = []
  const partial: CodebaseToolSpan[] = []
  for (const file of files) {
    const pathLower = file.path.toLowerCase()
    const nameLower = basename(file.path).toLowerCase()
    if (pathLower === needle || nameLower === needle) {
      exact.push(file)
      continue
    }
    if (pathLower.endsWith(`/${needle}`) || nameLower.endsWith(needle)) {
      suffix.push(file)
      continue
    }
    if (pathLower.includes(needle) || nameLower.includes(needle)) {
      partial.push(file)
    }
  }
  return [...exact, ...suffix, ...partial]
}

const isFileOnlySpan = (span: CodebaseToolSpan): boolean =>
  !span.symbol || span.symbol === basename(span.path)

const runSearch = async (rawQuery: string): Promise<void> => {
  const query = rawQuery.trim()
  if (!query) {
    nodes.value = []
    edges.value = []
    state.hasSearched = false
    return
  }

  const project = fleet.activeProject.value
  if (!project) {
    toast.error('No active project', {
      description: 'Open a project before exploring the graph.',
    })
    return
  }

  const generation = ++searchGeneration.value
  loading.value = true
  state.hasSearched = true
  try {
    const status = await mcpRuntime.getStatus(CODEGRAPH_SERVER_ID)
    if (generation !== searchGeneration.value) {
      return
    }
    if (status.status !== 'connected') {
      nodes.value = []
      edges.value = []
      toast.error('Graph is not running', {
        description: status.error ?? 'Waiting for the graph to finish starting.',
      })
      return
    }

    const [searchRaw, filesRaw] = valuesOrThrow(
      await Promise.allSettled([
        callCodegraphTool('codegraph_search', {
          query,
          limit: 12,
          projectPath: project.rootPath,
        }),
        callCodegraphTool('codegraph_files', {
          format: 'flat',
          includeMetadata: true,
          projectPath: project.rootPath,
        }),
      ]),
    )
    if (generation !== searchGeneration.value) {
      return
    }

    const search = normalizeCodegraphResult.tool(searchRaw)
    const fileHits = matchIndexedFiles(
      normalizeCodegraphResult.files(filesRaw).results,
      query,
    ).slice(0, 12)

    const preferFiles = looksLikeFilePath(query) || search.results.length === 0
    const results =
      preferFiles && fileHits.length > 0
        ? fileHits
        : search.results.length > 0
          ? search.results
          : fileHits

    if (results.length === 0) {
      nodes.value = []
      edges.value = []
      return
    }

    const focus = pickFocusSpan(query, results)
    const fileFocus = isFileOnlySpan(focus) || looksLikeFilePath(query)

    if (fileFocus) {
      const filePath = focus.path
      const nodeRaw = await callCodegraphTool('codegraph_node', {
        file: filePath,
        symbolsOnly: true,
        projectPath: project.rootPath,
      })
      if (generation !== searchGeneration.value) {
        return
      }
      const fileSymbols = normalizeCodegraphResult.node(nodeRaw, filePath).results
      const related =
        fileSymbols.length > 0
          ? fileSymbols.slice(0, 24)
          : results.filter((span) => spanKey(span) !== spanKey(focus))
      const focusSpan: CodebaseToolSpan = {
        path: filePath,
        startLine: 1,
        endLine: 1,
      }
      const graph = buildGraph(
        focusSpan,
        [],
        [],
        { results: [] },
        related,
      )
      nodes.value = graph.nodes
      edges.value = graph.edges
      return
    }

    const symbol = focus.symbol?.trim() || query
    const fileHint = focus.path || undefined
    const toolArgs: Record<string, unknown> = {
      symbol,
      limit: 20,
      projectPath: project.rootPath,
    }
    if (fileHint) {
      toolArgs.file = fileHint
    }

    const [callersRaw, calleesRaw, impactRaw] = valuesOrThrow(
      await Promise.allSettled([
        callCodegraphTool('codegraph_callers', toolArgs),
        callCodegraphTool('codegraph_callees', toolArgs),
        callCodegraphTool('codegraph_impact', {
          symbol,
          ...(fileHint ? { file: fileHint } : {}),
          depth: 2,
          projectPath: project.rootPath,
        }),
      ]),
    )
    if (generation !== searchGeneration.value) {
      return
    }

    const callers = normalizeCodegraphResult.tool(callersRaw).results
    const callees = normalizeCodegraphResult.tool(calleesRaw).results
    const impact = normalizeCodegraphResult.impact(impactRaw)
    const related =
      callers.length === 0 && callees.length === 0
        ? results.filter((span) => spanKey(span) !== spanKey(focus))
        : []
    const graph = buildGraph(focus, callers, callees, impact, related)

    nodes.value = graph.nodes
    edges.value = graph.edges
  } catch (error) {
    if (generation !== searchGeneration.value) {
      return
    }
    nodes.value = []
    edges.value = []
    toast.error('Graph search failed', {
      description: invokeErrorMessage(error),
    })
  } finally {
    if (generation === searchGeneration.value) {
      loading.value = false
    }
  }
}

const debouncedSearch = useDebounceFn((query: string) => {
  runSearch(query).catch((error: unknown) => {
    toast.error('Graph search failed', {
      description: invokeErrorMessage(error),
    })
  })
}, SEARCH_DEBOUNCE_MS)

watch(
  () => state.query,
  (query) => {
    if (!query.trim()) {
      searchGeneration.value += 1
      loading.value = false
      nodes.value = []
      edges.value = []
      state.hasSearched = false
      return
    }
    loading.value = true
    debouncedSearch(query)
  },
)

const handleNodeClick = async (event: NodeMouseEvent): Promise<void> => {
  const data = event.node.data as NeighborhoodNodeData | undefined
  if (!data?.path) {
    return
  }

  const project = fleet.activeProject.value
  if (!project) {
    toast.error('No active project')
    return
  }

  try {
    const relative = toProjectRelativePath(data.path, project.rootPath)
    await openAtLine(project.id, relative, data.startLine)
  } catch (error) {
    toast.error('Could not open file', {
      description: invokeErrorMessage(error),
    })
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50 bg-muted/10">
    <div class="relative shrink-0 border-b border-border/50 p-3">
      <Search
        class="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="state.query"
        class="pl-8"
        placeholder="Search symbol or file"
        aria-label="Graph search"
      />
      <Loader2
        v-if="loading"
        class="pointer-events-none absolute top-1/2 right-5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
      />
    </div>

    <div
      v-if="loading && !hasGraph"
      class="flex min-h-0 flex-1 flex-col items-center justify-center p-6"
    >
      <Loader2 class="size-6 animate-spin text-muted-foreground" />
      <p class="mt-3 text-sm text-muted-foreground">
        Loading callers, callees, and impact...
      </p>
    </div>

    <div
      v-else-if="hasGraph"
      class="relative min-h-0 flex-1"
    >
      <div
        v-if="loading"
        class="absolute inset-x-0 top-0 z-10 flex justify-center p-2"
      >
        <span
          class="inline-flex items-center gap-2 rounded-md border border-border/50 bg-background/90 px-2 py-1 text-xs text-muted-foreground backdrop-blur"
        >
          <Loader2 class="size-3.5 animate-spin" />
          Updating
        </span>
      </div>
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :default-edge-options="defaultEdgeOptions"
        :pan-on-drag="true"
        :nodes-connectable="false"
        :fit-view-on-init="true"
        class="h-full w-full"
        @node-click="handleNodeClick"
      >
        <Background />
        <Controls />
      </VueFlow>
    </div>

    <Empty
      v-else
      class="min-h-0 flex-1 border-0 bg-transparent"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitBranch class="size-6" />
        </EmptyMedia>
        <EmptyTitle>
          {{ state.hasSearched ? 'No graph to show' : 'Search the graph' }}
        </EmptyTitle>
        <EmptyDescription>
          {{
            state.hasSearched
              ? 'No indexed files or symbols matched. Try a symbol, or a source file from the index (markdown and some configs may be missing).'
              : 'Search by symbol or file name to explore callers, callees, and related nodes.'
          }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
</template>
