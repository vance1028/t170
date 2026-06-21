'use strict';

const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'];
const DINING_TYPES = ['DINE_IN', 'DELIVERY'];
const SUBSIDY_LEVELS = ['A', 'B', 'C'];
const IDENTITY_CATEGORIES = ['LOW_INCOME', 'EMPTY_NEST', 'GENERAL'];

function zeroOrNum(v) { return v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v); }

function buildEmptyOverview() {
  return {
    todayDiners: 0,
    todayDinerCount: 0,
    todayCanteenOccupancy: [],
    todayMealTypeDistribution: MEAL_TYPES.map(t => ({ mealType: t, count: 0, ratio: 0 })),
    todaySubsidyByLevel: SUBSIDY_LEVELS.map(l => ({ level: l, amount: 0 })),
    todaySubsidyByIdentity: IDENTITY_CATEGORIES.map(c => ({ category: c, amount: 0 })),
    monthSubsidyByLevel: SUBSIDY_LEVELS.map(l => ({ level: l, amount: 0 })),
    monthSubsidyByIdentity: IDENTITY_CATEGORIES.map(c => ({ category: c, amount: 0 })),
    todaySubsidyTotal: 0,
    monthSubsidyTotal: 0,
    todaySelfPayTotal: 0,
    diningTypeRatio: DINING_TYPES.map(t => ({ type: t, count: 0, ratio: 0 })),
    nutritionComplianceRate: 0,
    nutritionCompliant: 0,
    nutritionTotal: 0,
    noShowRate: 0,
    noShowCount: 0,
    reservationCount: 0,
    heatmapData: [],
  };
}

function buildEmptyBreakdown() {
  return {
    totalDiners: 0,
    totalAmount: 0,
    totalSubsidy: 0,
    totalSelfPay: 0,
    byMealType: MEAL_TYPES.map(t => ({ mealType: t, count: 0, amount: 0 })),
    byDiningType: DINING_TYPES.map(t => ({ type: t, count: 0, amount: 0 })),
    bySubsidyLevel: SUBSIDY_LEVELS.map(l => ({ level: l, count: 0, amount: 0 })),
    byCanteen: [],
    byDistrict: [],
    byTimeBucket: [],
  };
}

function buildEmptyHeatmapGrid() {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const result = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      result.push({ hour: h, minute: m, count: 0 });
    }
  }
  return result;
}

function ratio(numerator, denominator, digits = 4) {
  const d = zeroOrNum(denominator);
  if (d === 0) return 0;
  return Math.round((zeroOrNum(numerator) / d) * Math.pow(10, digits)) / Math.pow(10, digits);
}

function summarizeTodayDiners(rows, canteens) {
  const canteenMap = new Map(canteens.map(c => [c.id, c]));
  const byCanteen = new Map();
  let total = 0;
  let totalDiners = 0;

  for (const r of rows) {
    const cid = zeroOrNum(r.canteen_id);
    const cnt = zeroOrNum(r.diner_count);
    const unique = zeroOrNum(r.unique_elders);
    total += cnt;
    totalDiners += unique;
    if (!byCanteen.has(cid)) byCanteen.set(cid, { count: 0, unique: 0 });
    const acc = byCanteen.get(cid);
    acc.count += cnt;
    acc.unique += unique;
  }

  const occupancy = [];
  for (const c of canteens) {
    const d = byCanteen.get(c.id) || { count: 0, unique: 0 };
    const cap = zeroOrNum(c.capacity);
    occupancy.push({
      canteenId: c.id,
      canteenName: c.name,
      district: c.district,
      capacity: cap,
      dinerCount: d.count,
      uniqueElders: d.unique,
      occupancyRate: cap > 0 ? ratio(d.count, cap, 4) : 0,
    });
  }

  return { todayDinerCount: total, todayDiners: totalDiners, occupancy };
}

function summarizeMealTypeDistribution(rows) {
  const map = new Map(MEAL_TYPES.map(t => [t, 0]));
  let total = 0;
  for (const r of rows) {
    const mt = r.meal_type;
    const cnt = zeroOrNum(r.count);
    if (map.has(mt)) {
      map.set(mt, map.get(mt) + cnt);
      total += cnt;
    }
  }
  return MEAL_TYPES.map(t => ({
    mealType: t,
    count: map.get(t) || 0,
    ratio: ratio(map.get(t), total, 4),
  }));
}

function summarizeSubsidyByLevel(rows) {
  const map = new Map(SUBSIDY_LEVELS.map(l => [l, 0]));
  let total = 0;
  for (const r of rows) {
    const lv = r.subsidy_level;
    const amt = zeroOrNum(r.amount);
    if (map.has(lv)) {
      map.set(lv, map.get(lv) + amt);
      total += amt;
    }
  }
  return {
    breakdown: SUBSIDY_LEVELS.map(l => ({ level: l, amount: map.get(l) || 0 })),
    total,
  };
}

