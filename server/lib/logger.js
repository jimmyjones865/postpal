// LOG_LEVEL: debug | info (default) | warn | none; errors always shown
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, none: 3 };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

export const logger = {
  debug: (...args) => currentLevel <= LOG_LEVELS.debug && console.log(...args),
  info:  (...args) => currentLevel <= LOG_LEVELS.info  && console.log(...args),
  warn:  (...args) => currentLevel <= LOG_LEVELS.warn  && console.warn(...args),
  error: (...args) => console.error(...args)
};
