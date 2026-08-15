import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { LOCAL_MONEY_TABLES, migrateLocalMoneyToMinorUnits, type MoneyMigrationStage } from './local-money-migration'

type TestDatabase = InstanceType<typeof Database>
const databases: TestDatabase[] = []

function legacyDatabase(amount: number = 12.34): TestDatabase {
  const database = new Database(':memory:')
  databases.push(database)
  for (const spec of LOCAL_MONEY_TABLES) database.exec(spec.create.replaceAll(' INTEGER', ' REAL'))
  database.prepare('INSERT INTO incomes (id,name,group_name,amount,date,type,recurring,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run('income-1', 'Legacy', 'Primary', amount, '2026-08-15', 'fixed', 0, '')
  return database
}

afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

describe('local exact-money migration', () => {
  it.each<MoneyMigrationStage>(['backup-staged', 'tables-rebuilt', 'verified', 'completed'])('is restart-safe after %s failure', (failureStage) => {
    const database = legacyDatabase()
    expect(() => migrateLocalMoneyToMinorUnits(database, (stage) => {
      if (stage === failureStage) throw new Error(`crash:${stage}`)
    })).toThrow(`crash:${failureStage}`)

    migrateLocalMoneyToMinorUnits(database)
    const row = database.prepare('SELECT amount, typeof(amount) AS storage FROM incomes WHERE id=?').get('income-1') as { amount: number; storage: string }
    expect(row).toEqual({ amount: 1234, storage: 'integer' })
    expect((database.prepare('SELECT amount FROM incomes_legacy_money_v1 WHERE id=?').get('income-1') as { amount: number }).amount).toBe(12.34)
    expect((database.prepare('SELECT state FROM local_money_migrations WHERE version=1').get() as { state: string }).state).toBe('completed')
    expect(() => migrateLocalMoneyToMinorUnits(database)).not.toThrow()
  })

  it('fails closed on ambiguous sub-cent legacy data without altering the source table', () => {
    const database = legacyDatabase(1.005)
    expect(() => migrateLocalMoneyToMinorUnits(database)).toThrow('no more than two decimal places')
    expect((database.prepare('SELECT amount FROM incomes WHERE id=?').get('income-1') as { amount: number }).amount).toBe(1.005)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='incomes_legacy_money_v1'").get()).toBeUndefined()
  })
})
