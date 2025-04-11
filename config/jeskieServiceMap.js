// config/jeskieServiceMap.js

// !! IMPORTANT !! REPLACE '???' with ACTUAL numeric Service IDs from Jeskie Inc API
export const JESKIEINC_SERVICE_MAP = {
    // Format: platform_servicenameNormalized_quality: 'serviceIdString'
    tiktok_followers_standard: '5611',
    tiktok_followers_high: '5599',
    tiktok_likes_standard: '5624',
    tiktok_likes_high: '5517',
    tiktok_views_standard: '???',
    tiktok_views_high: '???',
    instagram_followers_standard: '5369',
    instagram_followers_high: '5370',
    instagram_likes_standard: '5182',
    instagram_likes_high: '271',
    instagram_views_standard: '508',
    instagram_views_high: '509',
    facebook_pagelikes_standard: '???',
    facebook_pagelikes_high: '???',
    facebook_postlikes_standard: '???',
    facebook_postlikes_high: '???',
    facebook_postshares_standard: '???',
    facebook_postshares_high: '???',
    youtube_subscribers_standard: '5535',
    youtube_subscribers_high: '5536',
    youtube_likes_standard: '???',
    youtube_likes_high: '???',
    youtube_views_standard: '???',
    youtube_views_high: '???',
    youtube_watchhours_standard: '???',
    youtube_watchhours_high: '???',
    telegram_channelmembers_standard: '???',
    telegram_channelmembers_high: '???',
    telegram_groupmembers_standard: '???',
    telegram_groupmembers_high: '???',
    telegram_postviews_standard: '???',
    telegram_postviews_high: '???',
    whatsapp_groupjoins_standard: '???',
    whatsapp_groupjoins_high: '???',
    whatsapp_statusviews_standard: '???',
    whatsapp_statusviews_high: '???',
    x_followers_standard: '???',
    x_followers_high: '???',
    x_likes_standard: '???',
    x_likes_high: '???',
    x_retweets_standard: '???',
    x_retweets_high: '???',
    x_comments_standard: '???',
    x_comments_high: '???',
};

/**
 * Finds the Jeskie Inc Service ID.
 */
export function getJeskienServiceId(platform, serviceName, quality) {
    if (!platform || !serviceName || !quality) { console.error(`[Mapping] Invalid input`); return null; }
    // Normalize service name: lowercase, NO spaces
    const serviceKey = serviceName.toLowerCase().replace(/\s+/g, '');
    const mapKey = `${platform}_${serviceKey}_${quality}`;
    const serviceId = JESKIEINC_SERVICE_MAP[mapKey];
    if (!serviceId || serviceId === '???') {
        console.error(`Jeskien Service ID Mapping not found/configured for key: ${mapKey}`);
        return null;
    }
    console.log(`[Mapping] Found Jeskien Service ID: ${serviceId} for key: ${mapKey}`);
    return serviceId;
}