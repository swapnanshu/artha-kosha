import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const state = searchParams.get('state') || '';

    let clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (clientId && clientId.includes('"')) {
      clientId = clientId.split('"')[0];
    }

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Google OAuth credentials not configured in environment' },
        { status: 400 }
      );
    }

    // Must match gmail-setup route's default redirectUri (APP_URL/oauth2callback)
    // For correctness in local environments, we compute it from APP_URL if present.
    const appUrl = process.env.APP_URL || '';
    const redirectUri = appUrl ? `${appUrl.replace(/\/$/, '')}/oauth2callback` : '';

    if (!redirectUri) {
      return NextResponse.json(
        { error: 'APP_URL is not configured in environment' },
        { status: 400 }
      );
    }

    const scope = 'https://www.googleapis.com/auth/gmail.readonly';

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    if (state) url.searchParams.set('state', state);

    return NextResponse.json({ url: url.toString(), redirectUri });
  } catch (error) {
    console.error('Error in oauth-start:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
