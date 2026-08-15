import Database from 'better-sqlite3-multiple-ciphers'
import { addDays, addMonths, differenceInCalendarDays, differenceInMonths, format, parseISO } from 'date-fns'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import Papa from 'papaparse'
import ExcelJS from 'exceljs'
import { calculateFinanceSnapshot } from '@shared/finance'
import {
  defaultCategories,
  defaultSettings,
  demoBudgetPlan,
  demoDebts,
  demoExpenses,
  demoGoals,
  demoIncomes
} from '@shared/defaults'
import { languageMeta } from '@shared/i18n'
import type {
  ActivityLogItem,
  AlertItem,
  BudgetPlan,
  CategoryDeletionImpact,
  Category,
  DebtRecord,
  ExpenseRecord,
  Goal,
  GoalContribution,
  IncomeRecord,
  MonthlySummary,
  RecurringTransaction,
  Settings
} from '@shared/types'
import type { FinanceDomainState } from '@shared/domain'
import type {
  AppSnapshot,
  DeleteCategoryInput,
  SaveBudgetPlanInput,
  SaveCategoryInput,
  SaveDebtInput,
  SaveExpenseInput,
  SaveGoalInput,
  SaveGoalContributionInput,
  SaveIncomeInput
} from '@shared/contracts'
import { debtInputSchema, snapshotImportSchema } from '@shared/validation'
import type { FinanceRepository } from './finance-repository'
import type { RemoteSyncRecord, SyncEntityType } from './sync-types'
import {
  localDatabaseEncryptionFiles,
  openEncryptedDatabase,
  type DatabaseKeyProtector,
  type EncryptionMigrationStage
} from './local-database-encryption'

const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const round2 = (value: number): number => Math.round(value * 100) / 100
const isDevLoggingEnabled = (): boolean => typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'

const ensureArray = <T>(value: T[] | null | undefined): T[] => value ?? []
const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const normalizeSettings = (value: Partial<Settings> | null | undefined): Settings => {
  const merged = { ...defaultSettings, ...(value ?? {}) }
  const language = merged.language ?? (merged.rtl ? 'ar' : 'en')
  const languageDefaults = languageMeta[language]
  return {
    ...merged,
    language,
    locale: merged.locale || languageDefaults.locale,
    rtl: typeof merged.rtl === 'boolean' ? merged.rtl : languageDefaults.rtl
  }
}

const defaultRuleForCategory = (category: Pick<Category, 'id' | 'type' | 'monthlyLimit'>) => ({
  categoryId: category.id,
  percentage: category.type === 'essential' ? 8 : category.type === 'saving' ? 6 : category.type === 'debt' ? 10 : 4,
  priorityWeight: category.type === 'essential' ? 10 : category.type === 'saving' ? 9 : category.type === 'debt' ? 8 : 5,
  lockedAmount: category.type === 'essential' ? category.monthlyLimit : null
})

const DEFAULT_FALLBACK_CATEGORY_ID = 'misc'

interface FinanceDatabaseOptions {
  dataDir?: string
  keyProtector: DatabaseKeyProtector
  injectEncryptionMigrationFailure?: (stage: EncryptionMigrationStage) => void
}

export class FinanceDatabase implements FinanceRepository {
  private db: any
  private dbPath: string
  private readonly dataDir: string
  readonly capabilities = {
    localPersistence: true as const,
    remoteSync: false,
    conflictDetection: false
  }

