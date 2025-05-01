'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Chrome } from 'lucide-react';

export default function SignInPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGoogleSignIn = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await signIn('google', { callbackUrl: '/dashboard' });
            // signIn redirects, so no need to handle success explicitly unless redirect=false
        } catch (err) {
             console.error("Google Sign In Error:", err);
             setError("An error occurred during Google sign-in.");
             setIsLoading(false);
        } 
        // setIsLoading(false); // Usually not reached due to redirect
    };

    const handleCredentialsSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const result = await signIn('credentials', {
                redirect: false, // Handle redirect manually based on result
                email,
                password,
                callbackUrl: '/dashboard' // Or wherever you want to redirect after login
            });

            if (result?.error) {
                console.error("Credentials Sign In Error:", result.error);
                // Provide specific feedback if possible (NextAuth returns error codes like "CredentialsSignin")
                if (result.error === 'CredentialsSignin') {
                    setError('Invalid email or password.');
                } else {
                    setError('An error occurred during sign-in.');
                }
                setIsLoading(false);
            } else if (result?.ok) {
                toast.success('Sign in successful!')
                // Redirect to dashboard or callbackUrl on successful sign-in
                router.push(result.url ?? '/dashboard');
                // Don't set isLoading false here as we are navigating away
            } else {
                // Handle other potential outcomes if needed
                 setError('An unexpected error occurred during sign-in.');
                 setIsLoading(false);
            }
        } catch (err) {
            console.error("Sign In Exception:", err);
            setError("An unexpected exception occurred.");
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-background px-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1 text-center">
                    <CardTitle className="text-2xl">Sign In</CardTitle>
                    <CardDescription>Enter your email below to login to your account</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    {/* Google Sign In Button */}
                    <Button 
                        variant="outline" 
                        className="w-full" 
                        onClick={handleGoogleSignIn}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Chrome className="mr-2 h-4 w-4" /> 
                        )}
                        Sign in with Google
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">
                                Or sign in with email
                            </span>
                        </div>
                    </div>
                    
                    {/* Credentials Form */}
                    <form onSubmit={handleCredentialsSignIn} className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="email">Email</Label>
                            <Input 
                                id="email" 
                                name="email" 
                                type="email" 
                                placeholder="your@email.com" 
                                required 
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center">
                                <Label htmlFor="password">Password</Label>
                                <Link href="/forgot-password" className="ml-auto inline-block text-xs underline">
                                    Forgot password?
                                </Link>
                            </div>
                            <Input 
                                id="password" 
                                name="password" 
                                type="password" 
                                placeholder="Enter your password" 
                                required 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>
                        {error && (
                           <p className="text-sm font-medium text-destructive text-center">{error}</p>
                        )}
                        <Button type="submit" className="w-full" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Sign in
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="justify-center">
                    <p className="text-sm text-muted-foreground">
                        Don&apos;t have an account?{" "}
                        <Link href="/signup" className="underline underline-offset-4 hover:text-primary">
                            Sign up
                        </Link>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
} 