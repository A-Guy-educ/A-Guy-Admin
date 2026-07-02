const SET_COOKIE_HEADER = 'Set-Cookie'
const DEFAULT_PAYLOAD_AUTH_COOKIE = 'payload-token'

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[]
}

export function withPartitionedPayloadAuthCookie(
  response: Response,
  cookieName = DEFAULT_PAYLOAD_AUTH_COOKIE,
): Response {
  const setCookieHeaders = getSetCookieHeaders(response.headers)
  if (setCookieHeaders.length === 0) {
    return response
  }

  let didRewrite = false
  const rewrittenCookies = setCookieHeaders.map((cookie) => {
    const rewritten = addPartitionedToPayloadAuthCookie(cookie, cookieName)
    if (rewritten !== cookie) {
      didRewrite = true
    }
    return rewritten
  })

  if (!didRewrite) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.delete(SET_COOKIE_HEADER)
  for (const cookie of rewrittenCookies) {
    headers.append(SET_COOKIE_HEADER, cookie)
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function getSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as HeadersWithSetCookie).getSetCookie
  if (typeof getSetCookie === 'function') {
    const values = getSetCookie.call(headers)
    if (values.length > 0) {
      return values.flatMap(splitCombinedSetCookieHeader)
    }
  }

  const combinedHeader = headers.get(SET_COOKIE_HEADER)
  return combinedHeader ? splitCombinedSetCookieHeader(combinedHeader) : []
}

function addPartitionedToPayloadAuthCookie(cookie: string, cookieName: string): string {
  if (!isNamedCookie(cookie, cookieName)) {
    return cookie
  }

  if (hasCookieAttribute(cookie, 'partitioned')) {
    return cookie
  }

  if (!hasCookieAttribute(cookie, 'secure') || !hasCookieAttribute(cookie, 'samesite', 'none')) {
    return cookie
  }

  return `${cookie}; Partitioned`
}

function isNamedCookie(cookie: string, cookieName: string): boolean {
  const firstSegment = cookie.split(';', 1)[0]?.trim()
  const name = firstSegment?.split('=', 1)[0]?.trim()

  return name?.toLowerCase() === cookieName.toLowerCase()
}

function hasCookieAttribute(
  cookie: string,
  attributeName: string,
  expectedValue?: string,
): boolean {
  return cookie
    .split(';')
    .slice(1)
    .some((segment) => {
      const [name, value] = segment.trim().split('=', 2)
      if (name?.toLowerCase() !== attributeName.toLowerCase()) {
        return false
      }

      if (expectedValue === undefined) {
        return true
      }

      return value?.toLowerCase() === expectedValue.toLowerCase()
    })
}

function splitCombinedSetCookieHeader(header: string): string[] {
  const cookies: string[] = []
  let start = 0
  let inExpiresAttribute = false

  for (let index = 0; index < header.length; index += 1) {
    if (!inExpiresAttribute && header.slice(index).toLowerCase().startsWith('expires=')) {
      inExpiresAttribute = true
      index += 'expires='.length - 1
      continue
    }

    const char = header[index]
    if (inExpiresAttribute && char === ';') {
      inExpiresAttribute = false
      continue
    }

    if (!inExpiresAttribute && char === ',') {
      cookies.push(header.slice(start, index).trim())
      start = index + 1
    }
  }

  cookies.push(header.slice(start).trim())
  return cookies.filter(Boolean)
}
