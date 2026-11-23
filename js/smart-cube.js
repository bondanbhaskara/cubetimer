/* GAN Bluetooth connection and 3×3 state tracking. */
(function (global) {
  'use strict';

  const { applyMove, cubeFacelets, cubeFromFacelets } = global.Scramble;
  const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  const FACE_TURN = /^[URFDLB](?:2|')?$/;
  const DRIVER_URL = 'https://cdn.jsdelivr.net/npm/gan-web-bluetooth@3.0.2/+esm';

  function isCubeState(facelets) {
    return typeof facelets === 'string' && /^[URFDLB]{54}$/.test(facelets) &&
      [...'URFDLB'].every((face, i) => facelets[9 * i + 4] === face && facelets.split(face).length === 10);
  }

  class SmartCube {
    static loadDriver() {
      return import(DRIVER_URL);
    }

    static async connect(driver, address) {
      const mac = address.trim().replace(/[:-]/g, '');
      if (mac && !/^[0-9a-f]{12}$/i.test(mac)) throw new Error('Enter the cube’s six-byte Bluetooth address.');

      let device;
      try {
        const connection = await driver.connectGanCube(async (selected, fallback) => {
          device = selected;
          if (mac) return mac.match(/../g).join(':');
          if (fallback) throw new Error('Enter the cube’s Bluetooth address to connect. This browser could not read it automatically.');
          return null;
        });
        return new SmartCube(connection);
      } catch (error) {
        if (device?.gatt?.connected) device.gatt.disconnect();
        throw error;
      }
    }

    constructor(connection) {
      this.connection = connection;
      this.name = connection.deviceName || 'GAN cube';
      this.facelets = null;
      this.model = null;
      this.serial = null;
      this.syncTimer = 0;
      this.battery = null;
      this.hardware = null;
      this.readingInfo = false;
    }

    listen(onEvent) {
      this.onEvent = onEvent;
      this.subscription = this.connection.events$.subscribe((event) => this.receive(event));
      this.sync();
    }

    async readDeviceInfo() {
      if (this.readingInfo) return;
      this.readingInfo = true;
      try {
        for (const type of ['REQUEST_BATTERY', 'REQUEST_HARDWARE']) {
          if (!this.subscription || this.subscription.closed) return;
          await this.connection.sendCubeCommand({ type }).catch(() => {});
        }
      } finally {
        this.readingInfo = false;
      }
    }

    sync() {
      this.facelets = null;
      this.onEvent({ type: 'syncing' });
      clearTimeout(this.syncTimer);
      const timer = this.syncTimer = setTimeout(() => {
        this.onEvent({ type: 'error', message: 'The cube did not send its state. Wake it, close CubeStation, and check the Bluetooth address.' });
      }, 5000);
      this.connection.sendCubeCommand({ type: 'REQUEST_FACELETS' }).catch(() => {
        if (this.syncTimer === timer) this.onEvent({ type: 'error', message: 'Could not read the cube state. Reconnect the cube to try again.' });
      });
    }

    receive(event) {
      if (event.type === 'DISCONNECT') {
        this.onEvent({ type: 'disconnect' });
        return;
      }
      if (event.type === 'BATTERY' && Number.isFinite(event.batteryLevel)) {
        this.battery = Math.max(0, Math.min(100, Math.round(event.batteryLevel)));
        this.onEvent({ type: 'device' });
        return;
      }
      if (event.type === 'HARDWARE') {
        this.hardware = event;
        this.onEvent({ type: 'device' });
        return;
      }
      if (!Number.isInteger(event.serial)) return;
      const serial = event.serial & 255;
      const step = this.serial === null ? 0 : (serial - this.serial) & 255;

      if (event.type === 'FACELETS' && isCubeState(event.facelets)) {
        // A status packet can be delivered after newer move notifications.
        if (this.facelets && step >= 128) return;
        if (step === 0 && this.facelets === event.facelets) return;
        clearTimeout(this.syncTimer);
        this.syncTimer = 0;
        this.serial = serial;
        this.facelets = event.facelets;
        this.model = cubeFromFacelets(event.facelets);
        this.onEvent({ type: 'state' });
      } else if (event.type === 'MOVE' && this.facelets && step > 0 && step < 128) {
        if (step !== 1 || !FACE_TURN.test(event.move)) return this.sync();
        const previous = this.facelets;
        this.serial = serial;
        applyMove(this.model, event.move);
        this.facelets = cubeFacelets(this.model);
        this.onEvent({ type: 'move', previous, time: event.localTimestamp, cubeTime: event.cubeTimestamp, move: event.move });
      }
    }

    async disconnect(alreadyDisconnected = false) {
      clearTimeout(this.syncTimer);
      this.syncTimer = 0;
      this.subscription?.unsubscribe();
      this.subscription = null;
      if (!alreadyDisconnected) await this.connection.disconnect();
    }
  }

  SmartCube.SOLVED = SOLVED;
  SmartCube.FACE_TURN = FACE_TURN;
  global.SmartCube = SmartCube;
})(typeof window !== 'undefined' ? window : globalThis);
