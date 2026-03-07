import 'dotenv/config'
import { execSync, spawn } from 'child_process'
import http from 'http'
import localtunnel from 'localtunnel'

const PORT = 3003
const PROXY_PORT = 3004
const SUBDOMAIN = process.env.LT_SUBDOMAIN || undefined
const USERNAME = process.env.TUNNEL_USERNAME ?? 'admin'
const PASSWORD = process.env.TUNNEL_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD ?? 'admin'

export function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function createAuthProxy(): http.Server {
  const expectedAuth = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')

  return http.createServer((req, res) => {
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="OpenCode"' })
      res.end('Unauthorized')
      return
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${PORT}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        proxyRes.pipe(res)
      },
    )

    proxyReq.on('error', (err) => {
      res.writeHead(502)
      res.end(`Proxy error: ${err.message}`)
    })

    req.pipe(proxyReq)
  })
}

async function start(): Promise<void> {
  console.log(`🚀 Starting OpenCode tunnel`)
  console.log(`🔒 Credentials: ${USERNAME} / ${PASSWORD}`)
  console.log('')

  if (!isPortInUse(PORT)) {
    console.log(`⚠️  Starting OpenCode on port ${PORT}...`)
    spawn('opencode', ['web', '--port', String(PORT)], {
      stdio: 'inherit',
      detached: true,
    }).unref()
    await new Promise<void>((resolve) => setTimeout(resolve, 5000))
  } else {
    console.log(`✅ OpenCode already running on port ${PORT}`)
  }

  const proxy = createAuthProxy()
  await new Promise<void>((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve))
  console.log(`🛡️  Auth proxy running on port ${PROXY_PORT}`)

  const tunnel = await localtunnel({ port: PROXY_PORT, subdomain: SUBDOMAIN })

  console.log('')
  console.log(`🌐 Tunnel URL: ${tunnel.url}`)
  console.log(`🔒 Credentials: ${USERNAME} / ${PASSWORD}`)
  console.log('')
  console.log('Press Ctrl+C to stop.')

  tunnel.on('close', () => {
    console.log('🔌 Tunnel closed')
    proxy.close()
    process.exit(0)
  })

  tunnel.on('error', (err: Error) => {
    console.error('❌ Tunnel error:', err)
    proxy.close()
    process.exit(1)
  })

  const shutdown = () => {
    console.log('\n🛑 Shutting down...')
    tunnel.close()
    proxy.close()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start()
