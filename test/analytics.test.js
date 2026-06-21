'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const fs = require('fs');

const { getPool, ensureSchema, resetAll, waitForDb, close } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');
const { buildEmptyOverview, buildEmptyBreakdown, aggregateOverview, zeroOrNum } = require('../src/data/aggregator');
const { escapeCsvField, toCsv } = require('../src/data/exporter');

const app = createApp();

test.before(async () => { await waitForDb(); await ensureSchema(); getPool(); });
test.beforeEach(async () => { await resetAll(); await seed(); });
test.after(async () => { await close(); });

async function loginAs(u, p) {
  const res = await request(app).post('/api/auth/login').send({ username: u, password: p });
  assert.strictEqual(res.status, 200, `登录失败: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

test('总览接口返回完整结构，空数据时零值而非 null', async () => {
  const store = require('../src/data/store');
  await resetAll();
  await store.createUser({ username: 'viewer', password: 'viewer123', name: '李社工', role: 'VIEWER' });
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/analytics/overview?date=2026-06-21').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const d = res.body.data;

  assert.strictEqual(d.todayDinerCount, 0);
  assert.strictEqual(d.todayDiners, 0);
  assert.ok(Array.isArray(d.todayCanteenOccupancy));
  assert.ok(Array.isArray(d.todayMealTypeDistribution));
  assert.strictEqual(d.todayMealTypeDistribution.length, 3);
  for (const mt of d.todayMealTypeDistribution) {
    assert.strictEqual(mt.count, 0);
    assert.strictEqual(mt.ratio, 0);
  }
  assert.strictEqual(d.todaySubsidyTotal, 0);
  assert.strictEqual(d.monthSubsidyTotal, 0);
  assert.strictEqual(d.todaySelfPayTotal, 0);
  assert.ok(Array.isArray(d.diningTypeRatio));
  assert.strictEqual(d.diningTypeRatio.length, 2);
  assert.strictEqual(d.nutritionComplianceRate, 0);
  assert.strictEqual(d.nutritionCompliant, 0);
  assert.strictEqual(d.nutritionTotal, 0);
  assert.strictEqual(d.noShowRate, 0);
  assert.ok(Array.isArray(d.heatmapData));
});

test('总览接口有数据时数字正确，与明细对得上', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/analytics/overview?date=2026-06-21').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const d = res.body.data;

  assert.strictEqual(d.todayDinerCount, 3);
  assert.strictEqual(d.todayDiners, 2);
  assert.strictEqual(d.todaySelfPayTotal, 240 + 720 + 900);
  assert.strictEqual(d.todaySubsidyTotal, 360 + 1080 + 900);

  const lunch = d.todayMealTypeDistribution.find(m => m.mealType === 'LUNCH');
  assert.ok(lunch);
  assert.strictEqual(lunch.count, 2);
  assert.ok(lunch.ratio > 0.6);

  const dineIn = d.diningTypeRatio.find(t => t.type === 'DINE_IN');
  assert.ok(dineIn);
  assert.strictEqual(dineIn.count, 2);

  assert.ok(d.nutritionComplianceRate > 0);
  assert.ok(d.noShowRate > 0);

  const cg = d.todayCanteenOccupancy.find(c => c.canteenName === '城关街道长者食堂');
  assert.ok(cg);
  assert.strictEqual(cg.dinerCount, 3);
  assert.ok(cg.occupancyRate > 0);

  assert.ok(d.heatmapData.length > 0);
});

test('下钻接口按街道筛选，数字正确', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/analytics/breakdown?dateStart=2026-06-01&dateEnd=2026-06-30&district=城关区').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const d = res.body.data;

  assert.ok(d.totalDiners > 0);
  assert.ok(d.totalAmount > 0);
  assert.ok(d.totalSubsidy > 0);
  assert.ok(d.totalSelfPay > 0);
  assert.ok(d.byCanteen.length > 0);
  assert.ok(d.byDistrict.length > 0);
  for (const c of d.byCanteen) {
    assert.strictEqual(c.district, '城关区');
  }
});

test('下钻接口按助餐点筛选，返回正确数据', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const canteens = (await request(app).get('/api/canteens').set('Authorization', `Bearer ${token}`)).body.data;
  const c1 = canteens[0];

  const res = await request(app).get(`/api/analytics/breakdown?dateStart=2026-06-01&dateEnd=2026-06-30&canteenId=${c1.id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const d = res.body.data;

  assert.ok(d.byCanteen.length <= 1);
  if (d.byCanteen[0]) {
    assert.strictEqual(d.byCanteen[0].canteenId, c1.id);
  }
});

test('下钻接口按周、月粒度聚合', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const [resDay, resWeek, resMonth] = await Promise.all([
    request(app).get('/api/analytics/breakdown?dateStart=2026-06-01&dateEnd=2026-06-30&granularity=day').set('Authorization', `Bearer ${token}`),
    request(app).get('/api/analytics/breakdown?dateStart=2026-06-01&dateEnd=2026-06-30&granularity=week').set('Authorization', `Bearer ${token}`),
    request(app).get('/api/analytics/breakdown?dateStart=2026-06-01&dateEnd=2026-06-30&granularity=month').set('Authorization', `Bearer ${token}`),
  ]);

  assert.strictEqual(resDay.status, 200);
  assert.strictEqual(resWeek.status, 200);
  assert.strictEqual(resMonth.status, 200);

  const dayBuckets = resDay.body.data.byTimeBucket.length;
  const weekBuckets = resWeek.body.data.byTimeBucket.length;
  const monthBuckets = resMonth.body.data.byTimeBucket.length;

  assert.ok(dayBuckets >= weekBuckets);
  assert.ok(weekBuckets >= monthBuckets);
  assert.strictEqual(monthBuckets, 1);
});

