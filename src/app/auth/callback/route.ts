import { NextRequest, NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { appOrigin, callbackUrl, oidcClient } from '../../../server/auth/oidc';
import { consumeAttempt, createSession, flowCookie, sessionCookie, setAuthCookie } from '../../../server/auth/session';
import { database } from '../../../server/db';
import { findIdentity } from '../../../server/metadata';

export async function GET(request: NextRequest) {
  function redirect(path: string) {
    const response = NextResponse.redirect(new URL(path, appOrigin()));
    setAuthCookie(response, flowCookie, '', 0);
    return response;
  }

  const handle = request.cookies.get(flowCookie)?.value;
  const state = request.nextUrl.searchParams.get('state');
  if (!handle || !state) return redirect('/?auth=failed');
  try {
    const attempt = await consumeAttempt(handle, state);
    if (!attempt) return redirect('/?auth=failed');
    const redirectUri = new URL(callbackUrl());
    redirectUri.search = request.nextUrl.search;
    const config = await oidcClient();
    const tokens = await oidc.authorizationCodeGrant(config, redirectUri, {
      pkceCodeVerifier: attempt.verifier,
      expectedNonce: attempt.nonce,
      expectedState: attempt.state,
      idTokenExpected: true
    });
    const claims = tokens.claims();
    if (!claims) return redirect('/?auth=failed');
    const identity = await findIdentity(database(), claims.iss, claims.sub);
    const roles = Array.isArray(claims.garden_roles) ? claims.garden_roles : [];
    if (!identity || identity.status !== 'active' || !roles.includes(`garden-${identity.role}`)) {
      return redirect('/?auth=denied');
    }
    const session = await createSession(identity.id, identity.auth_epoch);
    if (!session) return redirect('/?auth=denied');
    const response = redirect('/');
    setAuthCookie(response, sessionCookie, session.handle, session.maxAge);
    return response;
  } catch {
    return redirect('/?auth=failed');
  }
}
