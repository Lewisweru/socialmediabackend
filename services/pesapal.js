import axios from 'axios';

export class PesapalService {
  constructor(consumerKey, consumerSecret, isSandbox = true) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.baseUrl = isSandbox
      ? 'https://cybqa.pesapal.com/pesapalv3' // Sandbox URL
      : 'https://pay.pesapal.com/v3'; // Production URL
  }

  // Step 1: Get OAuth Token (POST request)
  async getOAuthToken() {
    try {
      console.log('Fetching OAuth token...');
      console.log('Base URL:', this.baseUrl);

      const payload = {
        consumer_key: this.consumerKey,
        consumer_secret: this.consumerSecret,
      };

      const response = await axios.post(`${this.baseUrl}/api/Auth/RequestToken`, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.data.token) {
        throw new Error('OAuth token not found in response');
      }

      console.log('OAuth token fetched successfully:', response.data.token);
      return response.data.token;
    } catch (error) {
      console.error('Error fetching OAuth token:', error.response?.data || error.message);
      throw new Error(`Failed to fetch OAuth token: ${error.response?.data?.message || error.message}`);
    }
  }

  // Step 2: Register Payment Order (POST request)
  async registerOrder(token, orderId, amount, currency, description, callbackUrl, customer, notificationId) {
    try {
      if (!customer.firstName || !customer.lastName || !customer.email) {
        throw new Error('Customer details are incomplete');
      }

      const payload = {
        id: orderId,
        currency,
        amount,
        description,
        callback_url: callbackUrl,
        notification_id: notificationId, // Include the IPN ID here
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

      console.log('Register Order Payload:', payload);

      const response = await axios.post(`${this.baseUrl}/api/Transactions/SubmitOrderRequest`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Register Order Response:', response.data);

      if (!response.data.order_tracking_id) {
        throw new Error('Order tracking ID not found in response');
      }

      return response.data;
    } catch (error) {
      console.error('Error registering order:', error.response?.data || error.message);
      throw new Error(`Failed to register order: ${error.response?.data?.message || error.message}`);
    }
  }

  // Step 3: Query Payment Status (GET request)
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

      console.log('Payment status fetched successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error querying payment status:', error.response?.data || error.message);
      throw new Error(`Failed to query payment status: ${error.response?.data?.message || error.message}`);
    }
  }

  // Register IPN URL (POST request)
  async registerIPN(token, ipnUrl, ipnNotificationType = 'POST') {
    try {
      const payload = {
        url: ipnUrl,
        ipn_notification_type: ipnNotificationType,
      };

      console.log('Registering IPN URL with payload:', payload);

      const response = await axios.post(`${this.baseUrl}/api/URLSetup/RegisterIPN`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.data.ipn_id) {
        throw new Error('IPN ID not found in response');
      }

      console.log('IPN URL registered successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error registering IPN URL:', error.response?.data || error.message);
      throw new Error(`Failed to register IPN URL: ${error.response?.data?.message || error.message}`);
    }
  }
}