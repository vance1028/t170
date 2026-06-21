'use strict';

const { getPool } = require('../db');
const { hashPassword } = require('../utils/password');
const { buildTimeBucketExpr } = require('./aggregator');

/** 数据仓储层：SQL 集中此处，路由层只调用这些 async 方法，对外返回 camelCase。 */

/* ----------------------------- 映射 ----------------------------- */
function mapUser(r) {
  if (!r) return null;
  return { id: r.id, username: r.username, name: r.name, role: r.role, status: r.status, createdAt: r.created_at };
}
function mapUserWithHash(r) { return r ? { ...mapUser(r), passwordHash: r.password_hash } : null; }
function mapCanteen(r) {
  if (!r) return null;
  return { id: r.id, code: r.code, name: r.name, district: r.district, address: r.address, capacity: r.capacity, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function mapElder(r) {
  if (!r) return null;
  return { id: r.id, code: r.code, name: r.name, gender: r.gender, age: r.age, phone: r.phone, subsidyLevel: r.subsidy_level, dietary: r.dietary, canteenId: r.canteen_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function mapMeal(r) {
  if (!r) return null;
  return {
    id: r.id,
    canteenId: r.canteen_id,
    serveDate: r.serve_date,
    mealType: r.meal_type,
    dishName: r.dish_name,
    priceCents: r.price_cents,
    calories: r.calories,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapOrder(r) {
  if (!r) return null;
  return { id: r.id, elderId: r.elder_id, mealId: r.meal_id, diningType: r.dining_type, qty: r.qty, amountCents: r.amount_cents, subsidyCents: r.subsidy_cents, payCents: r.pay_cents, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
}
function mapExportTask(r) {
  if (!r) return null;
  let params = null;
  if (r.params !== null && r.params !== undefined) {
    if (typeof r.params === 'string') {
      try { params = JSON.parse(r.params); } catch (_) { params = null; }
    } else {
      params = r.params;
    }
  }
  return {
    id: r.id,
    taskKey: r.task_key,
    type: r.type,
    params,
    status: r.status,
    totalCount: r.total_count,
    processedCount: r.processed_count,
    filePath: r.file_path,
    fileName: r.file_name,
    errorMessage: r.error_message,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ----------------------------- 用户 ----------------------------- */
async function getUserByUsername(u) { const [r] = await getPool().query('SELECT * FROM users WHERE username=?', [u]); return mapUserWithHash(r[0]); }
async function getUserById(id) { const [r] = await getPool().query('SELECT * FROM users WHERE id=?', [id]); return mapUser(r[0]); }
async function listUsers() { const [r] = await getPool().query('SELECT * FROM users ORDER BY id'); return r.map(mapUser); }
async function createUser({ username, password, name, role = 'VIEWER', status = 'ACTIVE' }) {
  const [x] = await getPool().query('INSERT INTO users (username,password_hash,name,role,status) VALUES (?,?,?,?,?)', [username, hashPassword(password), name, role, status]);
  return getUserById(x.insertId);
}
async function updateUser(id, f) {
  const sets = []; const p = [];
  for (const [k, col] of Object.entries({ name: 'name', role: 'role', status: 'status' })) if (f[k] !== undefined) { sets.push(`${col}=?`); p.push(f[k]); }
  if (f.password !== undefined) { sets.push('password_hash=?'); p.push(hashPassword(f.password)); }
  if (sets.length) { p.push(id); await getPool().query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, p); }
  return getUserById(id);
}
async function deleteUser(id) { const [x] = await getPool().query('DELETE FROM users WHERE id=?', [id]); return x.affectedRows > 0; }
async function countUsers() { const [r] = await getPool().query('SELECT COUNT(*) AS n FROM users'); return r[0].n; }

/* ----------------------------- 助餐点 ----------------------------- */
async function listCanteens({ district, status, keyword } = {}) {
  const w = []; const p = [];
  if (district) { w.push('district=?'); p.push(district); }
  if (status) { w.push('status=?'); p.push(status); }
  if (keyword) { w.push('(code LIKE ? OR name LIKE ?)'); const k = `%${keyword}%`; p.push(k, k); }
  const c = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const [r] = await getPool().query(`SELECT * FROM canteens ${c} ORDER BY id DESC`, p); return r.map(mapCanteen);
}
async function getCanteenById(id) { const [r] = await getPool().query('SELECT * FROM canteens WHERE id=?', [id]); return mapCanteen(r[0]); }
async function getCanteenByCode(code) { const [r] = await getPool().query('SELECT * FROM canteens WHERE code=?', [code]); return mapCanteen(r[0]); }
async function createCanteen(d) {
  const [x] = await getPool().query('INSERT INTO canteens (code,name,district,address,capacity,status) VALUES (?,?,?,?,?,?)', [d.code, d.name, d.district, d.address || '', d.capacity || 0, d.status || 'OPEN']);
  return getCanteenById(x.insertId);
}
async function updateCanteen(id, d) {
  const sets = []; const p = [];
  for (const [k, col] of Object.entries({ name: 'name', district: 'district', address: 'address', capacity: 'capacity', status: 'status' })) if (d[k] !== undefined) { sets.push(`${col}=?`); p.push(d[k]); }
  if (sets.length) { sets.push('updated_at=CURRENT_TIMESTAMP(3)'); p.push(id); await getPool().query(`UPDATE canteens SET ${sets.join(',')} WHERE id=?`, p); }
  return getCanteenById(id);
}
async function deleteCanteen(id) { const [x] = await getPool().query('DELETE FROM canteens WHERE id=?', [id]); return x.affectedRows > 0; }

/* ----------------------------- 长者 ----------------------------- */
async function listElders({ canteenId, subsidyLevel, status, keyword } = {}) {
  const w = []; const p = [];
  if (canteenId !== undefined) { w.push('canteen_id=?'); p.push(canteenId); }
  if (subsidyLevel) { w.push('subsidy_level=?'); p.push(subsidyLevel); }
  if (status) { w.push('status=?'); p.push(status); }
  if (keyword) { w.push('(code LIKE ? OR name LIKE ? OR phone LIKE ?)'); const k = `%${keyword}%`; p.push(k, k, k); }
  const c = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const [r] = await getPool().query(`SELECT * FROM elders ${c} ORDER BY id DESC`, p); return r.map(mapElder);
}
async function getElderById(id) { const [r] = await getPool().query('SELECT * FROM elders WHERE id=?', [id]); return mapElder(r[0]); }
async function getElderByCode(code) { const [r] = await getPool().query('SELECT * FROM elders WHERE code=?', [code]); return mapElder(r[0]); }
async function createElder(d) {
  const [x] = await getPool().query('INSERT INTO elders (code,name,gender,age,phone,subsidy_level,dietary,canteen_id,status) VALUES (?,?,?,?,?,?,?,?,?)',
    [d.code, d.name, d.gender || 'U', d.age || 0, d.phone || '', d.subsidyLevel || 'C', d.dietary || '', d.canteenId ?? null, d.status || 'ACTIVE']);
  return getElderById(x.insertId);
}
async function updateElder(id, d) {
  const map = { name: 'name', gender: 'gender', age: 'age', phone: 'phone', subsidyLevel: 'subsidy_level', dietary: 'dietary', canteenId: 'canteen_id', status: 'status' };
  const sets = []; const p = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) { sets.push(`${col}=?`); p.push(d[k]); }
  if (sets.length) { sets.push('updated_at=CURRENT_TIMESTAMP(3)'); p.push(id); await getPool().query(`UPDATE elders SET ${sets.join(',')} WHERE id=?`, p); }
  return getElderById(id);
}
async function deleteElder(id) { const [x] = await getPool().query('DELETE FROM elders WHERE id=?', [id]); return x.affectedRows > 0; }

/* ----------------------------- 餐次 ----------------------------- */
async function listMeals({ canteenId, serveDate, mealType, status } = {}) {
  const w = []; const p = [];
  if (canteenId !== undefined) { w.push('canteen_id=?'); p.push(canteenId); }
  if (serveDate) { w.push('serve_date=?'); p.push(serveDate); }
  if (mealType) { w.push('meal_type=?'); p.push(mealType); }
  if (status) { w.push('status=?'); p.push(status); }
  const c = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const [r] = await getPool().query(`SELECT * FROM meals ${c} ORDER BY serve_date DESC, id DESC`, p); return r.map(mapMeal);
}
async function getMealById(id) { const [r] = await getPool().query('SELECT * FROM meals WHERE id=?', [id]); return mapMeal(r[0]); }
async function createMeal(d) {
  const [x] = await getPool().query(
    'INSERT INTO meals (canteen_id,serve_date,meal_type,dish_name,price_cents,calories,protein_g,carbs_g,fat_g,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [d.canteenId, d.serveDate, d.mealType || 'LUNCH', d.dishName, d.priceCents || 0,
     d.calories || 0, d.proteinG || 0, d.carbsG || 0, d.fatG || 0, d.status || 'PUBLISHED']);
  return getMealById(x.insertId);
}
async function updateMeal(id, d) {
  const map = {
    serveDate: 'serve_date', mealType: 'meal_type', dishName: 'dish_name',
    priceCents: 'price_cents', calories: 'calories', proteinG: 'protein_g',
    carbsG: 'carbs_g', fatG: 'fat_g', status: 'status'
  };
  const sets = []; const p = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) { sets.push(`${col}=?`); p.push(d[k]); }
  if (sets.length) { sets.push('updated_at=CURRENT_TIMESTAMP(3)'); p.push(id); await getPool().query(`UPDATE meals SET ${sets.join(',')} WHERE id=?`, p); }
  return getMealById(id);
}
async function deleteMeal(id) { const [x] = await getPool().query('DELETE FROM meals WHERE id=?', [id]); return x.affectedRows > 0; }

/* ----------------------------- 订餐 ----------------------------- */
async function listOrders({ elderId, mealId, status } = {}) {
  const w = []; const p = [];
  if (elderId !== undefined) { w.push('elder_id=?'); p.push(elderId); }
  if (mealId !== undefined) { w.push('meal_id=?'); p.push(mealId); }
  if (status) { w.push('status=?'); p.push(status); }
  const c = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const [r] = await getPool().query(`SELECT * FROM orders ${c} ORDER BY id DESC`, p); return r.map(mapOrder);
}
async function getOrderById(id) { const [r] = await getPool().query('SELECT * FROM orders WHERE id=?', [id]); return mapOrder(r[0]); }
async function createOrder(d) {
  const [x] = await getPool().query('INSERT INTO orders (elder_id,meal_id,dining_type,qty,amount_cents,subsidy_cents,pay_cents,status) VALUES (?,?,?,?,?,?,?,?)',
    [d.elderId, d.mealId, d.diningType || 'DINE_IN', d.qty || 1, d.amountCents || 0, d.subsidyCents || 0, d.payCents || 0, d.status || 'RESERVED']);
  return getOrderById(x.insertId);
}
async function updateOrder(id, d) {
  const map = { diningType: 'dining_type', qty: 'qty', amountCents: 'amount_cents', subsidyCents: 'subsidy_cents', payCents: 'pay_cents', status: 'status' };
  const sets = []; const p = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) { sets.push(`${col}=?`); p.push(d[k]); }
  if (sets.length) { sets.push('updated_at=CURRENT_TIMESTAMP(3)'); p.push(id); await getPool().query(`UPDATE orders SET ${sets.join(',')} WHERE id=?`, p); }
  return getOrderById(id);
}

/* ----------------------------- 导出任务 ----------------------------- */
async function getExportTaskById(id) { const [r] = await getPool().query('SELECT * FROM export_tasks WHERE id=?', [id]); return mapExportTask(r[0]); }
async function getExportTaskByKey(taskKey) { const [r] = await getPool().query('SELECT * FROM export_tasks WHERE task_key=?', [taskKey]); return mapExportTask(r[0]); }
async function listExportTasks({ type, status } = {}) {
  const w = []; const p = [];
  if (type) { w.push('type=?'); p.push(type); }
  if (status) { w.push('status=?'); p.push(status); }
  const c = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const [r] = await getPool().query(`SELECT * FROM export_tasks ${c} ORDER BY id DESC LIMIT 100`, p);
  return r.map(mapExportTask);
}
async function createExportTask(d) {
  const paramsJson = d.params ? JSON.stringify(d.params) : null;
  const [x] = await getPool().query(
    'INSERT INTO export_tasks (task_key, type, params, status, total_count, processed_count, file_name, created_by) VALUES (?,?,?,?,?,?,?,?)',
    [d.taskKey, d.type, paramsJson, d.status || 'PENDING', d.totalCount || 0, d.processedCount || 0, d.fileName || null, d.createdBy ?? null]
  );
  return getExportTaskById(x.insertId);
}
async function updateExportTask(id, d) {
  const map = { status: 'status', totalCount: 'total_count', processedCount: 'processed_count', filePath: 'file_path', fileName: 'file_name', errorMessage: 'error_message' };
  const sets = []; const p = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) { sets.push(`${col}=?`); p.push(d[k]); }
  if (sets.length) { sets.push('updated_at=CURRENT_TIMESTAMP(3)'); p.push(id); await getPool().query(`UPDATE export_tasks SET ${sets.join(',')} WHERE id=?`, p); }
  return getExportTaskById(id);
}
async function upsertExportTask(taskKey, d) {
  const existing = await getExportTaskByKey(taskKey);
  if (existing) return existing;
  return createExportTask({ ...d, taskKey });
}

/* ----------------------------- 聚合查询：一次查出，无 N+1 ----------------------------- */

async function getTodayDinerCountByCanteen(date) {
  const sql = `
    SELECT m.canteen_id,
           SUM(o.qty) AS diner_count,
           COUNT(DISTINCT o.elder_id) AS unique_elders
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED')
    GROUP BY m.canteen_id
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

async function getMealTypeDistribution(date) {
  const sql = `
    SELECT m.meal_type, SUM(o.qty) AS count
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED')
    GROUP BY m.meal_type
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

async function getSubsidyByLevel(dateStart, dateEnd) {
  const sql = `
    SELECT e.subsidy_level, SUM(o.subsidy_cents) AS amount
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    WHERE m.serve_date BETWEEN ? AND ? AND o.status IN ('RESERVED','SERVED')
    GROUP BY e.subsidy_level
  `;
  const [r] = await getPool().query(sql, [dateStart, dateEnd]);
  return r;
}

async function getSubsidyByIdentity(dateStart, dateEnd) {
  const sql = `
    SELECT
      CASE
        WHEN e.subsidy_level = 'A' THEN 'LOW_INCOME'
        WHEN e.age >= 80 THEN 'EMPTY_NEST'
        ELSE 'GENERAL'
      END AS identity_category,
      SUM(o.subsidy_cents) AS amount
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    WHERE m.serve_date BETWEEN ? AND ? AND o.status IN ('RESERVED','SERVED')
    GROUP BY identity_category
  `;
  const [r] = await getPool().query(sql, [dateStart, dateEnd]);
  return r;
}

async function getSelfPayTotal(date) {
  const sql = `
    SELECT SUM(o.pay_cents) AS amount
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED')
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

async function getDiningTypeRatio(date) {
  const sql = `
    SELECT o.dining_type, SUM(o.qty) AS count
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED')
    GROUP BY o.dining_type
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

async function getNutritionCompliance(date) {
  const sql = `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN m.calories >= 400 AND m.protein_g >= 15 AND m.fat_g <= 30 THEN 1 ELSE 0 END) AS compliant
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED')
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

async function getNoShowStats(date) {
  const sql = `
    SELECT o.status, SUM(o.qty) AS count
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED','NO_SHOW')
    GROUP BY o.status
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

async function getHeatmapData(date) {
  const sql = `
    SELECT
      m.canteen_id,
      HOUR(o.created_at) AS hour,
      FLOOR(MINUTE(o.created_at) / 30) * 30 AS minute,
      SUM(o.qty) AS count
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    WHERE m.serve_date = ? AND o.status IN ('RESERVED','SERVED')
    GROUP BY m.canteen_id, hour, minute
  `;
  const [r] = await getPool().query(sql, [date]);
  return r;
}

/* ----------------------------- 下钻聚合查询 ----------------------------- */

async function getBreakdownTotals(filters) {
  const { where, params } = buildBreakdownWhere(filters);
  const sql = `
    SELECT
      SUM(o.qty) AS diner_count,
      SUM(o.amount_cents) AS amount,
      SUM(o.subsidy_cents) AS subsidy,
      SUM(o.pay_cents) AS self_pay
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

async function getBreakdownByMealType(filters) {
  const { where, params } = buildBreakdownWhere(filters);
  const sql = `
    SELECT m.meal_type, SUM(o.qty) AS count, SUM(o.amount_cents) AS amount
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY m.meal_type
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

async function getBreakdownByDiningType(filters) {
  const { where, params } = buildBreakdownWhere(filters);
  const sql = `
    SELECT o.dining_type, SUM(o.qty) AS count, SUM(o.amount_cents) AS amount
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY o.dining_type
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

async function getBreakdownBySubsidyLevel(filters) {
  const { where, params } = buildBreakdownWhere(filters);
  const sql = `
    SELECT e.subsidy_level, SUM(o.qty) AS count, SUM(o.subsidy_cents) AS amount
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY e.subsidy_level
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

async function getBreakdownByCanteen(filters) {
  const { where, params } = buildBreakdownWhere(filters);
  const sql = `
    SELECT
      m.canteen_id,
      c.name AS canteen_name,
      c.district,
      SUM(o.qty) AS diner_count,
      SUM(o.amount_cents) AS amount,
      SUM(o.subsidy_cents) AS subsidy,
      SUM(o.pay_cents) AS self_pay
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY m.canteen_id, c.name, c.district
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

async function getBreakdownByDistrict(filters) {
  const { where, params } = buildBreakdownWhere(filters);
  const sql = `
    SELECT
      c.district,
      SUM(o.qty) AS diner_count,
      SUM(o.amount_cents) AS amount,
      SUM(o.subsidy_cents) AS subsidy,
      SUM(o.pay_cents) AS self_pay
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY c.district
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

async function getBreakdownByTimeBucket(filters, granularity) {
  const { where, params } = buildBreakdownWhere(filters);
  const bucketExpr = buildTimeBucketExpr(granularity);
  const sql = `
    SELECT
      ${bucketExpr} AS bucket,
      SUM(o.qty) AS diner_count,
      SUM(o.amount_cents) AS amount,
      SUM(o.subsidy_cents) AS subsidy,
      SUM(o.pay_cents) AS self_pay
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY bucket
    ORDER BY bucket
  `;
  const [r] = await getPool().query(sql, params);
  return r;
}

function buildBreakdownWhere({ dateStart, dateEnd, district, canteenId, mealType, diningType, subsidyLevel } = {}) {
  const w = []; const p = [];
  w.push("o.status IN ('RESERVED','SERVED')");
  if (dateStart) { w.push('m.serve_date >= ?'); p.push(dateStart); }
  if (dateEnd) { w.push('m.serve_date <= ?'); p.push(dateEnd); }
  if (district) { w.push('c.district = ?'); p.push(district); }
  if (canteenId !== undefined) { w.push('m.canteen_id = ?'); p.push(canteenId); }
  if (mealType) { w.push('m.meal_type = ?'); p.push(mealType); }
  if (diningType) { w.push('o.dining_type = ?'); p.push(diningType); }
  if (subsidyLevel) { w.push('e.subsidy_level = ?'); p.push(subsidyLevel); }
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

/* ----------------------------- 导出数据查询 ----------------------------- */

async function getOrderDetailForExport(params) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  const sql = `
    SELECT
      o.id,
      e.code AS elder_code,
      e.name AS elder_name,
      e.subsidy_level,
      c.name AS canteen_name,
      c.district,
      m.serve_date,
      m.meal_type,
      m.dish_name,
      o.dining_type,
      o.qty,
      o.amount_cents,
      o.subsidy_cents,
      o.pay_cents,
      o.status,
      o.created_at
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    ORDER BY o.id
  `;
  const [r] = await getPool().query(sql, qParams);
  return r;
}

async function getSubsidyLedgerForExport(params) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  const sql = `
    SELECT
      DATE_FORMAT(m.serve_date, '%Y-%m') AS month,
      c.district,
      c.name AS canteen_name,
      e.code AS elder_code,
      e.name AS elder_name,
      e.subsidy_level,
      CASE
        WHEN e.subsidy_level = 'A' THEN '低保'
        WHEN e.age >= 80 THEN '高龄空巢'
        ELSE '普通长者'
      END AS identity_category,
      SUM(o.qty) AS meal_count,
      SUM(o.subsidy_cents) AS subsidy_total,
      SUM(o.pay_cents) AS self_pay_total,
      SUM(o.amount_cents) AS amount_total
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY month, c.district, c.name, e.code, e.name, e.subsidy_level, identity_category
    ORDER BY month, c.district, c.name, e.code
  `;
  const [r] = await getPool().query(sql, qParams);
  return r;
}

async function getMealStatisticsForExport(params, granularity) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  const bucketExpr = buildTimeBucketExpr(granularity);
  const sql = `
    SELECT
      ${bucketExpr} AS bucket,
      c.district,
      c.name AS canteen_name,
      m.meal_type,
      SUM(o.qty) AS diner_count,
      SUM(CASE WHEN o.dining_type = 'DINE_IN' THEN o.qty ELSE 0 END) AS dine_in_count,
      SUM(CASE WHEN o.dining_type = 'DELIVERY' THEN o.qty ELSE 0 END) AS delivery_count,
      SUM(o.subsidy_cents) AS subsidy_total,
      SUM(o.pay_cents) AS self_pay_total,
      SUM(o.amount_cents) AS amount_total,
      SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END) AS no_show_count,
      CASE
        WHEN SUM(o.qty) + SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END) > 0
        THEN SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END) / (SUM(o.qty) + SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END))
        ELSE 0
      END AS no_show_rate
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY bucket, c.district, c.name, m.meal_type
    ORDER BY bucket, c.district, c.name, m.meal_type
  `;
  const [r] = await getPool().query(sql, qParams);
  return r;
}

async function getOrderDetailForExportBatch(params, limit, offset) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  const sql = `
    SELECT
      o.id,
      e.code AS elder_code,
      e.name AS elder_name,
      e.subsidy_level,
      c.name AS canteen_name,
      c.district,
      m.serve_date,
      m.meal_type,
      m.dish_name,
      o.dining_type,
      o.qty,
      o.amount_cents,
      o.subsidy_cents,
      o.pay_cents,
      o.status,
      o.created_at
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    ORDER BY o.id
    LIMIT ? OFFSET ?
  `;
  const [r] = await getPool().query(sql, [...qParams, Number(limit), Number(offset)]);
  return r;
}

async function getSubsidyLedgerForExportBatch(params, limit, offset) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  const sql = `
    SELECT
      DATE_FORMAT(m.serve_date, '%Y-%m') AS month,
      c.district,
      c.name AS canteen_name,
      e.code AS elder_code,
      e.name AS elder_name,
      e.subsidy_level,
      CASE
        WHEN e.subsidy_level = 'A' THEN '低保'
        WHEN e.age >= 80 THEN '高龄空巢'
        ELSE '普通长者'
      END AS identity_category,
      SUM(o.qty) AS meal_count,
      SUM(o.subsidy_cents) AS subsidy_total,
      SUM(o.pay_cents) AS self_pay_total,
      SUM(o.amount_cents) AS amount_total
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY month, c.district, c.name, e.code, e.name, e.subsidy_level, identity_category
    ORDER BY month, c.district, c.name, e.code
    LIMIT ? OFFSET ?
  `;
  const [r] = await getPool().query(sql, [...qParams, Number(limit), Number(offset)]);
  return r;
}

async function getMealStatisticsForExportBatch(params, granularity, limit, offset) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  const bucketExpr = buildTimeBucketExpr(granularity);
  const sql = `
    SELECT
      ${bucketExpr} AS bucket,
      c.district,
      c.name AS canteen_name,
      m.meal_type,
      SUM(o.qty) AS diner_count,
      SUM(CASE WHEN o.dining_type = 'DINE_IN' THEN o.qty ELSE 0 END) AS dine_in_count,
      SUM(CASE WHEN o.dining_type = 'DELIVERY' THEN o.qty ELSE 0 END) AS delivery_count,
      SUM(o.subsidy_cents) AS subsidy_total,
      SUM(o.pay_cents) AS self_pay_total,
      SUM(o.amount_cents) AS amount_total,
      SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END) AS no_show_count,
      CASE
        WHEN SUM(o.qty) + SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END) > 0
        THEN SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END) / (SUM(o.qty) + SUM(CASE WHEN o.status = 'NO_SHOW' THEN o.qty ELSE 0 END))
        ELSE 0
      END AS no_show_rate
    FROM orders o
    INNER JOIN meals m ON o.meal_id = m.id
    INNER JOIN elders e ON o.elder_id = e.id
    INNER JOIN canteens c ON m.canteen_id = c.id
    ${where}
    GROUP BY bucket, c.district, c.name, m.meal_type
    ORDER BY bucket, c.district, c.name, m.meal_type
    LIMIT ? OFFSET ?
  `;
  const [r] = await getPool().query(sql, [...qParams, Number(limit), Number(offset)]);
  return r;
}

async function getExportDataCount(type, params) {
  const { where, params: qParams } = buildBreakdownWhere(params);
  let sql;
  switch (type) {
    case 'SUBSIDY_LEDGER':
      sql = `
        SELECT COUNT(*) AS n
        FROM (
          SELECT 1
          FROM orders o
          INNER JOIN meals m ON o.meal_id = m.id
          INNER JOIN elders e ON o.elder_id = e.id
          INNER JOIN canteens c ON m.canteen_id = c.id
          ${where}
          GROUP BY DATE_FORMAT(m.serve_date, '%Y-%m'), c.district, c.name, e.code
        ) AS sub
      `;
      break;
    case 'MEAL_STATISTICS':
      sql = `
        SELECT COUNT(*) AS n
        FROM (
          SELECT 1
          FROM orders o
          INNER JOIN meals m ON o.meal_id = m.id
          INNER JOIN elders e ON o.elder_id = e.id
          INNER JOIN canteens c ON m.canteen_id = c.id
          ${where}
          GROUP BY ${buildTimeBucketExpr(params.granularity || 'day')}, c.district, c.name, m.meal_type
        ) AS sub
      `;
      break;
    case 'ORDER_DETAIL':
    default:
      sql = `
        SELECT COUNT(*) AS n
        FROM orders o
        INNER JOIN meals m ON o.meal_id = m.id
        INNER JOIN elders e ON o.elder_id = e.id
        INNER JOIN canteens c ON m.canteen_id = c.id
        ${where}
      `;
  }
  const [r] = await getPool().query(sql, qParams);
  return r[0] ? r[0].n : 0;
}

module.exports = {
  mapUser, mapCanteen, mapElder, mapMeal, mapOrder, mapExportTask,
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, countUsers,
  listCanteens, getCanteenById, getCanteenByCode, createCanteen, updateCanteen, deleteCanteen,
  listElders, getElderById, getElderByCode, createElder, updateElder, deleteElder,
  listMeals, getMealById, createMeal, updateMeal, deleteMeal,
  listOrders, getOrderById, createOrder, updateOrder,
  getExportTaskById, getExportTaskByKey, listExportTasks, createExportTask, updateExportTask, upsertExportTask,
  getTodayDinerCountByCanteen,
  getMealTypeDistribution,
  getSubsidyByLevel,
  getSubsidyByIdentity,
  getSelfPayTotal,
  getDiningTypeRatio,
  getNutritionCompliance,
  getNoShowStats,
  getHeatmapData,
  getBreakdownTotals,
  getBreakdownByMealType,
  getBreakdownByDiningType,
  getBreakdownBySubsidyLevel,
  getBreakdownByCanteen,
  getBreakdownByDistrict,
  getBreakdownByTimeBucket,
  getOrderDetailForExport,
  getSubsidyLedgerForExport,
  getMealStatisticsForExport,
  getOrderDetailForExportBatch,
  getSubsidyLedgerForExportBatch,
  getMealStatisticsForExportBatch,
  getExportDataCount,
};
