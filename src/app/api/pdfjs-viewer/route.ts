import { NextRequest, NextResponse } from 'next/server'

/**
 * PDF.js Viewer Proxy
 *
 * Proxies the viewer.html from Vercel Blob CDN and serves it with proper headers
 * for iframe embedding. Also rewrites asset URLs to point to Blob CDN.
 *
 * This proxy:
 * 1. Fetches viewer.html from Blob CDN
 * 2. Rewrites relative URLs (viewer.css, viewer.mjs) to absolute Blob CDN URLs
 * 3. Replaces Mozilla CDN URLs with our Blob CDN URLs
 * 4. Serves with Content-Type: text/html for inline display
 */
export async function GET(request: NextRequest) {
  const CDN_BASE = 'https://96hg0ck1hvrndmxp.public.blob.vercel-storage.com/pdfjs/4.4.168'

  // Matching v4.4.168 viewer files uploaded from official PDF.js release
  const VIEWER_HTML_URL = `${CDN_BASE}/viewer-I6DnqEMX9W9cwNNvWKm3D8YvXdCzUA.html`
  const VIEWER_MJS_URL = `${CDN_BASE}/viewer-SyYgQ0jufpmBIqrWX2zGA21kZmurH6.mjs`
  const VIEWER_CSS_URL = `${CDN_BASE}/viewer-MgMiA2nNdPgVwb4uc8CAB6Twx6vmUC.css`
  // Use non-hashed pdf.mjs so worker can find pdf.worker.mjs in same directory
  const PDF_MJS_URL = `${CDN_BASE}/build/pdf.mjs`

  // Get the PDF file URL from query params
  const searchParams = request.nextUrl.searchParams
  let pdfFileUrl = searchParams.get('file')

  console.log('[PDF Viewer Proxy] Received request with file:', pdfFileUrl)

  // Convert relative URLs to absolute URLs
  if (pdfFileUrl && !pdfFileUrl.startsWith('http://') && !pdfFileUrl.startsWith('https://')) {
    const origin = request.nextUrl.origin
    pdfFileUrl = `${origin}${pdfFileUrl.startsWith('/') ? '' : '/'}${pdfFileUrl}`
    console.log('[PDF Viewer Proxy] Converted to absolute URL:', pdfFileUrl)
  }

  try {
    // Fetch viewer.html from Blob CDN
    const response = await fetch(VIEWER_HTML_URL, {
      // Cache for 1 hour in our edge function
      next: { revalidate: 3600 },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch PDF viewer' }, { status: 500 })
    }

    let html = await response.text()

    // Fetch and rewrite CSS to fix image paths
    const cssResponse = await fetch(VIEWER_CSS_URL)
    let css = await cssResponse.text()

    // Rewrite relative image paths in CSS to absolute URLs
    css = css.replace(/url\(images\//g, `url(${CDN_BASE}/web/images/`)

    // Inject the rewritten CSS inline instead of linking to external CSS
    html = html
      // Remove the external CSS link
      .replace('href="viewer.css"', 'href="data:text/css;base64,REMOVED"')
      // Add inline CSS after the link
      .replace('</head>', `<style>${css}</style>\n</head>`)
      // Replace relative viewer.mjs with hashed Blob CDN URL
      .replace('src="viewer.mjs"', `src="${VIEWER_MJS_URL}"`)
      // Replace relative pdf.mjs path from prebuilt version with our Blob CDN URL
      .replace('src="../build/pdf.mjs"', `src="${PDF_MJS_URL}"`)
      // Replace Mozilla CDN pdf.mjs with our Blob CDN URL
      .replace('src="https://mozilla.github.io/pdf.js/build/pdf.mjs"', `src="${PDF_MJS_URL}"`)
      // Remove locale references (causes 404 but not critical)
      .replace(
        '<link rel="resource" type="application/l10n" href="https://mozilla.github.io/pdf.js/web/locale/locale.json" />',
        '',
      )
      .replace('<link rel="resource" type="application/l10n" href="locale/locale.json">', '')

    // Set base URL for other relative paths (images, fonts, etc.)
    // Points to web/ subdirectory where viewer files expect to find images
    html = html.replace('<head>', `<head>\n  <base href="${CDN_BASE}/web/">`)

    // If PDF file URL provided, inject script to load it
    if (pdfFileUrl) {
      html = html.replace(
        '</head>',
        `<script>
          // Wait for PDFViewerApplication to be available on window
          window.addEventListener('webviewerloaded', function() {
            console.log('[PDF Viewer] webviewerloaded event fired');
            if (window.PDFViewerApplication && window.PDFViewerApplication.initializedPromise) {
              console.log('[PDF Viewer] Loading PDF:', '${pdfFileUrl.replace(/'/g, "\\'")}');
              window.PDFViewerApplication.initializedPromise.then(function() {
                window.PDFViewerApplication.open('${pdfFileUrl.replace(/'/g, "\\'")}').catch(function(err) {
                  console.error('[PDF Viewer] Failed to load PDF:', err);
                });
              });
            }
          });
        </script>
        </head>`,
      )
    }

    // Serve with proper headers for iframe embedding
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    })
  } catch (error) {
    console.error('Error proxying PDF viewer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
