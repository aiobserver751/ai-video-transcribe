'use client';

import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import { getUserProfile } from '@/app/actions/userActions';
import { users } from '@/server/db/schema';
import { InferSelectModel } from 'drizzle-orm';
import { useSession } from 'next-auth/react';

// Define the shape of the user profile data
export type UserProfile = InferSelectModel<typeof users>;

// Define the shape of the context value
interface UserProfileContextType {
    profile: UserProfile | null;
    isLoading: boolean;
    error: string | null;
    refetchProfile: () => Promise<void>; // Function to manually trigger a refetch
}

// Create the context with a default value (usually undefined or null)
const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

// Define the props for the provider component
interface UserProfileProviderProps {
    children: ReactNode;
}

// Create the provider component
export const UserProfileProvider: React.FC<UserProfileProviderProps> = ({ children }) => {
    const { data: session, status } = useSession();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // Function to fetch the profile
    const fetchProfile = useCallback(async () => {
        console.log("UserProfileProvider: Fetching profile...");
        setIsLoading(true);
        setError(null);
        try {
            const profileData = await getUserProfile();
            console.log("UserProfileProvider: Profile fetched", profileData);
            setProfile(profileData);
        } catch (err: unknown) {
            console.error("UserProfileProvider: Error fetching profile", err);
            const message = err instanceof Error ? err.message : "An unknown error occurred.";
            setError(message);
            setProfile(null); // Clear profile on error
        }
        setIsLoading(false);
    }, []);

    // Fetch profile when session is authenticated
    useEffect(() => {
        if (status === 'authenticated' && session?.user?.id) {
            console.log("Session authenticated, fetching profile");
            fetchProfile();
        } else if (status === 'unauthenticated') {
            console.log("Session unauthenticated, clearing profile");
            setProfile(null);
            setIsLoading(false);
        }
    }, [status, session, fetchProfile]);

    // Value provided by the context
    const value = {
        profile,
        isLoading,
        error,
        refetchProfile: fetchProfile, // Provide the fetch function for manual refetching
    };

    return (
        <UserProfileContext.Provider value={value}>
            {children}
        </UserProfileContext.Provider>
    );
};

// Custom hook to use the UserProfileContext
export const useUserProfile = (): UserProfileContextType => {
    const context = useContext(UserProfileContext);
    if (context === undefined) {
        throw new Error('useUserProfile must be used within a UserProfileProvider');
    }
    return context;
}; 