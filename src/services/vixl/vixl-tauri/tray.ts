import { call } from './helpers'

export const trayRefreshAgents = (): Promise<void> => call('tray_refresh_agents')
