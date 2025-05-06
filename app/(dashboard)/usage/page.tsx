import { getUserProfile } from "@/app/actions/userActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function UsagePage() {
  const profile = await getUserProfile();

  // Could add a more specific loading/error state if needed
  const currentCredits = profile?.credits ?? 0;

  if (!profile) {
    return (
        <div className="p-6">
          <h1 className="text-2xl font-semibold text-destructive">Access Denied</h1>
          <p className="text-muted-foreground">Could not load usage information.</p>
        </div>
      );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Usage</h1>
      <Card>
        <CardHeader>
            <CardTitle>Credit Balance</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-4xl font-bold">{currentCredits}</p>
            <p className="text-sm text-muted-foreground">Credits remaining for this billing cycle.</p>
            {/* TODO: Add usage history graph/table */}
        </CardContent>
      </Card>
       {/* Other usage metrics can go here */}
    </div>
  );
} 