import NextAuth, { type DefaultSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
// Uncomment adapter imports
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db";
// Import the table objects from the schema
import { users, accounts, sessions, verificationTokens } from "@/server/db/schema";

// --- Module Augmentation for Session User ID ---
declare module "next-auth" {
  interface Session {
    user?: {
      id?: string; // Add the id field
    } & DefaultSession["user"]; // Inherit default fields (name, email, image)
  }
}
// --- End Module Augmentation ---

// Ensure you have these environment variables set in your .env file!
if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error("Missing GOOGLE_CLIENT_ID environment variable");
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_SECRET environment variable");
}
// AUTH_SECRET is required in production and recommended for development
if (!process.env.AUTH_SECRET) {
  console.warn("AUTH_SECRET environment variable is not set. Using a default value for development.");
  // Consider generating a strong secret: openssl rand -base64 32
}

export const authOptions: NextAuthOptions = {
  // Explicitly pass table objects to the Drizzle adapter
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Optional: Customize authorization scope if needed
      // authorization: {
      //   params: {
      //     prompt: "consent",
      //     access_type: "offline",
      //     response_type: "code"
      //   }
      // }
    }),
    // Add other providers here if needed (e.g., GitHub, Credentials)
  ],
  // When using database sessions, the session strategy defaults to "database".
  // JWT is still used for the initial handshake unless disabled.
  session: {
    strategy: "database", // Explicitly set to database strategy
  },
  callbacks: {
    // Ensure the session callback includes the user ID from the database user object
    async session({ session, user }) {
      if (user?.id && session.user) {
         session.user.id = user.id; // Use user.id from adapter
      }
      return session;
    },
    // JWT callback is less critical when using database sessions for the session itself,
    // but can still be useful if you need the token for other purposes.
    // Let's keep the basic one adding the user ID.
    async jwt({ token, user }) {
      if (user) { // user object is available on sign-in
        token.id = user.id;
      }
      return token;
    },
  },
  secret: process.env.AUTH_SECRET,
  // pages: {
  //   signIn: '/auth/signin',
  // }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 