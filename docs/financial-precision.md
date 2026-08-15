# Financial precision

MoneyWise represents every supported two-decimal currency amount as an integer number of minor units (cents). The supported range is -999,999,999.99 through 999,999,999.99 where a signed balance is permitted; ordinary income and expense inputs are non-negative. This range remains inside JavaScript's safe-integer range.

User input is parsed directly from decimal text. Zero, one, or two fractional digits are accepted; sub-cent input is rejected rather than rounded. Integer arithmetic and `BigInt` intermediates provide half-away-from-zero allocation at unavoidable division boundaries. Floating-point values remain only for non-money metrics such as percentages and chart ratios.

Sync payloads use integer minor units and require `moneyVersion: 2`. This makes old-client writes fail closed. Unversioned server records are interpreted as legacy major-unit decimals only when every value is cent-exact and in range, then exposed to clients as v2 cents. This compatibility read does not mutate production Turso data.

Encrypted desktop profiles migrate legacy SQLite `REAL` columns transactionally. A complete legacy table generation is retained as `_legacy_money_v1`; converted rows, storage classes, counts, and hashes are verified before activation. Ambiguous sub-cent rows abort without changing the source. The migration is idempotent and can resume after every injected failure point.

User-requested JSON, CSV, and XLSX exports intentionally contain exact major-unit decimal strings and the marker `moneywise-decimal-major-v2`. Imports parse those strings directly. Application-managed storage and sync never use these display strings as an arithmetic representation.