function summarizeSubsidyByIdentity(rows) {
  const map = new Map(IDENTITY_CATEGORIES.map(c => [c, 0]));
  let total = 0;
  for (const r of rows) {
    const cat = r.identity_category || 'GENERAL';
    const amt = zeroOrNum(r.amount);
    if (map.has(cat)) {
      map.set(cat, map.get(cat) + amt);
      total += amt;
    } else {
      map.set('GENERAL', map.get('GENERAL') + amt);
      total += amt;
    }
  }
  return {
    breakdown: IDENTITY_CATEGORIES.map(c => ({ category: c, amount: map.get(c) || 0 })),
    total,
  };
}

function summarizeDiningTypeRatio(rows) {
  const map = new Map(DINING_TYPES.map(t => [t, 0]));
  let total = 0;
  for (const r of rows) {
    const dt = r.dining_type;
    const cnt = zeroOrNum(r.count);
    if (map.has(dt)) {
      map.set(dt, map.get(dt) + cnt);
      total += cnt;
    }
  }
  return DINING_TYPES.map(t => ({
    type: t,
    count: map.get(t) || 0,
    ratio: ratio(map.get(t), total, 4),
  }));
}

function summarizeNutrition(rows) {
  let compliant = 0;
  let total = 0;
  for (const r of rows) {
    const t = zeroOrNum(r.total);
    const c = zeroOrNum(r.compliant);
    total += t;
    compliant += c;
  }
  return {
    nutritionCompliant: compliant,
    nutritionTotal: total,
    nutritionComplianceRate: ratio(compliant, total, 4),
  };
}

function summarizeNoShow(rows) {
  let reserved = 0;
  let noShow = 0;
  for (const r of rows) {
    const s = r.status;
    const c = zeroOrNum(r.count);
    if (s === 'RESERVED' || s === 'SERVED') reserved += c;
    if (s === 'NO_SHOW') noShow += c;
  }
  return {
    reservationCount: reserved,
    noShowCount: noShow,
    noShowRate: ratio(noShow, reserved + noShow, 4),
  };
}

function summarizeHeatmap(rows, canteens) {
  const canteenMap = new Map(canteens.map(c => [c.id, c]));
  const result = [];
  for (const r of rows) {
    const cid = zeroOrNum(r.canteen_id);
    const h = zeroOrNum(r.hour);
    const m = zeroOrNum(r.minute);
    const cnt = zeroOrNum(r.count);
    const canteen = canteenMap.get(cid);
    if (!canteen) continue;
    result.push({
      canteenId: cid,
      canteenName: canteen.name,
      district: canteen.district,
      hour: h,
      minute: m,
      count: cnt,
    });
  }
  return result;
}

function aggregateOverview({
  canteens,
  todayDinerRows,
  mealTypeRows,
  todaySubsidyLevelRows,
  todaySubsidyIdentityRows,
  monthSubsidyLevelRows,
  monthSubsidyIdentityRows,
  todaySelfPayRows,
  diningTypeRows,
  nutritionRows,
  noShowRows,
  heatmapRows,
}) {
  const base = buildEmptyOverview();
  const dinerSum = summarizeTodayDiners(todayDinerRows || [], canteens || []);
  base.todayDinerCount = dinerSum.todayDinerCount;
  base.todayDiners = dinerSum.todayDiners;
  base.todayCanteenOccupancy = dinerSum.occupancy;
  base.todayMealTypeDistribution = summarizeMealTypeDistribution(mealTypeRows || []);

  const todayByLevel = summarizeSubsidyByLevel(todaySubsidyLevelRows || []);
  base.todaySubsidyByLevel = todayByLevel.breakdown;
  base.todaySubsidyTotal = todayByLevel.total;

  const todayByIdentity = summarizeSubsidyByIdentity(todaySubsidyIdentityRows || []);
  base.todaySubsidyByIdentity = todayByIdentity.breakdown;

  const monthByLevel = summarizeSubsidyByLevel(monthSubsidyLevelRows || []);
  base.monthSubsidyByLevel = monthByLevel.breakdown;
  base.monthSubsidyTotal = monthByLevel.total;

  const monthByIdentity = summarizeSubsidyByIdentity(monthSubsidyIdentityRows || []);
  base.monthSubsidyByIdentity = monthByIdentity.breakdown;

  let selfPay = 0;
  for (const r of todaySelfPayRows || []) selfPay += zeroOrNum(r.amount);
  base.todaySelfPayTotal = selfPay;

  base.diningTypeRatio = summarizeDiningTypeRatio(diningTypeRows || []);

  const nutri = summarizeNutrition(nutritionRows || []);
  base.nutritionCompliant = nutri.nutritionCompliant;
  base.nutritionTotal = nutri.nutritionTotal;
  base.nutritionComplianceRate = nutri.nutritionComplianceRate;

  const ns = summarizeNoShow(noShowRows || []);
  base.reservationCount = ns.reservationCount;
  base.noShowCount = ns.noShowCount;
  base.noShowRate = ns.noShowRate;

  base.heatmapData = summarizeHeatmap(heatmapRows || [], canteens || []);

  return base;
}

