import {
  HW_LEDGER_KEY,
  HW_MANIFEST_KEY,
  LEDGER_COLUMNS,
  MANIFEST_COLUMNS,
  MANIFEST_STATUS_COLUMN,
  RECEIPT_EXTENSIONS,
} from '@/data/hwmanifest'
import type { ManifestInput } from '@/data/hwmanifest'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 危险废物转移联单的业务规则都收在这一个文件里：
// 一车一联单（按车次去重）、联单编号按批次连续、转移量以过磅单为准、
// 回执上传后才能结算、结算按联单编号唯一入账、按时间段打包导出。

export type ServiceResult = {
  ok: boolean
  message: string
}

export type CreateResult = ServiceResult & {
  row?: EntryRow
  duplicated?: boolean
}

export type ExportResult = ServiceResult & {
  filename?: string
  content?: string
  columns?: string[]
  rowCount?: number
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/** 联单编号按批次连续生成：批次号取自转移日期，批次内取当前最大序号 +1，不重号不断档。 */
function nextManifestNo(rows: EntryRow[], transferDate: string): { 批次号: string; 联单编号: string } {
  const batch = `HWF-${transferDate.split('-').join('')}`
  const maxSeq = rows
    .filter((row) => String(row['批次号'] ?? '') === batch)
    .map((row) => Number(String(row['联单编号'] ?? '').split('-').pop()))
    .filter((seq) => Number.isFinite(seq))
    .reduce((max, seq) => Math.max(max, seq), 0)
  return { 批次号: batch, 联单编号: `${batch}-${String(maxSeq + 1).padStart(3, '0')}` }
}

/** 登记转移联单：一车一条，同一车次重复登记只留一份；转移量以过磅单为准，差异挂在联单下面。 */
export function createManifest(input: ManifestInput): CreateResult {
  const required: [string, string][] = [
    ['车次', input.车次],
    ['承运车号', input.承运车号],
    ['危险废物类别', input.危险废物类别],
    ['过磅单号', input.过磅单号],
    ['处置单位', input.处置单位],
    ['转移日期', input.转移日期],
  ]
  for (const [label, value] of required) {
    if (!value || !String(value).trim()) {
      return { ok: false, message: `${label}不能为空，转移联单登记失败` }
    }
  }
  if (!Number.isFinite(input.申报量) || input.申报量 <= 0) {
    return { ok: false, message: '申报量必须是大于 0 的数字，转移联单登记失败' }
  }
  if (!Number.isFinite(input.过磅量) || input.过磅量 <= 0) {
    return { ok: false, message: '过磅量必须是大于 0 的数字，转移联单登记失败' }
  }

  const rows = listRows(HW_MANIFEST_KEY)
  const trip = input.车次.trim()
  const existing = rows.find((row) => String(row['车次'] ?? '') === trip)
  if (existing) {
    return {
      ok: true,
      duplicated: true,
      row: existing,
      message: `车次 ${trip} 已登记联单 ${existing['联单编号']}，同一车次只保留一份，未重复登记`,
    }
  }

  const declared = round3(input.申报量)
  const weighed = round3(input.过磅量)
  const diff = round3(weighed - declared)
  const { 批次号, 联单编号 } = nextManifestNo(rows, input.转移日期)
  const row: EntryRow = {
    id: nextId(rows),
    status: '待回执',
    pending: true,
    abnormal: diff !== 0,
    联单编号,
    批次号,
    车次: trip,
    承运车号: input.承运车号.trim(),
    危险废物类别: input.危险废物类别.trim(),
    '申报量（吨）': declared,
    过磅单号: input.过磅单号.trim(),
    '过磅量（吨）': weighed,
    '转移量（吨）': weighed,
    '差异（吨）': diff,
    差异说明:
      diff === 0
        ? ''
        : `申报量 ${declared} 吨与过磅量 ${weighed} 吨相差 ${diff} 吨，转移量以过磅单 ${input.过磅单号.trim()} 为准`,
    处置单位: input.处置单位.trim(),
    转移日期: input.转移日期,
    回执文件: '',
  }
  saveRows(HW_MANIFEST_KEY, [...rows, row])
  const diffNote = diff === 0 ? '' : `；与申报量差异 ${diff} 吨已挂在联单下`
  return { ok: true, row, message: `联单 ${联单编号} 登记成功，转移量以过磅单为准记 ${weighed} 吨${diffNote}` }
}

function readFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = () => resolve()
    reader.readAsArrayBuffer(file)
  })
}

