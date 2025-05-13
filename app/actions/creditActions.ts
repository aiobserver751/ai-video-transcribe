'use server';

import { db } from '@/server/db';
import { creditTransactions } from '@/server/db/schema';
import { getAuthSession } from '@/lib/auth';
import { eq, desc, count } from 'drizzle-orm';
import { logger } from '@/lib/logger';

// Changed from interface to type alias for better compatibility with $inferSelect
export type CreditTransactionWithId = typeof creditTransactions.$inferSelect;

export interface PaginatedCreditHistory {
  transactions: CreditTransactionWithId[];
  totalPages: number;
  currentPage: number;
  totalCount: number;
}

interface GetCreditHistoryParams {
  page?: number;
  pageSize?: number;
}

/**
 * Server Action to fetch paginated credit transaction history for the logged-in user.
 */
export async function getCreditHistory(
  params: GetCreditHistoryParams = {}
): Promise<PaginatedCreditHistory> {
  const { page = 1, pageSize = 10 } = params;

  logger.info(`[CreditActions] getCreditHistory called for page: ${page}, pageSize: ${pageSize}`);

  const session = await getAuthSession();
  if (!session?.user?.id) {
    logger.warn('[CreditActions] User not authenticated. Cannot fetch credit history.');
    // Consider throwing an error or returning a more specific error structure
    // For now, returning empty to avoid breaking potential UI that expects this structure.
    return {
      transactions: [],
      totalPages: 0,
      currentPage: page,
      totalCount: 0,
    };
  }
  const userId = session.user.id;

  try {
    const offset = (page - 1) * pageSize;

    // Fetch transactions for the current page
    const transactions = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.created_at))
      .limit(pageSize)
      .offset(offset);

    // Fetch the total count of transactions for this user for pagination
    const totalCountResult = await db
      .select({ value: count() })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    
    const totalCount = totalCountResult[0]?.value ?? 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    logger.info(`[CreditActions] Fetched ${transactions.length} transactions for user ${userId}. Total count: ${totalCount}, Total pages: ${totalPages}`);

    return {
      transactions: transactions, 
      totalPages,
      currentPage: page,
      totalCount
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error fetching credit history';
    logger.error(`[CreditActions] Error fetching credit history for user ${userId}: ${errorMessage}`, error);
    // Depending on requirements, you might want to throw the error or return an error state
    // For now, returning empty to allow UI to handle gracefully.
    return {
      transactions: [],
      totalPages: 0,
      currentPage: page,
      totalCount: 0,
    };
  }
}
 