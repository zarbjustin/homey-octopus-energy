'use strict';

import { OctopusMeterDevice } from '../../lib/OctopusMeterDevice';

module.exports = class ExportDevice extends OctopusMeterDevice {

  /** Export energy is tracked as exported (production) for Homey Energy. */
  protected energyMeterCapability(): string | null {
    return 'meter_power.exported';
  }

  /** Export pays earnings; there is no standing charge to add. */
  protected costCapability(): string {
    return 'octopus_earnings_today';
  }

  protected includeStandingChargeInCost(): boolean {
    return false;
  }

};
