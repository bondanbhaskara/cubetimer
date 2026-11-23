/* 3D view of the live 3×3 facelets and detected layer turns. */
(function (global) {
  'use strict';

  const { netPosition } = global.Scramble;
  const FACELET_ORDER = 'URFDLB';
  const DEFAULT_VIEW = [-28, -34];
  const ROTATION_KEYS = {
    ArrowUp: [15, 0], ArrowDown: [-15, 0], ArrowLeft: [0, -15], ArrowRight: [0, 15],
  };
  const FACES = {
    U: { axis: 1, side: 1, rotation: 'rotateX(90deg)' },
    R: { axis: 0, side: 1, rotation: 'rotateY(90deg)' },
    F: { axis: 2, side: 1, rotation: '' },
    D: { axis: 1, side: -1, rotation: 'rotateX(-90deg)' },
    L: { axis: 0, side: -1, rotation: 'rotateY(-90deg)' },
    B: { axis: 2, side: -1, rotation: 'rotateY(180deg)' },
  };

  function div(className) {
    const element = document.createElement('div');
    element.className = className;
    return element;
  }

  class CubeView {
    constructor(container, colors, resetButton) {
      this.colors = colors;
      this.scene = div('live-cube-scene');
      this.layer = div('live-cube-layer');
      this.scene.append(this.layer);
      this.cubies = [];
      this.stickers = [];
      this.pending = [];
      this.facelets = null;
      this.animation = null;
      this.motion = global.matchMedia('(prefers-reduced-motion: reduce)');
      for (const x of [-2, 0, 2]) {
        for (const y of [-2, 0, 2]) {
          for (const z of [-2, 0, 2]) {
            if (x || y || z) this.addCubie([x, y, z]);
          }
        }
      }
      container.append(this.scene);
      this.setOrientation(...DEFAULT_VIEW);
      this.bindRotation(container, resetButton);
    }

    setOrientation(pitch, yaw) {
      this.pitch = pitch % 360;
      this.yaw = yaw % 360;
      this.scene.style.transform = `rotateX(${this.pitch}deg) rotateY(${this.yaw}deg)`;
    }

    bindRotation(container, resetButton) {
      const reset = () => this.setOrientation(...DEFAULT_VIEW);
      let drag = null;
      container.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        container.setPointerCapture(drag.id);
      });
      container.addEventListener('pointermove', (event) => {
        if (drag?.id !== event.pointerId) return;
        const pitch = (drag.y - event.clientY) * 0.65;
        const yaw = (event.clientX - drag.x) * 0.65;
        this.setOrientation(this.pitch + pitch, this.yaw + yaw);
        drag.x = event.clientX;
        drag.y = event.clientY;
      });
      container.addEventListener('lostpointercapture', (event) => {
        if (drag?.id === event.pointerId) drag = null;
      });
      container.addEventListener('keydown', (event) => {
        const rotation = ROTATION_KEYS[event.code];
        if (rotation) this.setOrientation(this.pitch + rotation[0], this.yaw + rotation[1]);
        else if (event.code === 'Home') reset();
        else return;
        event.preventDefault();
        event.stopPropagation();
      });
      resetButton.addEventListener('click', reset);
      resetButton.addEventListener('keydown', (event) => {
        // Let the button handle activation before the timer's keyboard shortcuts.
        if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
      });
      resetButton.addEventListener('keyup', (event) => {
        if (event.code === 'Space') event.stopPropagation();
      });
    }

    addCubie(position) {
      const [x, y, z] = position;
      const element = div('live-cubie');
      // The simulator uses +Y up. CSS uses +Y down.
      element.style.transform = `translate3d(${x * 14}px, ${-y * 14}px, ${z * 14}px)`;
      for (const { axis, side, rotation } of Object.values(FACES)) {
        const face = div('live-cube-face');
        face.style.transform = `${rotation} translateZ(13.5px)`;
        if (position[axis] === side * 2) {
          const normal = [0, 0, 0];
          normal[axis] = side;
          const [name, row, col] = netPosition({ p: position, nv: normal }, 3);
          this.stickers[FACELET_ORDER.indexOf(name) * 9 + row * 3 + col] = face;
          face.classList.add('sticker');
        }
        element.append(face);
      }
      this.cubies.push({ position, element });
      this.scene.append(element);
    }

    paint(facelets) {
      this.stickers.forEach((sticker, i) => sticker.style.setProperty('--sticker-color', this.colors[facelets[i]]));
    }

    resetLayer() {
      this.animation?.cancel();
      this.animation = null;
      this.scene.append(...this.layer.children);
    }

    setState(facelets) {
      this.facelets = facelets;
      this.pending.length = 0;
      this.resetLayer();
      if (facelets) this.paint(facelets);
    }

    turn(move, facelets) {
      // A backlog can happen when multiple turns arrive in a Bluetooth packet.
      if (this.motion.matches || document.hidden || this.pending.length >= 3) {
        this.setState(facelets);
        return;
      }
      this.facelets = facelets;
      this.pending.push({ move, facelets });
      if (!this.animation) this.playNextTurn();
    }

    playNextTurn() {
      const next = this.pending.shift();
      if (!next) return;
      const { move, facelets } = next;
      const { axis, side } = FACES[move[0]];
      const amount = move[1] === '2' ? 2 : move[1] === "'" ? -1 : 1;
      const angle = 90 * (axis === 1 ? -side : side) * amount;
      const rotate = `rotate${'XYZ'[axis]}`;
      for (const { position, element } of this.cubies) {
        if (position[axis] === side * 2) this.layer.append(element);
      }
      const animation = this.layer.animate([
        { transform: `${rotate}(0deg)` },
        { transform: `${rotate}(${angle}deg)` },
      ], {
        duration: (amount === 2 ? 150 : 110) / (1 + this.pending.length / 2),
        easing: 'ease-out',
        fill: 'forwards',
      });
      this.animation = animation;
      animation.onfinish = () => {
        if (this.animation !== animation) return;
        this.resetLayer();
        this.paint(facelets);
        this.playNextTurn();
      };
    }
  }

  global.CubeView = CubeView;
})(window);
