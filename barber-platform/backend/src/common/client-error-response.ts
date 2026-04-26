import { HttpStatus } from '@nestjs/common';

/** Machine-readable codes for clients (toast / i18n). */
export const CLIENT_ERROR_CODES = {
  BOOKING_INVALID_REQUEST: 'BOOKING_INVALID_REQUEST',
  VALIDATION_GENERIC: 'VALIDATION_GENERIC',
} as const;

function looksLikeClassValidatorWhitelistNoise(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('should not exist') ||
    t.includes('must be a uuid') ||
    t.includes('must be an uuid') ||
    (t.includes('must be') && t.includes('uuid'))
  );
}

/** Finalize booking: POST .../appointments/create | .../appointments/book | .../book (see BookingController). */
function isBookingConfirmPath(urlPath: string): boolean {
  const p = urlPath.split('?')[0].replace(/\/$/, '');
  return (
    p.endsWith('/appointments/create') ||
    p.endsWith('/appointments/book') ||
    p.endsWith('/book')
  );
}

/** Turn class-validator spam into one safe string + optional clientCode. */
export function buildPublicErrorBody(
  status: number,
  message: string | string[],
  requestUrl: string,
): {
  statusCode: number;
  message: string;
  error: string;
  clientCode?: string;
  code?: string;
  refreshAvailability?: boolean;
} {
  const rawParts = Array.isArray(message) ? message : [message];
  const joined = rawParts.join(' ');

  const errorName =
    (HttpStatus as unknown as Record<number, string>)[status] || 'Error';

  if (
    status === HttpStatus.BAD_REQUEST &&
    looksLikeClassValidatorWhitelistNoise(joined)
  ) {
    const booking = isBookingConfirmPath(requestUrl);
    if (booking) {
      return {
        statusCode: status,
        message:
          'Could not complete booking. Please choose a time slot again or refresh the page.',
        error: errorName,
        clientCode: CLIENT_ERROR_CODES.BOOKING_INVALID_REQUEST,
      };
    }
    return {
      statusCode: status,
      message: 'Invalid request. Please check your information and try again.',
      error: errorName,
      clientCode: CLIENT_ERROR_CODES.VALIDATION_GENERIC,
    };
  }

  return {
    statusCode: status,
    message: Array.isArray(message) ? rawParts.join(', ') : String(message),
    error: errorName,
  };
}
