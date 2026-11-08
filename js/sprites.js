// Many small pictures in one draw: each stands up facing the viewer, floats turned to the screen, or
// lies flat on the surface. Used for what fills the room around a card placed on a real surface.
import * as THREE from '../lib/three.module.min.js';

export const FREE = 0, STAND = 1, FLAT = 2;

export function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// a small flame, tip up
export function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const fill = g.createRadialGradient(32, 94, 2, 32, 84, 66);
  fill.addColorStop(0, 'rgba(255,252,232,1)');
  fill.addColorStop(0.32, 'rgba(255,212,120,1)');
  fill.addColorStop(0.72, 'rgba(255,136,44,0.95)');
  fill.addColorStop(1, 'rgba(255,92,24,0.2)');
  g.fillStyle = fill;
  g.shadowColor = 'rgba(255,150,60,0.9)';
  g.shadowBlur = 12;
  g.beginPath();
  g.moveTo(32, 8);
  g.bezierCurveTo(38, 44, 55, 62, 53, 88);
  g.bezierCurveTo(51, 110, 40, 118, 32, 118);
  g.bezierCurveTo(24, 118, 13, 110, 11, 88);
  g.bezierCurveTo(9, 62, 26, 44, 32, 8);
  g.fill();
  return canvasTexture(c);
}

export class Sprites {
  // anchor: 0 the picture's foot is at its position, 1 its top (it hangs and swings from there), 0.5 its middle
  constructor(map, n, { additive = false, order = 100, anchor = 0.5 } = {}) {
    this.n = n;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1]), 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // unused, but three.js wants it
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const inst = (name, k) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.aPos = inst('iPos', 3);
    this.aSize = inst('iSize', 4); // width, height, turn, how it is held
    this.aCol = inst('iCol', 4);
    g.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uAnchor: { value: anchor } },
      vertexShader: /* glsl */ `
        attribute vec2 corner; attribute vec3 iPos; attribute vec4 iSize; attribute vec4 iCol;
        uniform float uAnchor; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vUv = vec2(corner.x + 0.5, corner.y);
          vCol = iCol;
          float c = cos(iSize.z), s = sin(iSize.z);
          vec2 q = vec2(corner.x * iSize.x, (corner.y - uAnchor) * iSize.y);
          q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          vec4 mv;
          if (iSize.w > 1.5) {
            mv = modelViewMatrix * vec4(iPos + vec3(q.x, 0.0, -q.y), 1.0);
          } else {
            mv = modelViewMatrix * vec4(iPos, 1.0);
            float k = length(modelViewMatrix[0].xyz);
            if (iSize.w > 0.5) {
              vec3 up = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
              vec3 right = normalize(cross(up, normalize(-mv.xyz)));
              mv.xyz += (right * q.x + up * q.y) * k;
            } else {
              mv.xy += q * k;
            }
          }
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 c = texture2D(map, vUv);
          float a = c.a * vCol.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(c.rgb * vCol.rgb, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }

  set(i, x, y, z, w, h, turn, how, r, g, b, a) {
    const p = this.aPos.array, s = this.aSize.array, c = this.aCol.array;
    const i3 = i * 3, i4 = i * 4;
    p[i3] = x; p[i3 + 1] = y; p[i3 + 2] = z;
    s[i4] = w; s[i4 + 1] = h; s[i4 + 2] = turn; s[i4 + 3] = how;
    c[i4] = r; c[i4 + 1] = g; c[i4 + 2] = b; c[i4 + 3] = a;
  }

  flush() {
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = true;
  }
}
