const https = require('https')
const { URL } = require('url')
const NewlineDecoder = require('newline-decoder')

const EMPTY = Buffer.alloc(0)

module.exports = class SimpleLND {
  constructor (opts = {}) {
    if (typeof opts === 'string') opts = { lndconnect: opts }

    const uri = opts.lndconnect || opts.lndconnectUri

    if (uri) opts = { ...decodeLNConnect(uri), ...opts }
    if (!opts.macaroon) throw new Error('macaroon is required')

    this.macaroon = autoBuffer(opts.macaroon).toString('hex')
    this.cert = opts.cert ? autoBuffer(opts.cert) : null

    let host = opts.host || '127.0.0.1'
    let port = opts.port || 0

    const i = host.indexOf(':')

    if (i > -1) {
      if (!port) port = Number(host.slice(i + 1))
      host = host.slice(0, i)
    }

    this.host = host
    this.port = port || 8080
    this.rejectUnauthorized = typeof opts.rejectUnauthorized === 'boolean'
      ? opts.rejectUnauthorized
      : (this.host !== '127.0.0.1' && this.host !== 'localhost')

    this.requests = new Set()

    this._configuring = null
  }

  getInfo () {
    return this._requestFirst({ method: 'GET', path: '/v1/getinfo' })
  }

  decodePayReq (paymentRequest) {
    return this._requestFirst({ method: 'GET', path: '/v1/payreq/' + paymentRequest })
  }

  listChannels ({ activeOnly = true } = {}) {
    return this._requestFirst({ method: 'GET', path: '/v1/channels?active_only=' + activeOnly })
  }

  sendPayment ({ paymentRequest, timeoutSeconds = 10, feeLimitSat = 40 } = {}) {
    const body = {
      payment_request: paymentRequest,
      timeout_seconds: timeoutSeconds,
      fee_limit_sat: feeLimitSat
    }

    return this._request({ method: 'POST', path: '/v2/router/send', body })
  }

  addInvoice ({ value = 0, memo = '' }) {
    const body = {
      memo,
      value: '' + value
    }

    return this._requestFirst({ method: 'POST', path: '/v1/invoices', body })
  }

  listInvoices ({ indexOffset = 0, numMaxInvoices = 1024, reversed = false, pendingOnly = false } = {}) {
    const path = '/v1/invoices' +
      '?index_offset=' + indexOffset +
      '&num_max_invoices=' + numMaxInvoices +
      '&reversed=' + reversed +
      '&pending_only=' + pendingOnly

    return this._requestFirst({ method: 'GET', path })
  }

  subscribeInvoices ({ addIndex = 0, settleIndex = 0 } = {}) {
    return this._request({ method: 'GET', path: '/v1/invoices/subscribe?add_index=' + addIndex + '&settle_index=' + settleIndex }, { heartbeat: true })
  }

  destroy () {
    for (const req of this.requests) req.destroy()
  }

  async _autoConf () {
    if (this.port === 10009) {
      // prob wrong and should be 8080, lets test
      try {
        await this._requestFirst({ method: 'GET', path: '/v1/getinfo', autoConf: false })
      } catch {
        this.port = 8080
        try {
          await this._requestFirst({ method: 'GET', path: '/v1/getinfo', autoConf: false })
        } catch {
          this.port = 10009
        }
      }
    }
  }

  async _requestFirst (opts) {
    let result = null

    for await (const data of this._request(opts)) {
      result = data
    }

    return result
  }

  async * _request (opts) {
    if (opts.autoConf !== false) {
      if (!this._configuring) this._configuring = this._autoConf()
      await this._configuring
    }

    const enc = new NewlineDecoder()

    const req = https.request({
      ...opts,
      ca: this.cert && [this.cert],
      host: this.host,
      port: this.port,
      rejectUnauthorized: this.rejectUnauthorized,
      headers: {
        'Connection': 'Keep-Alive',
        'Grpc-Metadata-macaroon': this.macaroon
      }
    })

    this.requests.add(req)

    let interval = null
    if (opts.heartbeat) {
      interval = setInterval(() => res.socket.write(EMPTY), 10000)
    } else {
      req.setTimeout(30000, () => req.destroy())
    }

    if (opts.body) req.end(JSON.stringify(opts.body))
    else req.end()

    try {
      const res = await new Promise((resolve, reject) => {
        req.on('response', resolve)
        req.on('error', reject)
      })

      if (res.statusCode !== 200) throw new Error('Unexpected status code ' + res.statusCode)

      for await (const data of res) {
        for (const line of enc.push(data)) {
          yield JSON.parse(line)
        }
      }

      for (const line of enc.end()) {
        yield JSON.parse(line)
      }
    } finally {
      if (interval) clearInterval(interval)
      this.requests.delete(req)
    }
  }
}

function autoBuffer (inp) {
  if (Buffer.isBuffer(inp)) return inp
  if (/^[a-fA-F0-9]$/.test(inp)) return Buffer.from(inp, 'hex')
  return Buffer.from(inp, 'base64')
}

function decodeLNConnect (url) {
  const u = new URL(url)

  return {
    host: u.host,
    port: Number(u.port || 8080),
    macaroon: u.searchParams.has('macaroon') ? decodeBase64Url(u.searchParams.get('macaroon')) : null,
    cert: u.searchParams.has('cert') ? decodeBase64Url(u.searchParams.get('cert')) : null
  }
}

function decodeBase64Url (str) {
  return Buffer.from(unescape(str), 'base64')
}

function unescape (str) {
  return (str + '==='.slice((str.length + 3) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
}