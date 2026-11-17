<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useData, withBase } from 'vitepress'
import { LABS, READ_KEY, LAB_KEY, load } from './progress'

const { theme } = useData()
const reads = ref<Record<string, number>>({})
const labs = ref<Record<string, number>>({})

const groups = computed(() => (theme.value.sidebar as any[]).map(g => ({
  text: g.text,
  items: g.items.map((i: any) => ({
    ...i,
    read: !!reads.value[i.link],
    lab: LABS[i.link],
    passed: !!(LABS[i.link] && labs.value[LABS[i.link]])
  }))
})))
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
const finished = computed(() => groups.value.reduce((n, g) => n + g.items.filter((i: any) => i.read).length, 0))
const labTotal = Object.keys(LABS).length
const labPassed = computed(() => Object.values(LABS).filter(l => labs.value[l]).length)
const percent = computed(() => total.value ? Math.round(finished.value / total.value * 100) : 0)
const labPercent = computed(() => Math.round(labPassed.value / labTotal * 100))

onMounted(() => { reads.value = load(READ_KEY); labs.value = load(LAB_KEY) })
function reset() {
  if (confirm('确定清空学习进度？')) {
    localStorage.removeItem(READ_KEY); localStorage.removeItem(LAB_KEY)
    reads.value = {}; labs.value = {}
  }
}
</script>

<template>
  <div class="progress-board">
    <p><strong>阅读：{{ finished }} / {{ total }}</strong> 章（{{ percent }}%）</p>
    <div class="bar"><div class="fill" :style="{ width: percent + '%' }"></div></div>
    <p><strong>实验：{{ labPassed }} / {{ labTotal }}</strong> 个已通过（{{ labPercent }}%）
      <button class="reset" @click="reset">重置</button></p>
    <div class="bar"><div class="fill lab" :style="{ width: labPercent + '%' }"></div></div>
    <p class="note">进度保存在本机浏览器中，属于自我声明。实验是否真正通过以 <code>npm run lab -- &lt;name&gt;</code> 的输出为准。</p>
    <div v-for="g in groups" :key="g.text" class="group">
      <h4>{{ g.text }}</h4>
      <ul>
        <li v-for="i in g.items" :key="i.link">
          <span>{{ i.read ? '✅' : '⬜' }}</span>
          <a :href="withBase(i.link)">{{ i.text }}</a>
          <span v-if="i.lab" class="lab-badge" :class="{ passed: i.passed }">
            🧪 {{ i.lab }}{{ i.passed ? ' ✓' : '' }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
