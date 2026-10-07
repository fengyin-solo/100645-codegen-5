<template>
  <section class="page" data-module="hwmanifest">
    <header class="page-head">
      <div>
        <h2>危险废物转移联单</h2>
        <p class="page-desc">一车一条转移联单，联单编号按批次连续生成；转移量以过磅单为准，回执上传后才允许结算，结算结果自动落入危废处置转出台账。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">
          {{ showCreate ? '收起登记' : '登记转移联单' }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showCreate" class="panel" @submit.prevent="submitCreate">
      <h3 class="panel-title">登记转移联单（同一车次重复登记只保留一份）</h3>
      <div class="form-grid">
        <label class="filter-item">
          <span>车次</span>
          <input v-model="createForm.车次" placeholder="如 TRIP-1007-01" />
        </label>
        <label class="filter-item">
          <span>承运车号</span>
          <input v-model="createForm.承运车号" placeholder="如 皖A·D12345" />
        </label>
        <label class="filter-item">
          <span>危险废物类别</span>
          <input v-model="createForm.危险废物类别" list="waste-categories" placeholder="选择或填写危废类别" />
          <datalist id="waste-categories">
            <option v-for="item in wasteCategories" :key="item" :value="item" />
          </datalist>
        </label>
        <label class="filter-item">
          <span>申报量（吨）</span>
          <input v-model="createForm.申报量" type="number" step="0.001" min="0" placeholder="转移申报量" />
        </label>
        <label class="filter-item">
          <span>过磅单号</span>
          <input v-model="createForm.过磅单号" placeholder="如 WEIG-1007-01" />
        </label>
        <label class="filter-item">
          <span>过磅量（吨）</span>
          <input v-model="createForm.过磅量" type="number" step="0.001" min="0" placeholder="以过磅单为准" />
        </label>
        <label class="filter-item">
          <span>处置单位</span>
          <input v-model="createForm.处置单位" list="disposal-units" placeholder="选择或填写处置单位" />
          <datalist id="disposal-units">
            <option v-for="item in disposalUnits" :key="item" :value="item" />
          </datalist>
        </label>
        <label class="filter-item">
          <span>转移日期</span>
          <input v-model="createForm.转移日期" type="date" />
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交登记</button>
        <button class="btn ghost" type="button" @click="resetCreateForm">清空</button>
      </div>
    </form>

    <form class="panel" @submit.prevent="runExport">
      <h3 class="panel-title">按时间段打包导出（导出件字段与页面完全一致）</h3>
      <div class="filter-bar export-bar">
        <label class="filter-item">
          <span>开始日期</span>
          <input v-model="exportRange.start" type="date" />
        </label>
        <label class="filter-item">
          <span>结束日期</span>
          <input v-model="exportRange.end" type="date" />
        </label>
        <button class="btn primary" type="submit">导出转移联单</button>
      </div>
      <p v-if="exportMessage" class="export-result" :class="{ 'error-text': exportFailed }">
        {{ exportMessage }}
      </p>
    </form>

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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr :class="{ 'diff-manifest': hasDiff(row) }">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="row.status !== '已结算'"
                class="link"
                type="button"
                @click="pickReceipt(row)"
              >
                {{ row.status === '回执已上传' ? '重传回执' : '上传回执' }}
              </button>
              <button
                class="link"
                type="button"
                :disabled="row.status !== '回执已上传'"
                :title="row.status === '回执已上传' ? '办理结算' : '回执上传后才允许结算'"
                @click="settle(row)"
              >
                结算
              </button>
            </td>
          </tr>
          <tr v-if="hasDiff(row)" class="diff-row">
            <td :colspan="columns.length + 2">⚠ 差异说明：{{ row['差异说明'] }}</td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无危险废物转移联单，可先登记转移联单</td>
        </tr>
      </tbody>
    </table>

    <input
      ref="receiptInput"
      type="file"
      accept=".pdf,.jpg,.jpeg,.png"
      class="visually-hidden"
      @change="onReceiptPicked"
    />

    <footer class="page-foot">
      <span>共 {{ total }} 条危险废物转移联单</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createManifest,
  exportManifests,
  settleManifest,
  uploadReceipt,
} from '@/api/hwmanifest-service'
import { listEntries } from '@/api/local-service'
import {
  DISPOSAL_UNITS,
  HW_MANIFEST_KEY,
  MANIFEST_COLUMNS,
  MANIFEST_STATUSES,
  WASTE_CATEGORIES,
} from '@/data/hwmanifest'
import type { EntryRow } from '@/data/types'

const columns: string[] = [...MANIFEST_COLUMNS]
const wasteCategories = WASTE_CATEGORIES
const disposalUnits = DISPOSAL_UNITS
const filterFields = ['联单编号', '车次', '处置单位']

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const showCreate = ref(false)

const emptyCreateForm = () => ({
  车次: '',
  承运车号: '',
  危险废物类别: '',
  申报量: '',
  过磅单号: '',
  过磅量: '',
  处置单位: '',
  转移日期: new Date().toISOString().slice(0, 10),
})
const createForm = reactive(emptyCreateForm())

const exportRange = reactive({ start: '', end: '' })
const exportMessage = ref('')
const exportFailed = ref(false)

const receiptInput = ref<HTMLInputElement | null>(null)
const receiptTargetId = ref<number | null>(null)

const stats = computed(() => [
  { label: '待回执联单', value: countByStatus('待回执') },
  { label: '回执已上传', value: countByStatus('回执已上传') },
  { label: '已结算联单', value: countByStatus('已结算') },
  { label: '有差异联单', value: allRows.value.filter((row) => hasDiff(row)).length },
])

const statusSummary = computed(() =>
  MANIFEST_STATUSES.map((status) => ({
    status,
    count: countByStatus(status),
  })),
)

function countByStatus(status: string): number {
  return allRows.value.filter((row) => String(row.status) === status).length
}

function hasDiff(row: EntryRow): boolean {
  return Number(row['差异（吨）'] ?? 0) !== 0
}

function resetCreateForm() {
  Object.assign(createForm, emptyCreateForm())
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createManifest({
    车次: createForm.车次,
    承运车号: createForm.承运车号,
    危险废物类别: createForm.危险废物类别,
    申报量: Number(createForm.申报量),
    过磅单号: createForm.过磅单号,
    过磅量: Number(createForm.过磅量),
    处置单位: createForm.处置单位,
    转移日期: createForm.转移日期,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  if (!result.duplicated) {
    resetCreateForm()
    showCreate.value = false
  }
  reload()
}

function pickReceipt(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  receiptTargetId.value = Number(row.id)
  const input = receiptInput.value
  if (input) {
    input.value = ''
    input.click()
  }
}

async function onReceiptPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  const id = receiptTargetId.value
  if (id === null) {
    return
  }
  const result = await uploadReceipt(id, file)
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = `${result.message}（可重新点击「上传回执」重试）`
  }
  input.value = ''
  reload()
}

function settle(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = settleManifest(Number(row.id))
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function runExport() {
  exportMessage.value = ''
  exportFailed.value = false
  const result = exportManifests(exportRange.start, exportRange.end)
  if (!result.ok || !result.content || !result.filename) {
    exportFailed.value = true
    exportMessage.value = `导出失败：${result.message}`
    return
  }
  const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  exportMessage.value = `${result.message}：${(result.columns ?? []).join('、')}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  try {
    allRows.value = listEntries(HW_MANIFEST_KEY).items
    const payload = listEntries(HW_MANIFEST_KEY, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '危险废物转移联单列表读取失败'
  }
}

onMounted(reload)
</script>
