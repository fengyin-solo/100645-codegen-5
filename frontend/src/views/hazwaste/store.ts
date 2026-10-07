import { SEED_LEDGER, SEED_MANIFESTS } from './seed'
import type { HazwasteLedgerEntry, HazwasteManifest } from './types'

// 危废模块的本地持久化：联单与转出台账分两个键存放，刷新、关掉再打开都还在。
const MANIFEST_KEY = 'waste-to-energy-plant:hazwaste-manifests'
const LEDGER_KEY = 'waste-to-energy-plant:hazwaste-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    // 存储内容被改坏时回到示例数据，绝不让页面读不出来。
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let manifestsCache: HazwasteManifest[] | null = null
let ledgerCache: HazwasteLedgerEntry[] | null = null

export function listManifests(): HazwasteManifest[] {
  if (manifestsCache === null) {
    manifestsCache = read(MANIFEST_KEY, SEED_MANIFESTS)
  }
  return manifestsCache
}

export function saveManifests(rows: HazwasteManifest[]): void {
  manifestsCache = rows
  write(MANIFEST_KEY, rows)
}

export function listLedger(): HazwasteLedgerEntry[] {
  if (ledgerCache === null) {
    ledgerCache = read(LEDGER_KEY, SEED_LEDGER)
  }
  return ledgerCache
}

export function saveLedger(rows: HazwasteLedgerEntry[]): void {
  ledgerCache = rows
  write(LEDGER_KEY, rows)
}

/** 回到示例数据（重置演示用）。 */
export function resetHazwaste(): { manifests: HazwasteManifest[]; ledger: HazwasteLedgerEntry[] } {
  const manifests = clone(SEED_MANIFESTS)
  const ledger = clone(SEED_LEDGER)
  saveManifests(manifests)
  saveLedger(ledger)
  return { manifests, ledger }
}
