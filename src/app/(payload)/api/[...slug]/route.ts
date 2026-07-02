/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import config from '@payload-config'
import '@payloadcms/next/css'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'

import { withPartitionedPayloadAuthCookie } from '@/infra/auth/payload_auth_cookie_headers'
import { normalizePayloadLoginRequest } from '@/infra/auth/payload_login_request'

type PayloadRouteArgs = {
  params: Promise<{
    slug?: string[]
  }>
}

type PayloadRouteHandler = (request: Request, args: PayloadRouteArgs) => Promise<Response>

function withPayloadAuthCookieHeaders(handler: PayloadRouteHandler): PayloadRouteHandler {
  return async (request, args) =>
    withPartitionedPayloadAuthCookie(
      await handler(await normalizePayloadLoginRequest(request), args),
    )
}

export const GET = withPayloadAuthCookieHeaders(REST_GET(config))
export const POST = withPayloadAuthCookieHeaders(REST_POST(config))
export const DELETE = withPayloadAuthCookieHeaders(REST_DELETE(config))
export const PATCH = withPayloadAuthCookieHeaders(REST_PATCH(config))

export const PUT = withPayloadAuthCookieHeaders(REST_PUT(config))
export const OPTIONS = REST_OPTIONS(config)
