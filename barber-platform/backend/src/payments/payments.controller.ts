import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  RawBodyRequest,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Permissions } from '../common/decorators/roles.decorator';
import { CreatePaymentIntentDto } from './dto/create-intent.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('create-intent')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager', 'staff', 'customer')
  @Permissions('payment:create')
  async createIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.payments.createPaymentIntent(dto);
  }

  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new Error('Raw body required for webhook signature verification');
    }
    return this.payments.handleWebhook(rawBody, signature ?? '');
  }
}
