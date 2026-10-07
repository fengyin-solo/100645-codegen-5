<template>
  <section class="page" data-module="hazwaste-ledger">
    <header class="page-head">
      <div>
        <h2>危废处置转出台账</h2>
        <p class="page-desc">结算结果按联单落账：一条联单只对应一条台账，重复结算不会多出第二份；转移量取过磅量。</p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="goBack">返回转移联单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">台账条目</span>
        <strong class="stat-value">{{ filtered.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计转出量（吨）</span>
        <strong class="stat-value">{{ totalWeight }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">涉及联单（去重）</span>
        <strong class="stat-value">{{ manifestCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">重复落账</span>
        <strong class="stat-value" :class="{ warn: duplicateCount > 0 }">{{ duplicateCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>结算开始日期</span>
        <input v-model="startDate" type="date" />
      </label>
      <label class="filter-item">
        <span>结算结束日期</span>
        <input v-model="endDate" type="date" />
      </label>
      <label class="filter-item">
        <span>处置单位 / 车号 / 联单编号</span>
        <input v-model="keyword" placeholder="按关键字检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="duplicateCount > 0" class="error-text">
      检测到 {{ duplicateCount }} 个联单在台账中出现多条记录，正常流程不应出现，请核查数据。
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in filtered" :key="entry.id">
          <td>{{ entry.id }}</td>
          <td>{{ entry.manifestNo }}</td>
          <td>{{ entry.batchNo }}</td>
          <td>{{ entry.hazardCategory }}</td>
          <td>{{ entry.outboundWeightTon }}</td>
          <td>{{ entry.carrierVehicleNo }}</td>
          <td>{{ entry.disposalUnit }}</td>
          <td>{{ entry.transferDate }}</td>
          <td>{{ entry.settlementDate }}</td>
        </tr>
        <tr v-if="!filtered.length">
          <td :colspan="columns.length" class="empty-state">暂无台账记录，联单结算后自动落账</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>台账条目与联单一一对应，结算重放不产生新记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { listLedger } from './store'
import type { HazwasteLedgerEntry } from './types'

const router = useRouter()

const columns = [
  '台账编号',
  '来源联单编号',
  '批次',
  '危险废物类别',
  '转出量(吨)',
  '承运车号',
  '处置单位',
  '转移日期',
  '结算日期',
]

const entries = ref<HazwasteLedgerEntry[]>([])
const startDate = ref('')
const endDate = ref('')
const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return entries.value
    .filter((e) => (startDate.value ? e.settlementDate >= startDate.value : true))
    .filter((e) => (endDate.value ? e.settlementDate <= endDate.value : true))
    .filter((e) =>
      kw
        ? [e.manifestNo, e.batchNo, e.hazardCategory, e.carrierVehicleNo, e.disposalUnit].join(' ').toLowerCase().includes(kw)
        : true,
    )
    .sort((a, b) => b.id - a.id)
})

const totalWeight = computed(() =>
  filtered.value.reduce((sum, entry) => Math.round((sum + entry.outboundWeightTon) * 100) / 100, 0),
)
const manifestCount = computed(() => new Set(filtered.value.map((e) => e.manifestId)).size)
const duplicateCount = computed(() => {
  const seen = new Map<number, number>()
  for (const entry of entries.value) {
    seen.set(entry.manifestId, (seen.get(entry.manifestId) ?? 0) + 1)
  }
  return [...seen.values()].filter((n) => n > 1).length
})

function reload() {
  entries.value = listLedger()
}

function resetFilters() {
  startDate.value = ''
  endDate.value = ''
  keyword.value = ''
  reload()
}

function goBack() {
  router.push('/hazwaste')
}

onMounted(reload)
</script>

<style scoped>
.warn { color: #b42318; }
</style>
