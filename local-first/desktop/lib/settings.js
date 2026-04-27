'use strict';

let injectEnabled = process.env.JARVIS_INJECT_DISABLED !== '1';

module.exports = {
  isInjectEnabled() {
    return injectEnabled;
  },
  setInjectEnabled(value) {
    injectEnabled = Boolean(value);
  },
};
