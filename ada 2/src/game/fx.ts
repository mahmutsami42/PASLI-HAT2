import * as THREE from 'three';
import { T } from './textures';
import { groundY } from './terrain';

const PV = `
attribute vec4 aColor; attribute float aSize; varying vec4 vColor; uniform float uScale;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.1, -mv.z); }`;
const PF = `
uniform sampler2D uMap; varying vec4 vColor;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.003) discard;
  #include <colorspace_fragment>
}`;

export class Particles {
  points: THREE.Points; n: number; i = 0;
  pos: Float32Array; col: Float32Array; size: Float32Array;
  vel: Float32Array; life: Float32Array; maxLife: Float32Array; s0: Float32Array; s1: Float32Array; c0: Float32Array; grav: Float32Array; drag: Float32Array;
  uScale = { value: 800 };
  constructor(scene: THREE.Scene, n: number, additive: boolean, map: THREE.Texture) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.c0 = new Float32Array(n * 4); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({
      vertexShader: PV, fragmentShader: PF, uniforms: { uMap: { value: map }, uScale: this.uScale }, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number, grav = 0, drag = 0.5) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.c0[i * 4] = r; this.c0[i * 4 + 1] = g; this.c0[i * 4 + 2] = b; this.c0[i * 4 + 3] = a; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt: number) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t * 0.2);
      this.col[i * 4] = this.c0[i * 4]; this.col[i * 4 + 1] = this.c0[i * 4 + 1]; this.col[i * 4 + 2] = this.c0[i * 4 + 2]; this.col[i * 4 + 3] = this.c0[i * 4 + 3] * fade;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true; (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
  setScale(h: number, fov: number) { this.uScale.value = (h * 0.5) / Math.tan((fov * Math.PI) / 360); }
}

export class Rain {
  mesh: THREE.LineSegments; u: { uTime: { value: number }; uCam: { value: THREE.Vector3 }; uAlpha: { value: number } };
  constructor(scene: THREE.Scene, n: number) {
    const pos = new Float32Array(n * 6), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 60, y = Math.random() * 32, z = Math.random() * 60;
      pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAlpha: { value: 0.35 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position; float y = mod(p.y - uTime * 26.0, 32.0);
          vec3 w = vec3(mod(p.x - uCam.x, 60.0) - 30.0 + uCam.x, y + uCam.y - 10.0, mod(p.z - uCam.z, 60.0) - 30.0 + uCam.z);
          w += aEnd * vec3(1.4, 1.0, 0.3) * 0.9; vA = 1.0 - aEnd * 0.8;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: `uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.8, 0.9, uAlpha * vA); }`,
    });
    this.mesh = new THREE.LineSegments(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }
  update(t: number, cam: THREE.Vector3) { this.u.uTime.value = t; this.u.uCam.value.copy(cam); }
  dispose(scene: THREE.Scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

export class Debris {
  im: THREE.InstancedMesh; n: number; i = 0;
  p: Float32Array; v: Float32Array; life: Float32Array; size: Float32Array; rot: Float32Array; spin: Float32Array;
  dummy = new THREE.Object3D(); col = new THREE.Color();
  constructor(scene: THREE.Scene, n: number) {
    this.n = n;
    const g = new THREE.IcosahedronGeometry(0.5, 0);
    this.im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), n);
    this.im.castShadow = false; this.im.frustumCulled = false;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.size = new Float32Array(n); this.rot = new Float32Array(n * 3); this.spin = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); this.im.setMatrixAt(i, this.dummy.matrix); this.im.setColorAt(i, this.col.set(0x777777)); }
    scene.add(this.im);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: number, life = 2) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.life[i] = life; this.size[i] = size;
    this.spin.set([(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12], i * 3);
    this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.im.setColorAt(i, this.col.set(color)); if (this.im.instanceColor) this.im.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= 16 * dt;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const gy = groundY(this.p[i * 3], this.p[i * 3 + 2]) + this.size[i] * 0.3;
      if (this.p[i * 3 + 1] < gy) { this.p[i * 3 + 1] = gy; this.v[i * 3 + 1] *= -0.35; this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6; this.spin[i * 3] *= 0.5; this.spin[i * 3 + 1] *= 0.5; this.spin[i * 3 + 2] *= 0.5; }
      this.rot[i * 3] += this.spin[i * 3] * dt; this.rot[i * 3 + 1] += this.spin[i * 3 + 1] * dt; this.rot[i * 3 + 2] += this.spin[i * 3 + 2] * dt;
      const s = this.life[i] < 0.4 ? this.size[i] * (this.life[i] / 0.4) : this.size[i];
      this.dummy.position.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.dummy.rotation.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
      this.dummy.scale.setScalar(this.life[i] <= 0 ? 0 : s);
      this.dummy.updateMatrix(); this.im.setMatrixAt(i, this.dummy.matrix);
    }
    this.im.instanceMatrix.needsUpdate = true;
  }
}

export class Tracers {
  mesh: THREE.LineSegments; n: number; pos: Float32Array; ttl: number[]; i = 0;
  constructor(scene: THREE.Scene, n = 24) {
    this.n = n; this.pos = new Float32Array(n * 6); this.ttl = new Array(n).fill(0);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  add(a: THREE.Vector3, b: THREE.Vector3) {
    const i = this.i; this.i = (i + 1) % this.n; this.ttl[i] = 0.07;
    // kısa bir çizgi: b'ye doğru ilk bölüm
    const d = b.clone().sub(a); const len = d.length(); d.normalize();
    const s = a.clone().addScaledVector(d, Math.min(2, len * 0.1)); const e = a.clone().addScaledVector(d, Math.min(len, 38));
    this.pos.set([s.x, s.y, s.z, e.x, e.y, e.z], i * 6);
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) { if (this.ttl[i] > 0) { this.ttl[i] -= dt; if (this.ttl[i] <= 0) this.pos.fill(0, i * 6, i * 6 + 6); } }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function makeParticleSystems(scene: THREE.Scene, mult: number) {
  return {
    smoke: new Particles(scene, Math.round(1600 * mult), false, T.puff()),
    glow: new Particles(scene, Math.round(900 * mult), true, T.soft()),
  };
}
