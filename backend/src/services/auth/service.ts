import { AuthorizationError } from '@/errors/AuthorizationError';
import { AccessRepository } from '@/repositories/access/repository';

interface LoginResult {
  user: {
    id: string;
    email: string;
  };
  session: {
    accessToken: string;
    expiresIn: number;
  };
}

interface AuthProfile {
  user: {
    id: string;
    email: string;
  };
  memberships: Array<{
    organizationId: string;
    roleId: string;
    status: string;
  }>;
  permissions: Record<string, string[]>;
}

export class AuthService {
  constructor(private readonly accessRepository: AccessRepository = new AccessRepository()) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.accessRepository.signIn(email, password);
    return {
      user: {
        id: result.user.id,
        email: result.user.email ?? email
      },
      session: {
        accessToken: result.session.access_token,
        expiresIn: result.session.expires_in ?? 3600
      }
    };
  }

  async getProfile(user: { id: string; email: string }): Promise<AuthProfile> {
    const memberships = await this.accessRepository.listMemberships(user.id);
    const permissions = await this.accessRepository.listPermissionsByOrganization(user.id);

    if (memberships.length === 0) {
      throw new AuthorizationError('Authenticated user does not have any active organization memberships');
    }

    return {
      user,
      memberships,
      permissions
    };
  }

  logout() {
    return {
      success: true
    };
  }
}
