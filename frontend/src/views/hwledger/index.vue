<template>
  <section class="page" data-module="hwledger">
    <header class="page-head">
      <div>
        <h2>危废处置转出台账</h2>
        <p class="page-desc">联单结算结果自动落入的转出台账，按联单编号唯一入账，重复结算不会多出第二份记录。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出转出台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无台账记录，联单结算后自动入账</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条危废转出台账记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import { HW_LEDGER_KEY, LEDGER_COLUMNS } from '@/data/hwmanifest'
import type { EntryRow } from '@/data/types'

const columns: string[] = [...LEDGER_COLUMNS]
const filterFields = ['联单编号', '处置单位', '转移日期']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '已入账记录', value: rows.value.length },
  {
    label: '累计转出量（吨）',
    value: rows.value.reduce((sum, row) => sum + (Number(row['转移量（吨）']) || 0), 0),
  },
])

function exportRows() {
  downloadEntries(HW_LEDGER_KEY)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(HW_LEDGER_KEY, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '危废处置转出台账读取失败'
  }
}

onMounted(reload)
</script>
