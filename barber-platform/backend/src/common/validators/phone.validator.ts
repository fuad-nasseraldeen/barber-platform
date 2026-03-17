import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Israeli local format (05xxxxxxxx) → E.164 (+9725xxxxxxxx) */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10 && digits[1] === '5') {
    return '+972' + digits.slice(1);
  }
  return phone;
}

export function IsE164(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isE164',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && E164_REGEX.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid E.164 phone number (e.g. +1234567890)`;
        },
      },
    });
  };
}

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}
