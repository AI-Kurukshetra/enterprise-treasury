export interface ClientSession {
  accessToken: string | null;
  userId: string | null;
  organizationId: string | null;
}

const sessionStorageKeys = ['atlas.session', 'atlas.auth', 'session'];
const preferredOrganizationStorageKey = 'atlas.organization-id';

export function getClientSession(): ClientSession {
  if (typeof window === 'undefined') {
    return {
      accessToken: null,
      userId: null,
      organizationId: null
    };
  }

  const rawSession = readStoredSession();
  const accessToken = extractAccessToken(rawSession) ?? readTokenFromCookies();

  return {
    accessToken,
    userId: extractUserId(rawSession, accessToken),
    organizationId: getPreferredOrganizationId()
  };
}

export function getPreferredOrganizationId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(preferredOrganizationStorageKey);
  if (stored) {
    return stored;
  }

  const cookieValue = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('atlas-organization-id='));

  if (!cookieValue) {
    return null;
  }

  return decodeURIComponent(cookieValue.split('=').slice(1).join('='));
}

export function setPreferredOrganizationId(organizationId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(preferredOrganizationStorageKey, organizationId);
  document.cookie = `atlas-organization-id=${encodeURIComponent(organizationId)}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
}

function readStoredSession(): unknown {
  for (const key of sessionStorageKeys) {
    const value = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    if (value) {
      const parsed = safeJsonParse(value);
      if (parsed) {
        return parsed;
      }
    }
  }

  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
      const value = window.localStorage.getItem(key);
      if (value) {
        const parsed = safeJsonParse(value);
        if (parsed) {
          return parsed;
        }
      }
    }
  }

  return null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractAccessToken(session: unknown): string | null {
  if (!session) {
    return null;
  }

  if (Array.isArray(session)) {
    for (const candidate of session) {
      const token = extractAccessToken(candidate);
      if (token) {
        return token;
      }
    }

    return null;
  }

  if (typeof session === 'object') {
    const record = session as Record<string, unknown>;
    const directToken = asString(record.access_token) ?? asString(record.accessToken);
    if (directToken) {
      return directToken;
    }

    const nestedSession = record.currentSession ?? record.session;
    if (nestedSession) {
      return extractAccessToken(nestedSession);
    }
  }

  return null;
}

function extractUserId(session: unknown, accessToken: string | null): string | null {
  if (session && typeof session === 'object') {
    const record = session as Record<string, unknown>;
    const directUserId = asString(record.user_id) ?? asString(record.userId);
    if (directUserId) {
      return directUserId;
    }

    const nestedUser = record.user as Record<string, unknown> | undefined;
    const nestedUserId = nestedUser ? asString(nestedUser.id) : null;
    if (nestedUserId) {
      return nestedUserId;
    }

    const nestedSession = record.currentSession ?? record.session;
    if (nestedSession) {
      const nestedSessionUserId = extractUserId(nestedSession, accessToken);
      if (nestedSessionUserId) {
        return nestedSessionUserId;
      }
    }
  }

  if (!accessToken) {
    return null;
  }

  const segments = accessToken.split('.');
  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(atob(segments[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    return asString(payload.sub);
  } catch {
    return null;
  }
}

function readTokenFromCookies(): string | null {
  const accessTokenCookie = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('atlas-access-token='));

  if (!accessTokenCookie) {
    return null;
  }

  return decodeURIComponent(accessTokenCookie.split('=').slice(1).join('='));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
