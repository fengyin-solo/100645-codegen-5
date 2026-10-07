<template>
  <section class="page" data-module="hazwaste">
    <header class="page-head">
      <div>
        <h2>危险废物转移联单</h2>
        <p class="page-desc">一车一条转移联单，挂危险废物类别、转移量、承运车号与处置单位，联单编号按批次连续生成；过磅单定转移量，回执到齐方可结算。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记转移联单</button>
        <button class="btn" type="button" @click="toggleExportPanel">按时间段打包导出</button>
        <button class="btn ghost" type="button" @click="goLedger">查看转出台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ warn: item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="exportOpen" class="export-panel" @submit.prevent="runExport">
      <label class="filter-item">
        <span>开始日期</span>
        <input v-model="exportStart" type="date" />
      </label>
      <label class="filter-item">
        <span>结束日期</span>
        <input v-model="exportEnd" type="date" />
      </label>
      <button class="btn primary" type="submit" :disabled="exporting">{{ exporting ? '导出中…' : '导出一份文件' }}</button>
      <button class="btn ghost" type="button" @click="exportOpen = false">收起</button>
      <span class="panel-hint">导出件列与本表完全一致：{{ exportColumns.length }} 列</span>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="keyword" placeholder="联单编号 / 车号 / 处置单位 / 危废类别" />
      </label>
      <label class="filter-item">
        <span>联单状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="s in manifestStatuses" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table manifest-table">
      <thead>
        <tr>
          <th v-for="column in exportColumns" :key="column">{{ column }}</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in filteredRows" :key="row.id">
          <tr :class="{ 'row-abnormal': row.abnormal && row.status !== '已结算' }">
            <td>{{ row.manifestNo }}</td>
            <td>{{ row.batchNo }}</td>
            <td>{{ row.hazardCategory }}</td>
            <td>{{ row.declaredWeightTon }}</td>
            <td>{{ row.weighNote ? row.weighNote.weightTon : '—' }}</td>
            <td>
              <span v-if="row.weightDiffTon !== null" :class="diffClass(row.weightDiffTon)">
                {{ formatDiff(row.weightDiffTon) }}
              </span>
              <span v-else>—</span>
            </td>
            <td>{{ row.carrierVehicleNo }}</td>
            <td>{{ row.disposalUnit }}</td>
            <td>{{ row.transferDate }}</td>
            <td>{{ row.weighNote ? row.weighNote.ticketNo : '—' }}</td>
            <td>
              <span v-if="row.receipt" :title="`${row.receipt.fileName}（${row.receipt.uploadedAt} 上传）`">
                {{ row.receipt.fileName }}
              </span>
              <span v-else class="muted">未上传</span>
            </td>
            <td>
              <span :class="{ 'tag-abnormal': row.abnormal && row.status !== '已结算' }">{{ row.status }}</span>
            </td>
            <td>{{ row.settledAt ?? '—' }}</td>
            <td class="row-actions">
              <button v-if="row.status === '待过磅' || row.status === '已过磅'" class="link" type="button" @click="openWeigh(row)">
                {{ row.weighNote ? '更正过磅单' : '登记过磅单' }}
              </button>
              <button
                v-if="row.status === '待过磅' || row.status === '已过磅' || row.status === '回执已收'"
                class="link"
                type="button"
                @click="pickReceipt(row)"
              >
                {{ row.receipt ? '重传回执' : '上传回执' }}
              </button>
              <button
                v-if="row.status === '回执已收'"
                class="link"
                type="button"
                :disabled="settlingId === row.id"
                @click="settle(row)"
              >
                {{ settlingId === row.id ? '结算中…' : '结算' }}
              </button>
              <button v-if="row.status === '已结算'" class="link" type="button" @click="settle(row)">再次结算</button>
            </td>
          </tr>
          <tr v-if="row.weighNote && row.weightDiffTon !== null" class="diff-row" :class="{ 'diff-abnormal': row.abnormal }">
            <td :colspan="exportColumns.length + 1">
              <span class="diff-label">过磅差异（挂在本联单下）：</span>
              过磅单号 {{ row.weighNote.ticketNo }}，申报量 {{ row.declaredWeightTon }} 吨，过磅量
              {{ row.weighNote.weightTon }} 吨，差异 {{ formatDiff(row.weightDiffTon) }} 吨；
              <em>转移量以过磅单为准</em>
              <span v-if="row.abnormal" class="diff-warn">差异超出 ±5%（且 &gt;0.1 吨），联单已标记异常</span>
            </td>
          </tr>
        </template>
        <tr v-if="!filteredRows.length">
          <td :colspan="exportColumns.length + 1" class="empty-state">暂无符合条件的转移联单，可先登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条联单（全部 {{ manifests.length }} 条）</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记联单 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记危险废物转移联单</h3>
        <p class="modal-hint">同一承运车号同一天视为同一车次，重复登记只保留一份联单；联单编号登记后按批次自动连号。</p>
        <div class="form-grid">
          <label class="form-item">
            <span>危险废物类别</span>
            <input v-model="createForm.hazardCategory" list="hw-category-options" placeholder="如 HW06 废有机溶剂" />
            <datalist id="hw-category-options">
              <option v-for="c in hazardCategoryOptions" :key="c" :value="c" />
            </datalist>
          </label>
          <label class="form-item">
            <span>申报转移量（吨）</span>
            <input v-model.number="createForm.declaredWeightTon" type="number" min="0" step="0.01" />
          </label>
          <label class="form-item">
            <span>承运车号</span>
            <input v-model="createForm.carrierVehicleNo" placeholder="如 沪A·H1024" />
          </label>
          <label class="form-item">
            <span>处置单位</span>
            <input v-model="createForm.disposalUnit" list="disposal-unit-options" placeholder="持证处置单位全称" />
            <datalist id="disposal-unit-options">
              <option v-for="u in disposalUnitOptions" :key="u" :value="u" />
            </datalist>
          </label>
          <label class="form-item">
            <span>转移日期</span>
            <input v-model="createForm.transferDate" type="date" />
          </label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">登记</button>
        </div>
      </div>
    </div>

    <!-- 过磅单 -->
    <div v-if="weighOpen" class="modal-mask" @click.self="weighOpen = false">
      <div class="modal">
        <h3>登记过磅单</h3>
        <p class="modal-hint">联单 {{ weighTarget?.manifestNo }}：转移量以过磅单为准，与申报量对不上时差异挂在联单下面。</p>
        <div class="form-grid">
          <label class="form-item">
            <span>过磅单号</span>
            <input v-model="weighForm.ticketNo" placeholder="如 WB-261007-01" />
          </label>
          <label class="form-item">
            <span>过磅时间</span>
            <input v-model="weighForm.weighedAt" type="datetime-local" />
          </label>
          <label class="form-item">
            <span>过磅量（吨）</span>
            <input v-model.number="weighForm.weightTon" type="number" min="0" step="0.01" />
          </label>
        </div>
        <p v-if="weighError" class="error-text">{{ weighError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="weighOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitWeigh">保存过磅单</button>
        </div>
      </div>
    </div>

    <input
      ref="receiptInput"
      type="file"
      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
      class="hidden-file"
      @change="onReceiptPicked"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  downloadTextFile,
  EXPORT_COLUMNS,
  exportManifestsByRange,
  recordWeigh,
  saveManifest,
  settleManifest,
  uploadReceipt,
} from './service'
import { listManifests } from './store'
import { MANIFEST_STATUSES, type HazwasteManifest } from './types'

const router = useRouter()

const exportColumns = EXPORT_COLUMNS
const manifestStatuses = MANIFEST_STATUSES
const hazardCategoryOptions = ['HW06 废有机溶剂', 'HW08 废矿物油', 'HW18 焚烧处置残渣', 'HW34 废酸', 'HW49 其他废物']
const disposalUnitOptions = ['绿源危废处置有限公司', '环信工业废物处理中心']

const manifests = ref<HazwasteManifest[]>([])
const keyword = ref('')
const statusFilter = ref('')
const errorMessage = ref('')
const infoMessage = ref('')

const exportOpen = ref(false)
const exportStart = ref('')
const exportEnd = ref('')
const exporting = ref(false)

const createOpen = ref(false)
const createError = ref('')
const createForm = ref({ hazardCategory: '', declaredWeightTon: '' as number | '', carrierVehicleNo: '', disposalUnit: '', transferDate: '' })

const weighOpen = ref(false)
const weighError = ref('')
const weighTarget = ref<HazwasteManifest | null>(null)
const weighForm = ref({ ticketNo: '', weighedAt: '', weightTon: '' as number | '' })

const receiptInput = ref<HTMLInputElement | null>(null)
const receiptTargetId = ref<number | null>(null)
const settlingId = ref<number | null>(null)

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return manifests.value
    .filter((row) => (statusFilter.value ? row.status === statusFilter.value : true))
    .filter((row) =>
      kw
        ? [row.manifestNo, row.batchNo, row.carrierVehicleNo, row.disposalUnit, row.hazardCategory]
            .join(' ')
            .toLowerCase()
            .includes(kw)
        : true,
    )
    .sort((a, b) => b.id - a.id)
})