  constructor(initialUserId: string | null = null, private readonly options: FinanceDatabaseOptions) {
    this.dataDir = options.dataDir ?? join(app.getPath('userData'), 'moneywise')
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
    this.migrateLegacyDatabase(initialUserId)
    this.dbPath = this.profileEncryptedDatabasePath(initialUserId)
    this.openDatabase(initialUserId)
    try {
      this.removeLegacyDatabaseAfterEncryptedActivation()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private profileId(userId: string): string {
    return createHash('sha256').update(`moneywise-desktop-profile:${userId}`).digest('hex')
  }

  private profileDatabasePath(userId: string | null): string {
    const directory = this.profileDirectory(userId)
    mkdirSync(directory, { recursive: true })
    return join(directory, userId ? 'moneywise.sqlite' : 'unscoped-local.sqlite')
  }

  private profileDirectory(userId: string | null): string {
    return userId ? join(this.dataDir, 'profiles', this.profileId(userId)) : join(this.dataDir, 'quarantine')
  }

  private profileEncryptedDatabasePath(userId: string | null): string {
    return join(this.profileDirectory(userId), localDatabaseEncryptionFiles.encryptedDatabase)
  }

  private migrateLegacyDatabase(ownerUserId: string | null): void {
    const legacyPath = join(this.dataDir, 'moneywise.sqlite')
    if (!existsSync(legacyPath)) return
    const targetPath = this.profileDatabasePath(ownerUserId)
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${targetPath}${suffix}`, { force: true })
    const legacy = new Database(legacyPath)
    try {
      legacy.pragma('wal_checkpoint(FULL)')
      legacy.prepare('VACUUM INTO ?').run(targetPath)
      const migrated = new Database(targetPath, { readonly: true })
      try {
        if (migrated.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Migrated profile failed integrity validation')
      } finally {
        migrated.close()
      }
    } finally {
      legacy.close()
    }
  }

  private removeLegacyDatabaseAfterEncryptedActivation(): void {
    const legacyPath = join(this.dataDir, 'moneywise.sqlite')
    for (const suffix of ['-wal', '-shm', '-journal', '']) rmSync(`${legacyPath}${suffix}`, { force: true })
  }

  private openDatabase(userId: string | null): void {
    this.db = openEncryptedDatabase({
      directory: this.profileDirectory(userId),
      plaintextFilename: userId ? 'moneywise.sqlite' : 'unscoped-local.sqlite',
      profileId: userId ? this.profileId(userId) : 'unscoped-local',
      keyProtector: this.options.keyProtector,
      injectFailure: this.options.injectEncryptionMigrationFailure
    })
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('temp_store = MEMORY')
    this.initialize()
  }

  switchAccountProfile(userId: string | null): void {
    const nextPath = this.profileEncryptedDatabasePath(userId)
    if (nextPath === this.dbPath) return
    this.db.pragma('wal_checkpoint(FULL)')
    this.db.close()
    this.dbPath = nextPath
    this.openDatabase(userId)
  }

  close(): void {
    this.db.pragma('wal_checkpoint(FULL)')
    this.db.close()
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incomes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        source_id TEXT,
        type TEXT NOT NULL,
        recurring INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        source_id TEXT,
        category_id TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        type TEXT NOT NULL,
        recurring INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        goal_id TEXT,
        debt_id TEXT,
        allocation_kind TEXT NOT NULL DEFAULT 'spend'
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        monthly_limit REAL,
        built_in INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        target_amount REAL NOT NULL,
        current_amount REAL NOT NULL,
        target_date TEXT NOT NULL,
        priority TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS goal_contributions (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        expense_id TEXT NOT NULL UNIQUE,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS debts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        total_amount REAL NOT NULL,
        installment_amount REAL NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        desired_payoff_date TEXT,
        payment_frequency TEXT NOT NULL DEFAULT 'monthly',
        recurring_automatically INTEGER NOT NULL DEFAULT 1,
        category_id TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS budget_plans (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        method TEXT NOT NULL,
        custom_savings_target REAL NOT NULL DEFAULT 0,
        custom_emergency_target REAL NOT NULL DEFAULT 0,
        debt_acceleration REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        rules_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS recurring_transactions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount REAL NOT NULL,
        day_of_month INTEGER NOT NULL,
        category_id TEXT,
        group_name TEXT,
        payment_method TEXT,
        entry_type TEXT,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        goal_id TEXT,
        debt_id TEXT,
        allocation_kind TEXT,
        source_id TEXT,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        module TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monthly_summaries (
        month TEXT PRIMARY KEY,
        income REAL NOT NULL,
        expenses REAL NOT NULL,
        savings REAL NOT NULL,
        debt_payments REAL NOT NULL,
        closing_balance REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(date DESC);
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
      CREATE INDEX IF NOT EXISTS idx_expenses_category_date ON expenses(category_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_goals_target_date ON goals(target_date ASC);
      CREATE INDEX IF NOT EXISTS idx_budget_plans_month ON budget_plans(month DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log(created_at DESC);
    `)

    const incomeColumns = this.db.prepare('PRAGMA table_info(incomes)').all() as Array<{ name: string }>
    if (!incomeColumns.some((column) => column.name === 'source_id')) {
      this.db.exec('ALTER TABLE incomes ADD COLUMN source_id TEXT')
    }

    const expenseColumns = this.db.prepare('PRAGMA table_info(expenses)').all() as Array<{ name: string }>
    if (!expenseColumns.some((column) => column.name === 'source_id')) {
      this.db.exec('ALTER TABLE expenses ADD COLUMN source_id TEXT')
    }
    if (!expenseColumns.some((column) => column.name === 'goal_id')) {
      this.db.exec("ALTER TABLE expenses ADD COLUMN goal_id TEXT")
    }
    if (!expenseColumns.some((column) => column.name === 'debt_id')) {
      this.db.exec("ALTER TABLE expenses ADD COLUMN debt_id TEXT")
    }
    if (!expenseColumns.some((column) => column.name === 'allocation_kind')) {
      this.db.exec("ALTER TABLE expenses ADD COLUMN allocation_kind TEXT NOT NULL DEFAULT 'spend'")
    }

    const recurringColumns = this.db.prepare('PRAGMA table_info(recurring_transactions)').all() as Array<{ name: string }>
    if (!recurringColumns.some((column) => column.name === 'payment_method')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN payment_method TEXT")
    }
    if (!recurringColumns.some((column) => column.name === 'entry_type')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN entry_type TEXT")
    }
    if (!recurringColumns.some((column) => column.name === 'notes')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
    }
    if (!recurringColumns.some((column) => column.name === 'tags_json')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!recurringColumns.some((column) => column.name === 'goal_id')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN goal_id TEXT")
    }
    if (!recurringColumns.some((column) => column.name === 'debt_id')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN debt_id TEXT")
    }
    if (!recurringColumns.some((column) => column.name === 'allocation_kind')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN allocation_kind TEXT")
    }
    if (!recurringColumns.some((column) => column.name === 'source_id')) {
      this.db.exec("ALTER TABLE recurring_transactions ADD COLUMN source_id TEXT")
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_expenses_goal_date ON expenses(goal_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal_date ON goal_contributions(goal_id, date DESC);
    `)

    const categoryCount = this.db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number }
    if (categoryCount.count === 0) {
      const stmt = this.db.prepare(`
        INSERT INTO categories (id, name, type, color, icon, monthly_limit, built_in)
        VALUES (@id, @name, @type, @color, @icon, @monthlyLimit, @builtIn)
      `)
      const tx = this.db.transaction((categories: Category[]) => {
        categories.forEach((category) => stmt.run({ ...category, monthlyLimit: category.monthlyLimit, builtIn: category.builtIn ? 1 : 0 }))
      })
      tx(defaultCategories)
    }

    const settingsRow = this.db.prepare('SELECT json FROM settings WHERE id = 1').get() as { json: string } | undefined
    if (!settingsRow) {
      this.db.prepare('INSERT INTO settings (id, json) VALUES (1, ?)').run(JSON.stringify(defaultSettings))
    }

    const budgetCount = this.db.prepare('SELECT COUNT(*) AS count FROM budget_plans').get() as { count: number }
    if (budgetCount.count === 0) {
      this.saveBudgetPlan(demoBudgetPlan, false)
    }

    const debtCount = this.db.prepare('SELECT COUNT(*) AS count FROM debts').get() as { count: number }
    if (debtCount.count === 0) {
      demoDebts.forEach((entry) => this.writeDebt(entry))
    }
  }

  private mapIncome(row: Record<string, unknown>): IncomeRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      groupName: String(row.group_name),
      amount: Number(row.amount),
      date: String(row.date),
      type: row.type as IncomeRecord['type'],
      recurring: Boolean(row.recurring),
      notes: String(row.notes)
    }
  }

  private mapExpense(row: Record<string, unknown>): ExpenseRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      amount: Number(row.amount),
      date: String(row.date),
      categoryId: String(row.category_id),
      paymentMethod: row.payment_method as ExpenseRecord['paymentMethod'],
      type: row.type as ExpenseRecord['type'],
      recurring: Boolean(row.recurring),
      notes: String(row.notes),
      tags: parseJson<string[]>(String(row.tags_json), []),
      goalId: (row.goal_id as string | null) ?? null,
      debtId: (row.debt_id as string | null) ?? null,
      allocationKind: (row.allocation_kind as ExpenseRecord['allocationKind'] | null) ?? 'spend'
    }
  }

  private mapCategory(row: Record<string, unknown>): Category {
    return {
      id: String(row.id),
      name: String(row.name),
      type: row.type as Category['type'],
      color: String(row.color),
      icon: String(row.icon),
      monthlyLimit: row.monthly_limit === null ? null : Number(row.monthly_limit),
      builtIn: Boolean(row.built_in)
    }
  }

  private mapGoal(row: Record<string, unknown>): Goal {
    return {
      id: String(row.id),
      name: String(row.name),
      type: row.type as Goal['type'],
      targetAmount: Number(row.target_amount),
      currentAmount: Number(row.current_amount),
      targetDate: String(row.target_date),
      priority: row.priority as Goal['priority'],
      notes: String(row.notes)
    }
  }

  private mapDebt(row: Record<string, unknown>): DebtRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      totalAmount: Number(row.total_amount),
      installmentAmount: Number(row.installment_amount),
      startDate: String(row.start_date),
      endDate: (row.end_date as string | null) ?? null,
      desiredPayoffDate: (row.desired_payoff_date as string | null) ?? null,
      paymentFrequency: row.payment_frequency as DebtRecord['paymentFrequency'],
      recurringAutomatically: Boolean(row.recurring_automatically),
      categoryId: String(row.category_id),
      notes: String(row.notes)
    }
  }

  private mapBudget(row: Record<string, unknown>): BudgetPlan {
    return {
      id: String(row.id),
      month: String(row.month),
      method: row.method as BudgetPlan['method'],
      customSavingsTarget: Number(row.custom_savings_target),
      customEmergencyTarget: Number(row.custom_emergency_target),
      debtAcceleration: Number(row.debt_acceleration),
      notes: String(row.notes),
      rules: parseJson(String(row.rules_json), [])
    }
  }

  private mapGoalContribution(row: Record<string, unknown>): GoalContribution {
    return {
      id: String(row.id),
      goalId: String(row.goal_id),
      expenseId: String(row.expense_id),
      amount: Number(row.amount),
      date: String(row.date),
      notes: String(row.notes)
    }
  }

  getDomainState(): FinanceDomainState {
    const incomes = this.db.prepare('SELECT * FROM incomes ORDER BY date DESC').all().map((row: unknown) => this.mapIncome(row as Record<string, unknown>))
    const expenses = this.db.prepare('SELECT * FROM expenses ORDER BY date DESC').all().map((row: unknown) => this.mapExpense(row as Record<string, unknown>))
    const categories = this.db.prepare('SELECT * FROM categories ORDER BY built_in DESC, name ASC').all().map((row: unknown) => this.mapCategory(row as Record<string, unknown>))
    const goals = this.db.prepare('SELECT * FROM goals ORDER BY priority ASC, target_date ASC').all().map((row: unknown) => this.mapGoal(row as Record<string, unknown>))
    const debts = this.db.prepare('SELECT * FROM debts ORDER BY start_date ASC, name ASC').all().map((row: unknown) => this.mapDebt(row as Record<string, unknown>))
    const goalContributions = this.db
      .prepare('SELECT * FROM goal_contributions ORDER BY date DESC')
      .all()
      .map((row: unknown) => this.mapGoalContribution(row as Record<string, unknown>))
    const budgetPlans = this.db.prepare('SELECT * FROM budget_plans ORDER BY month DESC').all().map((row: unknown) => this.mapBudget(row as Record<string, unknown>))
    const recurringTransactions = this.db
      .prepare('SELECT * FROM recurring_transactions ORDER BY kind ASC, title ASC')
      .all()
      .map((row: unknown) => ({
        id: String((row as Record<string, unknown>).id),
        title: String((row as Record<string, unknown>).title),
        kind: (row as Record<string, unknown>).kind as RecurringTransaction['kind'],
        amount: Number((row as Record<string, unknown>).amount),
        dayOfMonth: Number((row as Record<string, unknown>).day_of_month),
        categoryId: ((row as Record<string, unknown>).category_id as string | null) ?? null,
        groupName: ((row as Record<string, unknown>).group_name as string | null) ?? null,
        paymentMethod: ((row as Record<string, unknown>).payment_method as ExpenseRecord['paymentMethod'] | null) ?? null,
        entryType: ((row as Record<string, unknown>).entry_type as IncomeRecord['type'] | ExpenseRecord['type'] | null) ?? null,
        notes: String((row as Record<string, unknown>).notes ?? ''),
        tags: parseJson<string[]>(String((row as Record<string, unknown>).tags_json ?? '[]'), []),
        goalId: ((row as Record<string, unknown>).goal_id as string | null) ?? null,
        debtId: ((row as Record<string, unknown>).debt_id as string | null) ?? null,
        allocationKind: ((row as Record<string, unknown>).allocation_kind as ExpenseRecord['allocationKind'] | null) ?? null,
        sourceId: ((row as Record<string, unknown>).source_id as string | null) ?? null,
        active: Boolean((row as Record<string, unknown>).active)
      }))
    const alerts = this.db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all().map((row: unknown) => row as AlertItem)
    const settingsRow = this.db.prepare('SELECT json FROM settings WHERE id = 1').get() as { json: string }
    const settings = normalizeSettings(parseJson<Partial<Settings>>(settingsRow?.json, defaultSettings))
    const activityLog = this.db
      .prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 50')
      .all()
      .map((row: unknown) => ({
        id: String((row as Record<string, unknown>).id),
        createdAt: String((row as Record<string, unknown>).created_at),
        action: String((row as Record<string, unknown>).action),
        detail: String((row as Record<string, unknown>).detail)
      })) as ActivityLogItem[]
    const monthlySummaries = this.db
      .prepare('SELECT * FROM monthly_summaries ORDER BY month DESC')
      .all()
      .map((row: unknown) => ({
        month: String((row as Record<string, unknown>).month),
        income: Number((row as Record<string, unknown>).income),
        expenses: Number((row as Record<string, unknown>).expenses),
        savings: Number((row as Record<string, unknown>).savings),
        debtPayments: Number((row as Record<string, unknown>).debt_payments),
        closingBalance: Number((row as Record<string, unknown>).closing_balance)
      })) as MonthlySummary[]

    return {
      incomes,
      expenses,
      categories,
      goals,
      debts,
      goalContributions,
      budgetPlans,
      recurringTransactions,
      alerts,
      settings,
      activityLog,
      monthlySummaries
    }
  }

  private writeDerivedTables(alerts: AlertItem[], monthlySummaries: MonthlySummary[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM alerts').run()
      const alertStmt = this.db.prepare(`
        INSERT INTO alerts (id, created_at, severity, title, message, module)
        VALUES (@id, @createdAt, @severity, @title, @message, @module)
      `)
      alerts.forEach((alert) => alertStmt.run(alert))

      this.db.prepare('DELETE FROM monthly_summaries').run()
      const summaryStmt = this.db.prepare(`
        INSERT INTO monthly_summaries (month, income, expenses, savings, debt_payments, closing_balance)
        VALUES (@month, @income, @expenses, @savings, @debtPayments, @closingBalance)
      `)
      monthlySummaries.forEach((summary) => summaryStmt.run(summary))
    })
    tx()
  }

  private repairDanglingReferences(): void {
    const categoryRows = this.db.prepare('SELECT id, type FROM categories ORDER BY built_in DESC, name ASC').all() as Array<{ id: string; type: Category['type'] }>
    if (categoryRows.length === 0) {
      return
    }

    const categoryIds = new Set(categoryRows.map((row) => row.id))
    const savingCategoryIds = new Set(categoryRows.filter((row) => row.type === 'saving').map((row) => row.id))
    const fallbackCategoryId = categoryRows.find((row) => row.id === DEFAULT_FALLBACK_CATEGORY_ID)?.id ?? categoryRows[0].id
    const fallbackDebtCategoryId = categoryRows.find((row) => row.type === 'debt')?.id ?? fallbackCategoryId
    const goalIds = new Set((this.db.prepare('SELECT id FROM goals').all() as Array<{ id: string }>).map((row) => row.id))
    const debtIds = new Set((this.db.prepare('SELECT id FROM debts').all() as Array<{ id: string }>).map((row) => row.id))
    const expenseIds = new Set((this.db.prepare('SELECT id FROM expenses').all() as Array<{ id: string }>).map((row) => row.id))

    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE expenses SET category_id = ? WHERE category_id NOT IN (SELECT id FROM categories)').run(fallbackCategoryId)
      this.db.prepare('UPDATE recurring_transactions SET category_id = ? WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories)').run(fallbackCategoryId)
      this.db.prepare('UPDATE debts SET category_id = ? WHERE category_id NOT IN (SELECT id FROM categories)').run(fallbackDebtCategoryId)

      const expenses = this.db.prepare('SELECT id, category_id, goal_id, debt_id FROM expenses WHERE goal_id IS NOT NULL OR debt_id IS NOT NULL').all() as Array<{
        id: string
        category_id: string
        goal_id: string | null
        debt_id: string | null
      }>
      const updateExpenseLinks = this.db.prepare('UPDATE expenses SET goal_id = ?, debt_id = ?, allocation_kind = ? WHERE id = ?')
      expenses.forEach((expense) => {
        const nextGoalId = expense.goal_id && goalIds.has(expense.goal_id) ? expense.goal_id : null
        const nextDebtId = expense.debt_id && debtIds.has(expense.debt_id) ? expense.debt_id : null
        const nextAllocationKind = nextGoalId ? 'goal-contribution' : savingCategoryIds.has(expense.category_id) ? 'saving' : 'spend'
        if (nextGoalId !== expense.goal_id || nextDebtId !== expense.debt_id) {
          updateExpenseLinks.run(nextGoalId, nextDebtId, nextAllocationKind, expense.id)
        }
      })

      const recurringEntries = this.db
        .prepare('SELECT id, category_id, goal_id, debt_id, active FROM recurring_transactions WHERE goal_id IS NOT NULL OR debt_id IS NOT NULL')
        .all() as Array<{ id: string; category_id: string | null; goal_id: string | null; debt_id: string | null; active: number }>
      const updateRecurring = this.db.prepare('UPDATE recurring_transactions SET goal_id = ?, debt_id = ?, active = ? WHERE id = ?')
      recurringEntries.forEach((entry) => {
        const nextGoalId = entry.goal_id && goalIds.has(entry.goal_id) ? entry.goal_id : null
        const nextDebtId = entry.debt_id && debtIds.has(entry.debt_id) ? entry.debt_id : null
        const nextActive = entry.debt_id && !nextDebtId ? 0 : entry.active
        if (nextGoalId !== entry.goal_id || nextDebtId !== entry.debt_id || nextActive !== entry.active) {
          updateRecurring.run(nextGoalId, nextDebtId, nextActive, entry.id)
        }
      })

      const invalidGoalContributions = this.db
        .prepare('SELECT id, goal_id, expense_id FROM goal_contributions')
        .all() as Array<{ id: string; goal_id: string; expense_id: string }>
      const deleteGoalContribution = this.db.prepare('DELETE FROM goal_contributions WHERE id = ?')
      invalidGoalContributions.forEach((entry) => {
        if (!goalIds.has(entry.goal_id) || !expenseIds.has(entry.expense_id)) {
          deleteGoalContribution.run(entry.id)
        }
      })
    })

    tx()
  }

  private createSnapshot(): AppSnapshot {
    this.repairDanglingReferences()
    const data = this.getDomainState()
    const derived = calculateFinanceSnapshot(data)
    this.writeDerivedTables(derived.alerts, derived.monthlySummaries)
    if (isDevLoggingEnabled()) {
      console.debug('[main] Snapshot rebuilt', {
        incomes: data.incomes.length,
        expenses: data.expenses.length,
        goals: data.goals.length,
        debts: data.debts.length,
        month: derived.analytics.dashboard.month,
        remainingBalance: derived.analytics.dashboard.remainingBalance
      })
    }
    return {
      ...data,
      alerts: derived.alerts,
      monthlySummaries: derived.monthlySummaries,
      analytics: derived.analytics
    }
  }

  private log(action: string, detail: string): void {
    this.db
      .prepare('INSERT INTO activity_log (id, created_at, action, detail) VALUES (?, ?, ?, ?)')
      .run(createId('activity'), new Date().toISOString(), action, detail)
  }

  private writeIncome(payload: SaveIncomeInput & { id: string }): void {
    this.db
      .prepare(`
        INSERT INTO incomes (id, name, group_name, amount, date, source_id, type, recurring, notes)
        VALUES (@id, @name, @groupName, @amount, @date, @sourceId, @type, @recurring, @notes)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          group_name = excluded.group_name,
          amount = excluded.amount,
          date = excluded.date,
          source_id = excluded.source_id,
          type = excluded.type,
          recurring = excluded.recurring,
          notes = excluded.notes
      `)
      .run({ ...payload, sourceId: (payload as SaveIncomeInput & { id: string; sourceId?: string | null }).sourceId ?? null, recurring: payload.recurring ? 1 : 0 })
  }

  private writeExpense(payload: SaveExpenseInput & { id: string }): void {
    const normalizedPayload: SaveExpenseInput & { id: string } = {
      ...payload,
      goalId: payload.goalId ?? null,
      debtId: payload.debtId ?? null,
      allocationKind: payload.allocationKind ?? 'spend'
    }
    this.db
      .prepare(`
        INSERT INTO expenses (id, title, amount, date, source_id, category_id, payment_method, type, recurring, notes, tags_json, goal_id, debt_id, allocation_kind)
        VALUES (@id, @title, @amount, @date, @sourceId, @categoryId, @paymentMethod, @type, @recurring, @notes, @tagsJson, @goalId, @debtId, @allocationKind)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          amount = excluded.amount,
          date = excluded.date,
          source_id = excluded.source_id,
          category_id = excluded.category_id,
          payment_method = excluded.payment_method,
          type = excluded.type,
          recurring = excluded.recurring,
          notes = excluded.notes,
          tags_json = excluded.tags_json,
          goal_id = excluded.goal_id,
          debt_id = excluded.debt_id,
          allocation_kind = excluded.allocation_kind
      `)
      .run({
        ...normalizedPayload,
        recurring: normalizedPayload.recurring ? 1 : 0,
        tagsJson: JSON.stringify(ensureArray(normalizedPayload.tags)),
        sourceId: (normalizedPayload as SaveExpenseInput & { id: string; sourceId?: string | null }).sourceId ?? null,
        goalId: normalizedPayload.goalId,
        debtId: normalizedPayload.debtId,
        allocationKind: normalizedPayload.allocationKind
      })
  }

  private writeGoal(payload: SaveGoalInput & { id: string }): void {
    this.db
      .prepare(`
        INSERT INTO goals (id, name, type, target_amount, current_amount, target_date, priority, notes)
        VALUES (@id, @name, @type, @targetAmount, @currentAmount, @targetDate, @priority, @notes)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          target_amount = excluded.target_amount,
          current_amount = excluded.current_amount,
          target_date = excluded.target_date,
          priority = excluded.priority,
          notes = excluded.notes
      `)
      .run(payload)
  }

  private writeDebt(payload: SaveDebtInput & { id: string }): void {
    this.db
      .prepare(`
        INSERT INTO debts (
          id, name, total_amount, installment_amount, start_date, end_date, desired_payoff_date,
          payment_frequency, recurring_automatically, category_id, notes
        )
        VALUES (
          @id, @name, @totalAmount, @installmentAmount, @startDate, @endDate, @desiredPayoffDate,
          @paymentFrequency, @recurringAutomatically, @categoryId, @notes
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          total_amount = excluded.total_amount,
          installment_amount = excluded.installment_amount,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          desired_payoff_date = excluded.desired_payoff_date,
          payment_frequency = excluded.payment_frequency,
          recurring_automatically = excluded.recurring_automatically,
          category_id = excluded.category_id,
          notes = excluded.notes
      `)
      .run({
        ...payload,
        recurringAutomatically: payload.recurringAutomatically ? 1 : 0
      })
  }

  private writeCategory(payload: SaveCategoryInput & { id: string; builtIn: boolean }): void {
    this.db
      .prepare(`
        INSERT INTO categories (id, name, type, color, icon, monthly_limit, built_in)
        VALUES (@id, @name, @type, @color, @icon, @monthlyLimit, @builtIn)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          color = excluded.color,
          icon = excluded.icon,
          monthly_limit = excluded.monthly_limit
      `)
      .run({ ...payload, builtIn: payload.builtIn ? 1 : 0 })
  }

  private normalizeExpenseAllocation(
    payload: SaveExpenseInput & { id: string },
    category: Category,
    debt: DebtRecord | null
  ): SaveExpenseInput & { id: string } {
    const hasGoalLink = Boolean(payload.goalId)
    const normalizedGoalId = hasGoalLink ? payload.goalId ?? null : null

    if (hasGoalLink) {
      return {
        ...payload,
        goalId: normalizedGoalId,
        debtId: null,
        allocationKind: 'goal-contribution'
      }
    }

    if (debt) {
      return {
        ...payload,
        categoryId: debt.categoryId,
        goalId: null,
        debtId: debt.id,
        allocationKind: 'spend'
      }
    }

    if (payload.allocationKind === 'saving' && category.type === 'saving') {
      return {
        ...payload,
        goalId: null,
        allocationKind: 'saving'
      }
    }

    return {
      ...payload,
      goalId: null,
      allocationKind: 'spend'
    }
  }

  private syncGoalContributionForExpense(expense: SaveExpenseInput & { id: string }): void {
    if (expense.goalId && expense.allocationKind === 'goal-contribution') {
      this.db
        .prepare(`
          INSERT INTO goal_contributions (id, goal_id, expense_id, amount, date, notes)
          VALUES (@id, @goalId, @expenseId, @amount, @date, @notes)
          ON CONFLICT(expense_id) DO UPDATE SET
            goal_id = excluded.goal_id,
            amount = excluded.amount,
            date = excluded.date,
            notes = excluded.notes
        `)
        .run({
          id: `gcon-${expense.id}`,
          goalId: expense.goalId,
          expenseId: expense.id,
          amount: expense.amount,
          date: expense.date,
          notes: expense.notes
        })
      return
    }

    this.db.prepare('DELETE FROM goal_contributions WHERE expense_id = ?').run(expense.id)
  }

  private getGoalProgressAmount(goalId: string): number {
    const baseRow = this.db.prepare('SELECT current_amount FROM goals WHERE id = ?').get(goalId) as { current_amount: number } | undefined
    const contributionRow = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM goal_contributions WHERE goal_id = ?').get(goalId) as { total: number }
    return Number(baseRow?.current_amount ?? 0) + Number(contributionRow.total ?? 0)
  }

  private getDebtPaidAmount(debtId: string): number {
    return Number(
      (this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE debt_id = ?').get(debtId) as { total: number }).total
    )
  }

  private normalizeDebtInput(payload: SaveDebtInput & { id: string }): SaveDebtInput & { id: string } {
    const desiredDate = payload.desiredPayoffDate ?? payload.endDate ?? null
    let installmentAmount = payload.installmentAmount

    if (desiredDate && installmentAmount <= 0) {
      const start = parseISO(payload.startDate)
      const end = parseISO(desiredDate)
      const periods =
        payload.paymentFrequency === 'weekly'
          ? Math.max(Math.ceil(differenceInCalendarDays(end, start) / 7) + 1, 1)
          : Math.max(differenceInMonths(end, start) + 1, 1)
      installmentAmount = round2(payload.totalAmount / periods)
    }

    return {
      ...payload,
      installmentAmount: installmentAmount > 0 ? installmentAmount : payload.totalAmount
    }
  }

  private getCategoryById(id: string): Category | null {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.mapCategory(row) : null
  }

  private getDebtById(id: string): DebtRecord | null {
    const row = this.db.prepare('SELECT * FROM debts WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.mapDebt(row) : null
  }

  private syncBudgetRulesForCategory(category: Category): void {
    const plans = this.db.prepare('SELECT id, rules_json FROM budget_plans').all() as Array<{ id: string; rules_json: string }>
    const stmt = this.db.prepare('UPDATE budget_plans SET rules_json = ? WHERE id = ?')
    plans.forEach((plan) => {
      const rules = parseJson<BudgetPlan['rules']>(plan.rules_json, [])
      const nextRules = rules.some((entry) => entry.categoryId === category.id)
        ? rules.map((entry) => (entry.categoryId === category.id ? { ...entry, lockedAmount: category.type === 'essential' ? category.monthlyLimit : entry.lockedAmount } : entry))
        : [...rules, defaultRuleForCategory(category)]
      stmt.run(JSON.stringify(nextRules), plan.id)
    })
  }

  private removeCategoryFromBudgetRules(categoryId: string, fallbackCategoryId: string): void {
    const plans = this.db.prepare('SELECT id, rules_json FROM budget_plans').all() as Array<{ id: string; rules_json: string }>
    const stmt = this.db.prepare('UPDATE budget_plans SET rules_json = ? WHERE id = ?')
    plans.forEach((plan) => {
      const rules = parseJson<BudgetPlan['rules']>(plan.rules_json, [])
      const nextRules = rules
        .filter((entry) => entry.categoryId !== categoryId)
        .map((entry) => ({ ...entry, categoryId: entry.categoryId === categoryId ? fallbackCategoryId : entry.categoryId }))
      stmt.run(JSON.stringify(nextRules), plan.id)
    })
  }

  getCategoryDeletionImpact(id: string): CategoryDeletionImpact {
    const category = this.getCategoryById(id)
    if (!category) {
      throw new Error('Category not found.')
    }

    const expenseCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM expenses WHERE category_id = ?').get(id) as { count: number }).count)
    const recurringCount = Number(
      (this.db.prepare('SELECT COUNT(*) AS count FROM recurring_transactions WHERE category_id = ?').get(id) as { count: number }).count
    )
    const budgetRuleCount = Number(
      (this.db.prepare("SELECT COUNT(*) AS count FROM budget_plans WHERE rules_json LIKE ?").get(`%\"categoryId\":\"${id}\"%`) as { count: number }).count
    )
    const affectedReportAmount = Number(
      (this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE category_id = ?').get(id) as { total: number }).total
    )

    const availableTargetCategories = this.db
      .prepare('SELECT id, name, built_in FROM categories WHERE id != ? ORDER BY built_in DESC, name ASC')
      .all(id)
      .map((row: unknown) => ({
        id: String((row as Record<string, unknown>).id),
        name: String((row as Record<string, unknown>).name),
        builtIn: Boolean((row as Record<string, unknown>).built_in)
      }))

    const fallbackCategoryId =
      DEFAULT_FALLBACK_CATEGORY_ID !== category.id ? DEFAULT_FALLBACK_CATEGORY_ID : availableTargetCategories[0]?.id ?? null

    if (!fallbackCategoryId) {
      throw new Error('At least one category must remain available for reassignment.')
    }

    return {
      categoryId: category.id,
      categoryName: category.name,
      expenseCount,
      budgetRuleCount,
      recurringCount,
      affectedReportAmount,
      availableTargetCategories,
      fallbackCategoryId
    }
  }

  private writeBudgetPlan(payload: SaveBudgetPlanInput): void {
    this.db
      .prepare(`
        INSERT INTO budget_plans (id, month, method, custom_savings_target, custom_emergency_target, debt_acceleration, notes, rules_json)
        VALUES (@id, @month, @method, @customSavingsTarget, @customEmergencyTarget, @debtAcceleration, @notes, @rulesJson)
        ON CONFLICT(id) DO UPDATE SET
          month = excluded.month,
          method = excluded.method,
          custom_savings_target = excluded.custom_savings_target,
          custom_emergency_target = excluded.custom_emergency_target,
          debt_acceleration = excluded.debt_acceleration,
          notes = excluded.notes,
          rules_json = excluded.rules_json
      `)
      .run({
        ...payload,
        rulesJson: JSON.stringify(payload.rules)
      })
  }

  getSnapshot(): AppSnapshot {
    return this.createSnapshot()
  }

  applyRemoteSyncChanges(changes: RemoteSyncRecord[]): AppSnapshot {
    const tx = this.db.transaction((entries: RemoteSyncRecord[]) => {
      entries.forEach((entry) => this.applyRemoteSyncChange(entry))
    })
    tx(changes)
    return this.createSnapshot()
  }

  saveIncome(input: SaveIncomeInput): AppSnapshot {
    const payload: SaveIncomeInput & { id: string } = { ...input, id: input.id ?? createId('income') }
    const tx = this.db.transaction(() => {
      this.writeIncome(payload)
      if (payload.recurring) {
        this.upsertRecurringFromIncome(payload.id, payload)
      }
      this.log(payload.id === input.id ? 'income.updated' : 'income.created', `${payload.name} - ${payload.amount}`)
    })
    tx()
    return this.createSnapshot()
  }

  deleteIncome(id: string): AppSnapshot {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM incomes WHERE id = ?').run(id)
      this.db.prepare("DELETE FROM recurring_transactions WHERE id = ? OR id = ?").run(id, `rec-${id}`)
      this.log('income.deleted', id)
    })
    tx()
    return this.createSnapshot()
  }

  saveExpense(input: SaveExpenseInput): AppSnapshot {
    const basePayload: SaveExpenseInput & { id: string } = {
      ...input,
      id: input.id ?? createId('expense'),
      goalId: input.goalId ?? null,
      debtId: input.debtId ?? null,
      allocationKind: input.allocationKind ?? 'spend'
    }
    const tx = this.db.transaction(() => {
      const existingExpenseRow = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(basePayload.id) as Record<string, unknown> | undefined
      const existingExpense = existingExpenseRow ? this.mapExpense(existingExpenseRow) : null
      const category = this.getCategoryById(basePayload.categoryId)
      if (!category) {
        throw new Error('The selected category does not exist anymore.')
      }
      const linkedDebt = basePayload.debtId ? this.getDebtById(basePayload.debtId) : null
      if (basePayload.goalId) {
        const goalExists = this.db.prepare('SELECT 1 FROM goals WHERE id = ?').get(basePayload.goalId)
        if (!goalExists) {
          throw new Error('The selected goal does not exist anymore.')
        }
      }
      if (basePayload.debtId && !linkedDebt) {
          throw new Error('The selected debt does not exist anymore.')
      }
      const payload = this.normalizeExpenseAllocation(basePayload, category, linkedDebt)
      this.writeExpense(payload)
      this.syncGoalContributionForExpense(payload)
      if (payload.recurring) {
        this.upsertRecurringFromExpense(payload.id, payload)
      } else {
        this.db.prepare("DELETE FROM recurring_transactions WHERE id = ?").run(`rec-${payload.id}`)
      }
      const debtIdsToSync = new Set<string>()
      if (existingExpense?.debtId) debtIdsToSync.add(existingExpense.debtId)
      if (payload.debtId) debtIdsToSync.add(payload.debtId)
      debtIdsToSync.forEach((debtId) => {
        const debtRecord = this.getDebtById(debtId)
        if (debtRecord) {
          this.syncRecurringForDebt(debtRecord)
        }
      })
      this.log(payload.id === input.id ? 'expense.updated' : 'expense.created', `${payload.title} - ${payload.amount}`)
    })
    tx()
    return this.createSnapshot()
  }

  deleteExpense(id: string): AppSnapshot {
    const tx = this.db.transaction(() => {
      const expenseRow = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as Record<string, unknown> | undefined
      const linkedDebtId = expenseRow ? this.mapExpense(expenseRow).debtId : null
      this.db.prepare('DELETE FROM goal_contributions WHERE expense_id = ?').run(id)
      this.db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
      this.db.prepare("DELETE FROM recurring_transactions WHERE id = ? OR id = ?").run(id, `rec-${id}`)
      if (linkedDebtId) {
        const debtRecord = this.getDebtById(linkedDebtId)
        if (debtRecord) {
          this.syncRecurringForDebt(debtRecord)
        }
      }
      this.log('expense.deleted', id)
    })
    tx()
    return this.createSnapshot()
  }

  saveGoal(input: SaveGoalInput): AppSnapshot {
    const payload: SaveGoalInput & { id: string } = { ...input, id: input.id ?? createId('goal') }
    const tx = this.db.transaction(() => {
      this.writeGoal(payload)
      this.log(payload.id === input.id ? 'goal.updated' : 'goal.created', payload.name)
    })
    tx()
    return this.createSnapshot()
  }

  deleteGoal(id: string): AppSnapshot {
    const tx = this.db.transaction(() => {
      const linkedExpenses = this.db.prepare('SELECT * FROM expenses WHERE goal_id = ?').all(id) as Record<string, unknown>[]
      const updateExpense = this.db.prepare('UPDATE expenses SET goal_id = ?, allocation_kind = ? WHERE id = ?')

      linkedExpenses.forEach((row) => {
        const expense = this.mapExpense(row)
        const category = this.getCategoryById(expense.categoryId)
        const nextAllocationKind = category?.type === 'saving' ? 'saving' : 'spend'
        updateExpense.run(null, nextAllocationKind, expense.id)
      })
      this.db.prepare('DELETE FROM goal_contributions WHERE goal_id = ?').run(id)
      this.db.prepare('DELETE FROM goals WHERE id = ?').run(id)
      this.log('goal.deleted', id)
    })
    tx()
    return this.createSnapshot()
  }

  saveGoalContribution(input: SaveGoalContributionInput): AppSnapshot {
    const goal = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(input.goalId) as Record<string, unknown> | undefined
    if (!goal) {
      throw new Error('Goal not found.')
    }

    const categoryId = input.categoryId ?? this.db.prepare('SELECT id FROM categories ORDER BY built_in DESC, name ASC LIMIT 1').pluck().get()
    const category = typeof categoryId === 'string' ? this.getCategoryById(categoryId) : null
    if (!category || typeof categoryId !== 'string') {
      throw new Error('The selected category does not exist anymore.')
    }

    const expensePayload: SaveExpenseInput & { id: string } = {
      id: createId('expense'),
      title: `Goal contribution: ${String(goal.name)}`,
      amount: input.amount,
      date: input.date,
      categoryId,
      paymentMethod: input.paymentMethod ?? 'transfer',
      type: 'fixed',
      recurring: false,
      notes: input.notes,
      tags: ['goal', 'contribution'],
      goalId: input.goalId,
      debtId: null,
      allocationKind: 'goal-contribution'
    }
    const snapshot = this.saveExpense(expensePayload)
    this.log('goal.contribution.saved', `${input.goalId} - ${input.amount}`)
    return snapshot
  }

  saveDebt(input: SaveDebtInput): AppSnapshot {
      const payload = debtInputSchema.parse({ ...input, id: input.id ?? createId('debt') }) as SaveDebtInput & { id: string }
    const tx = this.db.transaction(() => {
      const normalized = this.normalizeDebtInput(payload)
      this.writeDebt(normalized)
      this.syncRecurringForDebt(normalized)
      this.log(normalized.id === input.id ? 'debt.updated' : 'debt.created', normalized.name)
    })
    tx()
    return this.createSnapshot()
  }

  deleteDebt(id: string): AppSnapshot {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE expenses SET debt_id = NULL WHERE debt_id = ?').run(id)
      this.db.prepare('DELETE FROM debts WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM recurring_transactions WHERE debt_id = ? OR id = ?').run(id, `debt-${id}`)
      this.log('debt.deleted', id)
    })
    tx()
    return this.createSnapshot()
  }