test('聚合数字与明细逐条对得上', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/analytics/breakdown/verify?dateStart=2026-06-01&dateEnd=2026-06-30').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.match, true, '聚合总数应与明细逐条求和一致');
});

test('无效 granularity 返回 400', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/analytics/breakdown?granularity=invalid').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 400);
});

test('CSV 字段转义：逗号、引号、换行正确处理', async () => {
  assert.strictEqual(escapeCsvField('普通文本'), '普通文本');
  assert.strictEqual(escapeCsvField('含,逗号'), '"含,逗号"');
  assert.strictEqual(escapeCsvField('含"引号'), '"含""引号"');
  assert.strictEqual(escapeCsvField('含\n换行'), '"含\n换行"');
  assert.strictEqual(escapeCsvField('混,合"情\n况'), '"混,合""情\n况"');
  assert.strictEqual(escapeCsvField(null), '');
  assert.strictEqual(escapeCsvField(undefined), '');
  assert.strictEqual(escapeCsvField(0), '0');
});

test('CSV 含中文正确生成，带 BOM', async () => {
  const headers = ['姓名', '街道', '金额'];
  const rows = [
    { '姓名': '王秀英', '街道': '城关区', '金额': '15.00' },
    { '姓名': '赵建国', '街道': '江南区', '金额': '12.00' },
  ];
  const csv = toCsv(headers, rows);

  assert.ok(csv.startsWith('\uFEFF'), 'CSV 应带 UTF-8 BOM');
  assert.ok(csv.includes('王秀英'), '中文姓名应正确');
  assert.ok(csv.includes('城关区'), '中文街道应正确');
  assert.ok(csv.includes('\n'), '应有换行');

  const lines = csv.replace('\uFEFF', '').split('\n');
  assert.strictEqual(lines[0], '姓名,街道,金额');
  assert.ok(lines[1].includes('王秀英'));
});

test('导出任务：提交返回任务号，同参数复用', async () => {
  const token = await loginAs('operator', 'operator123');
  const body = {
    type: 'ORDER_DETAIL',
    dateStart: '2026-06-01',
    dateEnd: '2026-06-30',
  };

  const res1 = await request(app).post('/api/exports').set('Authorization', `Bearer ${token}`).send(body);
  assert.strictEqual(res1.status, 201);
  assert.ok(res1.body.data.taskId);
  assert.strictEqual(res1.body.data.reused, false);

  await new Promise(r => setTimeout(r, 500));

  const res2 = await request(app).post('/api/exports').set('Authorization', `Bearer ${token}`).send(body);
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res2.body.data.taskId, res1.body.data.taskId);
  assert.strictEqual(res2.body.data.reused, true);
});

