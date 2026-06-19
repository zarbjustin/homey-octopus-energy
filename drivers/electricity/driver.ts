'use strict';

import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';

module.exports = class ElectricityDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'electricity';
    this.log('Electricity driver initialised');
  }

};
