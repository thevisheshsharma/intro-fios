
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get('username'); // This will be used as user_id as per current app flow

  if (!username) {
    return NextResponse.json({ error: 'Username (used as user_id) is required' }, { status: 400 });
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
    }, { status: 500 }); // 500 Internal Server Error because the server itself is misconfigured
  }

  // Using username as user_id based on current app input. 
  // The API documentation specifies user_id as numeric. If it strictly requires numbers, this may fail for non-numeric usernames.
  const externalApiUrl = `https://api.socialdata.tools/twitter/friends/list?user_id=${username}`;

  try {
    const response = await fetch(externalApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      cache: 'no-store', // Ensure fresh data is fetched
    });

    const responseBody = await response.text();
    let parsedData;

    try {
        parsedData = JSON.parse(responseBody);
    } catch (e) {
        // This block handles cases where the response body is not valid JSON.
        if (!response.ok) {
            // External API returned an error status (e.g., 401, 403, 404, 500) AND non-JSON body
            console.error(`External API error: ${response.status}. Response not JSON:`, responseBody);
            // Use responseBody directly if it's likely an error message, otherwise use statusText
            const errorMsg = responseBody.length < 200 ? responseBody : response.statusText; // Avoid sending huge HTML pages as error
            return NextResponse.json({ 
                error: `External API error (${response.status}): ${errorMsg}`, 
                details: { message: `The external API returned status ${response.statusText} but the response body could not be parsed as JSON.`, bodyPreview: responseBody.substring(0, 500) }
            }, { status: response.status });
        }
        // External API returned 2xx status BUT non-JSON body (malformed success response)
        console.error('External API success response (2xx) was not JSON:', responseBody);
        return NextResponse.json({ 
            error: 'Bad Gateway: Upstream API sent an invalid success response.', 
            details: { message: "The external API returned a success status, but its response body was not valid JSON.", bodyPreview: responseBody.substring(0, 500) }
        }, { status: 502 }); // 502 Bad Gateway
    }

    // At this point, parsedData contains the successfully parsed JSON
    const data = parsedData;

    if (!response.ok) {
      console.error(`External API error: ${response.status}`, data);
      // Construct a primary error message for the client from the external API's response
      const externalErrorMessage = data?.message || data?.error || data?.title || data?.detail || response.statusText || `External API Error ${response.status}`;
      return NextResponse.json({ error: externalErrorMessage, details: data }, { status: response.status });
    }
    
    // Response is OK (2xx) and JSON has been parsed
    // API doc says: "returns an array of user profiles". Assuming it's in data.data or similar
    // Example from docs shows direct array, but many APIs wrap in a 'data' object.
    // Check for 'data' key first, then if the root is an array.
    let usersArray: any[] | undefined;

    if (data && Array.isArray(data.data)) { // Common pattern: { data: [ ...users... ] }
        usersArray = data.data;
    } else if (Array.isArray(data)) { // API returns array directly at the root
        usersArray = data;
    }

    if (usersArray) {
        const usernames = usersArray.map((user: any) => user.username).filter(Boolean); // Filter out any null/undefined usernames
        return NextResponse.json({ followings: usernames });
    } else {
        // Successful (2xx) response from external API, but unexpected JSON structure.
        console.warn('Unexpected data structure from external API after successful fetch. Expected an array of users, possibly under a "data" key or at the root.', data);
        return NextResponse.json({ 
            error: 'Bad Gateway: Upstream API response has unexpected structure.', 
            details: { message: "The list of followings could not be extracted due to an unexpected data format from the external service.", receivedData: data }
        }, { status: 502 }); // 502 Bad Gateway
    }

  } catch (error: any) {
    console.error('Error fetching from external API proxy:', error);
    // Handle potential network errors or other exceptions during fetch
    return NextResponse.json({ error: 'Service Unavailable: Internal server error while contacting external API.', details: { message: error.message, type: error.name } }, { status: 503 }); // 503 Service Unavailable
  }
}
