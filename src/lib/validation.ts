import { Joi } from 'celebrate';

export const id = Joi.string()
  .pattern(/^\d{1,19}$/)
  .message('Некоректний ідентифікатор');

export const idNumber = Joi.number().integer().positive();

export const publicId = Joi.string()
  .length(26)
  .pattern(/^[0-9A-HJKMNP-TV-Z]{26}$/);

export const email = Joi.string().trim().lowercase().email().max(255);

export const password = Joi.string().min(8).max(128).messages({
  'string.min': 'Пароль має містити щонайменше 8 символів',
});

export const date = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .message('Дата має бути у форматі YYYY-MM-DD');

export const time = Joi.string()
  .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
  .message('Час має бути у форматі HH:MM');

export const money = Joi.number().positive().precision(2).max(99_999_999);

export const lat = Joi.number().min(-90).max(90);
export const lng = Joi.number().min(-180).max(180);

export const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
};

export const celebrateOptions = { abortEarly: false, stripUnknown: true } as const;