const stats = computed(() => [
  { label: '待过磅', value: manifests.value.filter((r) => r.status === '待过磅').length, warn: false },
  { label: '待回执（已过磅）', value: manifests.value.filter((r) => r.status === '已过磅').length, warn: false },
  { label: '待结算（回执已收）', value: manifests.value.filter((r) => r.status === '回执已收').length, warn: false },
  { label: '已结算', value: manifests.value.filter((r) => r.status === '已结算').length, warn: false },
  { label: '异常联单', value: manifests.value.filter((r) => r.abnormal && r.status !== '已结算').length, warn: true },
])

const statusSummary = computed(() =>
  manifestStatuses.map((status) => ({ status, count: manifests.value.filter((row) => row.status === status).length })),
)

function reload() {
  errorMessage.value = ''
  manifests.value = listManifests()
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
  reload()
}

function flash(message: string, ok = false) {
  if (ok) {
    infoMessage.value = message
    errorMessage.value = ''
  } else {
    errorMessage.value = message
    infoMessage.value = ''
  }
  window.setTimeout(() => {
    if (ok) infoMessage.value = ''
    else errorMessage.value = ''
  }, 5000)
}

function goLedger() {
  router.push('/hazwaste-ledger')
}

function toggleExportPanel() {
  exportOpen.value = !exportOpen.value
  if (exportOpen.value && !exportEnd.value) {
    exportEnd.value = new Date().toISOString().slice(0, 10)
    exportStart.value = exportEnd.value.slice(0, 8) + '01'
  }
}

