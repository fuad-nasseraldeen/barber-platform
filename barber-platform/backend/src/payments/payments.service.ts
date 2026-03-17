import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentIntentDto } from './dto/create-intent.dto';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret = this.config.get('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secret || 'sk_test_placeholder');
  }

  /**
   * Create a Stripe PaymentIntent for an appointment.
   * Supports deposits (partial) or full payments.
   */
  async createPaymentIntent(dto: CreatePaymentIntentDto) {
    await this.ensureAppointmentExists(dto.appointmentId, dto.businessId, dto.customerId);

    const existingPayment = await this.prisma.payment.findFirst({
      where: { appointmentId: dto.appointmentId },
    });
    if (existingPayment?.status === 'SUCCEEDED') {
      throw new BadRequestException('Appointment already paid');
    }

    const amountCents = Math.round(dto.amount * 100);
    const currency = (dto.currency ?? 'USD').toLowerCase();
    const type = dto.type ?? 'FULL';

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        businessId: dto.businessId,
        appointmentId: dto.appointmentId,
        customerId: dto.customerId,
        type,
      },
      ...(dto.returnUrl && { return_url: dto.returnUrl }),
    });

    let payment = await this.prisma.payment.findFirst({
      where: { appointmentId: dto.appointmentId },
    });

    if (payment) {
      payment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          amount: dto.amount,
          currency: currency.toUpperCase(),
          type: type as 'DEPOSIT' | 'FULL',
          status: 'PENDING',
          stripePaymentIntentId: paymentIntent.id,
          metadata: { stripeClientSecret: paymentIntent.client_secret },
        },
      });
    } else {
      payment = await this.prisma.payment.create({
        data: {
          businessId: dto.businessId,
          customerId: dto.customerId,
          appointmentId: dto.appointmentId,
          amount: dto.amount,
          currency: currency.toUpperCase(),
          type: type as 'DEPOSIT' | 'FULL',
          status: 'PENDING',
          stripePaymentIntentId: paymentIntent.id,
          metadata: { stripeClientSecret: paymentIntent.client_secret },
        },
      });
    }

    await this.prisma.appointment.update({
      where: { id: dto.appointmentId },
      data: { paymentId: payment.id },
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      paymentId: payment.id,
    };
  }

  /**
   * Handle Stripe webhook events.
   */
  async handleWebhook(payload: Buffer, signature: string) {
    const webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new BadRequestException('Webhook secret not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new BadRequestException(`Webhook signature verification failed: ${message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.canceled':
        await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        // Ignore other events
        break;
    }

    return { received: true };
  }

  private async handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
    const payment = await this.prisma.payment.findFirst({
      where: { stripePaymentIntentId: pi.id },
      include: { appointment: true },
    });

    if (!payment) return;

    const chargeId = pi.latest_charge
      ? typeof pi.latest_charge === 'string'
        ? pi.latest_charge
        : pi.latest_charge.id
      : null;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        stripeChargeId: chargeId,
        metadata: (() => {
          const m = (payment.metadata as Record<string, unknown>) || {};
          const { stripeClientSecret: _, ...rest } = m;
          return rest as object;
        })(),
      },
    });

    if (payment.appointment) {
      await this.prisma.appointment.update({
        where: { id: payment.appointmentId! },
        data: { status: 'CONFIRMED' },
      });
    }
  }

  private async handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
    const payment = await this.prisma.payment.findFirst({
      where: { stripePaymentIntentId: pi.id },
    });

    if (!payment) return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });
  }

  private async handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
    const payment = await this.prisma.payment.findFirst({
      where: { stripePaymentIntentId: pi.id },
    });

    if (!payment) return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED' },
    });
  }

  private async ensureAppointmentExists(
    appointmentId: string,
    businessId: string,
    customerId: string,
  ) {
    const apt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!apt) {
      throw new NotFoundException('Appointment not found');
    }
    if (apt.businessId !== businessId) {
      throw new ForbiddenException('Appointment does not belong to this business');
    }
    if (apt.customerId !== customerId) {
      throw new ForbiddenException('Customer does not match appointment');
    }
  }
}
