// Values from thunderid-config/bank-sample.yaml.
export const config = {
  // The SDK talks to ThunderID directly (the portal's origin is allowed in the `cors` server config).
  // The registration flow calls go through the dev server proxy.
  thunderidUrl: 'https://localhost:8090',
  // The gate hosts the sign-in and sign-up pages. The release serves it from ThunderID itself.
  gateUrl: 'https://localhost:8090/gate',
  clientId: 'bank-portal',
  applicationId: '01990000-ba4c-7000-8000-000000000002',
  // The bank API's resource identifier and the permissions the portal asks for.
  bankResource: 'https://bank.sample.local/api',
  // `group` puts the user's groups in the ID token, so the portal can tell an administrator. `system` is
  // granted only to users who hold it, and only on a token for ThunderID's own API (see systemResource).
  scopes: ['openid', 'profile', 'email', 'group', 'bank:read', 'bank:write', 'system'],
  // A token has one audience. Customers sign in for the bank API; the admin dashboard signs in again for
  // ThunderID's management API, whose resource identifier is this.
  systemResource: 'https://localhost:8090/mcp',
  adminGroup: 'Administrators',
  // ThunderID's built-in administration flows (backend/cmd/server/bootstrap/01-default-resources.yaml).
  // Administrators suspend, lift and unlock accounts by running them; there are no direct endpoints.
  flows: {
    userSuspend: '01900000-0000-7000-8000-000000000088',
    userUnsuspend: '01900000-0000-7000-8000-000000000089',
    userUnlock: '01900000-0000-7000-8000-000000000087',
    agentSuspend: '01900000-0000-7000-8000-000000000082',
    agentUnsuspend: '01900000-0000-7000-8000-000000000083',
    agentUnlock: '01900000-0000-7000-8000-000000000086',
  },
};
