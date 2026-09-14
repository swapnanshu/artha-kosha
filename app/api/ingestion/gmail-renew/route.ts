import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/src/lib/firebase-admin';
import { decrypt, encrypt } from '@/src/lib/encryption';
import { google } from 'googleapis';
import firebaseConfig from '@/firebase-applet-config.json';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');

    // Protect scheduler route with webhook secret
    if (!secret || secret !== process.env.SMS_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized: Invalid secret' }, { status: 401 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Google OAuth credentials not configured' }, { status: 500 });
    }

    const usersSnap = await adminDb.collection('users').get();
    let renewalCount = 0;

    const projectId = firebaseConfig.projectId;
    const topicName = `projects/${projectId}/topics/gmail-notifications`;
    const nowMs = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      const encryptedTokens = userData.gmailRefreshTokens || [];
      const watchExpirations = userData.gmailWatchExpirations || [];
      
      let updatedExpirations = [...watchExpirations];
      let needsProfileUpdate = false;

      for (let i = 0; i < encryptedTokens.length; i++) {
        const expirationStr = watchExpirations[i];
        const expirationMs = expirationStr ? new Date(expirationStr).getTime() : 0;

        // Renew if expired or expiring within 24 hours
        if (expirationMs - nowMs < oneDayMs) {
          try {
            const decryptedToken = decrypt(encryptedTokens[i]);
            const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
            oauth2Client.setCredentials({ refresh_token: decryptedToken });

            // Call watch()
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
            const watchRes = await gmail.users.watch({
              userId: 'me',
              requestBody: {
                topicName,
                labelIds: ['INBOX']
              }
            });

            if (watchRes.data.expiration) {
              const newExpiration = new Date(Number(watchRes.data.expiration)).toISOString();
              updatedExpirations[i] = newExpiration;
              needsProfileUpdate = true;
              renewalCount++;
            }
          } catch (err) {
            console.error(`Failed to renew Gmail watch for user ${uid}, token index ${i}:`, err);
          }
        }
      }

      if (needsProfileUpdate) {
        await userDoc.ref.update({
          gmailWatchExpirations: updatedExpirations
        });
      }
    }

    return NextResponse.json({ success: true, renewed: renewalCount });
  } catch (error) {
    console.error('Gmail Renewal Cron Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
