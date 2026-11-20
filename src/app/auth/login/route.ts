import { NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { appOrigin, callbackUrl, oidcClient } from '../../../server/auth/oidc';
import { attemptTtl, flowCookie, saveAttempt, setAuthCookie } from '../../../server/auth/session';

export async function GET() {
  try {
    const config = await oidcClient();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const authorize = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callbackUrl(), scope: 'openid', state, nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256', ui_locales: 'vi'
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
