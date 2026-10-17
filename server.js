// Independent "system of record" for stock balances. In a real landscape this role is played by S/4HANA's material
// ledger; here it is a separate Cloud Foundry app with its own data, so the stock service has to ask it over the
// network, with a token, instead of reading its own tables.
const express = require('express')

const SCOPE = 'agent'   // the stock service's technical client carries this authority
const BALANCES = JSON.parse(process.env.LEDGER_DATA || '{"41":500,"42":8.8}')
// Demo and incident simulation: LEDGER_ADJUST='{"42":9.1}' overrides single balances (cf set-env + cf restart).
const ADJUST = JSON.parse(process.env.LEDGER_ADJUST || '{}')
const ASOF = process.env.LEDGER_ASOF || '2026-10-17T00:00:00Z'

function authMiddleware() {
  if (process.env.LEDGER_AUTH === 'off') {   // tests only; never set on Cloud Foundry
    console.warn('LEDGER_AUTH=off: token check disabled')
    return (req, res, next) => next()
  }
  const { createSecurityContext, XsuaaService, SECURITY_CONTEXT, errors: { ValidationError } } = require('@sap/xssec')
  const creds = JSON.parse(process.env.VCAP_SERVICES || '{}').xsuaa?.[0]?.credentials
  if (!creds) { console.error('no xsuaa binding and LEDGER_AUTH is not off: refusing to start'); process.exit(1) }
  const service = new XsuaaService(creds)
  return async (req, res, next) => {
    try {
      const ctx = await createSecurityContext(service, { req })
      if (!ctx.checkLocalScope(SCOPE)) return res.status(403).json({ error: `scope ${SCOPE} required` })
      req[SECURITY_CONTEXT] = ctx
      next()
    } catch (e) {
      if (e instanceof ValidationError) return res.status(401).json({ error: 'invalid token' })
      console.error('token validation failed', e.message)
      res.status(500).json({ error: 'authentication unavailable' })
    }
  }
}

function build() {
  const app = express()
  app.get('/health', (req, res) => res.json({ ok: true }))   // the only unauthenticated route
  app.get('/ledger/balances', authMiddleware(), (req, res) => {
    const wanted = [].concat(req.query.material || []).map(Number).filter(Number.isInteger)
    if (!wanted.length) return res.status(400).json({ error: 'material=<id> is required (repeatable)' })
    const balances = wanted.map(m => {
      const v = m in ADJUST ? ADJUST[m] : BALANCES[m]
      return { material: m, balance: v === undefined ? null : v, asOf: ASOF }
    })
    console.log(`ledger read by ${req.headers['x-correlation-id'] || 'unknown'}: ${wanted.join(',')}`)
    res.json({ source: 'sap-gov-ledger', balances })
  })
  return app
}

module.exports = { build }
if (require.main === module) {
  const port = process.env.PORT || 8080
  build().listen(port, () => console.log('ledger listening on', port))
}
