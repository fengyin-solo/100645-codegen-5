/** 危险废物转移联单与处置转出台账的领域类型。 */

// 联单状态：待过磅 → 已过磅（申报/过磅有差异仍可流转）→ 回执已收 → 已结算
export const MANIFEST_STATUSES = ['待过磅', '已过磅', '回执已收', '已结算'] as const
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number]

/** 过磅单：转移量以过磅单为准 */
export type WeighNote = {
  ticketNo: string
  weighedAt: string
  weightTon: number
}

/** 处置单位回执 */
export type Receipt = {
  fileName: string
  fileType: string
  sizeByte: number
  uploadedAt: string
}

/** 一车一条转移联单 */
export type HazwasteManifest = {
  id: number
  /** 联单编号，按批次连续生成，如 HW-202610-0001 */
  manifestNo: string
  batchNo: string
  seqInBatch: number
  hazardCategory: string
  declaredWeightTon: number
  carrierVehicleNo: string
  disposalUnit: string
  /** 转移日期，用于按时间段打包导出 */
  transferDate: string
  status: ManifestStatus
  abnormal: boolean
  weighNote: WeighNote | null
  /** 过磅量 − 申报量（吨）：对不上时挂在联单下面，转移量以过磅单为准 */
  weightDiffTon: number | null
  receipt: Receipt | null
  settledAt: string | null
  ledgerEntryId: number | null
  createdAt: string
  updatedAt: string
}

/** 危废处置转出台账：结算后落账，一条联单只对应一条台账 */
export type HazwasteLedgerEntry = {
  id: number
  /** 来源联单，幂等键：同一联单重复结算不会多出第二份 */
  manifestId: number
  manifestNo: string
  batchNo: string
  hazardCategory: string
  /** 台账转移量取过磅量 */
  outboundWeightTon: number
  carrierVehicleNo: string
  disposalUnit: string
  transferDate: string
  settlementDate: string
}

export type SaveManifestInput = {
  hazardCategory: string
  declaredWeightTon: number
  carrierVehicleNo: string
  disposalUnit: string
  transferDate: string
}

export type SaveManifestResult =
  | { ok: true; manifest: HazwasteManifest; duplicated: boolean }
  | { ok: false; message: string }

export type UploadReceiptResult =
  | { ok: true; manifest: HazwasteManifest }
  | { ok: false; message: string }

export type WeighResult =
  | { ok: true; manifest: HazwasteManifest; diffTon: number }
  | { ok: false; message: string }

export type SettleResult =
  | { ok: true; manifest: HazwasteManifest; ledgerEntry: HazwasteLedgerEntry; duplicated: boolean }
  | { ok: false; message: string }

export type ExportResult =
  | { ok: true; filename: string; content: string; count: number }
  | { ok: false; message: string }