/** 上传处置单位回执：不是回执格式或文件读不出来都给出失败提示，联单保持原状态可重试。 */
export async function uploadReceipt(id: number, file: File | null): Promise<ServiceResult> {
  const rows = listRows(HW_MANIFEST_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的转移联单` }
  }
  const manifestNo = String(rows[index]['联单编号'] ?? id)
  if (String(rows[index].status) === '已结算') {
    return { ok: false, message: `联单 ${manifestNo} 已结算，不需要再上传回执` }
  }
  if (!file) {
    return { ok: false, message: '未选择回执文件，请重新选择后上传' }
  }
  const name = file.name.toLowerCase()
  if (!RECEIPT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return {
      ok: false,
      message: `「${file.name}」不是处置单位回执（仅支持 ${RECEIPT_EXTENSIONS.join(' / ')}），上传失败，请重新上传`,
    }
  }
  if (file.size === 0) {
    return { ok: false, message: `「${file.name}」内容为空，读取失败，请重新上传` }
  }
  try {
    await readFile(file)
  } catch {
    return { ok: false, message: `「${file.name}」读取失败，文件可能已损坏，请重新上传` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 回执文件: file.name, status: '回执已上传', pending: true }
  saveRows(HW_MANIFEST_KEY, next)
  return { ok: true, message: `联单 ${manifestNo} 的处置单位回执已上传，可以办理结算` }
}

/** 结算：回执上传后才允许；结果按联单编号唯一落入转出台账，重复结算不会多出第二份。 */
export function settleManifest(id: number): ServiceResult {
  const rows = listRows(HW_MANIFEST_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的转移联单` }
  }
  const manifest = rows[index]
  const manifestNo = String(manifest['联单编号'] ?? id)
  const status = String(manifest.status)
  const ledger = listRows(HW_LEDGER_KEY)
  const alreadyPosted = ledger.some((row) => String(row['联单编号'] ?? '') === manifestNo)

  if (status === '已结算') {
    return alreadyPosted
      ? { ok: true, message: `联单 ${manifestNo} 已结算，转出台账中已有对应记录，未重复入账` }
      : { ok: false, message: `联单 ${manifestNo} 已结算但台账缺少记录，请联系管理员核查` }
  }
  if (status !== '回执已上传') {
    return { ok: false, message: `联单 ${manifestNo} 的处置单位回执未上传，不允许结算` }
  }

  if (!alreadyPosted) {
    const ledgerRow: EntryRow = {
      id: nextId(ledger),
      status: '已结算',
      pending: false,
      abnormal: false,
      台账编号: `HWL-${String(nextId(ledger)).padStart(4, '0')}`,
      联单编号: manifestNo,
      危险废物类别: manifest['危险废物类别'] ?? '',
      '转移量（吨）': manifest['转移量（吨）'] ?? 0,
      承运车号: manifest['承运车号'] ?? '',
      处置单位: manifest['处置单位'] ?? '',
      转移日期: manifest['转移日期'] ?? '',
      结算时间: new Date().toISOString().slice(0, 10),
    }
    saveRows(HW_LEDGER_KEY, [...ledger, ledgerRow])
  }
  const next = [...rows]
  next[index] = { ...manifest, status: '已结算', pending: false }
  saveRows(HW_MANIFEST_KEY, next)
  return { ok: true, message: `联单 ${manifestNo} 结算完成，结果已落入危废处置转出台账` }
}

function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 按时间段打包导出：表头与页面列完全一致；时间段内无数据或导出件缺列都明确报错。 */
export function exportManifests(startDate: string, endDate: string): ExportResult {
  if (!startDate || !endDate) {
    return { ok: false, message: '请先选择导出时间段的开始日期和结束日期' }
  }
  if (startDate > endDate) {
    return { ok: false, message: `开始日期 ${startDate} 晚于结束日期 ${endDate}，请重新选择时间段` }
  }
  const matched = listRows(HW_MANIFEST_KEY)
    .filter((row) => {
      const date = String(row['转移日期'] ?? '')
      return date >= startDate && date <= endDate
    })
    .sort((a, b) => String(a['联单编号']).localeCompare(String(b['联单编号'])))
  if (matched.length === 0) {
    return { ok: false, message: `${startDate} 至 ${endDate} 内没有转移联单，未生成导出文件` }
  }

  const header = [...MANIFEST_COLUMNS, MANIFEST_STATUS_COLUMN]
  const lines = [header.map(csvCell).join(',')]
  for (const row of matched) {
    const missing = MANIFEST_COLUMNS.filter((column) => !(column in row))
    if (missing.length > 0) {
      return {
        ok: false,
        message: `联单 ${row['联单编号'] ?? row.id} 缺少字段（${missing.join('、')}），为避免导出件缺列已中止导出`,
      }
    }
    const cells = [...MANIFEST_COLUMNS.map((column) => csvCell(row[column])), csvCell(row.status)]
    if (cells.length !== header.length) {
      return { ok: false, message: `联单 ${row['联单编号']} 导出列数与表头不一致，已中止导出` }
    }
    lines.push(cells.join(','))
  }
  return {
    ok: true,
    message: `已导出 ${matched.length} 条联单，共 ${header.length} 列，字段与页面完全一致`,
    filename: `危废转移联单-${startDate}~${endDate}.csv`,
    content: `\uFEFF${lines.join('\n')}`,
    columns: header,
    rowCount: matched.length,
  }
}
