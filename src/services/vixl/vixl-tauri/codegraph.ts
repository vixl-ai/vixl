import type { GraphListItem } from '@/types/codegraph/graph-list-item'
import type { CodegraphStoreStat } from '@/types/codegraph/store-stat'
import { call } from './helpers'
import type { CodegraphCliResult } from './types'

/** Allowlisted CodeGraph CLI (`init` | `index`). Spawns `npx -y @colbymchenry/codegraph`. */
export const codegraphCli = (
  projectRoot: string,
  action: 'init' | 'index',
): Promise<CodegraphCliResult> => call('codegraph_cli', { projectRoot, action })

export const codegraphStoreStat = (
  projectRoot: string,
): Promise<CodegraphStoreStat> =>
  call('codegraph_store_stat', { projectRoot })

export const listGraphs = (): Promise<GraphListItem[]> => call('list_graphs')

export const deleteGraph = (id: string): Promise<void> => call('delete_graph', { id })
