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

import PM5 from './pm5';
import Logbook from './logbook';
import {formatDate, formatTime} from './utils';
import WebFont from 'webfontloader';

class App {
  constructor() {
  }

  setup() {
    this.pm5 = new PM5();
    this.logbook = new Logbook();
    this.currentPage = document.querySelector('.page_active');
    this.selectedTab = document.querySelector('.navigation__item_selected');
    this.btOnOffSwitch = document.querySelector('#myonoffswitch');

    this.btOnOffSwitch.addEventListener('change', event => {
      if (event.target.checked) {
        this.connect()
          .catch(err => {
            console.log('Connection failed:', err);
            event.target.checked = false;
          });
      } else {
        this.disconnect();
      }
    });

    const tabs = document.querySelectorAll('.navigation__item');
    const pages = document.querySelectorAll('.page');
    for (let tab of tabs) {
      const anchor = tab.querySelector('a');
      anchor.addEventListener('click', e => {
        e.preventDefault();
        const newTab = tab;
        let newPage;

        for (let page of pages) {
          if (page.getAttribute('data-page') === newTab.getAttribute('data-target-page')) {
            newPage = page;
            break;
          }
        }

        // Check if Page is valid.
        if (newPage) {
          this.currentPage.classList.remove('page_active');
          this.selectedTab.classList.remove('navigation__item_selected');
          newPage.classList.add('page_active');
          newTab.classList.add('navigation__item_selected');
          this.currentPage = newPage;
          this.selectedTab = newTab;
        }
        return false;
      });
    }

    this.statusText = document.querySelector('#status');
    this.timeText = document.querySelector('#time');
    this.distanceText = document.querySelector('#distance');
    this.strokeStateText = document.querySelector('#stroke-state');
    this.peakDriveForceText = document.querySelector('#peak-power');
    this.myBoat = document.querySelector('#myBoat');
    // this.fillLogbook();

    WebFont.load({
      google: {
        families: ['Roboto']
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').then(r => {
        console.log('REGISTRATION', r);
      });
    }
  }

  connect() {
    return this.pm5.connect()
      .then(() => {
        // The call bellow is an experimental API, documented here:
        // https://github.com/w3c/wake-lock.
        // According to this comment on the following issue:
        // https://github.com/w3c/wake-lock/issues/76#issuecomment-232669584, it's enabled
        // in Chrome behind an experimental, which seems to be:
        // chrome://flags/#enable-experimental-web-platform-features.
        // The same flag currently used to enable web-bluetooth.
        screen.keepAwake = true;
        return this.pm5.getPm5Information();
      }).then(information => {
        this.statusText.textContent = 'Connected to: ' + information.serialNumber;
        this.btOnOffSwitch.checked = true;
        return this.pm5.addEventListener('general-status', evt => {
          console.log(evt);
          console.log(evt.data);
          // TODO: Update a rowing guy animation based on this info.
          document.querySelector('#stroke-state').textContent = evt.data.strokeState;
          const date = new Date(evt.data.timeElapsed * 1000);
          this.timeText.textContent = formatTime(date);
          this.distanceText.textContent = (evt.data.distance).toFixed(2);

          this.myBoat.style.setProperty("left", evt.data.distance + "px");
          let color = "#fff";
          switch(evt.data.strokeState){
            case 0:
            case 1:
              color = "#fff";
              break;
            case 2:
              // STROKESTATE_DRIVING_STATE
              color = "#f00";
              break;
            case 3:
              // STROKESTATE_DWELLING_AFTER_DRIVE_STATE
              color = "#f0f";
              break;
            case 4:
              // STROKESTATE_RECOVERY_STATE
              color = "#00f";
              break;
          }
          this.myBoat.style.setProperty("background-color", color);

        });
      })
      .then(() => {
        return this.pm5.addEventListener('stroke-data', evt => {
          console.log(evt);
          console.log(evt.data);
          // TODO: Update a rowing guy animation based on this info.
          const pdf = evt.data.peakDriveForce;
          // const hexVal = (255 - pdf).toString(16);
          document.querySelector('#peak-power').textContent = pdf;
          // const color = "#ff" + hexVal + hexVal;
          // console.log("*** COLOR! " + color);
          // this.myBoat.style.setProperty("background-color", color);
        });
      })
      .then(() => {
        return this.pm5.setSampleRate(3);
      })
      .then(() => {
        return this.pm5.addEventListener('workout-end', evt => {
          // this.logbook.saveWorkout(evt.data)
          //   .then(workout => {
          //     this.addWorkout(workout);
          //     // TODO: Show Toast here!
          //     console.log('Workout Saved');
          //   })
          //   .catch(err => {
          //     // TODO: Show Toast here!
          //     console.error('Error Saving Workout', err);
          //   });
        });
      })
      .then(() => {
        return this.pm5.addEventListener('disconnect', () => {
          this.btOnOffSwitch.checked = false;
          this.statusText.textContent = 'Disconnected';
          screen.keepAwake = false;
        });
      });
  }

  disconnect() {
    this.pm5.disconnect();
  }

  _addWorkout(workoutTable, rowtemplate, workout) {
    rowtemplate.querySelector('.logentry__date').textContent = formatDate(workout.date);
    rowtemplate.querySelector('.logentry__time').textContent =
      formatTime(new Date(workout.timeElapsed * 1000));
    rowtemplate.querySelector('.logentry__distance').textContent = workout.distance;
    const clone = document.importNode(rowtemplate, true);
    workoutTable.appendChild(clone);
  }

  addWorkout(workout) {
    const rowtemplate = document.querySelector('#logbook-record').content;
    const workoutTable = document.querySelector('.logbook-records');
    this._addWorkout(workoutTable, rowtemplate, workout);
  }

  // fillLogbook() {
  //   this.logbook.loadWorkouts()
  //     .then(workouts => {
  //       if (workouts.length <= 0) {
  //         return;
  //       }
  //
  //       const rowtemplate = document.querySelector('#logbook-record').content;
  //       const workoutTable = document.querySelector('.logbook-records');
  //       workouts
  //         .sort((workoutA, workoutB) => workoutB.date - workoutA.date)
  //         .forEach(workout => {
  //           this._addWorkout(workoutTable, rowtemplate, workout);
  //         });
  //       const noWorkout = document.querySelector('.no-workout');
  //       noWorkout.classList.add('no-workout_hidden');
  //     });
  // }
}

const app = new App();
app.setup();