function runExport() {
  errorMessage.value = ''
  exporting.value = true
  try {
    const result = exportManifestsByRange(exportStart.value, exportEnd.value)
    if (!result.ok) {
      flash(result.message)
      return
    }
    downloadTextFile(result.filename, result.content)
    flash(`已将 ${result.count} 条联单打包导出为 ${result.filename}，字段与本页一致（${EXPORT_COLUMNS.length} 列）`, true)
  } catch {
    flash('导出失败：文件没有生成，请重试')
  } finally {
    exporting.value = false
  }
}

function openCreate() {
  createError.value = ''
  createForm.value = {
    hazardCategory: '',
    declaredWeightTon: '',
    carrierVehicleNo: '',
    disposalUnit: '',
    transferDate: new Date().toISOString().slice(0, 10),
  }
  createOpen.value = true
}

function submitCreate() {
  const form = createForm.value
  const result = saveManifest({
    hazardCategory: form.hazardCategory,
    declaredWeightTon: Number(form.declaredWeightTon),
    carrierVehicleNo: form.carrierVehicleNo,
    disposalUnit: form.disposalUnit,
    transferDate: form.transferDate,
  })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
  if (result.duplicated) {
    flash(`该车次在 ${result.manifest.transferDate} 已登记过联单 ${result.manifest.manifestNo}，只保留这一份，未重复登记`, true)
  } else {
    flash(`联单 ${result.manifest.manifestNo} 已登记（批次 ${result.manifest.batchNo} 第 ${result.manifest.seqInBatch} 号）`, true)
  }
}

