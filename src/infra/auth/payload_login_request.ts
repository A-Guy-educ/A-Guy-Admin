const PAYLOAD_USERS_LOGIN_PATH = '/api/users/login'
const FORM_URLENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded'
const JSON_CONTENT_TYPE = 'application/json'

export async function normalizePayloadLoginRequest(request: Request): Promise<Request> {
  if (!shouldNormalizeFormLoginRequest(request)) {
    return request
  }

  const body = await request.text()
  const data = Object.fromEntries(new URLSearchParams(body).entries())
  const headers = new Headers(request.headers)
  headers.set('content-type', JSON_CONTENT_TYPE)
  headers.delete('content-length')

  return new Request(request.url, {
    body: JSON.stringify(data),
    cache: request.cache,
    credentials: request.credentials,
    headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  })
}

function shouldNormalizeFormLoginRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== 'POST') {
    return false
  }

  if (new URL(request.url).pathname.replace(/\/+$/, '') !== PAYLOAD_USERS_LOGIN_PATH) {
    return false
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.startsWith(FORM_URLENCODED_CONTENT_TYPE)
}
