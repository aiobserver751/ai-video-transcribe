import { getUserProfile } from "@/app/actions/userActions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
// import { redirect } from 'next/navigation'; // Remove unused import
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

// Helper function to capitalize first letter
function capitalizeFirstLetter(string: string | null | undefined) {
  if (!string) return 'N/A';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Make the component async to fetch data
export default async function AccountPage() {
  const profile = await getUserProfile();

  // If no profile, redirect to login or show message
  if (!profile) {
    // Option 1: Redirect (make sure you have a sign-in page)
    // redirect('/api/auth/signin'); 
    
    // Option 2: Show message
    return (
        <div className="p-6">
          <h1 className="text-2xl font-semibold text-destructive">Access Denied</h1>
          <p className="text-muted-foreground">You must be logged in to view account information.</p>
        </div>
      );
  }

  // Calculate initials for fallback
  const initials = profile.name
    ? profile.name.split(' ').map((n) => n[0]).join('').toUpperCase()
    : profile.email?.[0].toUpperCase() ?? 'U';

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Account Information</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16 text-lg">
                  {profile.image && <AvatarImage src={profile.image} alt={profile.name ?? 'User Avatar'} />}
                  <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div>
                  <CardTitle>{profile.name ?? 'User'}</CardTitle>
                  <CardDescription>{profile.email}</CardDescription>
              </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="grid grid-cols-3 items-center gap-x-4 gap-y-2">
                <Label className="text-right font-semibold text-muted-foreground">Account Type</Label>
                <span className="col-span-2 text-sm">{capitalizeFirstLetter(profile.type)}</span>
                
                <Label className="text-right font-semibold text-muted-foreground">Name</Label>
                <span className="col-span-2 text-sm">{profile.name ?? <span className="italic text-muted-foreground">Not set</span>}</span>

                <Label className="text-right font-semibold text-muted-foreground">Email</Label>
                <span className="col-span-2 text-sm">{profile.email}</span>
                
                {/* Conditionally show password placeholder */} 
                {profile.type === 'normal' && (
                   <>
                    <Label className="text-right font-semibold text-muted-foreground">Password</Label>
                    <span className="col-span-2 text-sm font-mono">**********</span> {/* Placeholder */}
                   </>
                )}
            </div>
        </CardContent>
      </Card>
      {/* Add Edit button/link later if needed */}
    </div>
  );
} 