  saveCategory(input: SaveCategoryInput): AppSnapshot {
    const payload: Category = { ...input, id: input.id ?? createId('category'), builtIn: input.builtIn ?? false }
    const tx = this.db.transaction(() => {
      this.writeCategory(payload)
      this.syncBudgetRulesForCategory(payload)
      this.log(payload.id === input.id ? 'category.updated' : 'category.created', payload.name)
    })
    tx()
    return this.createSnapshot()
  }

  deleteCategory(input: DeleteCategoryInput): AppSnapshot {
    const impact = this.getCategoryDeletionImpact(input.categoryId)
    const targetCategoryId = input.mode === 'reassign' ? input.targetCategoryId : impact.fallbackCategoryId
    if (!targetCategoryId) {
      throw new Error('Select a target category before deleting.')
    }
    if (targetCategoryId === input.categoryId) {
      throw new Error('Choose a different target category.')
    }
    const targetCategory = this.getCategoryById(targetCategoryId)
    if (!targetCategory) {
      throw new Error('The target category was not found.')
    }

    const tx = this.db.transaction(() => {
      const category = this.db.prepare('SELECT id, name, built_in FROM categories WHERE id = ?').get(input.categoryId) as
        | { id: string; name: string; built_in: number }
        | undefined
      if (!category) {
        throw new Error('This category cannot be deleted.')
      }

      this.db.prepare('UPDATE expenses SET category_id = ? WHERE category_id = ?').run(targetCategoryId, input.categoryId)
      this.db.prepare('UPDATE recurring_transactions SET category_id = ? WHERE category_id = ?').run(targetCategoryId, input.categoryId)
      this.db.prepare('UPDATE debts SET category_id = ? WHERE category_id = ?').run(targetCategoryId, input.categoryId)
      this.removeCategoryFromBudgetRules(input.categoryId, targetCategoryId)
      this.db.prepare('DELETE FROM categories WHERE id = ?').run(input.categoryId)
      this.log('category.deleted', `${category.name} -> ${targetCategoryId}`)
    })
    tx()
    return this.createSnapshot()
  }

