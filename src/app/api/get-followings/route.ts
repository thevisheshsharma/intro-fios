
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get('username');

  if (!username) {
    return NextResponse.json({ error: 'Username is required' }, { status: 400 });
  }

  const apiKey = process.env.SOCIALDATA_API_KEY;
  if (!apiKey) {
    console.error('SOCIALDATA_API_KEY is not set in environment variables.');
    return NextResponse.json({ error: 'Server configuration error: API key missing.', details: { title: "Forbidden", message: "The server is not configured correctly to access the external API."} }, { status: 500 });
  }

  const externalApiUrl = `https://api.socialdata.tools/twitter/user/followings/${username}`;

  try {
    const response = await fetch(externalApiUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    const responseBody = await response.text();
    let parsedData;

    try {
        parsedData = JSON.parse(responseBody);
    } catch (e) {
        if (!response.ok) {
            // External API returned an error status AND non-JSON body
            console.error(`External API error: ${response.status}. Response not JSON:`, responseBody);
            return NextResponse.json({ 
                error: `External API error (${response.status}): Response body was not valid JSON.`, 
                details: { message: `The external API returned status ${response.statusText} but the response body could not be parsed as JSON.`, body: responseBody }
            }, { status: response.status });
        }
        // External API returned 2xx status BUT non-JSON body (malformed success response)
        console.error('External API success response (2xx) was not JSON:', responseBody);
        return NextResponse.json({ 
            error: 'Bad Gateway: Upstream API sent an invalid success response.', 
            details: { message: "The external API returned a success status, but its response body was not valid JSON.", body: responseBody }
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
    // Based on socialdata.tools documentation for /twitter/user/followings/{username}
    // The response is: { data: { users: [ { username: "..." }, ... ] } }
    if (data && data.data && Array.isArray(data.data.users)) {
        const usernames = data.data.users.map((user: any) => user.username).filter(Boolean); // Filter out any null/undefined usernames
        return NextResponse.json({ followings: usernames });
    } else {
        // Successful (2xx) response from external API, but unexpected JSON structure.
        console.warn('Unexpected data structure from external API after successful fetch:', data);
        return NextResponse.json({ 
            error: 'Bad Gateway: Upstream API response has unexpected structure.', 
            details: { message: "The list of followings could not be extracted due to an unexpected data format from the external service.", receivedData: data }
        }, { status: 502 }); // 502 Bad Gateway
    }

  } catch (error: any) {
    console.error('Error fetching from external API proxy:', error);
    // Handle potential network errors or other exceptions during fetch
    return NextResponse.json({ error: 'Service Unavailable: Internal server error while contacting external API.', details: { message: error.message } }, { status: 503 }); // 503 Service Unavailable
  }
}
    