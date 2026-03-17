import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GoogleVerifierService } from './google-verifier.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { LinkPhoneDto } from './dto/link-phone.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly googleVerifier: GoogleVerifierService,
  ) {}

  @Post('demo')
  @HttpCode(HttpStatus.OK)
  async demoLogin() {
    return this.auth.demoLogin();
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
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, {
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleAuth(@Body() dto: GoogleAuthDto) {
    const profile = await this.googleVerifier.verifyIdToken(
      dto.credential,
      dto.nonce,
    );
    return this.auth.googleAuth(profile);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken ?? '');
  }

  @Post('link-google')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async linkGoogle(
    @Request() req: { user: { id: string } },
    @Body() dto: GoogleAuthDto,
  ) {
    const profile = await this.googleVerifier.verifyIdToken(
      dto.credential,
      dto.nonce,
    );
    return this.auth.linkGoogle(req.user.id, profile);
  }

  @Post('link-phone')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async linkPhone(
    @Request() req: { user: { id: string } },
    @Body() dto: LinkPhoneDto,
  ) {
    return this.auth.linkPhone(req.user.id, dto.phone, dto.code);
  }
}
