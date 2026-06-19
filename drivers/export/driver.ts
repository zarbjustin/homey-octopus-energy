'use strict';

import { OctopusMeterDriver } from '../../lib/OctopusMeterDriver';

module.exports = class ExportDriver extends OctopusMeterDriver {

  async onInit(): Promise<void> {
    this.fuel = 'electricity';
    this.log('Export driver initialised');
  }

  protected accepts(meter: { fuel: string; isExport: boolean }): boolean {
    return meter.fuel === 'electricity' && meter.isExport;
  }

  protected deviceName(meter: { mpxn: string }): string {
    const tail = meter.mpxn ? ` ·${meter.mpxn.slice(-4)}` : '';
    return `Export Meter${tail}`;
  }

};
