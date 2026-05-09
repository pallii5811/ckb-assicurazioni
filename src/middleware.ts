import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Auth check is handled client-side via Supabase browser client.
  // Edge runtime cannot reliably reach Supabase (fetch failures),
  // so middleware just passes through all requests.
  return NextResponse.next({
    request: {
      headers: request.headers,
    },
  })
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
}
