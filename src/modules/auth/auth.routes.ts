import { celebrate, Joi, Segments } from 'celebrate';
import { Router, type CookieOptions, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { celebrateOptions, email, password } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { toUserDto } from '../users/user.dto.js';
import * as auth from './auth.service.js';
import {
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './tokens.js';
import { prisma } from '../../lib/prisma.js';

export const REFRESH_COOKIE = 'sg_rt';
export const CSRF_HEADER = 'x-sg-csrf';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
};

const meta = (req: Request) => ({ userAgent: req.get('user-agent'), ip: req.ip });

function sendSession(res: Response, session: auth.Session, status = 200) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
  res.status(status).json({ accessToken: session.accessToken, user: toUserDto(session.user) });
}

function requireCsrfHeader(req: Request) {
  if (req.get(CSRF_HEADER) !== '1') throw new AppError('FORBIDDEN', 'Відсутній заголовок захисту');
}

const loginLimit = rateLimit({
  points: 5,
  durationSec: 15 * 60,
  key: (req) => `${String(req.body?.email ?? '').toLowerCase()}|${req.ip}`,
});
const hourlyIpLimit = () => rateLimit({ points: 5, durationSec: 3600 });

export const authRouter = Router();

authRouter.post(
  '/register',
  hourlyIpLimit(),
  celebrate(
    {
      [Segments.BODY]: Joi.object({
        firstName: Joi.string().trim().min(1).max(100).required(),
        lastName: Joi.string().trim().max(100).allow('', null),
        email: email.required(),
        password: password.required(),
        acceptTerms: Joi.boolean().valid(true).required().messages({
          'any.only': 'Потрібна згода з умовами та політикою конфіденційності',
        }),
      }),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    sendSession(res, await auth.register(req.body, meta(req)), 201);
  },
);

authRouter.post(
  '/login',
  loginLimit,
  celebrate(
    {
      [Segments.BODY]: Joi.object({
        email: email.required(),
        password: Joi.string().max(128).required(),
      }),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    sendSession(res, await auth.login(req.body.email, req.body.password, meta(req)));
  },
);

authRouter.post(
  '/google',
  celebrate({ [Segments.BODY]: Joi.object({ idToken: Joi.string().max(4096).required() }) }),
  async (req, res) => {
    sendSession(res, await auth.loginWithGoogle(req.body.idToken, meta(req)));
  },
);

authRouter.post('/refresh', async (req, res) => {
  requireCsrfHeader(req);
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string' || !token) throw new AppError('UNAUTHORIZED');
  try {
    const { userId, refreshToken } = await rotateRefreshToken(token, meta(req));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'active') throw new AppError('UNAUTHORIZED');
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
    res.json({ accessToken: signAccessToken(user.id, user.role), user: toUserDto(user) });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  requireCsrfHeader(req);
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof token === 'string' && token) await revokeRefreshToken(token);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllRefreshTokens(req.user!.id);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

authRouter.post(
  '/verify-email',
  celebrate({ [Segments.BODY]: Joi.object({ token: Joi.string().max(200).required() }) }),
  async (req, res) => {
    await auth.verifyEmail(req.body.token);
    res.status(204).end();
  },
);

authRouter.post('/verify-email/resend', requireAuth, hourlyIpLimit(), async (req, res) => {
  await auth.resendVerifyEmail(req.user!.id);
  res.status(204).end();
});

authRouter.post(
  '/forgot-password',
  hourlyIpLimit(),
  celebrate({ [Segments.BODY]: Joi.object({ email: email.required() }) }),
  async (req, res) => {
    await auth.forgotPassword(req.body.email);
    res.status(204).end();
  },
);

authRouter.post(
  '/reset-password',
  celebrate({
    [Segments.BODY]: Joi.object({
      token: Joi.string().max(200).required(),
      password: password.required(),
    }),
  }),
  async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.password);
    res.status(204).end();
  },
);
