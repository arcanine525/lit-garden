import { NextRequest, NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { appOrigin, callbackUrl, oidcClient } from '../../../server/auth/oidc';
import { attemptTtl, flowCookie, sessionCookie, saveAttempt, setAuthCookie } from '../../../server/auth/session';

export async function GET(request: NextRequest) {
  try {
    const config = await oidcClient();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const authorize = oidc.buildAuthorizationUrl(config, {
      ...(request.cookies.has(sessionCookie) ? { prompt: 'login' } : {}),
      redirect_uri: callbackUrl(), scope: 'openid', state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256', max_age: '300', ui_locales: 'vi'
    });
    const handle = await saveAttempt({ verifier, state, nonce });
    const response = NextResponse.redirect(authorize);
    setAuthCookie(response, flowCookie, handle, attemptTtl);
    return response;
  } catch {
    return NextResponse.redirect(new URL('/?auth=unavailable', appOrigin()), {
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
