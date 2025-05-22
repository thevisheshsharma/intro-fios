
import { type NextRequest, NextResponse } from 'next/server';

async function fetchFromExternalApi(url: string, apiKey: string) {
  console.log(`Calling external API: ${url}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
    cache: 'no-store', // Ensure fresh data
  });

  let responseBodyText = '';
  try {
    responseBodyText = await response.text();
  } catch (e) {
    // Ignore error if response body is not text or empty,
    // the !response.ok check below will handle it.
  }
  
  let parsedData: any;
  try {
    parsedData = responseBodyText ? JSON.parse(responseBodyText) : null;
  } catch (e) {
    if (!response.ok) {
      console.error(`External API error: ${response.status}. Response not JSON:`, responseBodyText.substring(0, 500));
      const errorMsg = responseBodyText.length < 200 ? responseBodyText : response.statusText;
      return { 
        ok: false, 
        status: response.status, 
        json: { 
          error: `External API error (${response.status}): ${errorMsg}`, 
          details: { message: `The external API returned status ${response.statusText} but the response body could not be parsed as JSON.`, bodyPreview: responseBodyText.substring(0, 500) }
        } 
      };
    }
    console.error('External API success response (2xx) was not JSON:', responseBodyText.substring(0, 500));
    return { 
      ok: false, 
      status: 502, // Bad Gateway
      json: { 
        error: 'Bad Gateway: Upstream API sent an invalid success response.', 
        details: { message: "The external API returned a success status, but its response body was not valid JSON.", bodyPreview: responseBodyText.substring(0, 500) }
      } 
    };
  }

  if (!response.ok) {
    let externalErrorMessage = response.statusText || `External API Error ${response.status}`;
    if (parsedData) {
        // Prioritize more specific error messages if available
        if (typeof parsedData.message === 'string' && parsedData.message) externalErrorMessage = parsedData.message;
        else if (typeof parsedData.error === 'string' && parsedData.error) externalErrorMessage = parsedData.error;
        else if (typeof parsedData.error_message === 'string' && parsedData.error_message) externalErrorMessage = parsedData.error_message;
        else if (Array.isArray(parsedData.errors) && parsedData.errors.length > 0 && typeof parsedData.errors[0].message === 'string' && parsedData.errors[0].message) {
            externalErrorMessage = parsedData.errors[0].message;
        } else if (typeof parsedData.title === 'string' && parsedData.title) externalErrorMessage = parsedData.title;
        else if (typeof parsedData.detail === 'string' && parsedData.detail) externalErrorMessage = parsedData.detail;
    }
    console.error(`External API error: ${response.status} at ${url}. Message: ${externalErrorMessage}`, parsedData ? {details: parsedData} : {});
    
    // Specific logging for common HTTP errors
    if (response.status === 400) console.warn("External API returned 400 Bad Request. Check request parameters, especially user identifiers.");
    if (response.status === 401 || response.status === 403) console.warn("External API returned 401/403. Check API key validity and permissions.");
    if (response.status === 404) console.warn("External API returned 404 Not Found. The requested resource (e.g., user, endpoint) might not exist.");

    return { ok: false, status: response.status, json: { error: externalErrorMessage, details: parsedData } };
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
        title: "Server Configuration Error", 
        message: "The SOCIALDATA_API_KEY is missing from the server's environment variables. Please ensure it is set correctly for the application to authenticate with the external service." 
      } 
    }, { status: 500 });
  }

  try {
    // Step 1: User Lookup to get numeric user_id
    const userLookupUrl = `https://api.socialdata.tools/twitter/user/${username}`;
    console.log(`Attempting user lookup for username: ${username}. API URL: ${userLookupUrl}`);
    
    const lookupResponse = await fetchFromExternalApi(userLookupUrl, apiKey);

    if (!lookupResponse.ok) {
      const message = lookupResponse.json?.error || "Failed to look up user.";
      if (lookupResponse.status === 404) {
         return NextResponse.json({ error: `User "${username}" not found.`, details: lookupResponse.json?.details }, { status: 404 });
      }
      return NextResponse.json({ error: message, details: lookupResponse.json?.details }, { status: lookupResponse.status });
    }

    const lookupData = lookupResponse.json;
    const numericUserId = lookupData?.data?.id_str || lookupData?.id_str || lookupData?.data?.id || lookupData?.id;

    if (!numericUserId) {
      console.error('Could not find numeric user ID in lookup response:', lookupData);
      return NextResponse.json({ 
          error: 'Bad Gateway: User ID not found in the lookup response from the external API.',
          details: { message: "The external API returned a successful user lookup, but the user ID was missing or in an unexpected format.", receivedData: lookupData }
        }, { status: 502 });
    }
    console.log(`Successfully looked up user ID for ${username}: ${numericUserId}`);

    // Step 2: Fetch Following List using the numeric user_id
    const followingsListUrl = `https://api.socialdata.tools/twitter/friends/list?user_id=${numericUserId}`;
    console.log(`Attempting to fetch followings for user ID: ${numericUserId}. API URL: ${followingsListUrl}`);
    const followingsResponse = await fetchFromExternalApi(followingsListUrl, apiKey);

    if (!followingsResponse.ok) {
      const message = followingsResponse.json?.error || "Failed to fetch followings list.";
      return NextResponse.json({ error: message, details: followingsResponse.json?.details }, { status: followingsResponse.status });
    }

    const followingsData = followingsResponse.json;
    let usersArray: any[] | undefined;

    if (followingsData && Array.isArray(followingsData.data)) {
        usersArray = followingsData.data;
    } else if (followingsData && Array.isArray(followingsData.users)) {
        usersArray = followingsData.users;
    } else if (Array.isArray(followingsData)) {
        usersArray = followingsData;
    }

    if (usersArray) {
      const extractedUsernames = usersArray.map((user: any) => user.screen_name || user.username).filter(Boolean);
      
      if (usersArray.length > 0 && extractedUsernames.length === 0) {
        console.warn(
          `Successfully fetched ${usersArray.length} user objects from followings list for user ID ${numericUserId}, but failed to extract 'screen_name' or 'username' from them. First user object structure:`,
          JSON.stringify(usersArray[0], null, 2)
        );
      } else if (usersArray.length === 0) {
        console.log(`Followings list for user ID ${numericUserId} is empty as per external API for username ${username}.`);
      } else {
        console.log(`Successfully extracted ${extractedUsernames.length} following usernames for user ID ${numericUserId} (username: ${username}).`);
      }
      
      return NextResponse.json({ followings: extractedUsernames });
    } else {
      console.warn('Unexpected data structure from external API (followings list) for user ID ${numericUserId}. Expected an array of users, possibly under a "data" or "users" key, or at the root. Received:', followingsData);
      return NextResponse.json({ 
          error: 'Bad Gateway: Upstream API response for followings list has unexpected structure.',
          details: { message: "The list of followings could not be extracted due to an unexpected data format from the external service.", receivedData: followingsData }
        }, { status: 502 });
    }

  } catch (error: any) {
    console.error(`Error in get-followings proxy for username ${username}:`, error);
    // Avoid leaking detailed internal error structures to client if not from fetchFromExternalApi
    const errorMessage = error?.message || "Internal server error while processing request.";
    const errorName = error?.name || "Error";
    return NextResponse.json({ error: 'Service Unavailable: Internal server error while processing request.', details: { message: errorMessage, type: errorName } }, { status: 503 });
  }
}
