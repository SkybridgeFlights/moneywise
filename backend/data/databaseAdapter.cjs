function sqliteAdapter(db) {
  const sqlite = db.sqlite
  let transactionTail = Promise.resolve()
  const direct = {
    provider: 'sqlite', raw: db,
    async all(sql, args = []) { return sqlite.prepare(sql).all(...args) },
    async get(sql, args = []) { return sqlite.prepare(sql).get(...args) ?? null },
    async run(sql, args = []) { const result = sqlite.prepare(sql).run(...args); return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid } },
    async exec(sql) { sqlite.exec(sql) },
    async transaction() { throw new Error('Nested database transactions are not supported.') },
    async close() { sqlite.close() }
  }
  const adapter = {
    provider: 'sqlite',
    raw: db,
    async all(sql, args = []) { await transactionTail; return direct.all(sql, args) },
    async get(sql, args = []) { await transactionTail; return direct.get(sql, args) },
    async run(sql, args = []) { await transactionTail; return direct.run(sql, args) },
    async exec(sql) { await transactionTail; return direct.exec(sql) },
    async transaction(callback) {
      const previous = transactionTail
      let release
      transactionTail = new Promise((resolve) => { release = resolve })
      await previous
      sqlite.exec('BEGIN IMMEDIATE')
      try { const result = await callback(direct); sqlite.exec('COMMIT'); return result }
      catch (error) { sqlite.exec('ROLLBACK'); throw error }
      finally { release() }
    },
    async close() { sqlite.close() }
  }
  return adapter
}

function normalizeRows(result) {
  return Array.from(result.rows ?? [], (row) => ({ ...row }))
}

function isTransientRemoteError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const message = String(error?.message ?? '').toLowerCase()
  return /TIMEOUT|FETCH|NETWORK|CONNECTION|CLOSED|SERVER_ERROR/.test(code) || /timeout|timed out|connection|network|fetch failed|socket/.test(message)
}

function abortedTransactionError(error) {
  const aborted = new Error('The remote transaction was aborted before commit. Retry only with the same request ID.', { cause: error })
  aborted.code = 'transaction_aborted'
  aborted.retryable = true
  aborted.statusCode = 503
  return aborted
}

function libsqlHandleAdapter(handle, raw, transactionFactory) {
  return {
    provider: 'turso',
    raw,
    async all(sql, args = []) { return normalizeRows(await handle.execute({ sql, args })) },
    async get(sql, args = []) { return (await this.all(sql, args))[0] ?? null },
    async run(sql, args = []) {
      const result = await handle.execute({ sql, args })
      return { rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid }
    },
    async exec(sql) { await handle.executeMultiple(sql) },
    transaction: transactionFactory,
    async close() { raw.close() }
  }
}

function tursoAdapter(client) {
  let transactionTail = Promise.resolve()
  const adapter = libsqlHandleAdapter(client, client, async (callback) => {
    const previous = transactionTail
    let release
    transactionTail = new Promise((resolve) => { release = resolve })
    await previous
    let transaction
    try {
      transaction = await client.transaction('write')
      const transactionAdapter = libsqlHandleAdapter(transaction, client, async () => {
        throw new Error('Nested database transactions are not supported.')
      })
      const result = await callback(transactionAdapter)
      try {
        await transaction.commit()
      } catch (error) {
        const ambiguous = new Error('The remote transaction commit result is unknown. Retry the same request ID to resolve it.', { cause: error })
        ambiguous.code = 'ambiguous_commit'
        ambiguous.retryable = true
        ambiguous.statusCode = 503
        throw ambiguous
      }
      return result
    } catch (error) {
      if (transaction && error?.code !== 'ambiguous_commit') {
        try { await transaction.rollback() } catch {}
      }
      throw error?.code !== 'ambiguous_commit' && isTransientRemoteError(error) ? abortedTransactionError(error) : error
    } finally {
      release()
    }
  })
  return adapter
}

module.exports = { sqliteAdapter, tursoAdapter }
