const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeStoredMoneyPayload, parseLegacyMajor } = require('../domain/moneyPayload.cjs')

test('legacy major-unit payloads convert deterministically to v2 integer cents', () => {
  assert.deepEqual(normalizeStoredMoneyPayload('income', { id: 'i', amount: 0.1 }), { id: 'i', amount: 10, moneyVersion: 2 })
  assert.deepEqual(normalizeStoredMoneyPayload('expense', { id: 'e', amount: '999999999.99' }), { id: 'e', amount: 99999999999, moneyVersion: 2 })
  assert.equal(normalizeStoredMoneyPayload('budget', { customSavingsTarget: 0, customEmergencyTarget: 0, debtAcceleration: 0, rules: [{ lockedAmount: 2.5 }] }).rules[0].lockedAmount, 250)
})

test('legacy conversion rejects ambiguous sub-cent and overflow values', () => {
  assert.throws(() => parseLegacyMajor(1.005), /cent-exact/)
  assert.throws(() => parseLegacyMajor('1000000000.00'), /outside/)
})

test('v2 payload validation rejects floats and preserves integer cents', () => {
  assert.equal(normalizeStoredMoneyPayload('income', { moneyVersion: 2, amount: 1234 }).amount, 1234)
  assert.throws(() => normalizeStoredMoneyPayload('income', { moneyVersion: 2, amount: 12.34 }), /safe integer/)
})
