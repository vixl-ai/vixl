import { call } from './helpers'
import type { WebFetchRequest, WebFetchResponse } from './types'

export default (request: WebFetchRequest): Promise<WebFetchResponse> =>
  call('web_fetch', { request })
