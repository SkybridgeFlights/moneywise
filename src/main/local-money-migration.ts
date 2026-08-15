import { createHash } from 'node:crypto'
import { parseMoneyDecimal } from '@shared/money'

export type MoneyMigrationStage = 'backup-staged' | 'tables-rebuilt' | 'verified' | 'completed'

type Database = {
  exec(sql: string): void
  pragma(sql: string, options?: { simple?: boolean }): unknown
  prepare(sql: string): { all(...args: unknown[]): Array<Record<string, unknown>>; get(...args: unknown[]): Record<string, unknown> | undefined; run(...args: unknown[]): unknown }
}

export type LocalMoneyTableSpec = {
  name: string
  create: string
  columns: string[]
  money: Record<string, { nullable?: boolean; signed?: boolean }>
  jsonMoney?: (row: Record<string, unknown>) => void
}

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`

function convert(value: unknown, options: { nullable?: boolean; signed?: boolean }): number | null {
  if (value === null && options.nullable) return null
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Legacy money value is not numeric.')
  return parseMoneyDecimal(String(value), { allowNegative: options.signed })
}

function convertRules(row: Record<string, unknown>): void {
  const rules = JSON.parse(String(row.rules_json ?? '[]')) as Array<Record<string, unknown>>
  row.rules_json = JSON.stringify(rules.map((rule) => ({
    ...rule,
    lockedAmount: rule.lockedAmount === null || rule.lockedAmount === undefined ? null : convert(rule.lockedAmount, {})
  })))
}

function convertSettings(row: Record<string, unknown>): void {
  const settings = JSON.parse(String(row.json ?? '{}')) as Record<string, unknown>
  const correction = settings.balanceCorrection as Record<string, unknown> | null | undefined
  if (correction) {
    settings.balanceCorrection = {
      ...correction,
      calculatedBalanceBefore: convert(correction.calculatedBalanceBefore, { signed: true }),
      correctedBalance: convert(correction.correctedBalance, { signed: true }),
      difference: convert(correction.difference, { signed: true })
    }
  }
  row.json = JSON.stringify(settings)
}

export const LOCAL_MONEY_TABLES: LocalMoneyTableSpec[] = [
  { name: 'incomes', columns: ['id', 'name', 'group_name', 'amount', 'date', 'source_id', 'type', 'recurring', 'notes'], money: { amount: {} }, create: `CREATE TABLE incomes (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT NOT NULL, source_id TEXT, type TEXT NOT NULL, recurring INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '')` },
  { name: 'expenses', columns: ['id', 'title', 'amount', 'date', 'source_id', 'category_id', 'payment_method', 'type', 'recurring', 'notes', 'tags_json', 'goal_id', 'debt_id', 'allocation_kind'], money: { amount: {} }, create: `CREATE TABLE expenses (id TEXT PRIMARY KEY, title TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT NOT NULL, source_id TEXT, category_id TEXT NOT NULL, payment_method TEXT NOT NULL, type TEXT NOT NULL, recurring INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', goal_id TEXT, debt_id TEXT, allocation_kind TEXT NOT NULL DEFAULT 'spend')` },
  { name: 'categories', columns: ['id', 'name', 'type', 'color', 'icon', 'monthly_limit', 'built_in'], money: { monthly_limit: { nullable: true } }, create: `CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL, monthly_limit INTEGER, built_in INTEGER NOT NULL DEFAULT 0)` },
  { name: 'goals', columns: ['id', 'name', 'type', 'target_amount', 'current_amount', 'target_date', 'priority', 'notes'], money: { target_amount: {}, current_amount: {} }, create: `CREATE TABLE goals (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, target_amount INTEGER NOT NULL, current_amount INTEGER NOT NULL, target_date TEXT NOT NULL, priority TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '')` },
  { name: 'goal_contributions', columns: ['id', 'goal_id', 'expense_id', 'amount', 'date', 'notes'], money: { amount: {} }, create: `CREATE TABLE goal_contributions (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, expense_id TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL, date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '')` },
  { name: 'debts', columns: ['id', 'name', 'total_amount', 'installment_amount', 'start_date', 'end_date', 'desired_payoff_date', 'payment_frequency', 'recurring_automatically', 'category_id', 'notes'], money: { total_amount: {}, installment_amount: {} }, create: `CREATE TABLE debts (id TEXT PRIMARY KEY, name TEXT NOT NULL, total_amount INTEGER NOT NULL, installment_amount INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT, desired_payoff_date TEXT, payment_frequency TEXT NOT NULL DEFAULT 'monthly', recurring_automatically INTEGER NOT NULL DEFAULT 1, category_id TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '')` },
  { name: 'budget_plans', columns: ['id', 'month', 'method', 'custom_savings_target', 'custom_emergency_target', 'debt_acceleration', 'notes', 'rules_json'], money: { custom_savings_target: {}, custom_emergency_target: {}, debt_acceleration: {} }, jsonMoney: convertRules, create: `CREATE TABLE budget_plans (id TEXT PRIMARY KEY, month TEXT NOT NULL, method TEXT NOT NULL, custom_savings_target INTEGER NOT NULL DEFAULT 0, custom_emergency_target INTEGER NOT NULL DEFAULT 0, debt_acceleration INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', rules_json TEXT NOT NULL DEFAULT '[]')` },
  { name: 'recurring_transactions', columns: ['id', 'title', 'kind', 'amount', 'day_of_month', 'category_id', 'group_name', 'payment_method', 'entry_type', 'notes', 'tags_json', 'goal_id', 'debt_id', 'allocation_kind', 'source_id', 'active'], money: { amount: {} }, create: `CREATE TABLE recurring_transactions (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, day_of_month INTEGER NOT NULL, category_id TEXT, group_name TEXT, payment_method TEXT, entry_type TEXT, notes TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', goal_id TEXT, debt_id TEXT, allocation_kind TEXT, source_id TEXT, active INTEGER NOT NULL DEFAULT 1)` },
  { name: 'settings', columns: ['id', 'json'], money: {}, jsonMoney: convertSettings, create: `CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)` },
  { name: 'monthly_summaries', columns: ['month', 'income', 'expenses', 'savings', 'debt_payments', 'closing_balance'], money: { income: {}, expenses: {}, savings: { signed: true }, debt_payments: {}, closing_balance: { signed: true } }, create: `CREATE TABLE monthly_summaries (month TEXT PRIMARY KEY, income INTEGER NOT NULL, expenses INTEGER NOT NULL, savings INTEGER NOT NULL, debt_payments INTEGER NOT NULL, closing_balance INTEGER NOT NULL)` }
]

