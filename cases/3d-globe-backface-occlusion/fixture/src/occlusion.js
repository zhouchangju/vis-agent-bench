import { Vector3, ensureVector3, latLngToVector3 } from './math3d.js';

/**
 * 判定 3D 点位是否被中心在 (0,0,0) 的不透明球体背面遮挡
 * @param {Vector3|{x: number, y: number, z: number}} point - 目标点位
 * @param {Vector3|{x: number, y: number, z: number}} cameraPosition - 相机世界坐标
 * @param {number} globeRadius - 球体半径
 * @returns {{ occluded: boolean, povDist: number, povEdgeDist: number, povPosDist: number }}
 */
export function isPointOccludedBySphere(point, cameraPosition, globeRadius) {
  const p = ensureVector3(point);
  const cam = ensureVector3(cameraPosition);
  const R = Number(globeRadius);

  const povDist = cam.length();
  if (povDist <= R) {
    return { occluded: false, povDist, povEdgeDist: 0, povPosDist: cam.distanceTo(p) };
  }

  // TODO: 模型需在此实现切点视线距离计算与背面遮挡判断逻辑
  // 视线极限切点距离 D_edge = sqrt(D_pov^2 - R^2)
  // 目标点到相机距离 D_pos = distance(cam, p)
  // 当 D_pos > D_edge 时判定为遮挡
  const povEdgeDist = Math.sqrt(Math.max(0, povDist ** 2 - R ** 2));
  const povPosDist = cam.distanceTo(p);

  return {
    occluded: false,
    povDist,
    povEdgeDist,
    povPosDist,
  };
}

/**
 * 计算基于相机视距的透视缩放比例
 * @param {number} povPosDist - 目标点到相机距离
 * @param {number} povDist - 相机到球心距离
 * @param {number} globeRadius - 球体半径
 * @param {object} [options]
 * @param {number} [options.perspectiveMaxScale=1.0]
 * @param {number} [options.perspectiveMinScale=0.4]
 * @returns {number}
 */
export function computePerspectiveScale(povPosDist, povDist, globeRadius, options = {}) {
  const { perspectiveMaxScale = 1.0, perspectiveMinScale = 0.4 } = options;

  // TODO: 模型需在此根据 D_center (最近点) 与 D_edge (切点) 计算线性插值缩放比
  return perspectiveMaxScale;
}

/**
 * 将 3D 球面点位透视投影至 2D 屏幕物理像素坐标系
 * @param {Vector3|{x: number, y: number, z: number}} point
 * @param {object} camera - { position, target, fov, aspect, up }
 * @param {object} screen - { width, height }
 * @param {number|null} [globeRadius=null]
 * @returns {{ visible: boolean, occluded: boolean, screenX?: number, screenY?: number, ndc?: { x: number, y: number } }}
 */
export function projectSpherePointToScreen(point, camera, screen, globeRadius = null) {
  const p = ensureVector3(point);
  const camPos = ensureVector3(camera.position);

  // 1. 若指定球体半径，先行进行背面遮挡裁剪
  if (globeRadius != null) {
    const occ = isPointOccludedBySphere(p, camPos, globeRadius);
    if (occ.occluded) {
      return { visible: false, occluded: true };
    }
  }

  // TODO: 模型需在此构建 LookAt 观察坐标系、计算视角向量分量并映射至 NDC 和物理屏幕坐标 (0,0 在左上角)
  return {
    visible: true,
    occluded: false,
    screenX: screen.width / 2,
    screenY: screen.height / 2,
    ndc: { x: 0, y: 0 },
  };
}

/**
 * 批量处理球面浮层标记布局
 * @param {Array<object>} items - 浮层数据项数组，包含 lat, lng, altitude 或 point
 * @param {object} globeOptions - { globeRadius, camera, screen, layout }
 * @returns {Array<object>}
 */
export function layoutSphereTooltips(items, globeOptions) {
  if (!Array.isArray(items)) return [];
  const { globeRadius, camera, screen, layout = {} } = globeOptions;

  // TODO: 模型需在此整合坐标转换、遮挡裁剪、透视缩放与屏幕边界限制
  return items.map(item => ({
    ...item,
    visible: true,
    occluded: false,
    scale: 1.0,
    screenX: 0,
    screenY: 0,
  }));
}
