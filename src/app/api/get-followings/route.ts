
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
    return NextResponse.json({ 
      error: 'API Key Not Configured', 
      details: { 
        title: "Server Configuration Error", 
        message: "The SOCIALDATA_API_KEY is missing from the server's environment variables. Please ensure it is set correctly for the application to authenticate with the external service." 
      } 
    }, { status: 500 });
  }

  const externalApiUrl = `https://api.socialdata.tools/twitter/friends/list?user_id=${username}`;
  console.log(`Attempting to fetch followings for username: ${username}. API URL: ${externalApiUrl}`);

  try {
    const response = await fetch(externalApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    const responseBody = await response.text();
    let parsedData: any;

    try {
        parsedData = JSON.parse(responseBody);
    } catch (e) {
        if (!response.ok) {
            console.error(`External API error: ${response.status}. Response not JSON:`, responseBody);
            const errorMsg = responseBody.length < 200 ? responseBody : response.statusText;
            return NextResponse.json({ 
                error: `External API error (${response.status}): ${errorMsg}`, 
                details: { message: `The external API returned status ${response.statusText} but the response body could not be parsed as JSON.`, bodyPreview: responseBody.substring(0, 500) }
            }, { status: response.status });
        }
        console.error('External API success response (2xx) was not JSON:', responseBody);
        return NextResponse.json({ 
            error: 'Bad Gateway: Upstream API sent an invalid success response.', 
            details: { message: "The external API returned a success status, but its response body was not valid JSON.", bodyPreview: responseBody.substring(0, 500) }
        }, { status: 502 });
    }
    
    const data = parsedData;

    if (!response.ok) {
      console.error(`External API error: ${response.status}`, data);

      if (response.status === 400) {
        console.warn(`External API returned 400 Bad Request. Possible issue with user_id format ('${username}') or other parameters. Details:`, data);
      } else if (response.status === 401 || response.status === 403) {
        console.warn(`External API returned ${response.status}. Authentication/Authorization issue. API Key may be invalid or lack permissions. Details:`, data);
      } else if (response.status === 404) {
        console.warn(`External API returned 404 Not Found. User '${username}' may not exist or endpoint is incorrect. Details:`, data);
      }
      
      let externalErrorMessage = response.statusText || `External API Error ${response.status}`;
      if (data) {
        if (typeof data.message === 'string' && data.message) externalErrorMessage = data.message;
        else if (typeof data.error === 'string' && data.error) externalErrorMessage = data.error;
        else if (typeof data.error_message === 'string' && data.error_message) externalErrorMessage = data.error_message;
        else if (typeof data.title === 'string' && data.title) externalErrorMessage = data.title;
        else if (typeof data.detail === 'string' && data.detail) externalErrorMessage = data.detail;
        else if (Array.isArray(data.errors) && data.errors.length > 0 && typeof data.errors[0].message === 'string' && data.errors[0].message) {
          externalErrorMessage = data.errors[0].message;
        }
      }
      return NextResponse.json({ error: externalErrorMessage, details: data }, { status: response.status });
    }
    
    let usersArray: any[] | undefined;
    if (data && Array.isArray(data.data)) {
        usersArray = data.data;
    } else if (Array.isArray(data)) { 
        usersArray = data;
    }

    if (usersArray) {
        const usernames = usersArray.map((user: any) => user.username).filter(Boolean);
        return NextResponse.json({ followings: usernames });
    } else {
        console.warn('Unexpected data structure from external API after successful fetch. Expected an array of users, possibly under a "data" key or at the root.', data);
        return NextResponse.json({ 
            error: 'Bad Gateway: Upstream API response has unexpected structure.', 
            details: { message: "The list of followings could not be extracted due to an unexpected data format from the external service.", receivedData: data }
        }, { status: 502 });
    }

  } catch (error: any) {
    console.error('Error fetching from external API proxy:', error);
    return NextResponse.json({ error: 'Service Unavailable: Internal server error while contacting external API.', details: { message: error.message, type: error.name } }, { status: 503 });
  }
}
