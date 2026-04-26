import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService, AuthTokens } from './auth.service';
import { AuthCookieService, REFRESH_TOKEN_COOKIE } from './auth-cookie.service';
import { GoogleVerifierService } from './google-verifier.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { LinkPhoneDto } from './dto/link-phone.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Public auth payload (refresh token only in HttpOnly cookie). */
type AuthResponseBody = Omit<AuthTokens, 'refreshToken'>;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly googleVerifier: GoogleVerifierService,
    private readonly authCookie: AuthCookieService,
  ) {}

  private toBody(tokens: AuthTokens): AuthResponseBody {
    const { refreshToken: _r, ...rest } = tokens;
    return rest;
  }

  private withRefreshCookie(res: Response, tokens: AuthTokens): AuthResponseBody {
    this.authCookie.setRefreshToken(res, tokens.refreshToken);
    return this.toBody(tokens);
  }

  @Post('demo')
  @HttpCode(HttpStatus.OK)
  async demoLogin(@Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.demoLogin();
    return this.withRefreshCookie(res, tokens);
  }

  @Post('request-otp')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone, dto.senderId);
  }

  @Post('verify-otp')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.verifyOtp(dto.phone, dto.code, {
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    return this.withRefreshCookie(res, tokens);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleAuth(
    @Body() dto: GoogleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const profile = await this.googleVerifier.verifyIdToken(
      dto.credential,
      dto.nonce,
    );
    const tokens = await this.auth.googleAuth(profile);
    return this.withRefreshCookie(res, tokens);
  }

  /**
   * Rotation: validates opaque token in DB, revokes it, issues new access + new refresh (cookie).
   * Cookie preferred; body.refreshToken supported for non-browser clients (e.g. k6).
   */
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: RefreshTokenDto,
  ) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE] ?? body?.refreshToken;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('No refresh token');
    }
    const tokens = await this.auth.refreshTokens(token);
    return this.withRefreshCookie(res, tokens);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LogoutDto,
  ) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE] ?? dto?.refreshToken;
    await this.auth.logout(token);
    this.authCookie.clearRefreshToken(res);
    return { success: true };
  }

  @Post('link-google')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async linkGoogle(
    @Request() req: { user: { id: string } },
    @Body() dto: GoogleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const profile = await this.googleVerifier.verifyIdToken(
      dto.credential,
      dto.nonce,
    );
    const tokens = await this.auth.linkGoogle(req.user.id, profile);
    return this.withRefreshCookie(res, tokens);
  }

  @Post('link-phone')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async linkPhone(
    @Request() req: { user: { id: string } },
    @Body() dto: LinkPhoneDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.linkPhone(req.user.id, dto.phone, dto.code);
    return this.withRefreshCookie(res, tokens);
  }
}
