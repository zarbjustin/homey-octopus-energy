'use strict';

import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

module.exports = class ExportDevice extends OctopusMeterDevice {

  /** Export pays earnings; there is no standing charge to add. */
  protected costCapability(): string {
    return 'octopus_earnings_today';
  }

  protected includeStandingChargeInCost(): boolean {
    return false;
  }

};
