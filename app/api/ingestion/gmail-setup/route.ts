import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthAndGetUid, AuthError } from '@/src/lib/auth-middleware';
import { getUserDoc } from '@/src/lib/firestore';
import { encrypt } from '@/src/lib/encryption';
import { google } from 'googleapis';
import firebaseConfig from '@/firebase-applet-config.json';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuthAndGetUid(req);
    const { code, redirectUri } = await req.json();

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('Google OAuth credentials not configured in environment. Running in sandbox mode.');
      // Sandbox mode: Save a mock refresh token so the front-end onboarding can proceed
      const userRef = getUserDoc(uid);
      const fakeToken = encrypt('mock-refresh-token-' + Date.now());
      await userRef.set({
        gmailRefreshTokens: [fakeToken],
        gmailWatchExpirations: [new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()]
      }, { merge: true });

      return NextResponse.json({ 
        success: true, 
        sandbox: true, 
        message: 'Sandbox mode activated: Mock token registered.' 
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri || `${process.env.APP_URL}/oauth2callback`
    );

    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return NextResponse.json({ 
        error: 'No refresh token returned. Ensure you requested offline access (prompt=consent).' 
      }, { status: 400 });
    }

    // Encrypt and store refresh token
    const encryptedToken = encrypt(refreshToken);
    const userRef = getUserDoc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const existingTokens = userData?.gmailRefreshTokens || [];
    const existingExpirations = userData?.gmailWatchExpirations || [];

    // Register watch with Gmail API
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    let userEmail = '';
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      userEmail = userInfo.data.email || '';
    } catch (uiErr) {
      console.error('Failed to get userinfo email:', uiErr);
    }

    // Topic name must be: projects/<project-id>/topics/gmail-notifications
    const projectId = firebaseConfig.projectId;
    const topicName = `projects/${projectId}/topics/gmail-notifications`;
    
    let watchExpiration = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    let initialHistoryId = '';
    
    try {
      const watchRes = await gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName,
          labelIds: ['INBOX']
        }
      });
      if (watchRes.data.expiration) {
        watchExpiration = new Date(Number(watchRes.data.expiration)).toISOString();
      }
      if (watchRes.data.historyId) {
        initialHistoryId = String(watchRes.data.historyId);
      }
    } catch (watchErr) {
      console.error('Gmail API users.watch failed:', watchErr);
      // We still save the refresh token because we can sync on-demand even if Pub/Sub push fails
    }

    // Add new token and expiration
    existingTokens.push(encryptedToken);
    existingExpirations.push(watchExpiration);

    const connectedEmails: string[] = userData?.connectedEmails || [];
    if (userEmail && !connectedEmails.includes(userEmail)) {
      connectedEmails.push(userEmail);
    }

    const gmailLastHistoryId: Record<string, string> = userData?.gmailLastHistoryId || {};
    if (userEmail && initialHistoryId) {
      gmailLastHistoryId[userEmail] = initialHistoryId;
    }

    await userRef.set({
      gmailRefreshTokens: existingTokens,
      gmailWatchExpirations: existingExpirations,
      connectedEmails,
      gmailLastHistoryId,
    }, { merge: true });

    return NextResponse.json({ success: true, expiration: watchExpiration, email: userEmail });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Gmail Setup Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
