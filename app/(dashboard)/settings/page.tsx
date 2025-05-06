'use client';

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Trash2, Copy, Eye, EyeOff, AlertTriangle, Info } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/app/actions/apiKeyActions'; // Adjust path if needed
import { format } from 'date-fns';

// Interface for the shape of API key metadata returned by listApiKeys
interface ApiKeyMetadata {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
  keyPrefix: string;
  keySuffix: string;
}

export default function SettingsPage() {
  const [apiKeysList, setApiKeysList] = useState<ApiKeyMetadata[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(true);
  const [isLoadingGenerate, setIsLoadingGenerate] = useState(false);
  const [isLoadingRevoke, setIsLoadingRevoke] = useState<string | null>(null); // Store ID of key being revoked
  
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(true); // To toggle visibility for the new key

  const [error, setError] = useState<string | null>(null);

  // Fetch API Keys
  const fetchKeys = async () => {
    setIsLoadingKeys(true);
    setError(null);
    try {
      const result = await listApiKeys();
      if (result.success && result.keys) {
        setApiKeysList(result.keys);
      } else {
        setError(result.error || 'Failed to load API keys.');
        toast.error("Error", { description: result.error || 'Failed to load API keys.' });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred.';
      const fetchError = `An unexpected error occurred while fetching API keys: ${errorMessage}`;
      setError(fetchError);
      toast.error("Error", { description: fetchError });
    } finally {
      setIsLoadingKeys(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  // Handle Generate New Key
  const handleGenerateKey = async () => {
    setIsLoadingGenerate(true);
    setNewlyGeneratedKey(null); // Clear previous new key
    setShowNewKey(true); // Ensure it's shown by default
    setError(null);

    const trimmedName = newKeyName.trim();
    if (!trimmedName) {
      toast.error("Validation Error", { description: "API key name cannot be empty." });
      setError("API key name cannot be empty.");
      setIsLoadingGenerate(false);
      return;
    }

    try {
      const result = await generateApiKey(trimmedName);
      if (result.success && result.apiKey) {
        setNewlyGeneratedKey(result.apiKey.key);
        toast.success("API Key Generated", { description: "Your new API key has been generated. Copy it now, it won't be shown again!" });
        setNewKeyName(''); // Clear input
        await fetchKeys(); // Refresh the list
      } else {
        setError(result.error || 'Failed to generate API key.');
        toast.error("Error", { description: result.error || 'Failed to generate API key.' });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred.';
      const genError = `An unexpected error occurred during key generation: ${errorMessage}`;
      setError(genError);
      toast.error("Error", { description: genError });
    } finally {
      setIsLoadingGenerate(false);
    }
  };

  // Handle Revoke Key
  const handleRevokeKey = async (keyId: string) => {
    setIsLoadingRevoke(keyId);
    setError(null);
    try {
      const result = await revokeApiKey(keyId);
      if (result.success) {
        toast.success("API Key Revoked", { description: "The API key has been successfully revoked." });
        await fetchKeys(); // Refresh the list
      } else {
        setError(result.error || 'Failed to revoke API key.');
        toast.error("Error", { description: result.error || 'Failed to revoke API key.' });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unexpected error occurred.';
      const revokeError = `An unexpected error occurred while revoking the key: ${errorMessage}`;
      setError(revokeError);
      toast.error("Error", { description: revokeError });
    } finally {
      setIsLoadingRevoke(null);
    }
  };

  const handleCopyKey = () => {
    if (newlyGeneratedKey) {
      navigator.clipboard.writeText(newlyGeneratedKey)
        .then(() => toast.success("Copied!", { description: "API Key copied to clipboard." }))
        .catch(() => toast.error("Copy Failed", { description: "Could not copy key to clipboard." }));
    }
  };

  return (
    <div className="space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">API Keys</h1>
        <p className="text-muted-foreground">
          Manage your API keys for programmatic access to your account.
        </p>
      </div>

      {/* Section to display newly generated API key */}
      {newlyGeneratedKey && (
        <Card className="border-primary bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              New API Key Generated - Save It Now!
            </CardTitle>
            <CardDescription>
              This key will <span className="font-semibold">not be shown again</span>. Please copy and store it securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md font-mono text-sm break-all">
              {showNewKey ? newlyGeneratedKey : 'sk_************************************************'} 
              <Button variant="ghost" size="icon" onClick={() => setShowNewKey(!showNewKey)} className="ml-auto">
                {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button onClick={handleCopyKey} className="w-full sm:w-auto">
              <Copy className="mr-2 h-4 w-4" /> Copy Key
            </Button>
          </CardContent>
          <CardFooter>
             <Button variant="outline" onClick={() => setNewlyGeneratedKey(null)}>
                Dismiss
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Section to Create New API Key */}
      <Card>
        <CardHeader>
          <CardTitle>Generate New API Key</CardTitle>
          <CardDescription>
            Give your key a descriptive name (optional) for easier identification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Enter a name for your API key (e.g., My Integration)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            disabled={isLoadingGenerate}
          />
          <Button onClick={handleGenerateKey} disabled={isLoadingGenerate || !newKeyName.trim()}>
            {isLoadingGenerate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate Key
          </Button>
        </CardContent>
      </Card>

      {/* Section to List API Keys */}
      <Card>
        <CardHeader>
          <CardTitle>Your API Keys</CardTitle>
          <CardDescription>
            These are your existing API keys. Remember to treat them like passwords.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingKeys ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="ml-2">Loading your API keys...</p>
            </div>
          ) : error && !apiKeysList.length ? (
             <div className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> {error}
             </div>
          ) : apiKeysList.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Info className="mx-auto h-10 w-10 mb-2" />
              <p className="font-semibold">No API keys found.</p>
              <p>Generate your first API key above to get started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {apiKeysList.map((key) => (
                <div key={key.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {key.name}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {`${key.keyPrefix}...${key.keySuffix}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Created: {format(new Date(key.createdAt), 'MMM d, yyyy, HH:mm')}
                      {key.lastUsedAt && (
                        <span className="ml-2">| Last used: {format(new Date(key.lastUsedAt), 'MMM d, yyyy, HH:mm')}</span>
                      )}
                    </p>
                     <p className="text-xs text-muted-foreground">
                        Status: {key.isActive ? <span className="text-green-600">Active</span> : <span className="text-red-600">Inactive</span>}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isLoadingRevoke === key.id}
                      >
                        {isLoadingRevoke === key.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Revoke
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. Revoking this API key ({key.name} - {`${key.keyPrefix}...${key.keySuffix}`}) will immediately prevent it from being used for any requests.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isLoadingRevoke === key.id}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleRevokeKey(key.id)}
                          disabled={isLoadingRevoke === key.id}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          {isLoadingRevoke === key.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Yes, Revoke Key
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 