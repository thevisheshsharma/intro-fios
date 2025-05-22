
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
      console.error(`External API error: ${response.status}. Response not JSON:`, responseBodyText);
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
    // If response.ok but not JSON, it's an issue with the upstream API's format
    console.error('External API success response (2xx) was not JSON:', responseBodyText);
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
    console.error(`External API error: ${response.status}`, parsedData);
    let externalErrorMessage = response.statusText || `External API Error ${response.status}`;
    if (parsedData) {
        if (typeof parsedData.message === 'string' && parsedData.message) externalErrorMessage = parsedData.message;
        else if (typeof parsedData.error === 'string' && parsedData.error) externalErrorMessage = parsedData.error;
        else if (typeof parsedData.error_message === 'string' && parsedData.error_message) externalErrorMessage = parsedData.error_message;
        else if (typeof parsedData.title === 'string' && parsedData.title) externalErrorMessage = parsedData.title;
        else if (typeof parsedData.detail === 'string' && parsedData.detail) externalErrorMessage = parsedData.detail;
        else if (Array.isArray(parsedData.errors) && parsedData.errors.length > 0 && typeof parsedData.errors[0].message === 'string' && parsedData.errors[0].message) {
            externalErrorMessage = parsedData.errors[0].message;
        }
    }
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

  // Step 1: User Lookup to get numeric user_id
  const userLookupUrl = `https://api.socialdata.tools/twitter/user/${username}`;
  console.log(`Attempting user lookup for username: ${username}. API URL: ${userLookupUrl}`);
  
  try {
    const lookupResponse = await fetchFromExternalApi(userLookupUrl, apiKey);

    if (!lookupResponse.ok) {
      // Pass through the error from user lookup
      const message = lookupResponse.json.error || "Failed to look up user.";
      if (lookupResponse.status === 404) {
         return NextResponse.json({ error: `User "${username}" not found.`, details: lookupResponse.json.details }, { status: 404 });
      }
      return NextResponse.json({ error: message, details: lookupResponse.json.details }, { status: lookupResponse.status });
    }

    const lookupData = lookupResponse.json;
    // The numeric ID could be in `id_str` or `id`. Prefer `id_str` as per docs.
    // It might be nested under a `data` key or at the root.
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
      const message = followingsResponse.json.error || "Failed to fetch followings list.";
      return NextResponse.json({ error: message, details: followingsResponse.json.details }, { status: followingsResponse.status });
    }

    const followingsData = followingsResponse.json;
    let usersArray: any[] | undefined;

    // The Python example implies the list might be under a 'data' key, or it could be the root.
    // The original code checked `data.data` then `data`. SocialData APIs often use a `data` wrapper.
    if (followingsData && Array.isArray(followingsData.data)) {
        usersArray = followingsData.data;
    } else if (followingsData && Array.isArray(followingsData.users)) { // Common alternative
        usersArray = followingsData.users;
    } else if (Array.isArray(followingsData)) {
        usersArray = followingsData;
    }


    if (usersArray) {
      const usernames = usersArray.map((user: any) => user.username).filter(Boolean);
      return NextResponse.json({ followings: usernames });
    } else {
      console.warn('Unexpected data structure from external API (followings list). Expected an array of users, possibly under a "data" or "users" key, or at the root.', followingsData);
      return NextResponse.json({ 
          error: 'Bad Gateway: Upstream API response for followings list has unexpected structure.',
          details: { message: "The list of followings could not be extracted due to an unexpected data format from the external service.", receivedData: followingsData }
        }, { status: 502 });
    }

  } catch (error: any) {
    // Catch-all for network errors or other unexpected issues during the process
    console.error('Error in get-followings proxy:', error);
    return NextResponse.json({ error: 'Service Unavailable: Internal server error while processing request.', details: { message: error.message, type: error.name } }, { status: 503 });
  }
}
