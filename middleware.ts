import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

/**
 * Middleware to handle authentication across the application.
 * Protects routes and redirects to login when needed.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Define protected routes that require authentication
  const protectedPaths = [
    '/dashboard', 
    '/account', 
    '/api-keys', 
    '/usage',
    '/transcriptions',
    '/settings'
  ]
  
  // Check if the current path should be protected
  const isProtectedPath = protectedPaths.some(path => 
    pathname === path || pathname.startsWith(`${path}/`)
  )
  
  // Only check authentication for protected paths
  if (isProtectedPath) {
    try {
      const token = await getToken({ 
        req: request,
        secret: process.env.AUTH_SECRET
      })

      // If no token, redirect to signin
      if (!token) {
        const url = new URL('/signin', request.url)
        // Add the original URL as a callback parameter
        url.searchParams.set('callbackUrl', encodeURI(pathname))
        return NextResponse.redirect(url)
      }
    } catch (error) {
      console.error('Authentication middleware error:', error)
      // On error, still redirect to signin as a fallback
      const url = new URL('/signin', request.url)
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

/**
 * Configure which paths the middleware runs on.
 * Optimize by excluding paths that don't need authentication checks.
 */
export const config = {
  matcher: [
    // Include all paths except:
    // - API routes that handle their own auth
    // - NextAuth routes
    // - Public assets/static files
    // - Specific public pages
    '/((?!api/auth|_next/static|_next/image|favicon.ico|public|fonts|signin|signup|api/jobs).*)',
  ],
} 