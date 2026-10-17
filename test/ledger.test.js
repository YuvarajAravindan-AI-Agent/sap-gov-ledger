const assert = require('node:assert')
process.env.LEDGER_AUTH = 'off'
const { build } = require('../server')

;(async () => {
  const srv = build().listen(0)
  const base = `http://localhost:${srv.address().port}`
  const j = async p => (await fetch(base + p)).json()
  assert.deepStrictEqual((await j('/health')), { ok: true })
  const r = await j('/ledger/balances?material=41&material=42&material=99')
  assert.deepStrictEqual(r.balances.map(b => [b.material, b.balance]), [[41, 500], [42, 8.8], [99, null]])
  assert.strictEqual((await fetch(base + '/ledger/balances')).status, 400)
  srv.close()

  // Without a token check configured, the service must refuse to run (so it can never silently serve unauthenticated).
  const { spawnSync } = require('node:child_process')
  const res = spawnSync('node', ['server.js'], { cwd: __dirname + '/..', env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 8000 })
  assert.strictEqual(res.status, 1); assert.match(res.stderr, /refusing to start/)
  console.log('OK - ledger balances, validation, and refusal to run without a token check')
})().catch(e => { console.error(e); process.exit(1) })
