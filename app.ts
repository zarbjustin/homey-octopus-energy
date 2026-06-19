'use strict';

import Homey from 'homey';

module.exports = class OctopusEnergyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    this.log('Octopus Energy app has been initialized');
  }

};
