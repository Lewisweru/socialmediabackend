// utils/pricing.js (Corrected - Removed TS Type Assertions)
import { info, warn, error, debug } from './logger.js';

// --- Pricing Data --- Updated with user-provided prices ---
const PRICING = {
    tiktok:    { standard: { followers: 0.50, likes: 0.07, views: 0.004 },         high: { followers: 0.55, likes: 0.09, views: 0.005 } },
    instagram: { standard: { followers: 0.50, likes: 0.06, views: 0.01 },          high: { followers: 0.55, likes: 0.08, views: 0.02 } },
    facebook:  { standard: { pagelikes: 2.10, profilefollowers: 1.40, postlikes: 1.10, views: 0.06 },
                   high: { pagelikes: 2.20, profilefollowers: 1.44, postlikes: 1.13, views: 0.11 } },
    youtube:   { standard: { subscribers: 4.50, likes: 0.30, views: 1.20 },        high: { subscribers: 5.60, likes: 1.25, views: 1.45 } },
    telegram:  { standard: { members: 1.10, postviews: 0.03, postreactions: 0.06 }, high: { members: 2.10, postviews: 0.04, postreactions: 0.07 } },
    whatsapp:  { standard: { channelmembers: 2.50, emojireactions: 1.20 },       high: { channelmembers: 7.60, emojireactions: 2.50 } },
    x:         { standard: { followers: 7.60, likes: 1.90, retweets: 0.75 },       high: { followers: 7.70, likes: 2.10, retweets: 0.80 } },
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