<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, withBase } from 'vitepress'
import { LABS, READ_KEY, LAB_KEY, load, toggle } from './progress'

const route = useRoute()
const read = ref(false)
const passed = ref(false)

function page() {
  const base = withBase('/')
  const p = route.path.replace(/\.html$/, '')
  return p.startsWith(base) ? '/' + p.slice(base.length) : p
}
const lab = computed(() => LABS[page()])
function sync() {
  read.value = !!load(READ_KEY)[page()]
  passed.value = !!(lab.value && load(LAB_KEY)[lab.value])
}
function toggleRead() { toggle(READ_KEY, page()); sync() }
function togglePassed() { if (lab.value) { toggle(LAB_KEY, lab.value); sync() } }
onMounted(sync)
watch(() => route.path, sync)
</script>

<template>
  <div class="progress-mark">
    <div class="actions">
      <button :class="{ done: read }" @click="toggleRead">
        {{ read ? '✅ 已阅读（点击取消）' : '☐ 标记本章为已阅读' }}
      </button>
      <button v-if="lab" :class="{ done: passed }" @click="togglePassed"
        :title="`运行 npm run lab -- ${lab} 全部测试通过后再标记`">
        {{ passed ? `🧪 实验 ${lab} 已通过` : `☐ 实验 ${lab} 已通过` }}
      </button>
    </div>
    <span v-if="lab" class="hint">实验命令：<code>npm run lab -- {{ lab }}</code></span>
    <a :href="withBase('/guide/roadmap#学习进度')">查看总进度 →</a>
  </div>
</template>
