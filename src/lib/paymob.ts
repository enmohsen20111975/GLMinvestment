/**
 * Paymob Payment Gateway Service
 * Documentation: https://docs.paymob.com/
 * 
 * Supports multiple payment methods:
 * - Card (Online Card) - Integration ID from PAYMOB_INTEGRATION_ID_CARD
 * - Wallet (Mobile Wallet) - Integration ID from PAYMOB_INTEGRATION_ID_WALLET
 */

type PaymentMethod = 'card' | 'wallet';

interface PaymobConfig {
  apiKey: string;
  publicKey: string;
  secretKey: string;
  hmac: string;
  integrationIdCard: string;
  integrationIdWallet: string;
  iframeId: string;
  currency: string;
  mode: 'test' | 'live';
}

interface PaymentRequest {
  amount: number; // Amount in smallest currency unit (e.g., cents for EGP: 100 = 1 EGP)
  currency?: string;
  merchantOrderId: string;
  paymentMethod?: PaymentMethod; // 'card' or 'wallet', defaults to 'card'
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  billingData?: {
    apartment?: string;
    floor?: string;
    street?: string;
    building?: string;
    shippingMethod?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    state?: string;
  };
  callbackUrl: string;
  returnUrl?: string;
}

interface PaymentResponse {
  success: boolean;
  paymentKey?: string;
  iframeUrl?: string;
  walletUrl?: string; // For mobile wallet payments
  orderId?: string;
  error?: string;
}

interface PaymobAuthResponse {
  token: string;
}

interface PaymobOrderResponse {
  id: number;
}

interface PaymobPaymentKeyResponse {
  token: string;
}

class PaymobService {
  private config: PaymobConfig;
  private baseUrl: string;

  constructor() {
    this.config = {
      apiKey: process.env.PAYMOB_API_KEY || '',
      publicKey: process.env.PAYMOB_PUBLIC_KEY || '',
      secretKey: process.env.PAYMOB_SECRET_KEY || '',
      hmac: process.env.PAYMOB_HMAC || '',
      integrationIdCard: process.env.PAYMOB_INTEGRATION_ID_CARD || '',
      integrationIdWallet: process.env.PAYMOB_INTEGRATION_ID_WALLET || '',
      iframeId: process.env.PAYMOB_IFRAME_ID || '',
      currency: process.env.PAYMOB_CURRENCY || 'EGP',
      mode: (process.env.PAYMOB_MODE as 'test' | 'live') || 'test',
    };

    this.baseUrl = this.config.mode === 'test'
      ? 'https://accept.paymob.com/api'
      : 'https://accept.paymob.com/api';
  }

  /**
   * Get integration ID based on payment method
   */
  private getIntegrationId(paymentMethod: PaymentMethod): string {
    if (paymentMethod === 'wallet') {
      return this.config.integrationIdWallet;
    }
    return this.config.integrationIdCard;
  }

