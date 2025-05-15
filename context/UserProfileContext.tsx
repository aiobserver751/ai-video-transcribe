'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { getUserProfile } from '@/app/actions/userActions';
import { users } from '@/server/db/schema';
import { InferSelectModel } from 'drizzle-orm';
import { useSession } from 'next-auth/react';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Define the shape of the user profile data
export type UserProfile = InferSelectModel<typeof users>;

// Define the shape of the context value
interface UserProfileContextType {
    profile: UserProfile | null | undefined;
    isLoading: boolean;
    error: Error | null;
    refetchProfile: () => void;
}

// Create the context with a default value
const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

// Define the props for the provider component
interface UserProfileProviderProps {
    children: ReactNode;
}

// It's good practice to create the QueryClient instance outside the component
// or ensure it's memoized if created inside, but for a context provider
// that wraps a significant part of the app, creating it once here is fine.
// If this provider is used multiple times independently, QueryClient should be lifted higher.
const queryClient = new QueryClient();

export const AppQueryClientProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
        {children}
    </QueryClientProvider>
);

// Create the provider component
export const UserProfileProvider: React.FC<UserProfileProviderProps> = ({ children }) => {
    const { data: session, status } = useSession();
    const isAuthenticated = status === 'authenticated' && !!session?.user?.id;

    const { 
        data: profileData, 
        isLoading, 
        error, 
        refetch 
    } = useQuery<UserProfile | null, Error>({
        queryKey: ['userProfile', session?.user?.id],
        queryFn: async () => {
            console.log("UserProfileProvider (React Query): Fetching profile...");
            if (!isAuthenticated) {
                return null;
            }
            try {
                const profile = await getUserProfile();
                console.log("UserProfileProvider (React Query): Profile fetched", profile);
                return profile;
            } catch (err) {
                console.error("UserProfileProvider (React Query): Error fetching profile", err);
                throw err;
            }
        },
        enabled: isAuthenticated,
        refetchInterval: 5000,
        staleTime: 3000,
        refetchOnWindowFocus: true,
        placeholderData: (previousData) => previousData,
    });

    const value = {
        profile: profileData,
        isLoading,
        error,
        refetchProfile: refetch,
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