function fingerprint(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const hash = createHash('sha256')
  for (const row of rows) hash.update(JSON.stringify(columns.map((column) => row[column] ?? null)))
  return hash.digest('hex')
}

export function migrateLocalMoneyToMinorUnits(database: Database, injectFailure?: (stage: MoneyMigrationStage) => void): void {
  database.exec(`CREATE TABLE IF NOT EXISTS local_money_migrations (version INTEGER PRIMARY KEY, state TEXT NOT NULL, source_hash TEXT NOT NULL, converted_hash TEXT, applied_at TEXT)`)
  const complete = database.prepare('SELECT state FROM local_money_migrations WHERE version = 1').get() as { state?: string } | undefined
  if (complete?.state === 'completed') return
  const requiresMigration = LOCAL_MONEY_TABLES.some((spec) => {
    const columns = database.pragma(`table_info(${quote(spec.name)})`) as Array<{ name: string; type: string }>
    return Object.keys(spec.money).some((name) => columns.find((column) => column.name === name)?.type.toUpperCase() !== 'INTEGER')
  })
  if (!requiresMigration) {
    database.prepare("INSERT OR REPLACE INTO local_money_migrations(version,state,source_hash,converted_hash,applied_at) VALUES(1,'completed','new-integer-schema','new-integer-schema',?)").run(new Date().toISOString())
    return
  }

  const converted = new Map<string, Array<Record<string, unknown>>>()
  const sourceHash = createHash('sha256')
  for (const spec of LOCAL_MONEY_TABLES) {
    const rows = database.prepare(`SELECT ${spec.columns.map(quote).join(', ')} FROM ${quote(spec.name)} ORDER BY ${spec.columns.map(quote).join(', ')}`).all()
    sourceHash.update(spec.name)
    sourceHash.update(fingerprint(rows, spec.columns))
    converted.set(spec.name, rows.map((source) => {
      const row = { ...source }
      for (const [column, options] of Object.entries(spec.money)) row[column] = convert(row[column], options)
      spec.jsonMoney?.(row)
      return row
    }))
  }
  const sourceDigest = sourceHash.digest('hex')
  database.prepare("INSERT OR REPLACE INTO local_money_migrations(version,state,source_hash,converted_hash,applied_at) VALUES(1,'backup-staged',?,NULL,NULL)").run(sourceDigest)
  injectFailure?.('backup-staged')

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const spec of LOCAL_MONEY_TABLES) {
      const legacy = `${spec.name}_legacy_money_v1`
      database.exec(`DROP TABLE IF EXISTS ${quote(legacy)}; ALTER TABLE ${quote(spec.name)} RENAME TO ${quote(legacy)}`)
      const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(legacy) as Array<{ name: string }>
      for (const index of indexes) database.exec(`DROP INDEX ${quote(index.name)}`)
      database.exec(spec.create)
      const insert = database.prepare(`INSERT INTO ${quote(spec.name)} (${spec.columns.map(quote).join(', ')}) VALUES (${spec.columns.map(() => '?').join(', ')})`)
      for (const row of converted.get(spec.name) ?? []) insert.run(...spec.columns.map((column) => row[column]))
    }
    injectFailure?.('tables-rebuilt')
    const targetHash = createHash('sha256')
    for (const spec of LOCAL_MONEY_TABLES) {
      const rows = database.prepare(`SELECT ${spec.columns.map(quote).join(', ')} FROM ${quote(spec.name)} ORDER BY ${spec.columns.map(quote).join(', ')}`).all()
      const expectedRows = converted.get(spec.name) ?? []
      if (rows.length !== expectedRows.length) throw new Error(`Money migration row-count mismatch for ${spec.name}.`)
      if (fingerprint(rows, spec.columns) !== fingerprint(expectedRows, spec.columns)) throw new Error(`Money migration content mismatch for ${spec.name}.`)
      for (const [column] of Object.entries(spec.money)) {
        if (rows.some((row) => row[column] !== null && !Number.isSafeInteger(row[column]))) throw new Error(`Money migration produced a non-integer ${spec.name}.${column}.`)
      }
      targetHash.update(spec.name)
      targetHash.update(fingerprint(rows, spec.columns))
    }
    const targetDigest = targetHash.digest('hex')
    injectFailure?.('verified')
    database.prepare("UPDATE local_money_migrations SET state='completed', converted_hash=?, applied_at=? WHERE version=1").run(targetDigest, new Date().toISOString())
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  injectFailure?.('completed')
}
