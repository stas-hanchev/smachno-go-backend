import { isCelebrateError } from 'celebrate';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { Prisma } from '../generated/prisma/client.js';
import { AppError, type ErrorDetail } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { captureError } from '../lib/sentry.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Маршрут не знайдено'));
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (isCelebrateError(err)) {
    const details: ErrorDetail[] = [];
    for (const [segment, joiError] of err.details) {
      for (const d of joiError.details) {
        details.push({ field: d.path.join('.') || segment, message: d.message });
      }
    }
    return new AppError('VALIDATION_ERROR', undefined, details);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return new AppError('NOT_FOUND');
    if (err.code === 'P2002') return new AppError('ORDER_STATE_CONFLICT', 'Такий запис вже існує');
    if (err.code === 'P2003') {
      return new AppError('BUSINESS_RULE', 'Запис використовується й не може бути видалений');
    }
  }

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError('VALIDATION_ERROR', 'Файл завеликий, максимум 5 МБ', [
        { field: err.field ?? 'file', message: 'Максимум 5 МБ' },
      ]);
    }
    return new AppError('VALIDATION_ERROR', 'Некоректне завантаження файлу', [
      { field: err.field ?? 'file', message: 'Надішліть один файл у полі file' },
    ]);
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return new AppError('VALIDATION_ERROR', 'Некоректний JSON у тілі запиту');
  }

  if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large') {
    return new AppError('VALIDATION_ERROR', 'Завеликий розмір запиту');
  }

  return new AppError('INTERNAL');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  if (appError.status >= 500) {
    logger.error({ err, requestId: req.id }, 'Unhandled error');
    captureError(err, { requestId: req.id, method: req.method, path: req.path });
  }
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details?.length ? { details: appError.details } : {}),
    },
  });
};
