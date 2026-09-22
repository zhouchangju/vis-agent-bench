import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRadarSysRadius, dvRadarThemeParse } from '../src/dvRadar.js';

const mockOptionToken = {
  dvRadar: {
    radarSysShape: 'polygon',
    radarSysRadius: '80%'
  }
};

test('未设置 radius 时回退到主题默认值', () => {
  const radarSystems = [{}];
  parseRadarSysRadius(radarSystems, null, null, mockOptionToken);
  assert.equal(radarSystems[0].radius, '80%');
});

test('设置数字标量 radius 时应当保留用户值', () => {
  const radarSystems = [{ radius: 50 }];
  parseRadarSysRadius(radarSystems, null, null, mockOptionToken);
  assert.equal(radarSystems[0].radius, 50, '用户传入数值 50 不应被主题 80% 覆盖');
});

test('设置百分比字符串 radius 时应当保留用户值', () => {
  const radarSystems = [{ radius: '65%' }];
  parseRadarSysRadius(radarSystems, null, null, mockOptionToken);
  assert.equal(radarSystems[0].radius, '65%', '用户传入 65% 不应被主题 80% 覆盖');
});

test('设置内外径数组 radius 时应当保留用户值', () => {
  const radarSystems = [{ radius: ['20%', '75%'] }];
  parseRadarSysRadius(radarSystems, null, null, mockOptionToken);
  assert.deepEqual(radarSystems[0].radius, ['20%', '75%']);
});

test('完整 dvRadarThemeParse 流程集成测试', () => {
  const option = {
    series: [{ type: 'dvRadar' }],
    radar: { radius: 60 }
  };
  dvRadarThemeParse(option, null, mockOptionToken);
  assert.equal(option.radar.radius, 60);
  assert.equal(option.radar.shape, 'polygon');
});
