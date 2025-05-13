import { getUserProfile } from "@/app/actions/userActions";
import { getCreditHistory, type PaginatedCreditHistory } from "@/app/actions/creditActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// Helper to format date (can be moved to a utils file)
function formatDate(dateString: Date | string | null): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch {
    return 'Invalid Date';
  }
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const profile = await getUserProfile();
  // CORRECTED: Use credit_balance from the profile schema
  const currentCredits = profile?.credit_balance ?? 0;

  // Pagination
  const currentPage = Number(searchParams?.['page'] || '1');
  const pageSize = 15; // Or make this configurable, e.g., from user settings or constants file

  let creditHistory: PaginatedCreditHistory = {
    transactions: [],
    totalPages: 0,
    currentPage: currentPage,
    totalCount: 0,
  };

  // Only fetch history if profile (and thus userId) is available
  if (profile) {
    creditHistory = await getCreditHistory({ page: currentPage, pageSize });
  }

  if (!profile) {
    return (
        <div className="p-6">
          <h1 className="text-2xl font-semibold text-destructive">Access Denied or Error</h1>
          <p className="text-muted-foreground">Could not load user profile or usage information.</p>
        </div>
      );
  }

  return (
    <div className="space-y-8 p-4 md:p-6">
      <h1 className="text-3xl font-bold tracking-tight">Usage &amp; Credit History</h1>
      
      <Card>
        <CardHeader>
            <CardTitle>Current Credit Balance</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-4xl font-bold">{currentCredits}</p>
            {/* <p className="text-sm text-muted-foreground">Credits remaining for this billing cycle.</p> */}
        </CardContent>
      </Card>

      {/* Credit History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          {creditHistory.totalCount > 0 && (
            <p className="text-sm text-muted-foreground">
              Showing {creditHistory.transactions.length} of {creditHistory.totalCount} transactions.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {creditHistory.transactions.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[150px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right min-w-[100px]">Amount</TableHead>
                      <TableHead className="text-right hidden sm:table-cell min-w-[120px]">Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditHistory.transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(tx.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">{tx.description}</TableCell>
                        <TableCell className="text-right">
                          <Badge 
                            variant={tx.amount >= 0 ? "outline" : "destructive"}
                            className={`${tx.amount >= 0 ? "text-green-600 border-green-500" : "text-red-600 border-red-500"} font-medium`}
                          >
                            {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell font-mono">{tx.user_credits_after}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {creditHistory.totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <Button variant="outline" asChild disabled={currentPage <= 1}>
                    <Link href={`?page=${currentPage - 1}${searchParams?.query ? `&query=${searchParams.query}`: ''}`}>Previous</Link>
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {creditHistory.currentPage} of {creditHistory.totalPages}
                  </span>
                  <Button variant="outline" asChild disabled={currentPage >= creditHistory.totalPages}>
                    <Link href={`?page=${currentPage + 1}${searchParams?.query ? `&query=${searchParams.query}`: ''}`}>Next</Link>
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">No transaction history found.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 