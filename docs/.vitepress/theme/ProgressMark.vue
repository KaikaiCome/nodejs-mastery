<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute, withBase } from 'vitepress'

const KEY = 'nodejs-mastery-progress'
const route = useRoute()
const done = ref(false)

function read(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
function page() {
  const base = withBase('/')
  const p = route.path.replace(/\.html$/, '')
  return p.startsWith(base) ? '/' + p.slice(base.length) : p
}
function sync() { done.value = !!read()[page()] }
function toggle() {
  const data = read()
  if (data[page()]) delete data[page()]
  else data[page()] = Date.now()
  localStorage.setItem(KEY, JSON.stringify(data))
  sync()
}
onMounted(sync)
watch(() => route.path, sync)
</script>

<template>
  <div class="progress-mark">
    <button :class="{ done }" @click="toggle">
      {{ done ? '✅ 已学完（点击取消）' : '☐ 标记本章为已学完' }}
    </button>
    <a :href="withBase('/guide/roadmap#学习进度')">查看总进度 →</a>
  </div>
</template>
