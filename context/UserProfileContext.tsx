'use client';

import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import { getUserProfile } from '@/app/actions/userActions';
import type { SelectUser } from '@/types/user';

// Define the shape of the context value
interface UserProfileContextType {
    profile: SelectUser | null;
    isLoading: boolean;
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
    const [profile, setProfile] = useState<SelectUser | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    // Function to fetch the profile
    const fetchProfile = useCallback(async () => {
        console.log("UserProfileProvider: Fetching profile...");
        setIsLoading(true);
        try {
            const userProfile = await getUserProfile();
            setProfile(userProfile);
            console.log("UserProfileProvider: Profile fetched", userProfile);
        } catch (error) {
            console.error("UserProfileProvider: Error fetching profile", error);
            setProfile(null); // Set profile to null on error
        }
        setIsLoading(false);
    }, []);

    // Fetch profile on initial mount
    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]); // Depend on the memoized fetchProfile function

    // Value provided by the context
    const value = {
        profile,
        isLoading,
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