function aggregateBreakdown({
  totalRows,
  mealTypeRows,
  diningTypeRows,
  subsidyLevelRows,
  canteenRows,
  districtRows,
  timeBucketRows,
}) {
  const base = buildEmptyBreakdown();

  for (const r of totalRows || []) {
    base.totalDiners += zeroOrNum(r.diner_count);
    base.totalAmount += zeroOrNum(r.amount);
    base.totalSubsidy += zeroOrNum(r.subsidy);
    base.totalSelfPay += zeroOrNum(r.self_pay);
  }

  const mtMap = new Map(MEAL_TYPES.map(t => [t, { count: 0, amount: 0 }]));
  for (const r of mealTypeRows || []) {
    const mt = r.meal_type;
    if (!mtMap.has(mt)) continue;
    const acc = mtMap.get(mt);
    acc.count += zeroOrNum(r.count);
    acc.amount += zeroOrNum(r.amount);
  }
  base.byMealType = MEAL_TYPES.map(t => ({ mealType: t, ...mtMap.get(t) }));

  const dtMap = new Map(DINING_TYPES.map(t => [t, { count: 0, amount: 0 }]));
  for (const r of diningTypeRows || []) {
    const dt = r.dining_type;
    if (!dtMap.has(dt)) continue;
    const acc = dtMap.get(dt);
    acc.count += zeroOrNum(r.count);
    acc.amount += zeroOrNum(r.amount);
  }
  base.byDiningType = DINING_TYPES.map(t => ({ type: t, ...dtMap.get(t) }));

  const slMap = new Map(SUBSIDY_LEVELS.map(l => [l, { count: 0, amount: 0 }]));
  for (const r of subsidyLevelRows || []) {
    const sl = r.subsidy_level;
    if (!slMap.has(sl)) continue;
    const acc = slMap.get(sl);
    acc.count += zeroOrNum(r.count);
    acc.amount += zeroOrNum(r.amount);
  }
  base.bySubsidyLevel = SUBSIDY_LEVELS.map(l => ({ level: l, ...slMap.get(l) }));

  base.byCanteen = (canteenRows || []).map(r => ({
    canteenId: zeroOrNum(r.canteen_id),
    canteenName: r.canteen_name || '',
    district: r.district || '',
    dinerCount: zeroOrNum(r.diner_count),
    amount: zeroOrNum(r.amount),
    subsidy: zeroOrNum(r.subsidy),
    selfPay: zeroOrNum(r.self_pay),
  }));

  base.byDistrict = (districtRows || []).map(r => ({
    district: r.district || '',
    dinerCount: zeroOrNum(r.diner_count),
    amount: zeroOrNum(r.amount),
    subsidy: zeroOrNum(r.subsidy),
    selfPay: zeroOrNum(r.self_pay),
  }));

  base.byTimeBucket = (timeBucketRows || []).map(r => ({
    bucket: r.bucket || '',
    dinerCount: zeroOrNum(r.diner_count),
    amount: zeroOrNum(r.amount),
    subsidy: zeroOrNum(r.subsidy),
    selfPay: zeroOrNum(r.self_pay),
  }));

  return base;
}

function buildTimeBucketExpr(granularity) {
  switch (granularity) {
    case 'week':
      return "DATE_FORMAT(m.serve_date, '%Y-%u')";
    case 'month':
      return "DATE_FORMAT(m.serve_date, '%Y-%m')";
    case 'day':
    default:
      return "DATE(m.serve_date)";
  }
}

module.exports = {
  MEAL_TYPES,
  DINING_TYPES,
  SUBSIDY_LEVELS,
  IDENTITY_CATEGORIES,
  zeroOrNum,
  ratio,
  buildEmptyOverview,
  buildEmptyBreakdown,
  buildEmptyHeatmapGrid,
  aggregateOverview,
  aggregateBreakdown,
  buildTimeBucketExpr,
  summarizeTodayDiners,
  summarizeMealTypeDistribution,
  summarizeSubsidyByLevel,
  summarizeSubsidyByIdentity,
  summarizeDiningTypeRatio,
  summarizeNutrition,
  summarizeNoShow,
  summarizeHeatmap,
};
