import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import ProgressMark from './ProgressMark.vue'
import ProgressBoard from './ProgressBoard.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-after': () => h(ProgressMark)
    })
  },
  enhanceApp({ app }) {
    app.component('ProgressBoard', ProgressBoard)
  }
}
