import { env } from '../../config/env.js';
import type { PaymentProvider as ProviderName } from '../../generated/prisma/enums.js';
import { AppError } from '../../lib/errors.js';
import { formatMoney, type Decimal } from '../../lib/money.js';

export interface CheckoutParams {
  provider: ProviderName;
  checkoutUrl: string;
  data?: string;
  signature?: string;
}

export interface CreateCheckoutInput {
  providerOrderId: string;
  amount: Decimal;
  description: string;
}

export interface RefundResult {
  success: boolean;
  response: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly name: ProviderName;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutParams>;
  refund(providerOrderId: string, amount: Decimal): Promise<RefundResult>;
}

class FakeGateway implements PaymentGateway {
  readonly name = 'fake' as const;

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutParams> {
    return {
      provider: 'fake',
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
}

let gateway: PaymentGateway | null = null;

export function getGateway(): PaymentGateway {
  if (gateway) return gateway;
  if (env.PAYMENT_PROVIDER === 'fake') {
    gateway = new FakeGateway();
    return gateway;
  }
  throw new AppError('SERVICE_UNAVAILABLE', 'Онлайн-оплату ще не підключено');
}
