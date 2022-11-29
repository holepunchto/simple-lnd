const fs = require('fs/promises')
const LND = require('./lndhub')

main().catch(console.log)

async function main () {
  let authed
  try {
    const account = await fs.readFile('./account')
    authed = new LND(JSON.parse(account))
  } catch (e) {
    console.log(e)
    if (e.code !== 'ENOENT') throw e
    authed = await LND.create()
    console.log(authed)
    await fs.writeFile('./account', JSON.stringify({
      login: authed.login,
      password: authed.password,
      auth: authed.auth
    }))
  }

  // await authed.getInfo()
  //console.log(await authed.payInvoice({ invoice: 'lnbc100n1p3kpmrxpp5mqyfxlk42x63jm6tthhq4njdpm85m5lr9dtqvcyteyul7hwdrxlqdqqcqzysxqyz5vqsp5zneqqyenhu5qveml340e8ymnage60m3290wjdtlp4gqczsjxwu0s9qyyssqhhw70xn68w99ah0swrx7kdk65ce7xcrppkj0lujl2rdfez4hzxf3chxakcl03p4ahgk2d9dn2saaghyy73ctjz7d49jvfc43kfkqzucpp8x98p' }))
  // console.log(await authed.addInvoice({ amt: 5, memo: 'hi' }))
  console.log(await authed.getUserInvoices({ limit: 4 }))
  console.log(await authed.getBtc())

  // for await (const tx of new TxStream(authed, { live: true })) { console.log(tx) }
  console.log('done')
  // for (let i = 0; i < 20; i++) {
  //   await authed.addInvoice({ amt: '10', memo: 'test' })
  // }
}
