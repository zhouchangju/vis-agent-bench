import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, latLngToVector3 } from '../src/math3d.js';
import {
  isPointOccludedBySphere,
  computePerspectiveScale,
  projectSpherePointToScreen,
  layoutSphereTooltips,
} from '../src/occlusion.js';

test('isPointOccludedBySphere should correctly detect front vs back points', () => {
  const cameraPosition = new Vector3(0, 0, 300);
  const globeRadius = 100;

  // 正前方极点 (0, 0, 100) 必定可见
  const frontPoint = new Vector3(0, 0, 100);
  const frontResult = isPointOccludedBySphere(frontPoint, cameraPosition, globeRadius);
  assert.equal(frontResult.occluded, false, '球体正前方点位应可见');

  // 正后方极点 (0, 0, -100) 必定被遮挡
  const backPoint = new Vector3(0, 0, -100);
  const backResult = isPointOccludedBySphere(backPoint, cameraPosition, globeRadius);
  assert.equal(backResult.occluded, true, '球体背面点位应被遮挡');
});

test('projectSpherePointToScreen should project front center point to screen center', () => {
  const camera = {
    position: new Vector3(0, 0, 300),
    target: new Vector3(0, 0, 0),
    fov: 50,
    aspect: 800 / 600,
    up: new Vector3(0, 1, 0),
  };
  const screen = { width: 800, height: 600 };
  const frontPoint = new Vector3(0, 0, 100);

  const res = projectSpherePointToScreen(frontPoint, camera, screen, 100);
  assert.equal(res.visible, true);
  assert.ok(Math.abs(res.screenX - 400) < 1, '正前方中心点应投影至屏幕中心 X');
  assert.ok(Math.abs(res.screenY - 300) < 1, '正前方中心点应投影至屏幕中心 Y');
});
