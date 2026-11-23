/* GAN Bluetooth connection and 3×3 state tracking. */
(function (global) {
  'use strict';

  const { applyMove, cubeFacelets, cubeFromFacelets } = global.Scramble;
  const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  const FACE_TURN = /^[URFDLB](?:2|')?$/;
  const DRIVER_URL = 'https://cdn.jsdelivr.net/npm/gan-web-bluetooth@3.0.2/+esm';
  const ADDRESS_KEY_PREFIX = 'cubetimer.gan-address.';

  function isCubeState(facelets) {
    return typeof facelets === 'string' && /^[URFDLB]{54}$/.test(facelets) &&
      [...'URFDLB'].every((face, i) => facelets[9 * i + 4] === face && facelets.split(face).length === 10);
  }

  function normalizeAddress(value) {
    const digits = typeof value === 'string' ? value.trim().replace(/[:-]/g, '') : '';
    return /^[0-9a-f]{12}$/i.test(digits) ? digits.toUpperCase().match(/../g).join(':') : null;
  }

  function readAddress(key) {
    if (!key) return null;
    try {
      return normalizeAddress(global.localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  class SmartCube {
    static loadDriver() {
      return import(DRIVER_URL);
    }

    static async connect(driver, { requestAddress, onSelected, signal, manual = false }) {
      let device;
      let key;
      let address;
      try {
        const connection = await driver.connectGanCube(async (selected, fallback) => {
          signal?.throwIfAborted();
          device = selected;
          if (!fallback) {
            key = selected.id ? ADDRESS_KEY_PREFIX + selected.id : null;
            const saved = manual ? null : readAddress(key);
            onSelected?.(selected, !!saved);
            if (!manual) {
              address = saved;
              return saved;
            }
          }
          address = normalizeAddress(await requestAddress(selected));
          signal?.throwIfAborted();
          if (!address) throw new Error('Enter the cube’s six-byte Bluetooth address.');
          return address;
        });
        if (signal?.aborted) {
          await connection.disconnect().catch(() => {});
          signal.throwIfAborted();
        }
        const mac = normalizeAddress(connection.deviceMAC) || address;
        return new SmartCube(connection, key && mac ? { key, mac, signal } : null);
      } catch (error) {
        if (device?.gatt?.connected) device.gatt.disconnect();
        throw error;
      }
    }

    constructor(connection, pendingAddress = null) {
      this.connection = connection;
      this.pendingAddress = pendingAddress;
      this.name = connection.deviceName || 'GAN cube';
      this.facelets = null;
      this.model = null;
      this.serial = null;
      this.syncTimer = 0;
      this.resetRequest = null;
      this.battery = null;
      this.hardware = null;
      this.readingInfo = false;
    }

    rememberAddress() {
      const pending = this.pendingAddress;
      this.pendingAddress = null;
      if (!pending || pending.signal?.aborted) return;
      try {
        global.localStorage.setItem(pending.key, pending.mac);
      } catch {
        // Bluetooth timing still works when browser storage is unavailable.
      }
    }

    listen(onEvent) {
      this.onEvent = onEvent;
      this.subscription = this.connection.events$.subscribe((event) => this.receive(event));
      this.sync();
    }

    async readDeviceInfo() {
      if (this.readingInfo || this.resetRequest) return;
      this.readingInfo = true;
      try {
        for (const type of ['REQUEST_BATTERY', 'REQUEST_HARDWARE']) {
          if (!this.subscription || this.subscription.closed || this.resetRequest) return;
          await this.connection.sendCubeCommand({ type }).catch(() => {});
        }
      } finally {
        this.readingInfo = false;
      }
    }

    sync() {
      if (this.resetRequest) return;
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

    resetSolved() {
      if (!this.facelets || this.resetRequest) return false;
      const request = this.resetRequest = { reading: false };
      this.facelets = null;
      this.onEvent({ type: 'resetting' });

      const recover = (message) => {
        if (this.resetRequest !== request) return;
        this.resetRequest = null;
        this.onEvent({ type: 'reset-failed', message });
        this.sync();
      };
      this.syncTimer = setTimeout(() => recover('The cube did not confirm the reset. Keep it still and try again.'), 5000);
      this.connection.sendCubeCommand({ type: 'REQUEST_RESET' }).then(() => {
        if (this.resetRequest !== request) return;
        request.reading = true;
        return this.connection.sendCubeCommand({ type: 'REQUEST_FACELETS' });
      }).catch(() => recover('Could not reset the cube state. Try again.'));
      return true;
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
        const reset = this.resetRequest;
        if (reset && (!reset.reading || event.facelets !== SOLVED)) return;
        // A status packet can be delivered after newer move notifications.
        if (this.facelets && step >= 128) return;
        if (step === 0 && this.facelets === event.facelets) return;
        clearTimeout(this.syncTimer);
        this.syncTimer = 0;
        this.resetRequest = null;
        this.serial = serial;
        this.facelets = event.facelets;
        this.model = cubeFromFacelets(event.facelets);
        this.rememberAddress();
        this.onEvent({ type: reset ? 'reset' : 'state' });
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
      this.resetRequest = null;
      this.pendingAddress = null;
      this.subscription?.unsubscribe();
      this.subscription = null;
      if (!alreadyDisconnected) await this.connection.disconnect();
    }
  }

  SmartCube.SOLVED = SOLVED;
  SmartCube.FACE_TURN = FACE_TURN;
  SmartCube.normalizeAddress = normalizeAddress;
  global.SmartCube = SmartCube;
})(typeof window !== 'undefined' ? window : globalThis);
