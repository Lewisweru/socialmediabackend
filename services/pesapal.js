import axios from 'axios';

export class PesapalService {
  constructor(consumerKey, consumerSecret, isSandbox = true) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.baseUrl = isSandbox
      ? 'https://cybqa.pesapal.com/pesapalv3'
      : 'https://pay.pesapal.com/pesapalv3';
  }

  // Step 1: Get OAuth Token
  async getOAuthToken() {
    try {
      const authString = `${this.consumerKey}:${this.consumerSecret}`;
      const encodedAuth = Buffer.from(authString).toString('base64');

      const response = await axios.get(`${this.baseUrl}/api/Auth/RequestToken`, {
        headers: {
          Authorization: `Basic ${encodedAuth}`,
        },
      });

      if (!response.data.token) {
        throw new Error('OAuth token not found in response');
      }

      return response.data.token;
    } catch (error) {
      console.error('Error fetching OAuth token:', error.response?.data || error.message);
      throw new Error(`Failed to fetch OAuth token: ${error.response?.data?.message || error.message}`);
    }
  }

  // Step 2: Register Payment Order
  async registerOrder(token, orderId, amount, currency, description, callbackUrl, customer) {
    try {
      // Validate customer details
      if (!customer.firstName || !customer.lastName || !customer.email) {
        throw new Error('Customer details are incomplete');
      }

      const payload = {
        id: orderId,
        currency,
        amount,
        description,
        callback_url: callbackUrl,
        notification_id: '', // Optional: Add notification ID if you have one
        billing_address: {
          email_address: customer.email,
          phone_number: '',
          country_code: '',
          first_name: customer.firstName,
          middle_name: '',
          last_name: customer.lastName,
          line_1: '',
          line_2: '',
          city: '',
          state: '',
          postal_code: '',
          zip_code: '',
        },
      };

      const response = await axios.post(`${this.baseUrl}/api/Transactions/SubmitOrderRequest`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.data.order_tracking_id) {
        throw new Error('Order tracking ID not found in response');
      }

      return response.data;
    } catch (error) {
      console.error('Error registering order:', error.response?.data || error.message);
      throw new Error(`Failed to register order: ${error.response?.data?.message || error.message}`);
    }
  }

  // Step 3: Query Payment Status
  async queryPaymentStatus(token, orderTrackingId) {
    try {
      if (!orderTrackingId) {
        throw new Error('Order tracking ID is required');
      }

      const response = await axios.get(
        `${this.baseUrl}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.data.status) {
        throw new Error('Payment status not found in response');
      }

      return response.data;
    } catch (error) {
      console.error('Error querying payment status:', error.response?.data || error.message);
      throw new Error(`Failed to query payment status: ${error.response?.data?.message || error.message}`);
    }
  }
}