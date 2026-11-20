import * as oidc from 'openid-client';
import { requiredEnv } from '../config';

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

function authUrl(name: string) {
  const url = new URL(requiredEnv(name));
  if (url.username || url.password || url.hash || url.search ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback.has(url.hostname)))) {
    throw new Error(`Invalid server URL for ${name}`);
  }
  return url;
}

export function appOrigin() {
  const url = authUrl('APP_ORIGIN');
  if (url.pathname !== '/') throw new Error('APP_ORIGIN must be an origin');
  return url.origin;
}

export const callbackUrl = () => new URL('/auth/callback', appOrigin()).href;

let resolved: Promise<oidc.Configuration> | undefined;

export function oidcClient() {
  if (resolved) return resolved;
  const issuer = authUrl('KEYCLOAK_ISSUER');
  const secret = requiredEnv('APP_OIDC_SECRET');
  const execute = [oidc.enableNonRepudiationChecks];
  if (issuer.protocol === 'http:') execute.unshift(oidc.allowInsecureRequests);
  resolved = oidc.discovery(issuer, requiredEnv('APP_OIDC_CLIENT_ID'), secret,
    oidc.ClientSecretBasic(secret), { execute })
    .then(config => {
      config.timeout = 5;
      return config;
    }).catch(error => {
      resolved = undefined;
      throw error;
    });
  return resolved;
}
