import { env } from '../../config/env.js';
import { sendMail } from '../../lib/mailer.js';

export function sendVerifyEmail(to: string, firstName: string, token: string): Promise<void> {
  const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    subject: 'Підтвердіть email у СмачноGo',
    text: `Вітаємо, ${firstName}!\n\nЩоб підтвердити email, перейдіть за посиланням (дійсне 24 години):\n${link}\n\nЯкщо ви не реєструвалися в СмачноGo, просто проігноруйте цей лист.`,
  });
}

export function sendPasswordResetEmail(
  to: string,
  firstName: string,
  token: string,
): Promise<void> {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    subject: 'Відновлення пароля в СмачноGo',
    text: `Вітаємо, ${firstName}!\n\nЩоб задати новий пароль, перейдіть за посиланням (дійсне 1 годину):\n${link}\n\nЯкщо ви не надсилали запит, просто проігноруйте цей лист.`,
  });
}
