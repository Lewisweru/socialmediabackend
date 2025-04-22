// utils/pricing.js
const logger = require('./logger.js'); // Use the logger

// --- Pricing Data --- (Same as before, ensure consistency)
const PRICING = {
    tiktok: { standard: { followers: 0.5, likes: 0.05, views: 0.004 }, high: { followers: 0.55, likes: 0.07, views: 0.06 } },
    instagram: { standard: { followers: 0.5, likes: 0.06, views: 0.05 }, high: { followers: 0.55, likes: 0.08, views: 0.07 } },
    facebook: { standard: { pagelikes: 0.5, postlikes: 0.7, postshares: 0.6 }, high: { pagelikes: 0.55, postlikes: 0.9, postshares: 0.8 } },
    youtube: { standard: { subscribers: 1.2, likes: 0.9, views: 0.8, watchhours: 2.5 }, high: { subscribers: 1.5, likes: 1.2, views: 1.0, watchhours: 3.0 } },
    telegram: { standard: { channelmembers: 0.7, groupmembers: 0.6, postviews: 0.5 }, high: { channelmembers: 0.9, groupmembers: 0.8, postviews: 0.7 } },
    whatsapp: { standard: { groupjoins: 0.4, statusviews: 0.3 }, high: { groupjoins: 0.6, statusviews: 0.5 } },
    x: { standard: { followers: 0.8, likes: 0.7, retweets: 0.6, comments: 0.5 }, high: { followers: 1.0, likes: 0.9, retweets: 0.8, comments: 0.7 } },
};

// Helper function (same as before)
const normalizeServiceName = (name) => {
    if (!name) return '';
    return name.toLowerCase().replace(/\s+/g, '');
};

function calculatePrice(
    platform,
    service,
    quality,
    quantity
) {
    // --- Same validation and calculation logic as before ---
     if (!platform || !service || !quality || typeof quantity !== 'number' || quantity <= 0) {
        logger.warn(`Invalid input for calculatePrice: p=${platform}, s=${service}, q=${quality}, qty=${quantity}`);
        return 0;
    }
    const platformKey = platform.toLowerCase();
    const qualityKey = quality;
    const serviceKey = normalizeServiceName(service);

    const platformPrices = PRICING[platformKey];
    if (!platformPrices) {
        logger.error(`Pricing not found for platform: ${platformKey}`);
        return 0;
    }
    const qualityPrices = platformPrices[qualityKey];
     if (!qualityPrices) {
        logger.error(`Pricing not found for quality: ${qualityKey} under platform: ${platformKey}`);
        return 0;
    }
    const basePrice = qualityPrices[serviceKey];
    if (typeof basePrice !== 'number') {
        logger.error(`Pricing rate not found for service key: '${serviceKey}' under ${platformKey}/${qualityKey} (Original Service: '${service}')`);
        logger.debug(`Available service keys for ${platformKey}/${qualityKey}: ${Object.keys(qualityPrices).join(', ')}`);
        return 0;
    }
    const totalPrice = quantity * basePrice;
    const roundedPrice = Math.round(totalPrice * 100) / 100;
    logger.info(`Calculated price for ${quantity} x ${platform}/${service}/${quality} = ${roundedPrice}`);
    return roundedPrice;
}

module.exports = { calculatePrice }; // Export using CommonJS