
"use client";

import { useState, type FormEvent, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Users, AlertCircle, Eye } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

interface ApiResponse {
  followings?: string[];
  error?: string;
  details?: { message?: string; [key: string]: any };
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [submittedUsername, setSubmittedUsername] = useState('');
  const [followings, setFollowings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (hasSearched) {
      setFollowings([]);
      setError(null);
    }
  }, [username, hasSearched]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError('Please enter an X username.');
      setHasSearched(false);
      toast({
        title: "Input Required",
        description: "Please enter an X username.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setError(null);
    setFollowings([]);
    setSubmittedUsername(trimmedUsername);
    setHasSearched(true);

    try {
      const response = await fetch(`/api/get-followings?username=${trimmedUsername}`);
      const data: ApiResponse = await response.json();

      if (!response.ok) {
        let displayError = data.error || `An error occurred: ${response.statusText}`;
        
        if (data.details?.message) {
          displayError = data.details.message;
        }
        
        if (response.status === 404) {
          displayError = `User "@${trimmedUsername}" not found. Please check the username.`;
        } else if (response.status === 401 || response.status === 403) {
          displayError = "Access to the data service is unauthorized. This might be an API key issue on the server.";
        } else if (response.status === 500 && data.error === "API Key Not Configured") {
          displayError = "The server is not configured correctly to access the data service (API key missing).";
        } else if (data.error && (data.error.toLowerCase().includes("failed to fetch data") || displayError.toLowerCase().includes("failed to fetch"))) {
           displayError = `Could not retrieve followings for @${trimmedUsername}. The user might not exist, their profile could be private, or there might be a temporary issue with the data service. Please verify the username and try again.`;
        } else if (response.status === 400 && data.error && data.error.toLowerCase().includes("invalid request parameters")) {
           displayError = `Could not process the request for @${trimmedUsername}. The username might be in an unexpected format. Please try again.`;
        }
        
        setError(displayError);
        toast({
          title: "Error",
          description: displayError,
          variant: "destructive",
        });
        return;
      }

      if (data.followings && Array.isArray(data.followings)) {
        setFollowings(data.followings.slice(0, 5));
        if (data.followings.length > 0) {
            toast({
                title: "Success!",
                description: `Fetched followings for @${trimmedUsername}.`,
            });
        }
      } else {
        setError('Received an unexpected data format from the server.');
        setFollowings([]);
         toast({
          title: "Error",
          description: 'Received an unexpected data format from the server.',
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error('Client-side fetch error:', err);
      const clientError = err.message || 'An unexpected error occurred. Please check your network connection and try again.';
      setError(clientError);
      toast({
        title: "Fetch Error",
        description: clientError,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-start p-4 sm:p-8 md:p-16 bg-background font-sans">
      <div className="w-full max-w-lg space-y-8">
        <header className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-primary tracking-tight">
            X Following Retriever
          </h1>
          <p className="mt-2 text-md sm:text-lg text-muted-foreground">
            Enter an X username to see their latest public followings.
          </p>
        </header>

        <Card className="shadow-xl rounded-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Find Followings</CardTitle>
            <CardDescription>
              Type an X (formerly Twitter) username below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Input
                  id="username"
                  type="text"
                  placeholder="e.g., elonmusk"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
                  disabled={isLoading}
                  aria-label="X Username"
                  className="text-base py-3 px-4"
                />
              </div>
              <Button type="submit" className="w-full text-base py-3" disabled={isLoading || !username.trim()} variant="default">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <Users className="mr-2 h-5 w-5" />
                    Get Followings
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive" className="shadow-lg rounded-lg">
            <AlertCircle className="h-5 w-5" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {hasSearched && !isLoading && !error && followings.length > 0 && (
          <Card className="shadow-xl rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Followings for @{submittedUsername}</CardTitle>
              <CardDescription>
                Showing up to 5 most recent public followings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {followings.map((followingUsername, index) => (
                  <li key={index} className="flex items-center justify-between p-3 bg-secondary rounded-md hover:bg-accent/90 transition-colors duration-150 group">
                    <span className="font-medium text-secondary-foreground group-hover:text-accent-foreground">@{followingUsername}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`https://x.com/${followingUsername}`, '_blank')}
                      className="text-xs group-hover:border-accent-foreground group-hover:text-accent-foreground"
                      aria-label={`View X profile of @${followingUsername}`}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      View
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
         
        {hasSearched && !isLoading && !error && followings.length === 0 && (
          <Card className="shadow-xl rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">No Results</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                No public followings found for @{submittedUsername}, or their followings are private/empty.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
