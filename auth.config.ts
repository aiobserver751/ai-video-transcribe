import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db";
import { users, accounts, sessions, verificationTokens, creditTransactionTypeEnum } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { performCreditTransaction, getCreditConfig } from '@/server/services/creditService';
import { logger } from "@/lib/logger";

// Ensure you have these environment variables set in your .env file!
if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error("Missing GOOGLE_CLIENT_ID environment variable");
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_SECRET environment variable");
}
// AUTH_SECRET is required in production and recommended for development
if (!process.env.AUTH_SECRET) {
  logger.warn("AUTH_SECRET environment variable is not set. Consider setting it for production.");
}

export const authConfig: NextAuthOptions = {
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
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "your@email.com" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          logger.error('Authorize Error: Missing email or password');
          return null;
        }

        try {
          const userResult = await db.select()
                                  .from(users)
                                  .where(eq(users.email, credentials.email))
                                  .limit(1);
          
          const user = userResult[0];

          if (!user) {
            logger.info(`Authorize Error: No user found for email ${credentials.email}`);
            return null;
          }

          if (!user.passwordHash) {
            logger.info(`Authorize Error: User ${credentials.email} exists but has no password set (likely social login only).`);
            return null; 
          }

          const passwordIsValid = await bcrypt.compare(
            credentials.password,
            user.passwordHash
          );

          if (passwordIsValid) {
            logger.info(`Credentials authorized for user ${user.email}`);
            return {
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
            };
          } else {
            logger.info(`Authorize Error: Invalid password for user ${user.email}`);
            return null;
          }

        } catch (error) {
          logger.error("Authorize Error: Database or bcrypt error:", error);
          return null;
        }
      }
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async signIn({ user, account }) {
      try {
        logger.info(`[SIGN_IN_CALLBACK] START. User: ${JSON.stringify(user)}, Account: ${JSON.stringify(account)}`);
        
        // Existing signIn logic
        if (account?.provider === 'google' && user?.id) {
          try {
            const dbUserResult = await db.select({ type: users.type })
                                      .from(users)
                                      .where(eq(users.id, user.id))
                                      .limit(1);
            const dbUser = dbUserResult[0];

            logger.info(`[SIGN_IN_CALLBACK] Checking user ${user.id}. Found DB type: ${dbUser?.type ?? 'Not Found'}. Provider: ${account.provider}`);

            if (dbUser && dbUser.type !== 'google') {
              logger.info(`[SIGN_IN_CALLBACK] Updating user ${user.id} type from '${dbUser.type}' to 'google'.`);
              await db.update(users)
                      .set({ type: 'google' })
                      .where(eq(users.id, user.id));
              logger.info(`[SIGN_IN_CALLBACK] Successfully updated user ${user.id} type to 'google'.`);
            } else if (dbUser && dbUser.type === 'google') {
               logger.info(`[SIGN_IN_CALLBACK] User ${user.id} type is already 'google'. No update needed.`);
            } else if (!dbUser) {
               logger.warn(`[SIGN_IN_CALLBACK] User ${user.id} not found in DB during signIn callback (might be newly created). Type setting handled by createUser event.`);
            }
          } catch (error) {
            logger.error("[SIGN_IN_CALLBACK] Error checking/updating user type during Google sign-in:", error);
            // Don't block sign-in for this type of error
          }
        } else {
            logger.info(`[SIGN_IN_CALLBACK] Skipping type check. Provider: ${account?.provider}, User ID: ${user?.id}`);
        }

        logger.info(`[SIGN_IN_CALLBACK] END. Returning true.`);
        return true;
      } catch (error) {
        logger.error("[SIGN_IN_CALLBACK_ERROR]", error);
        // Still allow sign-in even if there was an error in the callback
        return true;
      }
    },
    async session({ session, token }) {
      try {
        logger.info(`[SESSION_CALLBACK] START. Session: ${JSON.stringify(session)}, Token: ${JSON.stringify(token)}`);
        
        // With JWT strategy, we get the information from the token
        if (session.user) {
          session.user.id = token.sub as string;
          
          // Add other user properties if needed
          if (token.email) session.user.email = token.email as string;
          if (token.name) session.user.name = token.name as string;
          if (token.picture) session.user.image = token.picture as string;
        }
        
        logger.info(`[SESSION_CALLBACK] END. Final session: ${JSON.stringify(session)}`);
        return session;
      } catch (error) {
        logger.error("[SESSION_CALLBACK_ERROR]", error);
        // Return session as is in case of error
        return session;
      }
    },
    async jwt({ token, user }) {
      try {
        logger.info(`[JWT_CALLBACK] START. Token: ${JSON.stringify(token)}, User: ${JSON.stringify(user)}`);
        
        // If this is the first sign in, add the user info to the token
        if (user) {
          token.sub = user.id; // Use sub for the user ID (standard claim)
          token.email = user.email;
          token.name = user.name;
          token.picture = user.image;
        }
        
        logger.info(`[JWT_CALLBACK] END. Final token: ${JSON.stringify(token)}`);
        return token;
      } catch (error) {
        logger.error("[JWT_CALLBACK_ERROR]", error);
        // Return token as is in case of error
        return token;
      }
    },
  },
  events: {
    async createUser(message) { 
      logger.info(`[AUTH_EVENT] New user created via adapter: ID ${message.user.id}, Email: ${message.user.email}`);
      
      if (!message.user.id) {
        logger.error("[AUTH_EVENT_ERROR] Cannot process createUser event. New user ID is missing.");
        return;
      }
      const newUserId = message.user.id;
      const userEmailForLog = message.user.email ?? 'UNKNOWN EMAIL';

      // --- Allocate Initial Credits ---
      try {
        const config = getCreditConfig(); 
        const initialCredits = config.FREE_TIER_INITIAL_CREDITS;
        
        if (initialCredits > 0) { 
          const creditResult = await performCreditTransaction(
            newUserId, 
            initialCredits,
            creditTransactionTypeEnum.enumValues[0], // 'initial_allocation'
            {
              customDescription: "Initial credits upon social sign-up."
            }
          );

          if (!creditResult.success) {
            logger.error(`[AUTH_EVENT_CREDIT_ERROR] Failed to allocate initial credits for new user ${newUserId} (${userEmailForLog}): ${creditResult.error}`);
          } else {
            logger.info(`[AUTH_EVENT_CREDIT_SUCCESS] Allocated ${initialCredits} initial credits to new user ${newUserId} (${userEmailForLog}). New balance: ${creditResult.newBalance}`);
          }
        } else {
          logger.info(`[AUTH_EVENT] Initial credit allocation skipped for user ${newUserId} (${userEmailForLog}) because initialCredits is 0 or less.`);
        }
      } catch (creditError) {
        logger.error(`[AUTH_EVENT_CREDIT_ERROR] Critical error allocating initial credits for new user ${userEmailForLog} (ID: ${newUserId}) during createUser event:`, creditError);
      }
      // --- End Credit Allocation ---
    },
    // NEW: linkAccount event to handle user type setting after account is linked
    async linkAccount(message) {
      logger.info(`[AUTH_EVENT_LINK_ACCOUNT] Account linked for user ID: ${message.user.id}, Provider: ${message.account.provider}`);

      if (!message.user.id) {
         logger.error("[AUTH_EVENT_LINK_ACCOUNT_ERROR] Cannot process linkAccount event. User ID is missing.");
         return;
      }

      if (message.account.provider === 'google') {
        logger.info(`[AUTH_EVENT_LINK_ACCOUNT] Provider is Google. Attempting to set user ${message.user.id} type to 'google'.`);
        try {
          await db.update(users)
                  .set({ type: 'google' })
                  .where(eq(users.id, message.user.id));
          logger.info(`[AUTH_EVENT_LINK_ACCOUNT] Successfully set user ${message.user.id} type to 'google'.`);
        } catch (error) {
          logger.error(`[AUTH_EVENT_LINK_ACCOUNT_ERROR] Failed to set user type to 'google' for user ${message.user.id}:`, error);
        }
      } else {
        logger.info(`[AUTH_EVENT_LINK_ACCOUNT] Provider is ${message.account.provider}. No user type update needed based on this link.`);
      }
    }
  },
  logger: {
    error: (code, metadata) => {
      logger.error(`[NextAuth Error] ${code}:`, metadata);
    },
    warn: (code) => {
      logger.warn(`[NextAuth Warning] ${code}`);
    },
    debug: (code, metadata) => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(`[NextAuth Debug] ${code}:`, metadata);
      }
    },
  },
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: '/signin',
  },
  debug: process.env.NODE_ENV === 'development',
}; 