'use strict';

import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';

module.exports = class GasDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'gas';
    this.log('Gas driver initialised');
  }

};
