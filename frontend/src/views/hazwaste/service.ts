import { listLedger, listManifests, saveLedger, saveManifests } from './store'
import type {
  ExportResult,
  HazwasteLedgerEntry,
  HazwasteManifest,
  ManifestStatus,
  SaveManifestInput,
  SaveManifestResult,
  SettleResult,
  UploadReceiptResult,
  WeighResult,
} from './types'

// 业务规则集中在这里，页面只负责交互：
// 1. 一车一条联单：同车号 + 同转移日期视为同一车次，重复登记只留一份。
// 2. 联单编号按批次（月份）连续生成。
// 3. 转移量以过磅单为准，与申报量的差异挂在联单下面。
// 4. 处置单位回执上传成功后才允许结算，结算幂等落到转出台账。

const RECEIPT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']
const RECEIPT_MIME_PREFIXES = ['application/pdf', 'image/']
const RECEIPT_MAX_SIZE = 20 * 1024 * 1024
/** 过磅量与申报量差异超过该比例（按申报量计）即标记联单异常 */
const WEIGHT_DIFF_TOLERANCE = 0.05
const WEIGHT_DIFF_ABS_FLOOR = 0.1

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function batchOf(dateText: string): string {
  // 转移日期形如 2026-10-07，批次取年月 202610。
  return dateText.slice(0, 10).replace('-', '').slice(0, 6)
}

function nextIdentity(rows: HazwasteManifest[], batchNo: string): { id: number; seq: number; manifestNo: string } {
  const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const seq = rows.filter((row) => row.batchNo === batchNo).reduce((max, row) => Math.max(max, row.seqInBatch), 0) + 1
  return { id, seq, manifestNo: `HW-${batchNo}-${String(seq).padStart(4, '0')}` }
}

function sameVehicleKey(vehicleNo: string, transferDate: string): string {
  return `${vehicleNo.replace(/\s/g, '').toUpperCase()}@${transferDate.slice(0, 10)}`
}

