/**
 * Copyright 2015-2016, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import EventTarget from './eventtarget';

const MID_MULTIPLIER = 256;
const HIGH_MULTIPLIER = MID_MULTIPLIER * 256;

const services = {
  information: {id: 'ce060010-43e5-11e4-916c-0800200c9a66'},
  rowing: {id: 'ce060030-43e5-11e4-916c-0800200c9a66'},
  control: {id: 'ce060020-43e5-11e4-916c-0800200c9a66'},
  discovery: {id: 'ce060000-43e5-11e4-916c-0800200c9a66'}
};

const characteristics = {
  informationService: {
    serialNumber: {
      id: 'ce060012-43e5-11e4-916c-0800200c9a66',
      service: services.information
    },
    hardwareRevision: {
      id: 'ce060013-43e5-11e4-916c-0800200c9a66',
      service: services.information
    },
    manufacturerName: {
      id: 'ce060014-43e5-11e4-916c-0800200c9a66',
      service: services.information
    },
    firmwareVersion: {
      id: 'ce060015-43e5-11e4-916c-0800200c9a66',
      service: services.information
    }
  },
  rowingService: {
    generalStatus: {
      id: 'ce060031-43e5-11e4-916c-0800200c9a66',
      service: services.rowing
    },
    dataRate: {
      id: 'ce060034-43e5-11e4-916c-0800200c9a66', // ce060034-43e5-11e4-916c-0800200c9a66
      // id: 'ce060034-43e5-11e4-916c-0800200c9A66',
      service: services.rowing
    },
    strokeData: {
      id: 'ce060035-43e5-11e4-916c-0800200c9a66',
      service: services.rowing
    },
    workoutEndSummary: {
      // id: 'ce060033-43e5-11e4-916c-0800200c9a66',
      id: 'ce060039-43e5-11e4-916c-0800200c9a66',
      service: services.rowing
    }
  }
};

export default class PM5 {
  constructor() {
    this.idObjectMap = new Map();
    this.eventTarget = new EventTarget();
    this.filters = {
      filters: [{services: [services.discovery.id]}],
      optionalServices: [services.information.id, services.control.id, services.rowing.id]
    };
  }

  addEventListener(type, callback) {
    this.eventTarget.addEventListener(type, callback);
    switch(type) {
      case 'general-status': {
        return this._addGeneralStatusListener();
      }
      case 'stroke-data': {
        return this._addStrokeDataListener();
      }
      case 'workout-end': {
        return this._addWorkoutEndListener();
      }
    }
  }

  removeEventListener(type, callback) {
    return this.eventTarget.removeEventListener(type, callback);
  }

  connect() {
    if (!navigator.bluetooth) {
      return Promise.reject('Bluetooth API not available');
    }

    return navigator.bluetooth.requestDevice(this.filters)
      .then(device => {
        this.device = device;
        this.device.addEventListener('gattserverdisconnected', () => {
          this.idObjectMap.clear();
          this.eventTarget.dispatchEvent({type: 'disconnect'});
        });
        return device.gatt.connect();
      })
      .then(server => {
        this.server = server;
        return Promise.resolve();
      });
  }

  disconnect() {
    if (!this.device || !this.device.gatt) {
      return Promise.resolve();
    }
    return this.device.gatt.disconnect();
  }

  get connected() {
    return this.device && this.device.gatt.connected;
  }

  _getService(service) {
    const serviceObject = this.idObjectMap.get(service.id);
    if (serviceObject) {
      return Promise.resolve(serviceObject);
    }

    return this.server.getPrimaryService(service.id)
      .then(s => {
        this.idObjectMap.set(service.id, s);
        return Promise.resolve(s);
      });
  }

  _getCharacteristic(characteristic) {
    const characteristicObject = this.idObjectMap.get(characteristic.id);
    if (characteristicObject) {
      return Promise.resolve(characteristicObject);
    }

    return this._getService(characteristic.service)
      .then(service => {
        return service.getCharacteristic(characteristic.id);
      })
      .then(c => {
        this.idObjectMap.set(characteristic.id, c);
        return Promise.resolve(c);
      });
  }

  _setupCharacteristicValueListener(characteristic, callback) {
    const pm5 = this;
    return this._getCharacteristic(characteristic)
      .then(c => {
        return c.startNotifications();
      })
      .then(c => {
        c.addEventListener('characteristicvaluechanged', e => {
          callback(pm5, e);
        });
        return Promise.resolve();
      });
  }

  /**
   * Data bytes packed as follows:
   *  0: Log Entry Date Lo,
   *  1: Log Entry Date Hi,
   *  2: Log Entry Time Lo,
   *  3: Log Entry Time Hi,
   *  4: Elapsed Time Lo (0.01 sec lsb),
   *  5: Elapsed Time Mid,
   *  6: Elapsed Time High,
   *  7: Distance Lo (0.1 m lsb),
   *  8: Distance Mid,
   *  9: Distance High,
   * 10: Average Stroke Rate,
   * 11: Ending Heartrate,
   * 12: Average Heartrate,
   * 13: Min Heartrate,
   * 14: Max Heartrate,
   * 15: Drag Factor Average,
   * 16: Recovery Heart Rate, (zero = not valid data. After 1 minute of rest/recovery, PM5 sends
   *     this data as a revised End Of Workout summary data characteristic unless the monitor has
   *     been turned off or a new workout started)
   * 17: Workout Type,
   * 18: Avg Pace Lo (0.1 sec lsb)
   * 19: Avg Pace Hi
   */
  _addWorkoutEndListener() {
    return this._setupCharacteristicValueListener(
      characteristics.rowingService.workoutEndSummary, (pm5, e) => {
        const valueArray = new Uint8Array(e.target.value.buffer);
        const logEntryDate = valueArray[0] + valueArray[1] * MID_MULTIPLIER;
        const logEntryTime = valueArray[2] + valueArray[3] * MID_MULTIPLIER;
        const timeElapsed = (valueArray[4] + (valueArray[5] * MID_MULTIPLIER)
            + (valueArray[6] * HIGH_MULTIPLIER)) * 0.01;
        const distance = (valueArray[7] + (valueArray[8] * MID_MULTIPLIER)
            + (valueArray[9] * HIGH_MULTIPLIER)) * 0.1;
        const averagePace = (valueArray[18] + valueArray[19] * MID_MULTIPLIER) * 0.1;
        const event = {
          type: 'workout-end',
          source: pm5,
          raw: e.target.value,
          data: {
            date: new Date(),
            logEntryDate: logEntryDate,
            logEntryTime: logEntryTime,
            timeElapsed: timeElapsed,
            distance: distance,
            avgStrokeRate: valueArray[10],
            endingHeartRate: valueArray[11],
            averageHeartRate: valueArray[12],
            minHeartRate: valueArray[13],
            maxHeartRate: valueArray[14],
            averageDragFactor: valueArray[15],
            recoveryHeartRate: valueArray[16],
            workoutType: valueArray[17],
            averagePace: averagePace
          }
        };
        pm5.eventTarget.dispatchEvent(event);
      });
  }

  _parseGeneralStatusBuffer(buffer) {
    /*
      From page 11 of the manual
      Data bytes packed as follows:
      0: Elapsed Time Lo (0.01 sec lsb),
      1: Elapsed Time Mid,
      2: Elapsed Time High,
      3: Distance Lo (0.1 m lsb),
      4: Distance Mid,
      5: Distance High,
      6: Workout Type 3(enum), CSAFE_PM_GET_WORKOUTTYPE4
      7: Interval Type5 (enum), CSAFE_PM_GET_INTERVALTYPE
      8: Workout State (enum), CSAFE_PM_GET_WORKOUTSTATE
      9: Rowing State (enum), CSAFE_PM_GET_ROWINGSTATE
      10: Stroke State (enum), CSAFE_PM_GET_STROKESTATE
      11: Total Work Distance Lo, CSAFE_PM_GET_WORKDISTANCE
      12: Total Work Distance Mid,
      13: Total Work Distance Hi,
      14: Workout Duration Lo (if time, 0.01 sec lsb), CSAFE_PM_GET_WORKOUTDURA TION
      15: Workout Duration Mid,
      16: Workout Duration Hi,
      17: Workout Duration Type (enum), CSAFE_PM_GET_WORKOUTDURA TION
      18: Drag Factor CSAFE_PM_GET_DRAGFACTOR
    */
    const v = new Uint8Array(buffer);

    return {
      timeElapsed: this._byteBuilder(v[0], v[1], v[2]) * 0.01,
      distance: this._byteBuilder(v[3], v[4], v[5]) * 0.1,
      workoutType: v[6],
      intervalType: v[7],
      workoutState: v[8],
      rowingState: v[9],
      strokeState: v[10],
      totalWorkDistance: this._byteBuilder(v[11], v[12], v[13]),
      workoutDuration: this._byteBuilder(v[14], v[15], v[16]),
      workoutDurationType: v[17],
      dragFactor: v[18]
    };
  }

  _addGeneralStatusListener() {
    return this._setupCharacteristicValueListener(
      characteristics.rowingService.generalStatus, (pm5, e) => {
        const valueArray = new Uint8Array(e.target.value.buffer);
        const timeElapsed = this._byteBuilder(valueArray[0], valueArray[1], valueArray[2]) * 0.01;
        const distance = this._byteBuilder(valueArray[3], valueArray[4], valueArray[5]) * 0.1;
        // const timeElapsed = (valueArray[0] + (valueArray[1] * MID_MULTIPLIER)
        //     + (valueArray[2] * HIGH_MULTIPLIER)) * 0.01;
        // const distance = (valueArray[3] + (valueArray[4] * MID_MULTIPLIER)
        //     + (valueArray[5] * HIGH_MULTIPLIER)) * 0.1;
        const workoutState = valueArray[8];
        const strokeState = valueArray[10];
        const dragFactor = valueArray[18];
        const event = {
          type: 'general-status',
          source: pm5,
          raw: e.target.value,
          data: this._parseGeneralStatusBuffer(e.target.value.buffer),
          oldData: {
            distance: distance,
            timeElapsed: timeElapsed,
            workoutState: workoutState,
            strokeState: strokeState,
            dragFactor: dragFactor
          }
        };
        pm5.eventTarget.dispatchEvent(event);
      });
  }

  _parseStrokeDataBuffer(buffer) {
    /*
      From page 15 of the manual
      Data bytes packed as follows:
      0: Elapsed Time Lo (0.01 sec lsb),
      1: Elapsed Time Mid,
      2: Elapsed Time High,
      3: Distance Lo (0.1 m lsb),
      4: Distance Mid,
      5: Distance High,
      6: Drive Length (0.01 meters, max = 2.55m), CSAFE_PM_GET_STROKESTATS
      7: Drive Time (0.01 sec, max = 2.55 sec),
      8: Stroke Recovery Time Lo (0.01 sec, max = 655.35 sec), CSAFE_PM_GET_STROKESTATS
      9: Stroke Recovery Time Hi, CSAFE_PM_GET_STROKESTATS8
      10: Stroke Distance Lo (0.01 m, max=655.35m), CSAFE_PM_GET_STROKESTATS
      11: Stroke Distance Hi,
      12: Peak Drive Force Lo (0.1 lbs of force, max=6553.5m), CSAFE_PM_GET_STROKESTATS
      13: Peak Drive Force Hi,
      14: Average Drive Force Lo (0.1 lbs of force, max=6553.5m), CSAFE_PM_GET_STROKESTATS
      15: Average Drive Force Hi,
      16: Work Per Stroke Lo (0.1 Joules, max=6553.5 Joules), CSAFE_PM_GET_STROKESTATS
      17: Work Per Stroke Hi
      18: Stroke Count Lo, CSAFE_PM_GET_STROKESTATS
      19: Stroke Count Hi,
    */
    const v = new Uint8Array(buffer);

    return {
      elapsedTime: this._byteBuilder(v[0], v[1], v[2]) * 0.01,
      distance: this._byteBuilder(v[3], v[4], v[5]) * 0.1,
      driveLength: this._byteBuilder(v[6]) * 0.01,
      driveTime: this._byteBuilder(v[7]) * 0.01,
      strokeRecoveryTime: this._byteBuilder(v[8], v[9]) * 0.01,
      strokeDistance: this._byteBuilder(v[10], v[11]) * 0.01,
      peakDriveForce: this._byteBuilder(v[12], v[13]) * 0.1,
      averageDriveForce: this._byteBuilder(v[14], v[15]) * 0.1,
      workPerStroke: this._byteBuilder(v[16], v[17]) * 0.1,
      strokeCount: this._byteBuilder(v[18], v[19])
    };
  }

  _addStrokeDataListener() {
    return this._setupCharacteristicValueListener(
      characteristics.rowingService.strokeData, (pm5, e) => {
        const valueArray = new Uint8Array(e.target.value.buffer);

        const peakDriveForce = this._byteBuilder(valueArray[12], valueArray[13]);
        const strokeCount = this._byteBuilder(valueArray[18], valueArray[19]);
        const driveLength = this._byteBuilder(valueArray[6], valueArray[7]);

        const event = {
          type: 'stroke-data',
          source: pm5,
          raw: e.target.value,
          data: this._parseStrokeDataBuffer(e.target.value.buffer),
          oldData: {
            peakDriveForce: peakDriveForce,
            strokeCount: strokeCount,
            driveLength: driveLength,
          }
        };
        pm5.eventTarget.dispatchEvent(event);
      }
    );
  }

  _byteBuilder(lo = 0, mid = 0, hi = 0) {
    return lo + (mid * MID_MULTIPLIER) + (hi * HIGH_MULTIPLIER);
  }

  _getStringCharacteristicValue(characteristic) {
    const decoder = new TextDecoder('utf-8');
    return this._getCharacteristic(characteristic)
      .then(c => {
        return c.readValue();
      })
      .then(value => {
        return decoder.decode(value);
      });
  }

  setSampleRate(value) {
    // Determines how often slave sends general status and additional status data as notifications. Set rate as follows:
    // 0 – 1 sec
    // 1 - 500ms (default if characteristic is not explicitly set by the app)
    // 2 – 250ms
    // 3 – 100ms
    return this._getCharacteristic(characteristics.rowingService.dataRate)
        .then((c) => {
          const buffer = new ArrayBuffer(1);
          const view = new DataView(buffer);
          view.setInt8(0, value);
          console.log("here goes nothing, setting to " + value);
          return c.writeValue(buffer);
        })
  }

  getFirmwareVersion() {
    return this._getStringCharacteristicValue(characteristics.informationService.firmwareVersion);
  }

  getHardwareRevision() {
    return this._getStringCharacteristicValue(characteristics.informationService.hardwareRevision);
  }

  getSerialNumber() {
    return this._getStringCharacteristicValue(characteristics.informationService.serialNumber);
  }

  getManufacturerName() {
    return this._getStringCharacteristicValue(characteristics.informationService.manufacturerName);
  }

  getPm5Information() {
    const pm5Information = {};
    return this.getManufacturerName()
      .then(manufacturer => {
        pm5Information.manufacturer = manufacturer;
        return this.getHardwareRevision();
      })
      .then(hwVersion => {
        pm5Information.hwVersion = hwVersion;
        return this.getSerialNumber();
      })
      .then(serialNumber => {
        pm5Information.serialNumber = serialNumber;
        return this.getFirmwareVersion();
      })
      .then(firmwareVersion => {
        pm5Information.firmwareVersion = firmwareVersion;
        return Promise.resolve(pm5Information);
      });
  }
}
