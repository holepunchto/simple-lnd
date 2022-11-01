const https = require('https')

const REQUEST_OVERLOAD = 'Too many requests, please try again later.'

module.exports = class SimpleLndHUB {
  constructor (opts = {}) {
    this.destroyed = false

    this.accountType = opts.accountType || 'common'
    this.host = opts.host || 'lndhub.herokuapp.com'

    this.login = opts.login
    this.password = opts.password

    this.auth = opts.auth || {}

    this.headers = {
      'Acces-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }

    if (opts.auth) this.headers.Authorization = opts.auth.access_token

    this.requests = new Set()
  }

  static async create (
    host = 'lndhub.herokuapp.com',
    partnerid = 'bluewallet',
    accounttype = 'common'
  ) {
    const body = {
      partnerid,
      accounttype
    }

    const login = await request(host, '/create', body, { method: 'POST' })
    const auth = await request(host, '/auth', login, { method: 'POST' })

    return new SimpleLndHUB({
      host,
      ...login,
      auth
    })
  }

  async ready () {
    if (!this.login) await this._createAccount()
    return this.getAuth()
  }

  async _createAccount (partnerid = 'bluewallet', accounttype = this.accountType) {
    const body = {
      partnerid,
      accounttype
    }

    const { login, password } = await request(this.host, '/create', body, { method: 'POST' })

    this.login = login
    this.password = password
  }

  async getAuth () {
    const body = {
      login: this.login,
      password: this.password,
      refresh_token: this.auth?.refresh_token
    }

    const auth = await request(this.host, '/auth', body, { method: 'POST' })

    this.auth = auth
    this.headers.Authorization = auth.access_token
  }

  getInfo () {
    return this._request({ method: 'GET', path: '/getinfo' })
  }

  balance () {
    return this._request({ method: 'GET', path: '/balance' })
  }

  getBtc () {
    return this._request({ method: 'GET', path: '/getbtc' })
  }

  getPending () {
    return this._request({ method: 'GET', path: '/getpending' })
  }

  addInvoice ({ amt, memo } = {}) {
    return this._request({
      method: 'POST',
      path: '/addinvoice',
      body: {
        amt,
        memo
      }
    })
  }

  payInvoice ({ invoice, amount } = {}) {
    return this._request({
      method: 'POST',
      path: '/payinvoice',
      body: {
        invoice,
        amount
      }
    })
  }

  getTxs ({ limit, offset } = {}) {
    return this._request({
      method: 'GET',
      path: query('/gettxs', { limit, offset })
    })
  }

  async getUserInvoices ({ limit, offset } = {}) {
    const invoices = await this._request({
      method: 'GET',
      path: query('/getuserinvoices', { limit, offset })
    })

    return invoices
  }

  decodeInvoice ({ invoice } = {}) {
    return this._request({
      method: 'GET',
      path: query('/decodeinvoice', { invoice })
    })
  }

  destroy () {
    this.destroyed = true
    for (const req of this.requests) req.destroy()
  }

  async _request (opts) {
    const chunks = []

    const req = https.request({
      ...opts,
      host: this.host,
      headers: this.headers
    })

    this.requests.add(req)
    req.setTimeout(30000, () => req.destroy())

    if (opts.body) req.end(JSON.stringify(opts.body))
    else req.end()

    const response = await new Promise((resolve, reject) => {
      req.on('error', (e) => { reject(e) })
      req.on('response', res => {
        res.on('data', data => { chunks.push(data) })
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
    })

    if (response.toString() === REQUEST_OVERLOAD) {
      this.requests.delete(req)
      let cancelled = false

      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 30000)
        this.requests.add({
          destroy () {
            clearTimeout(timeout)
            cancelled = true
            resolve()
          }
        })
      })

      if (cancelled) return this._request(opts)
    } else {
      return JSON.parse(response)
    }
  }
}

async function request (hostname, path, body, opts = {}) {
  const chunks = []

  const req = https.request({
    ...opts,
    hostname,
    headers: {
      'Acces-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    path,
    method: opts.method || 'GET'
  })

  req.end(JSON.stringify(body))
  req.setTimeout(30000, () => req.destroy())

  const response = await new Promise((resolve, reject) => {
    req.on('error', (e) => { reject(e) })
    req.on('response', res => {
      res.on('data', data => { chunks.push(data) })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
  })

  if (response.toString() === REQUEST_OVERLOAD) {
    throw new Error('Too many requests.')
  }

  return JSON.parse(response)
}

function query (path, params = {}) {
  let string = ''
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    string += `${k}=${v}`
  }
  if (!string.length) return path
  return path + '?' + string
}
