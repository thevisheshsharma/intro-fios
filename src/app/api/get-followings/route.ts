
import { type NextRequest, NextResponse } from 'next/server';

async function fetchFromExternalApi(url: string, apiKey: string) {
  console.log(`Calling external API: ${url}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  let responseBodyText = '';
  let parsedData: any = null;

  try {
    responseBodyText = await response.text();
    if (responseBodyText) {
      parsedData = JSON.parse(responseBodyText);
    }
  } catch (e) {
    // If JSON parsing fails, parsedData remains null.
    // If response.ok is true but JSON is invalid, we'll handle it below.
    // If response.ok is false, this parsing error is secondary to the HTTP error.
    console.warn(`Failed to parse JSON from ${url}, status: ${response.status}. Body: ${responseBodyText.substring(0, 200)}`);
  }

  if (!response.ok) {
    let externalErrorMessage = response.statusText; // Default to status text

    if (parsedData) {
      // Try to get a more specific error message from the parsed JSON
      const potentialErrorMessages = [
        parsedData.message,
        parsedData.error, // Often a string or an object
        parsedData.error_message,
        Array.isArray(parsedData.errors) && parsedData.errors.length > 0 && parsedData.errors[0].message,
        parsedData.title,
        parsedData.detail,
      ];
      for (const msg of potentialErrorMessages) {
        if (typeof msg === 'string' && msg) {
          externalErrorMessage = msg;
          break;
        }
      }
      // If parsedData.error is an object, try to get message from it
      if (typeof parsedData.error === 'object' && parsedData.error !== null && typeof parsedData.error.message === 'string') {
        externalErrorMessage = parsedData.error.message;
      }
    } else if (responseBodyText) {
      // If parsing failed but we have text, use the beginning of it if it's short.
      externalErrorMessage = responseBodyText.length < 100 ? responseBodyText : externalErrorMessage;
    }

    console.error(`External API error: ${response.status} at ${url}. Message: "${externalErrorMessage}"`, parsedData ? {details: parsedData} : {bodyPreview: responseBodyText.substring(0,200)});
    
    if (response.status === 400) console.warn("External API returned 400 Bad Request. Check request parameters.");
    if (response.status === 401 || response.status === 403) console.warn("External API returned 401/403. Check API key validity and permissions.");
    if (response.status === 404) console.warn("External API returned 404 Not Found. The requested resource might not exist.");

    return { ok: false, status: response.status, json: { error: externalErrorMessage, details: parsedData } };
  }

  // Handle cases where response is OK (2xx) but content is not valid JSON or missing
  if (!parsedData && response.ok && response.headers.get('content-type')?.includes('application/json')) {
      console.error(`External API success response (2xx) from ${url} was expected to be JSON but was not or was empty:`, responseBodyText.substring(0, 500));
      return { 
        ok: false, 
        status: 502, // Bad Gateway
        json: { 
          error: 'Bad Gateway: Upstream API sent an invalid success response.', 
          details: { message: "The external API returned a success status, but its response body was not valid JSON or was empty.", bodyPreview: responseBodyText.substring(0, 500) }
        } 
      };
  }
  
  return { ok: true, status: response.status, json: parsedData };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get('username');

  if (!username) {
    return NextResponse.json({ error: 'Username is required' }, { status: 400 });
  }
  console.log(`Processing request for username: ${username}`);

  const apiKey = process.env.SOCIALDATA_API_KEY;
  if (!apiKey) {
    console.error('SOCIALDATA_API_KEY is not set in environment variables.');
    return NextResponse.json({ 
      error: 'API Key Not Configured', 
      details: { 
        message: "The SOCIALDATA_API_KEY is missing. Please set it on the server." 
      } 
    }, { status: 500 });
  }

  try {
    // Step 1: User Lookup to get numeric user_id
    const userLookupUrl = `https://api.socialdata.tools/twitter/user/${username}`;
    console.log(`Attempting user lookup for username: ${username}`);
    
    const lookupResponse = await fetchFromExternalApi(userLookupUrl, apiKey);

    if (!lookupResponse.ok) {
      const message = lookupResponse.json?.error || "Failed to look up user.";
      // User not found is a common case, handle it gracefully.
      if (lookupResponse.status === 404) {
         return NextResponse.json({ error: `User "${username}" not found.`, details: lookupResponse.json?.details }, { status: 404 });
      }
      return NextResponse.json({ error: message, details: lookupResponse.json?.details }, { status: lookupResponse.status });
    }

    const lookupData = lookupResponse.json;
    // Prioritize id_str as per Twitter's recommendation for large IDs
    const numericUserId = lookupData?.data?.id_str || lookupData?.id_str || lookupData?.data?.id || lookupData?.id;

    if (!numericUserId) {
      console.error(`Could not find numeric user ID in lookup response for ${username}:`, lookupData);
      return NextResponse.json({ 
          error: 'Bad Gateway: User ID not found in the lookup response from the external API.',
          details: { message: "The external API successfully looked up the user, but the user ID was missing or in an unexpected format.", receivedData: lookupData }
        }, { status: 502 });
    }
    console.log(`Successfully looked up user ID for ${username}: ${numericUserId}`);

    // Step 2: Fetch Following List using the numeric user_id
    const followingsListUrl = `https://api.socialdata.tools/twitter/friends/list?user_id=${numericUserId}`;
    console.log(`Attempting to fetch followings for user ID: ${numericUserId}`);
    const followingsResponse = await fetchFromExternalApi(followingsListUrl, apiKey);

    if (!followingsResponse.ok) {
      const message = followingsResponse.json?.error || "Failed to fetch followings list.";
      return NextResponse.json({ error: message, details: followingsResponse.json?.details }, { status: followingsResponse.status });
    }

    const followingsData = followingsResponse.json;
    let usersArray: any[] | undefined;

    // Standard checks for where the array of users might be
    if (followingsData && Array.isArray(followingsData.data)) {
        usersArray = followingsData.data;
    } else if (followingsData && Array.isArray(followingsData.users)) {
        usersArray = followingsData.users;
    } else if (Array.isArray(followingsData)) { // Root might be the array
        usersArray = followingsData;
    }

    if (usersArray) {
      // Extract screen_name (common in Twitter APIs) or fallback to username
      const extractedUsernames = usersArray.map((user: any) => user.screen_name || user.username).filter(Boolean);
      
      if (usersArray.length > 0 && extractedUsernames.length === 0) {
        console.warn(
          `Fetched ${usersArray.length} user objects for ID ${numericUserId}, but failed to extract 'screen_name' or 'username'. First user object:`,
          JSON.stringify(usersArray[0], null, 2).substring(0, 500) // Log a snippet
        );
      } else if (extractedUsernames.length === 0) { // Could be usersArray.length === 0 or just no names extracted
        console.log(`Followings list for user ID ${numericUserId} (username ${username}) is empty or no usernames found.`);
      } else {
        console.log(`Successfully extracted ${extractedUsernames.length} following usernames for user ID ${numericUserId} (username: ${username}).`);
      }
      
      return NextResponse.json({ followings: extractedUsernames });
    } else {
      // This means the overall structure of followingsData was not an array and didn't have a 'data' or 'users' array.
      console.warn(`Unexpected data structure for followings list (user ID ${numericUserId}). Expected an array, or object with 'data'/'users' array. Received:`, JSON.stringify(followingsData, null, 2).substring(0, 500));
      return NextResponse.json({ 
          error: 'Bad Gateway: Upstream API response for followings list has unexpected structure.',
          details: { message: "The list of followings could not be extracted due to an unexpected data format.", receivedDataPreview: JSON.stringify(followingsData, null, 2).substring(0, 200) }
        }, { status: 502 });
    }

  } catch (error: any) {
    console.error(`Unhandled error in get-followings proxy for username ${username}:`, error);
    const errorMessage = error?.message || "An unexpected internal error occurred.";
    return NextResponse.json({ error: 'Service Unavailable: Internal server error.', details: { message: errorMessage, type: error?.name || "Error" } }, { status: 503 });
  }
}
