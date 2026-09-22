/**
 * 3D 向量与球面数学基础工具库
 */

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    this.z = Number(z) || 0;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.hypot(dx, dy, dz);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  subVectors(a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  normalize() {
    const l = this.length();
    if (l > 0) {
      this.multiplyScalar(1 / l);
    }
    return this;
  }

  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  cross(v) {
    return this.crossVectors(this, v);
  }
}

/**
 * 将经纬度与海拔转换为 3D 笛卡尔坐标
 * @param {number} lat - 纬度 [-90, 90]
 * @param {number} lng - 经度 [-180, 180]
 * @param {number} radius - 球体基准半径
 * @param {number} altitude - 海拔高度（默认 0）
 * @returns {Vector3}
 */
export function latLngToVector3(lat, lng, radius, altitude = 0) {
  const r = radius + (altitude || 0);
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;

  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z = r * Math.sin(phi) * Math.sin(theta);
  const y = r * Math.cos(phi);

  return new Vector3(x, y, z);
}

/**
 * 确保输入转为 Vector3 实例
 * @param {Vector3|{x: number, y: number, z: number}} v
 * @returns {Vector3}
 */
export function ensureVector3(v) {
  if (v instanceof Vector3) return v;
  if (v && typeof v === 'object') return new Vector3(v.x, v.y, v.z);
  return new Vector3();
}
