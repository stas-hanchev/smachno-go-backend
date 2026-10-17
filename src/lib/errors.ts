export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_BLOCKED'
  | 'NOT_FOUND'
  | 'LISTING_UNAVAILABLE'
  | 'ORDER_STATE_CONFLICT'
  | 'EMAIL_TAKEN'
  | 'ALREADY_REVIEWED'
  | 'INVALID_TOKEN'
  | 'BUSINESS_RULE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

export interface ErrorDetail {
  field: string;
  message: string;
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_BLOCKED: 403,
  NOT_FOUND: 404,
  LISTING_UNAVAILABLE: 409,
  ORDER_STATE_CONFLICT: 409,
  EMAIL_TAKEN: 409,
  ALREADY_REVIEWED: 409,
  INVALID_TOKEN: 400,
  BUSINESS_RULE: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Перевірте правильність заповнення полів',
  UNAUTHORIZED: 'Потрібно увійти в обліковий запис',
  TOKEN_EXPIRED: 'Сесія завершилася, увійдіть знову',
  INVALID_CREDENTIALS: 'Неправильний email або пароль',
  FORBIDDEN: 'Недостатньо прав для цієї дії',
  EMAIL_NOT_VERIFIED: 'Підтвердіть email, щоб продовжити',
  ACCOUNT_BLOCKED: 'Обліковий запис заблоковано',
  NOT_FOUND: 'Не знайдено',
  LISTING_UNAVAILABLE: 'На жаль, ці набори вже розібрали',
  ORDER_STATE_CONFLICT: 'Цю дію не можна виконати для замовлення в поточному стані',
  EMAIL_TAKEN: 'Цей email вже зареєстровано',
  ALREADY_REVIEWED: 'Ви вже залишили відгук на це замовлення',
  INVALID_TOKEN: 'Посилання недійсне або застаріло',
  BUSINESS_RULE: 'Дію не дозволено правилами сервісу',
  RATE_LIMITED: 'Забагато спроб, спробуйте пізніше',
  SERVICE_UNAVAILABLE: 'Сервіс тимчасово недоступний',
  INTERNAL: 'Сталася помилка, спробуйте пізніше',
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'AppError';
    this.status = STATUS_BY_CODE[code];
  }
}

export const notFound = (message?: string) => new AppError('NOT_FOUND', message);
export const forbidden = (message?: string) => new AppError('FORBIDDEN', message);
export const businessRule = (message: string, details?: ErrorDetail[]) =>
  new AppError('BUSINESS_RULE', message, details);
