import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { i18n } from './locales'
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css'
import ContextMenu from '@imengyu/vue3-context-menu'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(ContextMenu)

app.mount('#app')

if (import.meta.env.VITE_AGENT_EVAL === 'true') {
  const { installBrowserHarness } = await import('./core/evaluation/browserHarness')
  installBrowserHarness()
}
