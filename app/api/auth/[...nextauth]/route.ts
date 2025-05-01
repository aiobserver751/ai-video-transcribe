import NextAuth, { type DefaultSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
// Uncomment adapter imports
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db";
// Import the table objects from the schema
import { users, accounts, sessions, verificationTokens } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

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
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "your@email.com" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.error('Authorize Error: Missing email or password');
          return null;
        }

        try {
          const userResult = await db.select()
                                  .from(users)
                                  .where(eq(users.email, credentials.email))
                                  .limit(1);
          
          const user = userResult[0];

          if (!user) {
            console.log(`Authorize Error: No user found for email ${credentials.email}`);
            return null;
          }

          if (!user.passwordHash) {
            console.log(`Authorize Error: User ${credentials.email} exists but has no password set (likely social login only).`);
            return null; 
          }

          const passwordIsValid = await bcrypt.compare(
            credentials.password,
            user.passwordHash
          );

          if (passwordIsValid) {
            console.log(`Credentials authorized for user ${user.email}`);
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
            };
          } else {
            console.log(`Authorize Error: Invalid password for user ${user.email}`);
            return null;
          }

        } catch (error) {
          console.error("Authorize Error: Database or bcrypt error:", error);
          return null;
        }
      }
    }),
    // Add other providers here if needed (e.g., GitHub, Credentials)
  ],
  // When using database sessions, the session strategy defaults to "database".
  // JWT is still used for the initial handshake unless disabled.
  session: {
    strategy: "database", // Explicitly set to database strategy
  },
  callbacks: {
    // Add the signIn callback - remove unused parameters
    async signIn({ user, account }) { 
      // Check if the sign-in is via Google
      if (account?.provider === 'google' && user?.id) {
        try {
          // Fetch the user from DB to check their current type
          const dbUserResult = await db.select({ type: users.type })
                                    .from(users)
                                    .where(eq(users.id, user.id))
                                    .limit(1);
          const dbUser = dbUserResult[0];

          // If user exists and type is not already 'google', update it
          if (dbUser && dbUser.type !== 'google') {
            console.log(`Updating user ${user.id} type to google.`);
            await db.update(users)
                    .set({ type: 'google' })
                    .where(eq(users.id, user.id));
          }
        } catch (error) {
          console.error("Error updating user type during Google sign-in:", error);
        }
      }
      return true; // Allow the sign-in to proceed
    },
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
  pages: {
    signIn: '/signin',
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 