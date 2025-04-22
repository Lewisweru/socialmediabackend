// utils/logger.js (Basic Console Logger - ESM)

const getTimestamp = () => new Date().toISOString();

const info = (...args) => {
  console.log(`[INFO] ${getTimestamp()}:`, ...args);
};

const warn = (...args) => {
  console.warn(`[WARN] ${getTimestamp()}:`, ...args);
};

const error = (...args) => {
  console.error(`[ERROR] ${getTimestamp()}:`, ...args);
};

const debug = (...args) => {
  // Only log debug messages if NODE_ENV is 'development'
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[DEBUG] ${getTimestamp()}:`, ...args);
  }
};

// Export functions using named exports
export { info, warn, error, debug };