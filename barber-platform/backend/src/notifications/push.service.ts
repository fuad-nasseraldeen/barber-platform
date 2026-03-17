import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PushService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Send push notification via FCM (Firebase Cloud Messaging).
   * Requires FCM_SERVER_KEY or similar. Placeholder logs when not configured.
   */
  async send(params: {
    token: string;
    title: string;
    body?: string;
    data?: Record<string, string>;
  }): Promise<void> {
    const serverKey = this.config.get('FCM_SERVER_KEY');

    if (!serverKey) {
      console.log(
        `[Push] To token: ${params.title} (FCM_SERVER_KEY not set)`,
      );
      return;
    }

    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=${serverKey}`,
        },
        body: JSON.stringify({
          to: params.token,
          notification: {
            title: params.title,
            body: params.body,
          },
          data: params.data ?? {},
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[Push] Send failed:', err);
        throw new Error(`Push send failed: ${res.status}`);
      }
    } catch (e) {
      console.error('[Push] Error:', e);
      throw e;
    }
  }
}