function findByVehicle(rows: HazwasteManifest[], vehicleNo: string, transferDate: string): HazwasteManifest | undefined {
  const key = sameVehicleKey(vehicleNo, transferDate)
  return rows.find((row) => sameVehicleKey(row.carrierVehicleNo, row.transferDate) === key)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 登记转移联单（一车一条；同一车次重复登记只保留已有的那一份）。 */
export function saveManifest(input: SaveManifestInput): SaveManifestResult {
  const hazardCategory = input.hazardCategory.trim()
  const carrierVehicleNo = input.carrierVehicleNo.trim()
  const disposalUnit = input.disposalUnit.trim()
  const transferDate = input.transferDate.slice(0, 10)
  const declaredWeightTon = Number(input.declaredWeightTon)

  if (!hazardCategory) return { ok: false, message: '危险废物类别不能为空' }
  if (!carrierVehicleNo) return { ok: false, message: '承运车号不能为空' }
  if (!disposalUnit) return { ok: false, message: '处置单位不能为空' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) return { ok: false, message: '转移日期格式应为 YYYY-MM-DD' }
  if (!Number.isFinite(declaredWeightTon) || declaredWeightTon <= 0) return { ok: false, message: '申报转移量必须是大于 0 的数字' }

  const rows = listManifests()
  const existing = findByVehicle(rows, carrierVehicleNo, transferDate)
  if (existing) {
    // 同一车次重复登记：不新建、不覆盖，只把已有联单返回给页面。
    return { ok: true, manifest: existing, duplicated: true }
  }

  const batchNo = batchOf(transferDate)
  const { id, seq, manifestNo } = nextIdentity(rows, batchNo)
  const stamp = nowText()
  const manifest: HazwasteManifest = {
    id,
    manifestNo,
    batchNo,
    seqInBatch: seq,
    hazardCategory,
    declaredWeightTon: round2(declaredWeightTon),
    carrierVehicleNo,
    disposalUnit,
    transferDate,
    status: '待过磅',
    abnormal: false,
    weighNote: null,
    weightDiffTon: null,
    receipt: null,
    settledAt: null,
    ledgerEntryId: null,
    createdAt: stamp,
    updatedAt: stamp,
  }
  saveManifests([...rows, manifest])
  return { ok: true, manifest, duplicated: false }
}

/** 补录过磅单：转移量以过磅量为准，差异挂在联单下面；差异超阈值标记异常。 */
export function recordWeigh(
  manifestId: number,
  note: { ticketNo: string; weighedAt: string; weightTon: number },
): WeighResult {
  const ticketNo = note.ticketNo.trim()
  const weightTon = Number(note.weightTon)
  if (!ticketNo) return { ok: false, message: '过磅单号不能为空' }
  if (!Number.isFinite(weightTon) || weightTon <= 0) return { ok: false, message: '过磅量必须是大于 0 的数字' }

  const rows = listManifests()
  const index = rows.findIndex((row) => row.id === manifestId)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${manifestId} 的联单` }

  const current = rows[index]
  const diff = round2(weightTon - current.declaredWeightTon)
  const ratio = Math.abs(diff) / Math.max(current.declaredWeightTon, Number.EPSILON)
  const abnormal = Math.abs(diff) > WEIGHT_DIFF_ABS_FLOOR && ratio > WEIGHT_DIFF_TOLERANCE

  // 已收过回执/已结算的联单仍允许以过磅单更正转移量（结算台账同步在结算时取值）。
  const status: ManifestStatus = current.status === '待过磅' ? '已过磅' : current.status
  const updated: HazwasteManifest = {
    ...current,
    weighNote: { ticketNo, weighedAt: note.weighedAt || nowText(), weightTon: round2(weightTon) },
    weightDiffTon: diff,
    abnormal: current.abnormal || abnormal,
    status,
    updatedAt: nowText(),
  }
  const next = [...rows]
  next[index] = updated
  saveManifests(next)
  return { ok: true, manifest: updated, diffTon: diff }
}

/** 校验上传文件是否是可读的处置单位回执。 */
export function validateReceiptFile(file: { name: string; type: string; size: number }): string | null {
  const name = file.name ?? ''
  const lower = name.toLowerCase()
  if (!RECEIPT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return '上传文件不是处置单位回执：仅支持 PDF、JPG、PNG 格式，请重新选择'
  }
  // 部分环境拿不到 MIME（为空），以扩展名兜底；有值时必须与回执类型相符。
  if (file.type && !RECEIPT_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) {
    return `上传文件类型「${file.type || '未知'}」不是处置单位回执，请重新选择`
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return '回执文件读不出来：文件大小为 0 或已损坏，请重试'
  }
  if (file.size > RECEIPT_MAX_SIZE) {
    return '回执文件超过 20MB，无法读取，请压缩后重试'
  }
  return null
}

/**
 * 上传处置单位回执。
 * readFile 负责真正读盘并返回文件内容；读不出来（损坏/被占用）时给出失败提示，可重试。
 */
export async function uploadReceipt(
  manifestId: number,
  file: File,
  readFile: (f: File) => Promise<ArrayBuffer>,
): Promise<UploadReceiptResult> {
  const typeError = validateReceiptFile(file)
  if (typeError) return { ok: false, message: typeError }

  let buffer: ArrayBuffer
  try {
    buffer = await readFile(file)
  } catch {
    return { ok: false, message: '回执文件读不出来，请确认文件未损坏后重试' }
  }
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, message: '回执文件内容为空或已损坏，上传失败，请重试' }
  }

  const rows = listManifests()
  const index = rows.findIndex((row) => row.id === manifestId)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${manifestId} 的联单` }

  const current = rows[index]
  const updated: HazwasteManifest = {
    ...current,
    receipt: {
      fileName: file.name,
      fileType: file.type || '未知',
      sizeByte: file.size,
      uploadedAt: nowText(),
    },
    status: current.status === '待过磅' || current.status === '已过磅' ? '回执已收' : current.status,
    updatedAt: nowText(),
  }
  const next = [...rows]
  next[index] = updated
  saveManifests(next)
  return { ok: true, manifest: updated }
}

