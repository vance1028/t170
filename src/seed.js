'use strict';

const store = require('./data/store');

/**
 * 种子数据：管理员/食堂工作人员/观察员各一个账号，
 * 外加若干助餐点、长者、餐次与订餐，方便本地起步与「功能迭代」类任务直接有数据可用。
 * 幂等：库中已有用户则跳过。
 */
async function seed() {
  if ((await store.countUsers()) > 0) return { skipped: true };

  await store.createUser({ username: 'admin', password: 'admin123', name: '系统管理员', role: 'ADMIN' });
  await store.createUser({ username: 'operator', password: 'operator123', name: '张师傅', role: 'OPERATOR' });
  await store.createUser({ username: 'viewer', password: 'viewer123', name: '李社工', role: 'VIEWER' });

  const c1 = await store.createCanteen({ code: 'CT-CG-001', name: '城关街道长者食堂', district: '城关区', address: '幸福路12号', capacity: 80, status: 'OPEN' });
  const c2 = await store.createCanteen({ code: 'CT-JN-002', name: '江南社区助餐点', district: '江南区', address: '滨河东路5号', capacity: 50, status: 'OPEN' });
  await store.createCanteen({ code: 'CT-GX-003', name: '高新颐养中心餐厅', district: '高新区', address: '科苑路88号', capacity: 60, status: 'CLOSED' });

  const e1 = await store.createElder({ code: 'E-0001', name: '王秀英', gender: 'F', age: 78, phone: '13800000001', subsidyLevel: 'A', dietary: '低盐、忌花生', canteenId: c1.id });
  const e2 = await store.createElder({ code: 'E-0002', name: '赵建国', gender: 'M', age: 82, phone: '13800000002', subsidyLevel: 'B', dietary: '糖尿病、少糖', canteenId: c1.id });
  await store.createElder({ code: 'E-0003', name: '陈桂兰', gender: 'F', age: 69, phone: '13800000003', subsidyLevel: 'C', dietary: '', canteenId: c2.id });

  const m1 = await store.createMeal({ canteenId: c1.id, serveDate: '2026-06-18', mealType: 'LUNCH', dishName: '清蒸鲈鱼套餐', priceCents: 1500, calories: 520, proteinG: 28, carbsG: 45, fatG: 22, status: 'PUBLISHED' });
  const m2 = await store.createMeal({ canteenId: c1.id, serveDate: '2026-06-18', mealType: 'DINNER', dishName: '番茄牛腩面', priceCents: 1200, calories: 480, proteinG: 22, carbsG: 55, fatG: 18, status: 'PUBLISHED' });
  await store.createMeal({ canteenId: c2.id, serveDate: '2026-06-18', mealType: 'LUNCH', dishName: '香菇鸡肉饭', priceCents: 1300, calories: 450, proteinG: 25, carbsG: 50, fatG: 15, status: 'PUBLISHED' });

  const o1 = await store.createOrder({ elderId: e1.id, mealId: m1.id, diningType: 'DINE_IN', qty: 1, amountCents: 1500, subsidyCents: 900, payCents: 600, status: 'RESERVED' });
  await store.updateOrder(o1.id, { status: 'SERVED' });
  await store.createOrder({ elderId: e2.id, mealId: m2.id, diningType: 'DELIVERY', qty: 1, amountCents: 1200, subsidyCents: 600, payCents: 600, status: 'RESERVED' });

  const today = '2026-06-21';
  const tm1 = await store.createMeal({ canteenId: c1.id, serveDate: today, mealType: 'BREAKFAST', dishName: '营养早餐粥', priceCents: 600, calories: 350, proteinG: 12, carbsG: 55, fatG: 8, status: 'PUBLISHED' });
  const tm2 = await store.createMeal({ canteenId: c1.id, serveDate: today, mealType: 'LUNCH', dishName: '红烧排骨套餐', priceCents: 1800, calories: 580, proteinG: 32, carbsG: 48, fatG: 25, status: 'PUBLISHED' });
  const tm3 = await store.createMeal({ canteenId: c1.id, serveDate: today, mealType: 'DINNER', dishName: '小米粥配包子', priceCents: 800, calories: 420, proteinG: 14, carbsG: 60, fatG: 12, status: 'PUBLISHED' });
  const tm4 = await store.createMeal({ canteenId: c2.id, serveDate: today, mealType: 'LUNCH', dishName: '清蒸鳕鱼套餐', priceCents: 1600, calories: 500, proteinG: 30, carbsG: 42, fatG: 18, status: 'PUBLISHED' });

  const to1 = await store.createOrder({ elderId: e1.id, mealId: tm1.id, diningType: 'DINE_IN', qty: 1, amountCents: 600, subsidyCents: 360, payCents: 240, status: 'RESERVED' });
  await store.updateOrder(to1.id, { status: 'SERVED' });
  const to2 = await store.createOrder({ elderId: e1.id, mealId: tm2.id, diningType: 'DINE_IN', qty: 1, amountCents: 1800, subsidyCents: 1080, payCents: 720, status: 'RESERVED' });
  await store.updateOrder(to2.id, { status: 'SERVED' });
  const to3 = await store.createOrder({ elderId: e2.id, mealId: tm2.id, diningType: 'DELIVERY', qty: 1, amountCents: 1800, subsidyCents: 900, payCents: 900, status: 'RESERVED' });
  await store.updateOrder(to3.id, { status: 'SERVED' });
  const to4 = await store.createOrder({ elderId: e2.id, mealId: tm3.id, diningType: 'DELIVERY', qty: 1, amountCents: 800, subsidyCents: 400, payCents: 400, status: 'NO_SHOW' });

  return { skipped: false, users: 3, canteens: 3, elders: 3, meals: 7, orders: 6 };
}

if (require.main === module) {
  const { getPool, ensureSchema, waitForDb, close } = require('./db');
  (async () => {
    await waitForDb();
    await ensureSchema();
    getPool();
    const result = await seed();
    // eslint-disable-next-line no-console
    console.log('种子数据写入结果:', JSON.stringify(result));
    await close();
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { seed };
