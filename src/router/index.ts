import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/views/HomePage.vue'
import SettingsView from '@/views/SettingsView.vue'
import AgentThreadView from '@/views/AgentThreadView.vue'
import ProjectView from '@/views/ProjectView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomePage,
    },
    {
      path: '/chat/:chatId',
      name: 'home-chat',
      component: AgentThreadView,
    },
    {
      path: '/chat/:chatId/subagent/:subagentId',
      name: 'home-chat-subagent',
      component: AgentThreadView,
    },
    {
      path: '/project/:slug',
      name: 'project',
      component: ProjectView,
    },
    {
      path: '/project/:slug/chat/:chatId',
      name: 'chat',
      component: AgentThreadView,
    },
    {
      path: '/project/:slug/chat/:chatId/subagent/:subagentId',
      name: 'chat-subagent',
      component: AgentThreadView,
    },
    {
      path: '/group/:slug',
      name: 'group',
      component: ProjectView,
    },
    {
      path: '/group/:slug/chat/:chatId',
      name: 'group-chat',
      component: AgentThreadView,
    },
    {
      path: '/group/:slug/chat/:chatId/subagent/:subagentId',
      name: 'group-chat-subagent',
      component: AgentThreadView,
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
    },
  ],
})

export default router