/** 结算：回执已收才允许；结算结果幂等落到危废处置转出台账，重来不会多出第二份。 */
export function settleManifest(manifestId: number): SettleResult {
  const rows = listManifests()
  const index = rows.findIndex((row) => row.id === manifestId)
  if (index < 0) return { ok: false, message: `没有找到编号为 ${manifestId} 的联单` }
  const current = rows[index]

  if (!current.receipt) {
    return { ok: false, message: '处置单位回执尚未上传，联单不允许结算' }
  }
  if (!current.weighNote) {
    return { ok: false, message: '过磅单尚未登记，转移量无法确定，暂不能结算' }
  }

  const ledger = listLedger()

  // 幂等：已经结算过就直接回原有台账，不再新增第二条。
  const existingEntry = ledger.find((entry) => entry.manifestId === current.id)
  if (current.status === '已结算' && existingEntry) {
    return { ok: true, manifest: current, ledgerEntry: existingEntry, duplicated: true }
  }

  const stamp = nowText()
  let ledgerEntry: HazwasteLedgerEntry
  let entryId = current.ledgerEntryId
  let nextLedger = ledger

  if (existingEntry) {
    // 台账已在但联单状态被改回（异常数据）：沿用同一条台账，不新增。
    ledgerEntry = { ...existingEntry, outboundWeightTon: current.weighNote.weightTon }
    nextLedger = ledger.map((entry) => (entry.id === existingEntry.id ? ledgerEntry : entry))
  } else {
    entryId = ledger.reduce((max, entry) => Math.max(max, entry.id), 0) + 1
    ledgerEntry = {
      id: entryId,
      manifestId: current.id,
      manifestNo: current.manifestNo,
      batchNo: current.batchNo,
      hazardCategory: current.hazardCategory,
      outboundWeightTon: current.weighNote.weightTon,
      carrierVehicleNo: current.carrierVehicleNo,
      disposalUnit: current.disposalUnit,
      transferDate: current.transferDate,
      settlementDate: stamp.slice(0, 10),
    }
    nextLedger = [...ledger, ledgerEntry]
  }

  const updated: HazwasteManifest = {
    ...current,
    status: '已结算',
    settledAt: stamp,
    ledgerEntryId: entryId,
    updatedAt: stamp,
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  saveManifests(nextRows)
  saveLedger(nextLedger)
  return { ok: true, manifest: updated, ledgerEntry, duplicated: false }
}

// 导出列与页面表格列严格一致，改一处即可保证「导出件字段与页面看到的完全一致」。
export const EXPORT_COLUMNS = [
  '联单编号',
  '批次',
  '危险废物类别',
  '申报转移量(吨)',
  '过磅转移量(吨)',
  '差异(吨)',
  '承运车号',
  '处置单位',
  '转移日期',
  '过磅单号',
  '回执文件',
  '联单状态',
  '结算时间',
] as const

type ExportCell = string | number

/** 取某条联单在页面上展示的值（与 index.vue 同一套取值）。 */
export function manifestRowCells(row: HazwasteManifest): ExportCell[] {
  return [
    row.manifestNo,
    row.batchNo,
    row.hazardCategory,
    row.declaredWeightTon,
    row.weighNote ? row.weighNote.weightTon : '',
    row.weightDiffTon ?? '',
    row.carrierVehicleNo,
    row.disposalUnit,
    row.transferDate,
    row.weighNote ? row.weighNote.ticketNo : '',
    row.receipt ? row.receipt.fileName : '',
    row.status,
    row.settledAt ?? '',
  ]
}

function csvEscape(value: ExportCell): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 环保口：把某个时间段内的转移联单打包导出成一份 CSV 文件。
 * 列与页面完全一致；时间段内没有联单或生成失败都明确报错，不静默产出缺列空文件。
 */
export function exportManifestsByRange(startDate: string, endDate: string): ExportResult {
  const start = startDate.slice(0, 10)
  const end = endDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { ok: false, message: '导出失败：请先选择完整的开始与结束日期' }
  }
  if (start > end) {
    return { ok: false, message: '导出失败：开始日期不能晚于结束日期' }
  }

  const picked = listManifests()
    .filter((row) => row.transferDate >= start && row.transferDate <= end)
    .sort((a, b) => a.transferDate.localeCompare(b.transferDate) || a.seqInBatch - b.seqInBatch)

  if (picked.length === 0) {
    return { ok: false, message: `导出失败：${start} 至 ${end} 时间段内没有转移联单` }
  }

  // 完整性自检：表头列数必须与每条联单的取值列数一致，缺列立刻判定失败，不把残件交出去。
  const expected = EXPORT_COLUMNS.length
  const cellRows = picked.map(manifestRowCells)
  if (cellRows.some((cells) => cells.length !== expected || cells.some((cell) => cell === undefined))) {
    return { ok: false, message: '导出失败：导出件字段不完整（缺列），请重试' }
  }

  const lines = [
    EXPORT_COLUMNS.join(','),
    ...cellRows.map((cells) => cells.map(csvEscape).join(',')),
  ]
  if (lines.some((line) => line.trim() === '')) {
    return { ok: false, message: '导出失败：导出件内容不完整，请重试' }
  }

  const filename = `危险废物转移联单-${start}_${end}.csv`
  return { ok: true, filename, content: `﻿${lines.join('\n')}`, count: picked.length }
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
