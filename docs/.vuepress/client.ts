import '@fontsource-variable/inter/wght.css'
import { defineClientConfig } from 'vuepress/client'
import MarketingHome from './layouts/MarketingHome.vue'
import './styles/tailwind.css'

export default defineClientConfig({
  layouts: {
    MarketingHome,
  },
})
