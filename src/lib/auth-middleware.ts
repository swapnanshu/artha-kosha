import { NextRequest } from 'next/server';
import { adminAuth } from './firebase-admin';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 401) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

export async function verifyAuthAndGetUid(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Unauthorized: Missing or invalid token format', 401);
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    throw new AuthError('Unauthorized: Invalid token', 401);
  }
}