  saveBudgetPlan(input: SaveBudgetPlanInput, logChange = true): AppSnapshot {
    const tx = this.db.transaction(() => {
      this.writeBudgetPlan(input)
      if (logChange) {
        this.log('budget.saved', `${input.method} - ${input.month}`)
      }
    })
    tx()
    return this.createSnapshot()
  }

  saveSettings(input: Settings): AppSnapshot {
    const normalized = normalizeSettings(input)
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify(normalized))
      this.log('settings.updated', `${normalized.language} / ${normalized.currency} / ${normalized.theme}`)
    })
    tx()
    return this.createSnapshot()
  }

  seedDemoData(): AppSnapshot {
    const tx = this.db.transaction(() => {
      if ((this.db.prepare('SELECT COUNT(*) AS count FROM incomes').get() as { count: number }).count === 0) {
        demoIncomes.forEach((entry) => {
          const payload = { ...entry, id: entry.id ?? createId('income') }
          this.writeIncome(payload)
          if (payload.recurring) {
            this.upsertRecurringFromIncome(payload.id, payload)
          }
        })
      }
      if ((this.db.prepare('SELECT COUNT(*) AS count FROM expenses').get() as { count: number }).count === 0) {
        demoExpenses.forEach((entry) => {
          const payload = { ...entry, id: entry.id ?? createId('expense') }
          this.writeExpense(payload)
          this.syncGoalContributionForExpense(payload)
          if (payload.recurring) {
            this.upsertRecurringFromExpense(payload.id, payload)
          }
        })
      }
      if ((this.db.prepare('SELECT COUNT(*) AS count FROM goals').get() as { count: number }).count === 0) {
        demoGoals.forEach((entry) => this.writeGoal({ ...entry, id: entry.id ?? createId('goal') }))
      }
      if ((this.db.prepare('SELECT COUNT(*) AS count FROM debts').get() as { count: number }).count === 0) {
        demoDebts.forEach((entry) => this.writeDebt({ ...entry, id: entry.id ?? createId('debt') }))
      }
    })
    tx()
    this.log('demo.seeded', 'Demo data loaded')
    return this.createSnapshot()
  }

  resetData(): AppSnapshot {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM incomes;
        DELETE FROM expenses;
        DELETE FROM goals;
        DELETE FROM goal_contributions;
        DELETE FROM debts;
        DELETE FROM recurring_transactions;
        DELETE FROM alerts;
        DELETE FROM activity_log;
        DELETE FROM monthly_summaries;
        DELETE FROM budget_plans;
      `)
      this.db
        .prepare('DELETE FROM recurring_transactions')
        .run()
      this.writeBudgetPlan(demoBudgetPlan)
      this.log('data.reset', 'Application data reset')
    })
    tx()
    return this.createSnapshot()
  }

  async exportData(format: 'json' | 'csv' | 'xlsx', targetPath: string): Promise<{ success: boolean; filePath: string }> {
    const snapshot = this.createSnapshot()
    if (format === 'json') {
      writeFileSync(targetPath, JSON.stringify(snapshot, null, 2), 'utf8')
      return { success: true, filePath: targetPath }
    }

    if (format === 'csv') {
      const csv = Papa.unparse(snapshot.expenses.map((entry) => ({ ...entry, tags: entry.tags.join('|'), currency: snapshot.settings.currency })))
      writeFileSync(targetPath, csv, 'utf8')
      return { success: true, filePath: targetPath }
    }

    const workbook = new ExcelJS.Workbook()
    const appendSheet = (name: string, rows: Record<string, unknown>[]): void => {
      const worksheet = workbook.addWorksheet(name)
      const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
      if (headers.length === 0) return
      worksheet.addRow(headers)
      rows.forEach((row) => worksheet.addRow(headers.map((header) => row[header] ?? null)))
      worksheet.getRow(1).font = { bold: true }
      worksheet.views = [{ state: 'frozen', ySplit: 1 }]
    }
    appendSheet('Incomes', snapshot.incomes.map((entry) => ({ ...entry, currency: snapshot.settings.currency })))
    appendSheet('Expenses', snapshot.expenses.map((entry) => ({ ...entry, tags: entry.tags.join('|'), currency: snapshot.settings.currency })))
    appendSheet('Goals', snapshot.goals.map((entry) => ({ ...entry, currency: snapshot.settings.currency })))
    appendSheet('Debts', snapshot.debts.map((entry) => ({ ...entry, currency: snapshot.settings.currency })))
    appendSheet('GoalContributions', snapshot.goalContributions.map((entry) => ({ ...entry, currency: snapshot.settings.currency })))
    appendSheet('MonthlySummary', snapshot.monthlySummaries.map((entry) => ({ ...entry, currency: snapshot.settings.currency })))
    await workbook.xlsx.writeFile(targetPath)
    return { success: true, filePath: targetPath }
  }

  async importData(format: 'json' | 'csv' | 'xlsx', sourcePath: string): Promise<AppSnapshot> {
    if (format === 'json') {
      const raw = snapshotImportSchema.parse(JSON.parse(readFileSync(sourcePath, 'utf8')))
      const tx = this.db.transaction(() => {
        this.db.exec(`
          DELETE FROM incomes;
          DELETE FROM expenses;
          DELETE FROM goals;
          DELETE FROM goal_contributions;
          DELETE FROM debts;
          DELETE FROM recurring_transactions;
          DELETE FROM alerts;
          DELETE FROM activity_log;
          DELETE FROM monthly_summaries;
          DELETE FROM budget_plans;
        `)

        this.db
          .prepare(`
            INSERT INTO settings (id, json) VALUES (1, @json)
            ON CONFLICT(id) DO UPDATE SET json = excluded.json
          `)
          .run({ json: JSON.stringify(normalizeSettings(raw.settings)) })

        raw.categories
          .filter((entry) => !entry.builtIn)
          .forEach((entry) => this.writeCategory({ ...entry, id: entry.id ?? createId('category'), builtIn: false }))
        raw.budgetPlans.forEach((entry) => this.writeBudgetPlan(entry))
        raw.goals.forEach((entry) => this.writeGoal({ ...entry, id: entry.id ?? createId('goal') }))
        raw.debts.forEach((entry) => {
          const payload = this.normalizeDebtInput({ ...entry, id: entry.id ?? createId('debt') })
          this.writeDebt(payload)
          this.syncRecurringForDebt(payload)
        })
        raw.incomes.forEach((entry) => {
          const payload = { ...entry, id: entry.id ?? createId('income') }
          this.writeIncome(payload)
          if (payload.recurring) {
            this.upsertRecurringFromIncome(payload.id, payload)
          }
        })
        raw.expenses.forEach((entry) => {
          const payload = { ...entry, id: entry.id ?? createId('expense') }
          this.writeExpense(payload)
          this.syncGoalContributionForExpense(payload)
          if (payload.recurring) {
            this.upsertRecurringFromExpense(payload.id, payload)
          }
        })
        this.log('import.json', sourcePath)
      })
      tx()
      return this.createSnapshot()
    }

    if (format === 'csv') {
      const parsed = Papa.parse<Record<string, string>>(readFileSync(sourcePath, 'utf8'), { header: true })
      parsed.data
        .filter((entry) => entry.title && entry.amount && entry.date)
        .forEach((entry) =>
          this.saveExpense({
            title: entry.title,
            amount: Number(entry.amount),
            date: entry.date,
            categoryId: entry.categoryId || 'misc',
            paymentMethod: (entry.paymentMethod as ExpenseRecord['paymentMethod']) || 'card',
            type: (entry.type as ExpenseRecord['type']) || 'variable',
            recurring: entry.recurring === 'true',
            notes: entry.notes ?? '',
            tags: entry.tags ? entry.tags.split('|').filter(Boolean) : [],
            goalId: entry.goalId || null,
            debtId: entry.debtId || null,
            allocationKind: (entry.allocationKind as ExpenseRecord['allocationKind']) || 'spend'
          })
        )
      this.log('import.csv', sourcePath)
      return this.createSnapshot()
    }

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(sourcePath)
    const readRows = (worksheet: ExcelJS.Worksheet | undefined): Record<string, string>[] => {
      if (!worksheet) return []
      const headers = (worksheet.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String)
      const rows: Record<string, string>[] = []
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const result: Record<string, string> = {}
        headers.forEach((header, index) => {
          const value = row.getCell(index + 1).value
          result[header] = value == null ? '' : String(value)
        })
        rows.push(result)
      })
      return rows
    }
    const incomeRows = readRows(workbook.getWorksheet('Incomes') ?? workbook.worksheets[0])
    const expenseRows = readRows(workbook.getWorksheet('Expenses'))
    const debtRows = readRows(workbook.getWorksheet('Debts'))
    incomeRows.forEach((entry) => {
      if (entry.name && entry.amount && entry.date) {
        this.saveIncome({
          name: entry.name,
          groupName: entry.groupName ?? 'Imported',
          amount: Number(entry.amount),
          date: entry.date,
          type: (entry.type as IncomeRecord['type']) || 'variable',
          recurring: entry.recurring === 'true',
          notes: entry.notes ?? ''
        })
      }
    })
    expenseRows.forEach((entry) => {
      if (entry.title && entry.amount && entry.date) {
        this.saveExpense({
          title: entry.title,
          amount: Number(entry.amount),
          date: entry.date,
          categoryId: entry.categoryId || 'misc',
          paymentMethod: (entry.paymentMethod as ExpenseRecord['paymentMethod']) || 'card',
          type: (entry.type as ExpenseRecord['type']) || 'variable',
          recurring: entry.recurring === 'true',
          notes: entry.notes ?? '',
          tags: entry.tags ? String(entry.tags).split('|').filter(Boolean) : [],
          goalId: entry.goalId || null,
          debtId: entry.debtId || null,
          allocationKind: (entry.allocationKind as ExpenseRecord['allocationKind']) || 'spend'
        })
      }
    })
    debtRows.forEach((entry) => {
      if (entry.name && entry.totalAmount && entry.startDate) {
        this.saveDebt({
          name: entry.name,
          totalAmount: Number(entry.totalAmount),
          installmentAmount: Number(entry.installmentAmount ?? 0),
          startDate: entry.startDate,
          endDate: entry.endDate || null,
          desiredPayoffDate: entry.desiredPayoffDate || null,
          paymentFrequency: (entry.paymentFrequency as SaveDebtInput['paymentFrequency']) || 'monthly',
          recurringAutomatically: String(entry.recurringAutomatically) === 'true',
          categoryId: entry.categoryId || 'debt',
          notes: entry.notes ?? ''
        })
      }
    })
    this.log('import.xlsx', sourcePath)
    return this.createSnapshot()
  }

  private nextOccurrenceDate(month: string, dayOfMonth: number): string {
    const monthDate = parseISO(`${month}-01`)
    const maxDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
    return format(new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(dayOfMonth, maxDay)), 'yyyy-MM-dd')
  }

  private cloneRecurringEntriesForMonth(month: string): void {
    const recurring = this.db.prepare('SELECT * FROM recurring_transactions WHERE active = 1').all() as Record<string, unknown>[]

    recurring.forEach((row) => {
      const entry = {
        id: String(row.id),
        title: String(row.title),
        kind: row.kind as 'income' | 'expense',
        amount: Number(row.amount),
        dayOfMonth: Number(row.day_of_month),
        categoryId: (row.category_id as string | null) ?? null,
        groupName: (row.group_name as string | null) ?? null,
        paymentMethod: (row.payment_method as ExpenseRecord['paymentMethod'] | null) ?? null,
        entryType: (row.entry_type as IncomeRecord['type'] | ExpenseRecord['type'] | null) ?? null,
        notes: String(row.notes ?? ''),
        tags: parseJson<string[]>(String(row.tags_json ?? '[]'), []),
        goalId: (row.goal_id as string | null) ?? null,
        debtId: (row.debt_id as string | null) ?? null,
        allocationKind: (row.allocation_kind as ExpenseRecord['allocationKind'] | null) ?? null,
        sourceId: (row.source_id as string | null) ?? null
      }
      const date = this.nextOccurrenceDate(month, entry.dayOfMonth)

      if (entry.kind === 'income') {
        const exists = this.db
          .prepare('SELECT 1 FROM incomes WHERE source_id = ? AND date = ?')
          .get(entry.sourceId ?? entry.id, date) as { 1: number } | undefined
        if (!exists) {
          const source = entry.sourceId
            ? (this.db.prepare('SELECT recurring FROM incomes WHERE id = ?').get(entry.sourceId) as { recurring: number } | undefined)
            : undefined
          this.writeIncome({
            id: createId('income'),
            name: entry.title,
            groupName: entry.groupName ?? 'Recurring',
            amount: entry.amount,
            date,
            sourceId: entry.sourceId ?? entry.id,
            type: (entry.entryType as IncomeRecord['type']) ?? 'fixed',
            recurring: Boolean(source?.recurring ?? true),
            notes: entry.notes
          } as SaveIncomeInput & { id: string; sourceId?: string | null })
        }
        return
      }

      if (!entry.categoryId) return

      if (entry.debtId) {
        const debtRow = this.db.prepare('SELECT * FROM debts WHERE id = ?').get(entry.debtId) as Record<string, unknown> | undefined
        if (!debtRow) return
        const debt = this.mapDebt(debtRow)
        const paidSoFar = this.getDebtPaidAmount(debt.id)
        const remainingBalance = Math.max(debt.totalAmount - paidSoFar, 0)
        if (remainingBalance <= 0) {
          this.db.prepare('UPDATE recurring_transactions SET active = 0 WHERE debt_id = ?').run(debt.id)
          return
        }
        const exists = this.db.prepare('SELECT 1 FROM expenses WHERE debt_id = ? AND date = ?').get(debt.id, date) as { 1: number } | undefined
        if (exists) return
        const nextAmount = Math.min(debt.installmentAmount, remainingBalance)
        const expensePayload = {
          id: createId('expense'),
          title: `${debt.name} installment`,
          amount: nextAmount,
          date,
          sourceId: entry.sourceId ?? entry.id,
          categoryId: debt.categoryId,
          paymentMethod: 'bank',
          type: 'fixed',
          recurring: true,
          notes: debt.notes,
          tags: ['debt', 'installment'],
          goalId: null,
          debtId: debt.id,
          allocationKind: 'spend'
        } as SaveExpenseInput & { id: string; sourceId?: string | null }
        this.writeExpense(expensePayload)
        const remainingAfterInsert = Math.max(debt.totalAmount - (paidSoFar + nextAmount), 0)
        if (remainingAfterInsert <= 0) {
          this.db.prepare('UPDATE recurring_transactions SET active = 0 WHERE debt_id = ?').run(debt.id)
        }
        return
      }

      const exists = this.db.prepare('SELECT 1 FROM expenses WHERE source_id = ? AND date = ?').get(entry.sourceId ?? entry.id, date) as { 1: number } | undefined
      if (!exists) {
        const expensePayload = {
          id: createId('expense'),
          title: entry.title,
          amount: entry.amount,
          date,
          sourceId: entry.sourceId ?? entry.id,
          categoryId: entry.categoryId,
          paymentMethod: entry.paymentMethod ?? 'bank',
          type: (entry.entryType as ExpenseRecord['type']) ?? 'fixed',
          recurring: true,
          notes: entry.notes,
          tags: entry.tags,
          goalId: entry.goalId,
          debtId: null,
          allocationKind: entry.allocationKind ?? 'spend'
        } as SaveExpenseInput & { id: string; sourceId?: string | null }
        this.writeExpense(expensePayload)
        this.syncGoalContributionForExpense(expensePayload)
      }
    })
  }

  runMonthlyClose(month: string): AppSnapshot {
    const snapshot = this.createSnapshot()
    const summary = snapshot.monthlySummaries.find((entry) => entry.month === month)
    if (summary) {
      const nextMonth = format(addMonths(parseISO(`${month}-01`), 1), 'yyyy-MM')
      const tx = this.db.transaction(() => {
        this.db
          .prepare(`
            INSERT INTO monthly_summaries (month, income, expenses, savings, debt_payments, closing_balance)
            VALUES (@month, @income, @expenses, @savings, @debtPayments, @closingBalance)
            ON CONFLICT(month) DO UPDATE SET
              income = excluded.income,
              expenses = excluded.expenses,
              savings = excluded.savings,
              debt_payments = excluded.debt_payments,
              closing_balance = excluded.closing_balance
          `)
          .run(summary)

        const currentPlan = snapshot.budgetPlans.find((entry) => entry.month === month) ?? snapshot.budgetPlans[0]
        if (currentPlan) {
          this.writeBudgetPlan({ ...currentPlan, id: `budget-${nextMonth}`, month: nextMonth })
        }

        this.cloneRecurringEntriesForMonth(nextMonth)
        snapshot.debts.forEach((debt) => this.syncRecurringForDebt(debt))
        this.log('month.closed', month)
      })
      tx()
    }
    return this.createSnapshot()
  }

  private getFallbackCategoryId(type: Category['type'] | 'any' = 'any'): string {
    const preferred =
      type === 'debt'
        ? ((this.db.prepare("SELECT id FROM categories WHERE type = 'debt' ORDER BY built_in DESC, name ASC LIMIT 1").get() as { id: string } | undefined)?.id ?? null)
        : null
    if (preferred) {
      return preferred
    }
    const misc =
      ((this.db.prepare('SELECT id FROM categories WHERE id = ?').get(DEFAULT_FALLBACK_CATEGORY_ID) as { id: string } | undefined)?.id ?? null)
    if (misc) {
      return misc
    }
    const firstCategory = this.db.prepare('SELECT id FROM categories ORDER BY built_in DESC, name ASC LIMIT 1').get() as { id: string } | undefined
    if (!firstCategory) {
      throw new Error('No categories available for sync application.')
    }
    return firstCategory.id
  }

  private applyRemoteSyncChange(change: RemoteSyncRecord): void {
    if (change.deletedAt) {
      this.applyRemoteDelete(change.entityType, change.recordId)
      return
    }

    switch (change.entityType) {
      case 'income': {
        const payload = change.payload as Partial<IncomeRecord>
        this.writeIncome({
          id: change.recordId,
          name: payload.name ?? 'Synced income',
          groupName: payload.groupName ?? 'Synced',
          amount: Number(payload.amount ?? 0),
          date: payload.date ?? format(new Date(), 'yyyy-MM-dd'),
          type: payload.type ?? 'variable',
          recurring: Boolean(payload.recurring),
          notes: payload.notes ?? ''
        })
        if (payload.recurring) {
          this.upsertRecurringFromIncome(change.recordId, {
            name: payload.name ?? 'Synced income',
            groupName: payload.groupName ?? 'Synced',
            amount: Number(payload.amount ?? 0),
            date: payload.date ?? format(new Date(), 'yyyy-MM-dd'),
            type: payload.type ?? 'variable',
            recurring: Boolean(payload.recurring),
            notes: payload.notes ?? ''
          })
        } else {
          this.db.prepare("DELETE FROM recurring_transactions WHERE id = ? OR id = ?").run(change.recordId, `rec-${change.recordId}`)
        }
        break
      }
      case 'expense': {
        const payload = change.payload as Partial<ExpenseRecord>
        const existingExpenseRow = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(change.recordId) as Record<string, unknown> | undefined
        const existingExpense = existingExpenseRow ? this.mapExpense(existingExpenseRow) : null
        const goalId =
          payload.goalId && this.db.prepare('SELECT 1 FROM goals WHERE id = ?').get(payload.goalId) ? payload.goalId : null
        const linkedDebt = payload.debtId ? this.getDebtById(payload.debtId) : null
        const category = this.getCategoryById(payload.categoryId ?? '') ?? this.getCategoryById(this.getFallbackCategoryId(linkedDebt ? 'debt' : 'any'))
        if (!category) {
          throw new Error('No category available for synced expense.')
        }
        const normalized = this.normalizeExpenseAllocation(
          {
            id: change.recordId,
            title: payload.title ?? 'Synced expense',
            amount: Number(payload.amount ?? 0),
            date: payload.date ?? format(new Date(), 'yyyy-MM-dd'),
            categoryId: payload.categoryId ?? category.id,
            paymentMethod: payload.paymentMethod ?? 'card',
            type: payload.type ?? 'variable',
            recurring: Boolean(payload.recurring),
            notes: payload.notes ?? '',
            tags: ensureArray(payload.tags),
            goalId,
            debtId: linkedDebt?.id ?? null,
            allocationKind: payload.allocationKind ?? 'spend'
          },
          category,
          linkedDebt
        )
        this.writeExpense(normalized)
        this.syncGoalContributionForExpense(normalized)
        if (normalized.recurring) {
          this.upsertRecurringFromExpense(change.recordId, normalized)
        } else {
          this.db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(`rec-${change.recordId}`)
        }
        const debtIdsToSync = new Set<string>()
        if (existingExpense?.debtId) debtIdsToSync.add(existingExpense.debtId)
        if (normalized.debtId) debtIdsToSync.add(normalized.debtId)
        debtIdsToSync.forEach((debtId) => {
          const debt = this.getDebtById(debtId)
          if (debt) {
            this.syncRecurringForDebt(debt)
          }
        })
        break
      }
      case 'category': {
        const payload = change.payload as Partial<Category>
        this.writeCategory({
          id: change.recordId,
          name: payload.name ?? 'Synced category',
          type: payload.type ?? 'custom',
          color: payload.color ?? '#64748b',
          icon: payload.icon ?? 'wallet',
          monthlyLimit: payload.monthlyLimit ?? null,
          builtIn: Boolean(payload.builtIn)
        })
        const category = this.getCategoryById(change.recordId)
        if (category) {
          this.syncBudgetRulesForCategory(category)
        }
        break
      }
      case 'goal': {
        const payload = change.payload as Partial<Goal>
        this.writeGoal({
          id: change.recordId,
          name: payload.name ?? 'Synced goal',
          type: payload.type ?? 'general',
          targetAmount: Number(payload.targetAmount ?? 0),
          currentAmount: Number(payload.currentAmount ?? 0),
          targetDate: payload.targetDate ?? format(addMonths(new Date(), 1), 'yyyy-MM-dd'),
          priority: payload.priority ?? 'medium',
          notes: payload.notes ?? ''
        })
        break
      }
      case 'debt': {
        const payload = change.payload as Partial<DebtRecord>
        const normalized = this.normalizeDebtInput({
          id: change.recordId,
          name: payload.name ?? 'Synced debt',
          totalAmount: Number(payload.totalAmount ?? 0),
          installmentAmount: Number(payload.installmentAmount ?? 0),
          startDate: payload.startDate ?? format(new Date(), 'yyyy-MM-dd'),
          endDate: payload.endDate ?? null,
          desiredPayoffDate: payload.desiredPayoffDate ?? null,
          paymentFrequency: payload.paymentFrequency ?? 'monthly',
          recurringAutomatically: payload.recurringAutomatically ?? true,
          categoryId: this.getCategoryById(payload.categoryId ?? '') ? (payload.categoryId as string) : this.getFallbackCategoryId('debt'),
          notes: payload.notes ?? ''
        })
        this.writeDebt(normalized)
        this.syncRecurringForDebt(normalized)
        break
      }
      case 'budget': {
        const payload = change.payload as Partial<BudgetPlan>
        this.writeBudgetPlan({
          id: change.recordId,
          month: payload.month ?? format(new Date(), 'yyyy-MM'),
          method: payload.method ?? 'zero-based',
          customSavingsTarget: Number(payload.customSavingsTarget ?? 0),
          customEmergencyTarget: Number(payload.customEmergencyTarget ?? 0),
          debtAcceleration: Number(payload.debtAcceleration ?? 0),
          notes: payload.notes ?? '',
          rules: Array.isArray(payload.rules) ? payload.rules : []
        })
        break
      }
      case 'settings': {
        const payload = normalizeSettings(change.payload as Partial<Settings>)
        this.db.prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify(payload))
        break
      }
      case 'monthly-summary': {
        break
      }
      default:
        break
    }
  }

  private applyRemoteDelete(entityType: SyncEntityType, recordId: string): void {
    switch (entityType) {
      case 'income':
        this.db.prepare('DELETE FROM incomes WHERE id = ?').run(recordId)
        this.db.prepare("DELETE FROM recurring_transactions WHERE id = ? OR id = ?").run(recordId, `rec-${recordId}`)
        break
      case 'expense': {
        const expenseRow = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(recordId) as Record<string, unknown> | undefined
        const linkedDebtId = expenseRow ? this.mapExpense(expenseRow).debtId : null
        this.db.prepare('DELETE FROM goal_contributions WHERE expense_id = ?').run(recordId)
        this.db.prepare('DELETE FROM expenses WHERE id = ?').run(recordId)
        this.db.prepare("DELETE FROM recurring_transactions WHERE id = ? OR id = ?").run(recordId, `rec-${recordId}`)
        if (linkedDebtId) {
          const debt = this.getDebtById(linkedDebtId)
          if (debt) {
            this.syncRecurringForDebt(debt)
          }
        }
        break
      }
      case 'goal': {
        const linkedExpenses = this.db.prepare('SELECT * FROM expenses WHERE goal_id = ?').all(recordId) as Record<string, unknown>[]
        const updateExpense = this.db.prepare('UPDATE expenses SET goal_id = ?, allocation_kind = ? WHERE id = ?')
        linkedExpenses.forEach((row) => {
          const expense = this.mapExpense(row)
          const category = this.getCategoryById(expense.categoryId)
          updateExpense.run(null, category?.type === 'saving' ? 'saving' : 'spend', expense.id)
        })
        this.db.prepare('DELETE FROM goal_contributions WHERE goal_id = ?').run(recordId)
        this.db.prepare('DELETE FROM goals WHERE id = ?').run(recordId)
        break
      }
      case 'debt':
        this.db.prepare('UPDATE expenses SET debt_id = NULL WHERE debt_id = ?').run(recordId)
        this.db.prepare('DELETE FROM debts WHERE id = ?').run(recordId)
        this.db.prepare('DELETE FROM recurring_transactions WHERE debt_id = ? OR id = ?').run(recordId, `debt-${recordId}`)
        break
      case 'category': {
        const fallbackCategoryId = this.getFallbackCategoryId('any')
        const fallbackDebtCategoryId = this.getFallbackCategoryId('debt')
        if (fallbackCategoryId !== recordId) {
          this.db.prepare('UPDATE expenses SET category_id = ? WHERE category_id = ?').run(fallbackCategoryId, recordId)
          this.db.prepare('UPDATE recurring_transactions SET category_id = ? WHERE category_id = ?').run(fallbackCategoryId, recordId)
        }
        if (fallbackDebtCategoryId !== recordId) {
          this.db.prepare('UPDATE debts SET category_id = ? WHERE category_id = ?').run(fallbackDebtCategoryId, recordId)
        }
        this.removeCategoryFromBudgetRules(recordId, fallbackCategoryId === recordId ? fallbackDebtCategoryId : fallbackCategoryId)
        this.db.prepare('DELETE FROM categories WHERE id = ?').run(recordId)
        break
      }
      case 'budget':
        this.db.prepare('DELETE FROM budget_plans WHERE id = ?').run(recordId)
        break
      case 'settings':
        this.db.prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify(defaultSettings))
        break
      case 'monthly-summary':
        this.db.prepare('DELETE FROM monthly_summaries WHERE month = ?').run(recordId)
        break
      default:
        break
    }
  }

  private upsertRecurringFromIncome(id: string, input: SaveIncomeInput): void {
    const day = Number(input.date.split('-')[2] ?? 1)
    this.db
      .prepare(`
        INSERT INTO recurring_transactions (
          id, title, kind, amount, day_of_month, category_id, group_name, payment_method, entry_type,
          notes, tags_json, goal_id, debt_id, allocation_kind, source_id, active
        )
        VALUES (@id, @title, 'income', @amount, @dayOfMonth, NULL, @groupName, NULL, @entryType, @notes, '[]', NULL, NULL, NULL, @sourceId, 1)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          amount = excluded.amount,
          day_of_month = excluded.day_of_month,
          group_name = excluded.group_name,
          entry_type = excluded.entry_type,
          notes = excluded.notes,
          source_id = excluded.source_id,
          active = 1
      `)
      .run({
        id: `rec-${id}`,
        title: input.name,
        amount: input.amount,
        dayOfMonth: day,
        groupName: input.groupName,
        entryType: input.type,
        notes: input.notes,
        sourceId: id
      })
  }

  private upsertRecurringFromExpense(id: string, input: SaveExpenseInput): void {
    const day = Number(input.date.split('-')[2] ?? 1)
    this.db
      .prepare(`
        INSERT INTO recurring_transactions (
          id, title, kind, amount, day_of_month, category_id, group_name, payment_method, entry_type,
          notes, tags_json, goal_id, debt_id, allocation_kind, source_id, active
        )
        VALUES (
          @id, @title, 'expense', @amount, @dayOfMonth, @categoryId, NULL, @paymentMethod, @entryType,
          @notes, @tagsJson, @goalId, @debtId, @allocationKind, @sourceId, 1
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          amount = excluded.amount,
          day_of_month = excluded.day_of_month,
          category_id = excluded.category_id,
          payment_method = excluded.payment_method,
          entry_type = excluded.entry_type,
          notes = excluded.notes,
          tags_json = excluded.tags_json,
          goal_id = excluded.goal_id,
          debt_id = excluded.debt_id,
          allocation_kind = excluded.allocation_kind,
          source_id = excluded.source_id,
          active = 1
      `)
      .run({
        id: `rec-${id}`,
        title: input.title,
        amount: input.amount,
        dayOfMonth: day,
        categoryId: input.categoryId,
        paymentMethod: input.paymentMethod,
        entryType: input.type,
        notes: input.notes,
        tagsJson: JSON.stringify(ensureArray(input.tags)),
        goalId: input.goalId ?? null,
        debtId: input.debtId ?? null,
        allocationKind: input.allocationKind ?? 'spend',
        sourceId: id
      })
  }

  private syncRecurringForDebt(input: SaveDebtInput & { id: string }): void {
    const paidSoFar = this.getDebtPaidAmount(input.id)
    const remainingBalance = Math.max(input.totalAmount - paidSoFar, 0)
    const hasCustomRecurringLinkedPayment = Boolean(
      this.db
        .prepare('SELECT 1 FROM recurring_transactions WHERE debt_id = ? AND id != ? LIMIT 1')
        .get(input.id, `debt-${input.id}`)
    )
    if (!input.recurringAutomatically || remainingBalance <= 0) {
      this.db.prepare('DELETE FROM recurring_transactions WHERE id = ? OR debt_id = ?').run(`debt-${input.id}`, input.id)
      return
    }

    if (hasCustomRecurringLinkedPayment) {
      this.db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(`debt-${input.id}`)
      return
    }

    const day = Number(input.startDate.split('-')[2] ?? 1)
    this.db
      .prepare(`
        INSERT INTO recurring_transactions (
          id, title, kind, amount, day_of_month, category_id, group_name, payment_method, entry_type,
          notes, tags_json, goal_id, debt_id, allocation_kind, source_id, active
        )
        VALUES (
          @id, @title, 'expense', @amount, @dayOfMonth, @categoryId, NULL, 'bank', 'fixed',
          @notes, '["debt","installment"]', NULL, @debtId, 'spend', @sourceId, 1
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          amount = excluded.amount,
          day_of_month = excluded.day_of_month,
          category_id = excluded.category_id,
          notes = excluded.notes,
          debt_id = excluded.debt_id,
          source_id = excluded.source_id,
          active = 1
      `)
      .run({
        id: `debt-${input.id}`,
        title: `${input.name} installment`,
        amount: Math.min(input.installmentAmount, remainingBalance),
        dayOfMonth: day,
        categoryId: input.categoryId,
        notes: input.notes,
        debtId: input.id,
        sourceId: input.id
      })
  }
}