function openWeigh(row: HazwasteManifest) {
  weighTarget.value = row
  weighError.value = ''
  weighForm.value = {
    ticketNo: row.weighNote?.ticketNo ?? '',
    weighedAt: row.weighNote?.weighedAt.replace(' ', 'T').slice(0, 16) ?? '',
    weightTon: row.weighNote?.weightTon ?? '',
  }
  weighOpen.value = true
}

function submitWeigh() {
  if (!weighTarget.value) return
  const form = weighForm.value
  const result = recordWeigh(weighTarget.value.id, {
    ticketNo: form.ticketNo,
    weighedAt: form.weighedAt ? form.weighedAt.replace('T', ' ') : '',
    weightTon: Number(form.weightTon),
  })
  if (!result.ok) {
    weighError.value = result.message
    return
  }
  weighOpen.value = false
  reload()
  flash(`过磅单已保存，差异 ${formatDiff(result.diffTon)} 吨已挂在联单 ${result.manifest.manifestNo} 下，转移量以过磅单为准`, true)
}

function pickReceipt(row: HazwasteManifest) {
  errorMessage.value = ''
  receiptTargetId.value = row.id
  const input = receiptInput.value
  if (input) {
    // 清空 value，失败后重选同一个文件也能再次触发 change，支持重试。
    input.value = ''
    input.click()
  }
}

async function onReceiptPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const targetId = receiptTargetId.value
  if (!file || targetId === null) return

  const result = await uploadReceipt(targetId, file, (f) => f.arrayBuffer())
  if (!result.ok) {
    // 上传的不是回执或读不出来：明确失败，保留入口供重试。
    flash(`回执上传失败：${result.message}`)
    return
  }
  reload()
  flash(`处置单位回执「${result.manifest.receipt?.fileName}」已上传，联单 ${result.manifest.manifestNo} 可以结算`, true)
}

function settle(row: HazwasteManifest) {
  settlingId.value = row.id
  // 拆一个宏任务让“结算中”能渲染出来，同时保持结算逻辑本身同步、可重复执行。
  window.setTimeout(() => {
    try {
      const result = settleManifest(row.id)
      if (!result.ok) {
        flash(result.message)
        return
      }
      reload()
      if (result.duplicated) {
        flash(`联单 ${result.manifest.manifestNo} 早已结算，台账 ${result.ledgerEntry.id} 号已存在，未生成第二份`, true)
      } else {
        flash(`联单 ${result.manifest.manifestNo} 已结算，结果已落到危废处置转出台账（台账编号 ${result.ledgerEntry.id}）`, true)
      }
    } finally {
      settlingId.value = null
    }
  }, 0)
}

function formatDiff(diff: number): string {
  return `${diff > 0 ? '+' : ''}${diff}`
}

function diffClass(diff: number): string {
  if (Math.abs(diff) <= 0.0001) return 'diff-zero'
  return diff > 0 ? 'diff-plus' : 'diff-minus'
}

onMounted(reload)
</script>

<style scoped>
.manifest-table td { vertical-align: top; }
.muted { color: var(--muted); }
.warn { color: #b42318; }
.info-text { color: #176b3a; }
.diff-plus { color: #b42318; font-weight: 600; }
.diff-minus { color: #b54708; font-weight: 600; }
.diff-zero { color: var(--muted); }
.tag-abnormal { color: #b42318; font-weight: 600; }
.row-abnormal { background: #fef6f5; }
.diff-row td { background: #fbfcfe; font-size: 12px; color: #475569; padding: 6px 10px; }
.diff-row.diff-abnormal td { background: #fef6f5; }
.diff-label { font-weight: 600; color: #334155; }
.diff-warn { margin-left: 8px; color: #b42318; }
.export-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  background: #eef4ff;
  border: 1px solid #c7d9f7;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.panel-hint { font-size: 12px; color: var(--muted); }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 560px;
  max-width: calc(100vw - 40px);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
}
.modal h3 { margin: 0 0 6px; }
.modal-hint { margin: 0 0 12px; font-size: 12px; color: var(--muted); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input,
.filter-item select,
.form-item select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.hidden-file { display: none; }
</style>
