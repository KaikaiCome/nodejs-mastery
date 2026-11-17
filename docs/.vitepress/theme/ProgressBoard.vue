<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useData, withBase } from 'vitepress'

const KEY = 'nodejs-mastery-progress'
const { theme } = useData()
const progress = ref<Record<string, number>>({})

const groups = computed(() => (theme.value.sidebar as any[]).map(g => ({
  text: g.text,
  items: g.items.map((i: any) => ({ ...i, done: !!progress.value[i.link] }))
})))
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
const finished = computed(() => groups.value.reduce((n, g) => n + g.items.filter((i: any) => i.done).length, 0))
const percent = computed(() => total.value ? Math.round(finished.value / total.value * 100) : 0)

onMounted(() => {
  try { progress.value = JSON.parse(localStorage.getItem(KEY) || '{}') } catch {}
})
function reset() {
  if (confirm('确定清空学习进度？')) { localStorage.removeItem(KEY); progress.value = {} }
}
</script>

<template>
  <div class="progress-board">
    <div class="bar"><div class="fill" :style="{ width: percent + '%' }"></div></div>
    <p><strong>{{ finished }} / {{ total }}</strong> 章已完成（{{ percent }}%）
      <button class="reset" @click="reset">重置</button></p>
    <div v-for="g in groups" :key="g.text" class="group">
      <h4>{{ g.text }}</h4>
      <ul>
        <li v-for="i in g.items" :key="i.link">
          <span>{{ i.done ? '✅' : '⬜' }}</span>
          <a :href="withBase(i.link)">{{ i.text }}</a>
        </li>
      </ul>
    </div>
  </div>
</template>
