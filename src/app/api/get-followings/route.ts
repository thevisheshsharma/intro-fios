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

  // The API documentation indicates the endpoint requires the username directly
  const externalApiUrl = `https://api.socialdata.tools/twitter/user/followings/${username}`;

  try {
    const response = await fetch(externalApiUrl, {
      method: 'GET', // Explicitly GET
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json', // Good practice
      },
      cache: 'no-store', // Ensure fresh data
    });

    // Try to parse JSON regardless of status, as error responses are often JSON
    const responseBody = await response.text();
    let data;
    try {
        data = JSON.parse(responseBody);
    } catch (e) {
        // If JSON parsing fails, it might be a non-JSON error or empty response
        if (!response.ok) {
             console.error(`External API error: ${response.status}. Response not JSON:`, responseBody);
             return NextResponse.json({ error: `Failed to fetch data from external API: ${response.statusText}`, details: { message: "The external API returned a non-JSON error response.", body: responseBody }}, { status: response.status });
        }
        // If response.ok but not JSON (unlikely for this API), could be an issue
        console.warn('External API success response was not JSON:', responseBody);
        data = null; // Or handle as an error
    }


    if (!response.ok) {
      console.error(`External API error: ${response.status}`, data);
      // Pass through the error details from external API if available
      return NextResponse.json({ error: `Failed to fetch data: ${data?.title || response.statusText}`, details: data }, { status: response.status });
    }
    
    // Based on socialdata.tools documentation for /twitter/user/followings/{username}
    // The response is: { data: { users: [ { username: "..." }, ... ] } }
    if (data && data.data && Array.isArray(data.data.users)) {
        const usernames = data.data.users.map((user: any) => user.username).filter(Boolean); // Filter out any null/undefined usernames
        return NextResponse.json({ followings: usernames });
    } else {
        // This case implies a successful (2xx) response but unexpected structure.
        console.warn('Unexpected data structure from external API after successful fetch:', data);
        return NextResponse.json({ 
            error: 'Unexpected data structure received from the external API.', 
            details: { message: "The list of followings could not be extracted.", receivedData: data }
        }, { status: 200 }); // Or 500 if this is critical
    }

  } catch (error: any) {
    console.error('Error fetching from external API proxy:', error);
    // Handle potential network errors or other exceptions during fetch
    return NextResponse.json({ error: 'Internal server error while contacting external API.', details: { message: error.message } }, { status: 503 }); // 503 Service Unavailable
  }
}
