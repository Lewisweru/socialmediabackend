// utils/pricing.js (Corrected - Removed TS Type Assertions)
import { info, warn, error, debug } from './logger.js';

// --- Pricing Data --- Updated with user-provided prices ---
const PRICING = {
    tiktok:    { standard: { followers: 0.50, likes: 0.07, views: 0.04 },         high: { followers: 0.6095, likes: 0.09, views: 0.05 } },
    instagram: { standard: { followers: 0.50, likes: 0.06, videoviews: 0.01 },          high: { followers: 0.5977, likes: 0.08, videoviews: 0.02 } },
    facebook:  { standard: { pagefollowers: 0.29, profilefollowers: 0.33, pagelikesandfollowers :0.47, postlikes: 0.25, videoreelviews: 0.04 },
                   high: { pagefollowers: 0.31, profilefollowers: 0.44, pagelikesandfollowers :0.48, postlikes: 0.26, videoreelviews: 0.06 } },
    youtube:   { standard: { subscribers: 0.99, likes: 0.10, views: 0.27 },        high: { subscribers: 1.23, likes: 0.27, views: 0.32 } },
    telegram:  { standard: { members: 0.24, postviews: 0.02, postreactions: 0.06 }, high: { members: 0.46, postviews: 0.04, postreactions: 0.07 } },
    whatsapp:  { standard: { channelmembers: 0.56, emojireactions: 0.28 },       high: { channelmembers: 1.72, emojireactions: 0.55 } },
    x:         { standard: { followers: 1.73, likes: 0.42, retweets: 0.2 },       high: { followers: 1.74, likes: 0.46, retweets: 0.3 } },
  };

// --- End Pricing Data ---


// Helper function to normalize service names for lookup in PRICING
const normalizeServiceName = (name) => {
    if (!name) return '';
    return name.toLowerCase().replace(/\s+/g, '');
};


/**
 * Calculates the price based on backend configuration.
 */
export function calculatePrice(
    platform, // e.g., "tiktok", "facebook" (lowercase expected)
    service,  // e.g., "Followers", "Page Likes" (user-facing name)
    quality,  // "standard" or "high"
    quantity
) {
    if (!platform || !service || !quality || typeof quantity !== 'number' || quantity <= 0) {
        warn(`Invalid input for calculatePrice: p=${platform}, s=${service}, q=${quality}, qty=${quantity}`);
        return 0;
    }

    const platformKey = platform.toLowerCase();
    const qualityKey = quality;
    const serviceKey = normalizeServiceName(service);

    // Safely access nested properties using standard JavaScript bracket notation
    const platformPrices = PRICING[platformKey]; // FIX: Removed type assertion
    if (!platformPrices) {
        error(`Pricing config not found for platform: ${platformKey}`);
        return 0;
    }

    const qualityPrices = platformPrices[qualityKey]; // FIX: Removed type assertion
    if (!qualityPrices) {
        error(`Pricing config not found for quality: ${qualityKey} under platform: ${platformKey}`);
        return 0;
    }

    const basePrice = qualityPrices[serviceKey];
    if (typeof basePrice !== 'number') {
        error(`Pricing rate not found for service key: '${serviceKey}' under ${platformKey}/${qualityKey} (Original Service: '${service}')`);
        debug(`Available service keys for ${platformKey}/${qualityKey}: ${Object.keys(qualityPrices).join(', ')}`);
        return 0;
    }

    // --- Optional Min/Max Check (remains commented out unless needed) ---
    /*
    const supplierDetails = getExoSupplierServiceDetails(platformKey, service, quality);
    if (!supplierDetails) { ... }
    if (quantity < supplierDetails.min || quantity > supplierDetails.max) { ... }
    */

    const totalPrice = quantity * basePrice;
    const roundedPrice = Math.round(totalPrice * 100) / 100;

    info(`Calculated price for ${quantity} x ${platform}/${service}/${quality} = ${roundedPrice}`);
    return roundedPrice;
}