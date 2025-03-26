import axios from 'axios';

export class PaymentService {
  private readonly apiKey: string;
  private readonly merchantId: string;
  private readonly baseUrl = 'https://api.cryptomus.com/v1';

  constructor(apiKey: string, merchantId: string) {
    this.apiKey = apiKey;
    this.merchantId = merchantId;
  }

  async createPayment(amount: number, orderId: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/payment`,
        {
          amount: amount.toString(),
          currency: 'USD',
          order_id: orderId,
          network: 'tron',
          url_callback: `${process.env.API_URL}/payment/callback`,
          url_return: `${process.env.FRONTEND_URL}/order/success`,
          is_payment_multiple: false,
          lifetime: '600', // 10 minutes
          to_currency: 'USDT'
        },
        {
          headers: {
            merchant: this.merchantId,
            sign: this.generateSign({ amount: amount.toString(), order_id: orderId })
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Payment creation failed:', error);
      throw new Error('Payment creation failed');
    }
  }

  private generateSign(payload: Record<string, string>): string {
    const sortedParams = Object.keys(payload)
      .sort()
      .reduce((acc, key) => ({ ...acc, [key]: payload[key] }), {});
    
    const jsonString = JSON.stringify(sortedParams);
    const base64 = Buffer.from(jsonString).toString('base64');
    
    return require('crypto')
      .createHash('md5')
      .update(base64 + this.apiKey)
      .digest('hex');
  }
}