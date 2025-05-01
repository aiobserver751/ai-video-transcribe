'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation'; // For potential redirect on success
import { registerUser } from '@/app/actions/userActions';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Chrome } from 'lucide-react'; // Import icons from lucide-react

// Submit button component
function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" className="w-full" disabled={pending} aria-disabled={pending}>
             {pending ? (
                 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
             ) : null}
            Create account
        </Button>
    );
}

export default function SignUpPage() {
    const router = useRouter();
    const initialState = { message: null, success: false };
    const [state, formAction] = useFormState(registerUser, initialState);

    useEffect(() => {
        if (state.message) {
            if (state.success) {
                toast.success(state.message);
                // Redirect to sign-in page after successful registration
                router.push('/signin'); 
            } else {
                toast.error("Registration Failed", { description: state.message });
            }
        }
    }, [state, router]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-background px-4">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1 text-center">
                    <CardTitle className="text-2xl">Create an account</CardTitle>
                    <CardDescription>Enter your details below to create your account</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    {/* Google Sign In Button */}
                    <Button 
                        variant="outline" 
                        className="w-full" 
                        onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
                    >
                        <Chrome className="mr-2 h-4 w-4" />
                        Sign up with Google
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">
                                Or sign up with email
                            </span>
                        </div>
                    </div>
                    
                    {/* Registration Form */}
                    <form action={formAction} className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Name</Label>
                            <Input id="name" name="name" placeholder="Enter your full name" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" name="email" type="email" placeholder="your@email.com" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="password">Password</Label>
                            <Input id="password" name="password" type="password" placeholder="Enter your password" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="confirmPassword">Re-type Password</Label>
                            <Input id="confirmPassword" name="confirmPassword" type="password" placeholder="Re-enter your password" required />
                        </div>
                        <SubmitButton />
                    </form>
                    
                    {/* Display general form error if exists and not success */}
                    {/* {state.message && !state.success && (
                        <p className="text-center text-sm text-destructive">
                            {state.message}
                        </p>
                    )} */} 
                </CardContent>
                <CardFooter className="justify-center">
                    <p className="text-sm text-muted-foreground">
                        Already have an account?{" "}
                        <Link href="/signin" className="underline underline-offset-4 hover:text-primary">
                            Sign in
                        </Link>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
} 