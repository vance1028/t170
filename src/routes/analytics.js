'use strict';

const express = require('express');
const store = require('../data/store');
const { aggregateOverview, aggregateBreakdown, buildEmptyOverview, buildEmptyBreakdown } = require('../data/aggregator');
const { authRequired } = require('../auth');
const { sendData, sendError } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

function getTodayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getMonthRange(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const pad = n => String(n).padStart(2, '0');
  return {
    start: `${firstDay.getFullYear()}-${pad(firstDay.getMonth() + 1)}-${pad(firstDay.getDate())}`,
    end: `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`,
  };
}

function parseDateParam(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

router.get('/overview', async (req, res, next) => {
  try {
    const date = parseDateParam(req.query.date) || getTodayStr();
    const monthRange = getMonthRange(date);

    const canteensPromise = store.listCanteens({ status: 'OPEN' });

    const [
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
    ] = await Promise.all([
      canteensPromise,
      store.getTodayDinerCountByCanteen(date),
      store.getMealTypeDistribution(date),
      store.getSubsidyByLevel(date, date),
      store.getSubsidyByIdentity(date, date),
      store.getSubsidyByLevel(monthRange.start, monthRange.end),
      store.getSubsidyByIdentity(monthRange.start, monthRange.end),
      store.getSelfPayTotal(date),
      store.getDiningTypeRatio(date),
      store.getNutritionCompliance(date),
      store.getNoShowStats(date),
      store.getHeatmapData(date),
    ]);

    const overview = aggregateOverview({
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
    });

    return sendData(res, 200, { date, ...overview });
  } catch (e) { return next(e); }
});

router.get('/overview/empty', async (req, res, next) => {
  try {
    const empty = buildEmptyOverview();
    return sendData(res, 200, { date: getTodayStr(), ...empty });
  } catch (e) { return next(e); }
});

router.get('/breakdown', async (req, res, next) => {
  try {
    const { dateStart, dateEnd, district, canteenId, mealType, diningType, subsidyLevel, granularity = 'day' } = req.query;

    if (!['day', 'week', 'month'].includes(granularity)) {
      return sendError(res, 400, 'granularity 必须是 day/week/month');
    }

    const filters = {
      dateStart: parseDateParam(dateStart),
      dateEnd: parseDateParam(dateEnd),
      district: district || null,
      canteenId: canteenId !== undefined ? Number(canteenId) : undefined,
      mealType: mealType || null,
      diningType: diningType || null,
      subsidyLevel: subsidyLevel || null,
    };

    const [
      totalRows,
      mealTypeRows,
      diningTypeRows,
      subsidyLevelRows,
      canteenRows,
      districtRows,
      timeBucketRows,
    ] = await Promise.all([
      store.getBreakdownTotals(filters),
      store.getBreakdownByMealType(filters),
      store.getBreakdownByDiningType(filters),
      store.getBreakdownBySubsidyLevel(filters),
      store.getBreakdownByCanteen(filters),
      store.getBreakdownByDistrict(filters),
      store.getBreakdownByTimeBucket(filters, granularity),
    ]);

    const breakdown = aggregateBreakdown({
      totalRows,
      mealTypeRows,
      diningTypeRows,
      subsidyLevelRows,
      canteenRows,
      districtRows,
      timeBucketRows,
    });

    return sendData(res, 200, { filters: { granularity, ...filters }, ...breakdown });
  } catch (e) { return next(e); }
});

router.get('/breakdown/empty', async (req, res, next) => {
  try {
    const empty = buildEmptyBreakdown();
    return sendData(res, 200, {
      filters: { granularity: 'day', dateStart: null, dateEnd: null, district: null, canteenId: null, mealType: null, diningType: null, subsidyLevel: null },
      ...empty,
    });
  } catch (e) { return next(e); }
});

router.get('/breakdown/verify', async (req, res, next) => {
  try {
    const { dateStart, dateEnd, district, canteenId, mealType, diningType, subsidyLevel, granularity = 'day' } = req.query;

    const filters = {
      dateStart: parseDateParam(dateStart),
      dateEnd: parseDateParam(dateEnd),
      district: district || null,
      canteenId: canteenId !== undefined ? Number(canteenId) : undefined,
      mealType: mealType || null,
      diningType: diningType || null,
      subsidyLevel: subsidyLevel || null,
    };

    const detailList = await store.getOrderDetailForExport(filters);
    const breakdown = await store.getBreakdownTotals(filters);

    let detailTotal = 0;
    let detailAmount = 0;
    let detailSubsidy = 0;
    let detailSelfPay = 0;
    for (const r of detailList) {
      detailTotal += Number(r.qty) || 0;
      detailAmount += Number(r.amount_cents) || 0;
      detailSubsidy += Number(r.subsidy_cents) || 0;
      detailSelfPay += Number(r.pay_cents) || 0;
    }

    const aggTotal = breakdown[0] ? Number(breakdown[0].diner_count) || 0 : 0;
    const aggAmount = breakdown[0] ? Number(breakdown[0].amount) || 0 : 0;
    const aggSubsidy = breakdown[0] ? Number(breakdown[0].subsidy) || 0 : 0;
    const aggSelfPay = breakdown[0] ? Number(breakdown[0].self_pay) || 0 : 0;

    const match = detailTotal === aggTotal && detailAmount === aggAmount && detailSubsidy === aggSubsidy && detailSelfPay === aggSelfPay;

    return sendData(res, 200, {
      match,
      detailCount: detailList.length,
      detail: { totalDiners: detailTotal, totalAmount: detailAmount, totalSubsidy: detailSubsidy, totalSelfPay: detailSelfPay },
      aggregate: { totalDiners: aggTotal, totalAmount: aggAmount, totalSubsidy: aggSubsidy, totalSelfPay: aggSelfPay },
    });
  } catch (e) { return next(e); }
});

module.exports = router;
