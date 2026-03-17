import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService) {}

  async send(params: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void> {
    const apiKey = this.config.get('RESEND_API_KEY');

    if (!apiKey) {
      console.log(
        `[Email] To ${params.to}: ${params.subject} (RESEND_API_KEY not set)`,
      );
      return;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: this.config.get('EMAIL_FROM', 'notifications@example.com'),
          to: params.to,
          subject: params.subject,
          text: params.text,
          html: params.html ?? params.text,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[Email] Send failed:', err);
        throw new Error(`Email send failed: ${res.status}`);
      }
    } catch (e) {
      console.error('[Email] Error:', e);
      throw e;
    }
  }
}
