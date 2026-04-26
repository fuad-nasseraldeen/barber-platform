import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  collectPrismaErrorText,
  findPrismaKnownRequestError,
  isConcurrencyOrDuplicateDbChain,
} from '../prisma-error-helpers';
import { buildPublicErrorBody } from '../client-error-response';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    let conflictExtra: { code?: string; refreshAvailability?: boolean } = {};
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'object' && res !== null && 'message' in res
        ? (res as { message: string | string[] }).message
        : String(res);
      if (typeof res === 'object' && res !== null) {
        const o = res as Record<string, unknown>;
        if (typeof o.code === 'string') conflictExtra.code = o.code;
        if (o.refreshAvailability === true) conflictExtra.refreshAvailability = true;
      }
    } else {
      /**
       * Prefer full-text detection first so PG 40001 + “serialize concurrent” always maps to 409
       * even when Prisma class identity / `code` shape differs between bundles.
       */
      const chain = [
        collectPrismaErrorText(exception),
        exception instanceof Error ? exception.message : '',
        exception instanceof Error ? String(exception.stack ?? '') : '',
      ].join(' | ');
      if (isConcurrencyOrDuplicateDbChain(chain)) {
        status = HttpStatus.CONFLICT;
        message = 'Slot already taken';
      } else {
        const prismaKnown = findPrismaKnownRequestError(exception);
        if (prismaKnown) {
          if (prismaKnown.code === 'P2002') {
            status = HttpStatus.CONFLICT;
            message = 'Slot already taken';
          } else if (prismaKnown.code === 'P2003') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Invalid reference';
          } else if (prismaKnown.code === 'P2034') {
            status = HttpStatus.CONFLICT;
            message = 'Slot already taken';
          } else if (isConcurrencyOrDuplicateDbChain(collectPrismaErrorText(exception))) {
            status = HttpStatus.CONFLICT;
            message = 'Slot already taken';
          } else {
            message = prismaKnown.message;
          }
        } else if (exception instanceof Error) {
          if (/\bP2003\b/.test(chain)) {
            status = HttpStatus.BAD_REQUEST;
            message = 'Invalid reference';
          } else {
            message = exception.message;
          }
        }
      }
    }

    const isAuthError = status === 401 || status === 403;
    const isDbError =
      exception instanceof Error &&
      (exception.message?.includes('Prisma') ||
        exception.message?.includes('database') ||
        exception.message?.includes('unique') ||
        exception.message?.includes('foreign'));

    if (isAuthError) {
      this.logger.warn(
        `[Auth] ${request.method} ${request.url} - ${status} - ${Array.isArray(message) ? message.join(', ') : message}`,
      );
    } else if (isDbError) {
      this.logger.error(
        `[Database] ${request.method} ${request.url} - ${exception instanceof Error ? exception.stack : message}`,
      );
    } else if (status >= 500) {
      this.logger.error(
        `[API] ${request.method} ${request.url} - ${status} - ${exception instanceof Error ? exception.stack : message}`,
      );
    }

    if (response.headersSent) {
      this.logger.warn(
        `[HttpExceptionFilter] Skip duplicate response: ${request.method} ${request.url} (headers already sent)`,
      );
      return;
    }

    const body = buildPublicErrorBody(status, message, request.url ?? '');
    response.status(status).json({ ...body, ...conflictExtra });
  }
}
