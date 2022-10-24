const https = require('https')
const { URL } = require('url')
const NewlineDecoder = require('newline-decoder')
const WebSocket = require('ws')
const FastFifo = require('fast-fifo')

module.exports = class SimpleLND {
  constructor (opts = {}) {
    if (typeof opts === 'string') opts = { lndconnect: opts }

    const uri = opts.lndconnect || opts.lndconnectUri

    if (uri) opts = { ...decodeLNConnect(uri), ...opts }
    if (!opts.macaroon) throw new Error('macaroon is required')

    this.destroyed = false
    this.macaroon = autoBuffer(opts.macaroon)
    this.cert = opts.cert ? autoBuffer(opts.cert) : null

    let host = (opts.host || opts.socket || '127.0.0.1').trim()
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

    this.headers = {
      Connection: 'Keep-Alive',
      'Grpc-Metadata-macaroon': this.macaroon.toString('hex')
    }

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
    return this._requestLiveStream({ path: '/v1/invoices/subscribe?add_index=' + addIndex + '&settle_index=' + settleIndex })
  }

  destroy () {
    this.destroyed = true
    for (const req of this.requests) req.destroy()
  }

  session () {
    return new SimpleLND({
      host: this.host,
      port: this.port,
      macaroon: this.macaroon,
      cert: this.cert,
      rejectUnauthorized: this.rejectUnauthorized
    })
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

  async * _requestLiveStream (opts) {
    if (opts.autoConf !== false) {
      if (!this._configuring) this._configuring = this._autoConf()
      await this._configuring
    }

    const sock = new WebSocket('wss://' + this.host + ':' + this.port + opts.path, {
      timeout: 10000,
      ca: this.cert && [this.cert],
      host: this.host,
      port: this.port,
      rejectUnauthorized: this.rejectUnauthorized,
      headers: {
        'Grpc-Metadata-macaroon': this.headers['Grpc-Metadata-macaroon']
      }
    })

    const queue = new FastFifo()

    let yieldResolve = null
    let yieldReject = null
    let error = null
    let pongs = 0
    let pings = 0
    let interval = null

    sock.on('open', function () {
      interval = setInterval(ping, 7000)
    })

    sock.on('pong', function () {
      pongs++
    })

    sock.on('message', function (m) {
      queue.push(m)
      drain()
    })

    sock.on('error', function (err) {
      clearInterval(interval)
      error = err
      drain()
    })

    sock.on('close', function () {
      clearInterval(interval)
      if (!error) error = new Error('Closed')
      drain()
    })

    while (true) {
      yield new Promise((resolve, reject) => {
        yieldResolve = resolve
        yieldReject = reject
        drain()
      })
    }

    function ping () {
      if (pings++ !== pongs) sock.terminate()
      else sock.ping()
    }

    function drain () {
      if (!yieldResolve) return

      if (error) {
        trigger(error, null)
        return
      }

      const next = queue.shift()
      if (!next) return

      let m = null
      try {
        m = JSON.parse(next)
      } catch (err) {
        trigger(err, null)
        return
      }

      trigger(null, m)
    }

    function trigger (err, val) {
      if (err) yieldReject(err)
      else yieldResolve(val)
      yieldReject = yieldResolve = null
    }
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
      headers: this.headers,
      noDelay: true
    })

    this.requests.add(req)
    req.setTimeout(30000, () => req.destroy())

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
      this.requests.delete(req)
    }
  }
}

function autoBuffer (inp) {
  if (Buffer.isBuffer(inp)) return inp
  inp = inp.trim()
  if (/^[a-fA-F0-9]+$/.test(inp)) return Buffer.from(inp, 'hex')
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
