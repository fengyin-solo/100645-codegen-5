// 危险废物转移联单的共享定义：页面表格、导出文件、模块元数据都从这一份取，
// 保证「页面上看到的」和「导出件里的」字段完全一致，不会出现两处方括号各写一遍。

export const HW_MANIFEST_KEY = 'hwmanifest'
export const HW_LEDGER_KEY = 'hwledger'

// 联单表格列（导出件表头 = 这些列 + 当前状态列）
export const MANIFEST_COLUMNS = [
  '联单编号',
  '批次号',
  '车次',
  '承运车号',
  '危险废物类别',
  '申报量（吨）',
  '过磅单号',
  '过磅量（吨）',
  '转移量（吨）',
  '差异（吨）',
  '处置单位',
  '转移日期',
  '回执文件',
] as const

export const MANIFEST_STATUS_COLUMN = '当前状态'

// 危废处置转出台账列
export const LEDGER_COLUMNS = [
  '台账编号',
  '联单编号',
  '危险废物类别',
  '转移量（吨）',
  '承运车号',
  '处置单位',
  '转移日期',
  '结算时间',
] as const

export const MANIFEST_STATUSES = ['待回执', '回执已上传', '已结算'] as const

// 处置单位回执只认这些扫描件/照片格式，别的类型视为「不是回执」
export const RECEIPT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

export const WASTE_CATEGORIES = [
  'HW18 焚烧处置残渣（飞灰）',
  'HW08 废矿物油与含矿物油废物',
  'HW49 其他废物（废活性炭）',
  'HW49 其他废物（废布袋）',
  'HW50 废催化剂（脱硝）',
]

export const DISPOSAL_UNITS = [
  '绿洲危废综合处置中心',
  '东江环保处置有限公司',
  '中环危废资源化利用厂',
]

export type ManifestInput = {
  车次: string
  承运车号: string
  危险废物类别: string
  申报量: number
  过磅单号: string
  过磅量: number
  处置单位: string
  转移日期: string
}
