// Sign-in, sign-out and the session are the ThunderID Vue SDK's job (see session.js). This reads the
// tokens it holds.
import { config } from './config.js';

export function decodeJwt(token) {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// userFrom describes the signed-in user from the ID token's claims and the access token, whose subject is
// the user's ID and whose scope holds the permissions the token grants.
export function userFrom(idClaims, accessToken) {
  const access = decodeJwt(accessToken);
  const scopes = (access.scope ?? '').split(' ');
  const groups = idClaims.groups ?? [];
  return {
    id: access.sub,
    username: idClaims.username ?? idClaims.name,
    givenName: idClaims.given_name,
    familyName: idClaims.family_name,
    email: idClaims.email,
    permissions: scopes.filter((s) => s.startsWith('bank:')),
    // Whether the user belongs to the administrators' group, and whether this token is the one the
    // management API accepts (a `system` scope on a token for ThunderID's own resource).
    isAdmin: groups.includes(config.adminGroup),
    hasSystemAccess: scopes.includes('system') && access.aud === config.systemResource,
  };
}
