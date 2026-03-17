import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  id: string;
  email?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
}

const VALID_ISSUERS = [
  'accounts.google.com',
  'https://accounts.google.com',
];

@Injectable()
export class GoogleVerifierService {
  private readonly client: OAuth2Client;
  private readonly clientId: string;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    this.client = new OAuth2Client(this.clientId);
  }

  async verifyIdToken(
    credential: string,
    expectedNonce: string,
  ): Promise<GoogleProfile> {
    if (!credential?.trim()) {
      throw new UnauthorizedException('Missing credential');
    }

    if (!expectedNonce?.trim()) {
      throw new UnauthorizedException('Missing nonce');
    }

    let ticket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience: this.clientId,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google token verification failed';
      if (
        msg.includes('expired') ||
        msg.includes('Token used too late') ||
        msg.includes('exp')
      ) {
        throw new UnauthorizedException('Token expired');
      }
      if (msg.includes('audience') || msg.includes('aud')) {
        throw new UnauthorizedException('Invalid token audience');
      }
      throw new UnauthorizedException('Invalid Google token');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const iss = payload.iss;
    if (!iss || !VALID_ISSUERS.includes(iss)) {
      throw new UnauthorizedException('Invalid token issuer');
    }

    if (payload.email_verified !== true) {
      throw new UnauthorizedException('Email not verified');
    }

    const tokenNonce = payload.nonce;
    if (!tokenNonce || tokenNonce !== expectedNonce) {
      throw new UnauthorizedException('Invalid nonce');
    }

    return {
      id: payload.sub,
      email: payload.email,
      givenName: payload.given_name,
      familyName: payload.family_name,
      picture: payload.picture,
    };
  }
}
