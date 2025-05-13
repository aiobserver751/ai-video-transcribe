import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { logger } from "@/lib/logger";

// Log initialization information
logger.info("[AUTH_ROUTE_INIT] NEXTAUTH_URL:", process.env.NEXTAUTH_URL);
logger.info("[AUTH_ROUTE_INIT] AUTH_SECRET is set:", !!process.env.AUTH_SECRET);

// Create the handler using the imported config
const handler = NextAuth(authConfig);

// Export the handler for Next.js API routes
export { handler as GET, handler as POST }; 