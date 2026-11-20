import { NextRequest, NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { requiredEnv } from '../../../server/config';
import { appOrigin, oidcClient } from '../../../server/auth/oidc';
import { revokeSession, sessionCookie, setAuthCookie } from '../../../server/auth/session';

export async function POST(request: NextRequest) {
  const origin = appOrigin();
  if (request.headers.get('origin') !== origin) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    await revokeSession(request.cookies.get(sessionCookie)?.value);
  } catch {
    return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const home = new URL('/', origin);
  let destination = home;
  try {
    destination = oidc.buildEndSessionUrl(await oidcClient(), {
      client_id: requiredEnv('APP_OIDC_CLIENT_ID'), post_logout_redirect_uri: home.href
    });
  } catch {
    // Local revocation is already committed if Keycloak is unavailable.
  }
  const response = NextResponse.redirect(destination, 303);
  setAuthCookie(response, sessionCookie, '', 0);
  return response;
}
