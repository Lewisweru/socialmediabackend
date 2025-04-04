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
  async registerIPN(token, ipnUrl, ipnNotificationType = 'POST') { // Default to POST
    try {
        if (!ipnUrl) {
            throw new Error('IPN URL is required for registration.');
        }
        const payload = {
            url: ipnUrl,
            ipn_notification_type: ipnNotificationType.toUpperCase(), // Ensure uppercase (GET or POST)
        };
        console.log(`[PesapalService] Registering IPN URL: ${ipnUrl} (${ipnNotificationType})`);
        console.log('[PesapalService] Register IPN Payload:', payload);

        const response = await axios.post(`${this.baseUrl}/api/URLSetup/RegisterIPN`, payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });

        console.log('[PesapalService] Register IPN Response:', response.data);

        // Check for success and the essential ipn_id
        if (response?.data?.status !== "200" || !response?.data?.ipn_id) {
             const errorDetail = response?.data?.error ? JSON.stringify(response.data.error) : JSON.stringify(response?.data);
            throw new Error(`Failed to register IPN URL. Pesapal response: ${errorDetail}`);
        }

        console.log(`[PesapalService] IPN URL registered successfully. IPN ID: ${response.data.ipn_id}`);
        return response.data; // Contains url, created_date, ipn_id, status, etc.

    } catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data || error.message;
        console.error(`[PesapalService] Error registering IPN URL ${ipnUrl}:`, errorMsg);
        throw new Error(`Failed to register IPN URL: ${errorMsg}`);
    }
}
// --- End Register IPN URL ---

// --- NEW: Get Registered IPN URLs ---
async getRegisteredIPNs(token) {
    try {
        console.log('[PesapalService] Fetching registered IPN list...');
        const url = `${this.baseUrl}/api/URLSetup/GetIpnList`;

        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });

        console.log('[PesapalService] Get Registered IPNs Response:', response.data);

        // Response is expected to be an array
        if (!Array.isArray(response?.data)) {
            const errorDetail = JSON.stringify(response?.data);
            throw new Error(`Unexpected response format when fetching IPN list: ${errorDetail}`);
        }

        console.log(`[PesapalService] Found ${response.data.length} registered IPN URLs.`);
        return response.data; // Returns array of { url, created_date, ipn_id, status }

    } catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data || error.message;
        console.error('[PesapalService] Error fetching registered IPN URLs:', errorMsg);
        throw new Error(`Failed to fetch registered IPN URLs: ${errorMsg}`);
    }
}
}