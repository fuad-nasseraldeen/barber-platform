import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

type SettingsShape = {
  generalSettings?: { sendArrivalConfirmationSms?: boolean };
  arrivalConfirmation?: { template?: string };
};

@Injectable()
export class ArrivalConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  /**
   * Send arrival confirmation SMS when appointment is booked, if enabled.
   * Replaces all template placeholders with real appointment data.
   */
  async sendIfEnabled(appointmentId: string): Promise<void> {
    const apt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: { select: { firstName: true, lastName: true, phone: true, gender: true } },
        staff: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
        branch: { select: { name: true, address: true, street: true, city: true } },
        location: { select: { name: true, address: true, city: true } },
        business: { select: { name: true, settings: true, locale: true } },
      },
    });

    if (!apt?.customer?.phone) return;

    const settings = apt.business.settings as SettingsShape | null;
    const sendOn = settings?.generalSettings?.sendArrivalConfirmationSms;
    const template = settings?.arrivalConfirmation?.template;

    if (!sendOn || !template?.trim()) return;

    const message = this.replacePlaceholders(template, apt);
    await this.sms.send(apt.customer.phone, message).catch((e) => {
      console.error('[ArrivalConfirmation] SMS failed:', e);
    });
  }

  private replacePlaceholders(
    template: string,
    apt: {
      startTime: Date;
      customer: { firstName: string | null; lastName: string | null; gender: string | null };
      staff: { firstName: string; lastName: string };
      service: { name: string };
      branch: { name: string; address: string | null; street: string | null; city: string | null } | null;
      location: { name: string; address: string | null; city: string | null } | null;
      business: { name: string; locale: string };
    },
  ): string {
    const locale = apt.business.locale || 'he';
    const isFemale = apt.customer.gender === 'FEMALE';

    const customerName = [apt.customer.firstName, apt.customer.lastName].filter(Boolean).join(' ') || 'לקוח';
    const staffName = [apt.staff.firstName, apt.staff.lastName].filter(Boolean).join(' ') || '';
    const startTime = apt.startTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const branchName = apt.branch?.name ?? apt.location?.name ?? '';
    const serviceName = apt.service.name;
    const businessName = apt.business.name;

    const aptDate = new Date(apt.startTime);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const aptDay = new Date(aptDate);
    aptDay.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrTomorrow =
      aptDay.getTime() === today.getTime()
        ? locale === 'he'
          ? 'היום'
          : locale === 'ar'
            ? 'اليوم'
            : 'Today'
        : aptDay.getTime() === tomorrow.getTime()
          ? locale === 'he'
            ? 'מחר'
            : locale === 'ar'
              ? 'غداً'
              : 'Tomorrow'
          : aptDate.toLocaleDateString(locale, { weekday: 'long' });

    const dayName = aptDate.toLocaleDateString(locale, { weekday: 'long' });

    const canMf = isFemale ? (locale === 'he' ? 'יכולה' : locale === 'ar' ? 'تستطيعين' : 'can') : locale === 'he' ? 'יכול' : locale === 'ar' ? 'يستطيع' : 'can';
    const youMf = isFemale ? (locale === 'he' ? 'את' : locale === 'ar' ? 'أنتِ' : 'you') : locale === 'he' ? 'אתה' : locale === 'ar' ? 'أنت' : 'you';
    const arrivingMf = isFemale ? (locale === 'he' ? 'מגיעה' : locale === 'ar' ? 'قادمة' : 'arriving') : locale === 'he' ? 'מגיע' : locale === 'ar' ? 'قادم' : 'arriving';

    let address = apt.branch?.address ?? '';
    if (!address && apt.branch) {
      const parts = [apt.branch.street, apt.branch.city].filter(Boolean);
      if (parts.length) address = parts.join(', ');
    }
    if (!address) address = apt.location?.address ?? apt.location?.city ?? '';

    return template
      .replace(/\{\{customerName\}\}/g, customerName)
      .replace(/\{\{staffName\}\}/g, staffName)
      .replace(/\{\{startTime\}\}/g, startTime)
      .replace(/\{\{branchName\}\}/g, branchName)
      .replace(/\{\{serviceName\}\}/g, serviceName)
      .replace(/\{\{todayOrTomorrow\}\}/g, todayOrTomorrow)
      .replace(/\{\{dayName\}\}/g, dayName)
      .replace(/\{\{businessName\}\}/g, businessName)
      .replace(/\{\{canMf\}\}/g, canMf)
      .replace(/\{\{youMf\}\}/g, youMf)
      .replace(/\{\{arrivingMf\}\}/g, arrivingMf)
      .replace(/\{\{address\}\}/g, address);
  }
}