  /**
   * Step 1: Authentication - Get auth token
   */
  async authenticate(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/auth/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.config.apiKey,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Paymob authentication failed: ${error}`);
    }

    const data: PaymobAuthResponse = await response.json();
    return data.token;
  }

  /**
   * Step 2: Order Registration
   */
  async registerOrder(
    token: string,
    amount: number,
    merchantOrderId: string,
    items?: Array<{ name: string; amount: number; quantity: number }>
  ): Promise<number> {
    const response = await fetch(`${this.baseUrl}/ecommerce/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: false,
        amount_cents: amount,
        currency: this.config.currency,
        merchant_order_id: merchantOrderId,
        items: items || [],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Paymob order registration failed: ${error}`);
    }

    const data: PaymobOrderResponse = await response.json();
    return data.id;
  }

  /**
   * Step 3: Generate Payment Key
   */
  async generatePaymentKey(
    token: string,
    orderId: number,
    amount: number,
    integrationId: string,
    customer: PaymentRequest['customer'],
    billingData: PaymentRequest['billingData'],
    callbackUrl: string,
    returnUrl?: string
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/acceptance/payment_keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_token: token,
        amount_cents: amount,
        expiration: 3600,
        order_id: orderId,
        billing_data: {
          first_name: customer.firstName,
          last_name: customer.lastName,
          email: customer.email,
          phone_number: customer.phone,
          country: billingData?.country || 'EG',
          city: billingData?.city || 'Cairo',
          street: billingData?.street || 'NA',
          building: billingData?.building || 'NA',
          floor: billingData?.floor || 'NA',
          apartment: billingData?.apartment || 'NA',
        },
        currency: this.config.currency,
        integration_id: parseInt(integrationId),
        callback_url: callbackUrl,
        return_url: returnUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Paymob payment key generation failed: ${error}`);
    }

    const data: PaymobPaymentKeyResponse = await response.json();
    return data.token;
  }

  /**
   * Full Payment Flow - Returns payment URL
   * Supports both card and mobile wallet payments
   */
  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const paymentMethod = request.paymentMethod || 'card';
      const integrationId = this.getIntegrationId(paymentMethod);

      // Validate configuration
      if (!this.config.apiKey) {
        return {
          success: false,
          error: 'PAYMOB_API_KEY is not configured.',
        };
      }

      if (!integrationId) {
        return {
          success: false,
          error: `PAYMOB_INTEGRATION_ID_${paymentMethod.toUpperCase()} is not configured.`,
        };
      }

      if (paymentMethod === 'card' && !this.config.iframeId) {
        return {
          success: false,
          error: 'PAYMOB_IFRAME_ID is not configured for card payments.',
        };
      }

      // Step 1: Authenticate
      const token = await this.authenticate();

      // Step 2: Register Order
      const orderId = await this.registerOrder(token, request.amount, request.merchantOrderId);

      // Step 3: Generate Payment Key
      const paymentKey = await this.generatePaymentKey(
        token,
        orderId,
        request.amount,
        integrationId,
        request.customer,
        request.billingData,
        request.callbackUrl,
        request.returnUrl
      );

      // Generate appropriate URL based on payment method
      if (paymentMethod === 'wallet') {
        // For mobile wallet, use the wallet API endpoint
        const walletUrl = `${this.baseUrl}/acceptance/payments/pay`;
        return {
          success: true,
          paymentKey,
          walletUrl,
          orderId: orderId.toString(),
        };
      } else {
        // For card payments, return iframe URL
        const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${this.config.iframeId}?payment_token=${paymentKey}`;
        return {
          success: true,
          paymentKey,
          iframeUrl,
          orderId: orderId.toString(),
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Process Mobile Wallet Payment
   * Call this after getting wallet payment key
   */
  async processWalletPayment(paymentKey: string, walletNumber: string): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/acceptance/payments/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: {
            identifier: walletNumber,
            subtype: 'WALLET',
          },
          payment_token: paymentKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        return {
          success: true,
          redirectUrl: data.redirect_url,
        };
      } else {
        return {
          success: false,
          error: data.message || 'Wallet payment failed',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Verify HMAC signature from Paymob callback
   */
  verifyHmac(data: Record<string, string>, receivedHmac: string): boolean {
    const crypto = require('crypto');
    
    // Build the string to hash
    const keys = [
      'amount_cents',
      'created_at',
      'currency',
      'error_occured',
      'has_parent_transaction',
      'id',
      'integration_id',
      'is_3d_secure',
      'is_auth',
      'is_capture',
      'is_refunded',
      'is_standalone_payment',
      'is_voided',
      'order',
      'owner',
      'pending',
      'source_data_pan',
      'source_data_sub_type',
      'source_data_type',
    ];

    const values = keys.map(key => data[key] || '');
    const stringToHash = values.join('');

    const calculatedHmac = crypto
      .createHmac('sha512', this.config.hmac)
      .update(stringToHash)
      .digest('hex');

    return calculatedHmac === receivedHmac;
  }

  /**
   * Get iframe URL for a payment key (card payments)
   */
  getIframeUrl(paymentKey: string): string {
    return `https://accept.paymob.com/api/acceptance/iframes/${this.config.iframeId}?payment_token=${paymentKey}`;
  }

  /**
   * Get configuration status
   */
  getConfigStatus(): { configured: boolean; missing: string[]; availableMethods: PaymentMethod[] } {
    const missing: string[] = [];
    const availableMethods: PaymentMethod[] = [];
    
    if (!this.config.apiKey) missing.push('PAYMOB_API_KEY');
    if (!this.config.publicKey) missing.push('PAYMOB_PUBLIC_KEY');
    if (!this.config.secretKey) missing.push('PAYMOB_SECRET_KEY');
    if (!this.config.hmac) missing.push('PAYMOB_HMAC');

    // Check available payment methods
    if (this.config.integrationIdCard && this.config.iframeId) {
      availableMethods.push('card');
    } else {
      if (!this.config.integrationIdCard) missing.push('PAYMOB_INTEGRATION_ID_CARD');
      if (!this.config.iframeId) missing.push('PAYMOB_IFRAME_ID');
    }

    if (this.config.integrationIdWallet) {
      availableMethods.push('wallet');
    } else {
      missing.push('PAYMOB_INTEGRATION_ID_WALLET');
    }

    return {
      configured: missing.length === 0 || (this.config.apiKey !== '' && availableMethods.length > 0),
      missing,
      availableMethods,
    };
  }

  /**
   * Get available payment methods
   */
  getAvailablePaymentMethods(): PaymentMethod[] {
    const methods: PaymentMethod[] = [];
    if (this.config.integrationIdCard && this.config.iframeId) {
      methods.push('card');
    }
    if (this.config.integrationIdWallet) {
      methods.push('wallet');
    }
    return methods;
  }
}

// Export singleton instance
export const paymobService = new PaymobService();
export type { PaymentRequest, PaymentResponse, PaymentMethod };
