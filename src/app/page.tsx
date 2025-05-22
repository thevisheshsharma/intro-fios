
"use client";

import { useState, type FormEvent, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Users, AlertCircle, Eye } from 'lucide-react';

interface ApiResponse {
  followings?: string[];
  error?: string;
  details?: any;
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [submittedUsername, setSubmittedUsername] = useState('');
  const [followings, setFollowings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (hasSearched) {
      setFollowings([]);
      setError(null);
    }
  }, [username]);


  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError('Please enter an X username.');
      setHasSearched(false);
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
        const rawErrorMessage = data.error || `An error occurred: ${response.statusText}`;
        let detailedMessage = rawErrorMessage;
        
        if (data.details) {
            if (typeof data.details.error === 'string') {
                detailedMessage = data.details.error;
            } else if (typeof data.details.message === 'string') {
                detailedMessage = data.details.message;
            } else if (typeof data.details.detail === 'string' && data.details.title === "Not Found Error") {
                 detailedMessage = `User "${trimmedUsername}" not found or their followings are private. (${data.details.detail})`;
            } else if (data.details.title === "Forbidden" || response.status === 401 || response.status === 403) {
                detailedMessage = "Access to the API is forbidden. This might be due to an invalid API key or permission issues on the server.";
            }
        }
        
        if (response.status === 404 && (detailedMessage.includes("Could not find user") || detailedMessage.includes("User not found") || (data.details?.detail || "").includes("Could not find user"))) {
             setError(`User "${trimmedUsername}" not found or their followings are private.`);
        } else if (detailedMessage === "Failed to fetch data from Twitter") {
            let additionalHint = "";
            if (response.status === 400) { // Check if our API (mirroring external) returned 400
                additionalHint = " This can also occur if the external API requires a numeric user ID but a username string was provided.";
            }
            setError(`Could not retrieve followings for @${trimmedUsername}. This might be because the user doesn't exist, their profile is private, the username was entered incorrectly, or there's a temporary issue with the data service.${additionalHint} Please check the username and try again later.`);
        } else {
             setError(detailedMessage || 'Failed to fetch followings. Please try again.');
        }
        return;
      }

      if (data.followings && Array.isArray(data.followings)) {
        setFollowings(data.followings.slice(0, 5));
      } else {
        setError('Received an unexpected data format. The API might have changed.');
        setFollowings([]);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('An unexpected error occurred. Please check your network connection and try again.');
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
              Type an X (formerly Twitter) username below. The API may expect a numeric user ID for some accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Input
                  id="username"
                  type="text"
                  placeholder="e.g., elonmusk or a numeric user ID"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.startsWith('@') ? e.target.value.substring(1) : e.target.value)}
                  disabled={isLoading}
                  aria-label="X Username or Numeric User ID"
                  className="text-base py-3 px-4"
                />
              </div>
              <Button type="submit" className="w-full text-base py-3" disabled={isLoading} variant="default">
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
                No public followings found for @{submittedUsername}. The user might not exist, their followings could be private, or they aren't following anyone publicly.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

