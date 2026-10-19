import { env } from '../../config/env.js';
import type { PaymentProvider as ProviderName } from '../../generated/prisma/enums.js';
import { AppError } from '../../lib/errors.js';
import { formatMoney, type Decimal } from '../../lib/money.js';
import {
  decodeLiqpayData,
  encodeLiqpayData,
  LIQPAY_API_URL,
  LIQPAY_CHECKOUT_URL,
  liqpayExpiredDate,
  liqpaySignature,
  liqpayState,
  type LiqpayParams,
  type LiqpayPayload,
  type ProviderPaymentState,
} from './liqpay.js';

export interface CheckoutParams {
  provider: ProviderName;
  checkoutUrl: string;
  method: 'GET' | 'POST';
  data?: string;
  signature?: string;
}

export interface CreateCheckoutInput {
  providerOrderId: string;
  amount: Decimal;
  description: string;
  expiresAt?: Date;
}

export interface RefundResult {
  success: boolean;
  response: Record<string, unknown>;
}

export interface ProviderStatus {
  state: ProviderPaymentState;
  providerPaymentId: string | null;
  method: string | null;
  amount: string | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly name: ProviderName;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutParams>;
  refund(providerOrderId: string, amount: Decimal): Promise<RefundResult>;
  getStatus(providerOrderId: string): Promise<ProviderStatus | null>;
}

class FakeGateway implements PaymentGateway {
  readonly name = 'fake' as const;

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutParams> {
    return {
      provider: 'fake',
      method: 'POST',
      checkoutUrl: `/api/v1/payments/fake/${encodeURIComponent(input.providerOrderId)}/confirm`,
    };
  }

  async refund(providerOrderId: string, amount: Decimal): Promise<RefundResult> {
    return {
      success: true,
      response: {
        provider: 'fake',
        providerOrderId,
        amount: formatMoney(amount),
        status: 'reversed',
      },
    };
  }

  async getStatus(): Promise<ProviderStatus | null> {
    return null;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export function liqpayStatusFromPayload(payload: LiqpayPayload, sandbox: boolean): ProviderStatus {
  const str = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  return {
    state: liqpayState(payload.status, sandbox),
    providerPaymentId: str(payload.payment_id),
    method: str(payload.paytype)?.slice(0, 30) ?? null,
    amount: str(payload.amount),
    currency: str(payload.currency),
    raw: payload,
  };
}

export class LiqpayGateway implements PaymentGateway {
  readonly name = 'liqpay' as const;

  constructor(
    private readonly publicKey: string,
    private readonly privateKey: string,
    private readonly sandbox: boolean,
    private readonly apiPublicUrl: string,
  ) {}

  sign(params: LiqpayParams): { data: string; signature: string } {
    const data = encodeLiqpayData({ version: 3, public_key: this.publicKey, ...params });
    return { data, signature: liqpaySignature(data, this.privateKey) };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutParams> {
    const { data, signature } = this.sign({
      action: 'pay',
      amount: Number(formatMoney(input.amount)),
      currency: 'UAH',
      description: input.description.slice(0, 255),
      order_id: input.providerOrderId,
      language: 'uk',
      result_url: `${this.apiPublicUrl}/api/v1/payments/liqpay/return?orderId=${encodeURIComponent(input.providerOrderId)}`,
      server_url: `${this.apiPublicUrl}/api/v1/payments/liqpay/callback`,
      ...(input.expiresAt && { expired_date: liqpayExpiredDate(input.expiresAt) }),
      ...(this.sandbox && { sandbox: 1 }),
    });
    const query = new URLSearchParams({ data, signature });
    return {
      provider: 'liqpay',
      method: 'POST',
      checkoutUrl: `${LIQPAY_CHECKOUT_URL}?${query.toString()}`,
      data,
      signature,
    };
  }

  private async request(params: LiqpayParams): Promise<LiqpayPayload> {
    const body = new URLSearchParams(this.sign(params));
    const res = await fetch(LIQPAY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = decodeLiqpayData(text);
    }
    if (!res.ok || typeof payload !== 'object' || payload === null) {
      throw new Error(`LiqPay API responded with ${res.status}`);
    }
    return payload as LiqpayPayload;
  }

  async refund(providerOrderId: string, amount: Decimal): Promise<RefundResult> {
    const response = await this.request({
      action: 'refund',
      order_id: providerOrderId,
      amount: Number(formatMoney(amount)),
    });
    return { success: response.status === 'reversed', response };
  }

  async getStatus(providerOrderId: string): Promise<ProviderStatus | null> {
    const response = await this.request({ action: 'status', order_id: providerOrderId });
    if (response.result === 'error' && response.err_code === 'payment_not_found') return null;
    return liqpayStatusFromPayload(response, this.sandbox);
  }
}

let gateway: PaymentGateway | null = null;

export function getGateway(): PaymentGateway {
  if (gateway) return gateway;
  if (env.PAYMENT_PROVIDER === 'fake') {
    gateway = new FakeGateway();
    return gateway;
  }
  if (env.LIQPAY_PUBLIC_KEY && env.LIQPAY_PRIVATE_KEY) {
    gateway = new LiqpayGateway(
      env.LIQPAY_PUBLIC_KEY,
      env.LIQPAY_PRIVATE_KEY,
      env.LIQPAY_SANDBOX,
      env.API_PUBLIC_URL,
    );
    return gateway;
  }
  throw new AppError('SERVICE_UNAVAILABLE', 'Онлайн-оплату ще не підключено');
}
