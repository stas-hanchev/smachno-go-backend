import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });
  return transporter;
}

export const sentMail: MailMessage[] = [];

export async function sendMail(message: MailMessage): Promise<void> {
  if (env.NODE_ENV === 'test') {
    sentMail.push(message);
    return;
  }
  const transport = getTransporter();
  if (!transport) {
    logger.info(
      { to: message.to, subject: message.subject, text: message.text },
      'Email (not sent: SMTP_HOST is empty)',
    );
    return;
  }
  try {
    await transport.sendMail({ from: env.MAIL_FROM, ...message });
  } catch (err) {
    logger.error({ err, to: message.to, subject: message.subject }, 'Failed to send email');
  }
}
