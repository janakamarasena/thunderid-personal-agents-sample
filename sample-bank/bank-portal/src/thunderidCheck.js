// The ThunderID Vue SDK calls ThunderID straight from the browser, so ThunderID's `cors` server config must
// allow this origin (thunderid-config/bank-sample.yaml sets it), and the browser must trust ThunderID's
// certificate (scripts/setup.sh issues one with mkcert). Either failure looks like a CORS error in the browser.
// The dev server's proxy is not subject to CORS and does not check certificates, so comparing a direct request
// with a proxied one tells them apart from ThunderID being down.
import { config } from './config.js';

const DISCOVERY = '/.well-known/openid-configuration';

async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

// Returns { title, message } saying what is wrong, or null when the portal can talk to ThunderID.
export async function checkThunderID() {
  if (await reachable(config.thunderidUrl + DISCOVERY)) return null;
  if (await reachable('/thunderid' + DISCOVERY)) {
    return {
      title: 'The browser cannot call ThunderID',
      message: `Either ThunderID does not allow ${window.location.origin} (run scripts/import-config.sh) or the browser does not trust its certificate (open ${config.thunderidUrl} to check, and run mkcert -install).`,
    };
  }
  return {
    title: 'ThunderID is not reachable',
    message: `Start ThunderID at ${config.thunderidUrl} (scripts/start.sh).`,
  };
}
