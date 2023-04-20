const test = require('brittle')
const SimpleLndHUB = require('../lndhub.js')

let account = null

test('create account', async ({ ok, plan }) => {
  const lndHub = await lndHubAccount()
  plan(4)
  ok(lndHub, null)
  ok(lndHub.login)
  ok(lndHub.password)
  ok(lndHub.auth)
})

test('get balance', async ({ is, plan }) => {
  plan(1)
  const lndHub = await lndHubAccount()
  const balance = await lndHub.balance()
  is(balance.BTC.AvailableBalance, 0)
})

test('add invoice', async ({ ok, plan }) => {
  plan(1)
  const lndHub = await lndHubAccount()
  const invoice = await lndHub.addInvoice({ amt: 10, memo: 'memo' })
  ok(invoice)
})

test('decode invoice', async ({ ok, is, plan }) => {
  plan(3)
  const lndHub = await lndHubAccount()
  const invoice = 'lnbc100n1p3k9y0spp5jzaw9uwsxwj2ghraznrhlqprre9vcsec32rg7ekjrh20xm3dxa7sdq8d4jk6mccqzpgxqyz5vqsp52enp65t9ftl8yy3hmxx7df05kjemdxfq3ks0cem38eek244apeps9qyyssq6gfa0yrwj0rdc8ylcaqggd9hev5fkj94zy0tlsnfn8ef34rtrr9sfrfxu9f6cq98s0mpy95vsg4h0cv0ekxgu52t4ydtqhu4hn7yjzqpahnst6'
  const decodedInvoice = await lndHub.decodeInvoice({ invoice })
  ok(decodedInvoice)
  is(decodedInvoice.num_satoshis, '10')
  is(decodedInvoice.description, 'memo')
})

async function lndHubAccount () {
  if (!account) account = await SimpleLndHUB.create()
  return account
}