test('导出任务：查询进度，完成后可下载', async () => {
  const token = await loginAs('operator', 'operator123');
  const body = {
    type: 'SUBSIDY_LEDGER',
    dateStart: '2026-06-01',
    dateEnd: '2026-06-30',
  };

  const submitRes = await request(app).post('/api/exports').set('Authorization', `Bearer ${token}`).send(body);
  assert.ok(submitRes.body.data.taskId);
  const taskId = submitRes.body.data.taskId;

  await new Promise(r => setTimeout(r, 1000));

  const statusRes = await request(app).get(`/api/exports/${taskId}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(statusRes.status, 200);
  assert.ok(['COMPLETED', 'RUNNING', 'PENDING'].includes(statusRes.body.data.status));
  assert.strictEqual(typeof statusRes.body.data.progress, 'number');

  if (statusRes.body.data.status === 'COMPLETED') {
    const dlRes = await request(app).get(`/api/exports/${taskId}/download`).set('Authorization', `Bearer ${token}`);
    assert.strictEqual(dlRes.status, 200);
    assert.ok(dlRes.headers['content-type'].includes('csv'));
    assert.ok(dlRes.text.startsWith('\uFEFF') || dlRes.text.includes('发放月份'));
  }
});

test('导出任务：不存在的任务返回 404', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/exports/99999').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 404);
});

test('导出任务：未完成的任务不能下载', async () => {
  const token = await loginAs('operator', 'operator123');

  const store = require('../src/data/store');
  const task = await store.createExportTask({
    taskKey: 'test:pending',
    type: 'ORDER_DETAIL',
    status: 'PENDING',
    fileName: 'test.csv',
  });

  const dlRes = await request(app).get(`/api/exports/${task.id}/download`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(dlRes.status, 409);
});

test('空值零态构建函数返回完整零值结构', () => {
  const empty = buildEmptyOverview();
  assert.strictEqual(empty.todayDinerCount, 0);
  assert.strictEqual(empty.todaySubsidyTotal, 0);
  assert.strictEqual(empty.nutritionComplianceRate, 0);
  assert.ok(Array.isArray(empty.todayCanteenOccupancy));
  assert.strictEqual(empty.todayMealTypeDistribution.length, 3);
  assert.strictEqual(empty.diningTypeRatio.length, 2);

  const emptyBd = buildEmptyBreakdown();
  assert.strictEqual(emptyBd.totalDiners, 0);
  assert.strictEqual(emptyBd.totalAmount, 0);
  assert.ok(Array.isArray(emptyBd.byCanteen));
  assert.ok(Array.isArray(emptyBd.byTimeBucket));
});

test('zeroOrNum 正确处理各种空值', () => {
  assert.strictEqual(zeroOrNum(null), 0);
  assert.strictEqual(zeroOrNum(undefined), 0);
  assert.strictEqual(zeroOrNum(NaN), 0);
  assert.strictEqual(zeroOrNum(''), 0);
  assert.strictEqual(zeroOrNum('abc'), 0);
  assert.strictEqual(zeroOrNum(0), 0);
  assert.strictEqual(zeroOrNum(123), 123);
  assert.strictEqual(zeroOrNum('456'), 456);
});

test('无效导出类型返回 400', async () => {
  const token = await loginAs('operator', 'operator123');
  const res = await request(app).post('/api/exports').set('Authorization', `Bearer ${token}`).send({ type: 'INVALID' });
  assert.strictEqual(res.status, 400);
});

test('无 token 访问统计接口 401', async () => {
  const res = await request(app).get('/api/analytics/overview');
  assert.strictEqual(res.status, 401);
});

test('总览接口结构与明细金额一致', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/analytics/overview?date=2026-06-21').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const d = res.body.data;

  const sumSubsidyByLevel = d.todaySubsidyByLevel.reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(sumSubsidyByLevel, d.todaySubsidyTotal);

  const sumSubsidyByIdentity = d.todaySubsidyByIdentity.reduce((s, x) => s + x.amount, 0);
  assert.strictEqual(sumSubsidyByIdentity, d.todaySubsidyTotal);

  const sumMealCount = d.todayMealTypeDistribution.reduce((s, x) => s + x.count, 0);
  assert.strictEqual(sumMealCount, d.todayDinerCount);

  const sumDiningCount = d.diningTypeRatio.reduce((s, x) => s + x.count, 0);
  assert.strictEqual(sumDiningCount, d.todayDinerCount);

  assert.strictEqual(d.nutritionTotal, 3);
  assert.strictEqual(d.nutritionCompliant, 2);
  assert.ok(d.nutritionComplianceRate > 0.66 && d.nutritionComplianceRate < 0.67);
});
