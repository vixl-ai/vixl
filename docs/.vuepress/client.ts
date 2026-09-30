import { defineClientConfig } from 'vuepress/client'
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import Landing from './landing/LandingLayout.vue'
import './landing/styles/landing.css'

export default defineClientConfig({
  layouts: {
    Landing,
  },
})
