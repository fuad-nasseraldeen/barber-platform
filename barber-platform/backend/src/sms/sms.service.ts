import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** sms.to allows only alphanumeric + spaces. Hebrew/other chars are stripped. */
function sanitizeSenderId(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const sanitized = raw.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 11);
  return sanitized || undefined;
}

@Injectable()
export class SmsService {
  constructor(private readonly config: ConfigService) {}

  async send(phone: string, message: string, senderId?: string): Promise<void> {
    const apiKey = this.config.get('SMS_TO_API_KEY');
    const isDev = this.config.get('NODE_ENV') === 'development';
    const skipSms = this.config.get('SMS_SKIP_SEND') === 'true';

    if (!apiKey) {
      console.log(`[SMS] To ${phone}: ${message.slice(0, 80)}... (SMS_TO_API_KEY not set)`);
      return;
    }

    if (skipSms && isDev) {
      console.log(`[SMS] DEV: Skipping send. To ${phone}: ${message.slice(0, 80)}...`);
      return;
    }

    try {
      const res = await fetch('https://api.sms.to/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          to: phone,
          message,
          sender_id: sanitizeSenderId(senderId) || this.config.get('SMS_SENDER_ID') ,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[SMS] Send failed:', res.status, err);
        if (isDev) {
          const codeMatch = message.match(/verification code is: (\d+)/);
          console.log(`[SMS] DEV: SMS לא נשלח. השתמש בקוד מהטרמינל: ${codeMatch?.[1] ?? message.slice(0, 80)}`);
          return;
        }
        throw new Error(`SMS send failed: ${res.status}`);
      }
    } catch (e) {
      console.error('[SMS] Error:', e);
      if (isDev) {
        const codeMatch = message.match(/verification code is: (\d+)/);
        console.log(`[SMS] DEV: SMS לא נשלח. השתמש בקוד מהטרמינל: ${codeMatch?.[1] ?? message.slice(0, 80)}`);
        return;
      }
      throw e;
    }
  }

  async sendOtp(phone: string, code: string, senderId?: string): Promise<void> {
    const message = `Your verification code is: ${code}. Valid for 5 minutes.`;
    await this.send(phone, message, senderId);
  }
}
