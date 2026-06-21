'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function escapeCsvField(field) {
  if (field === null || field === undefined) return '';
  const s = String(field);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(headers, row) {
  return headers.map(h => escapeCsvField(row[h])).join(',') + '\n';
}

function toCsv(headers, rows) {
  const bom = '\uFEFF';
  const headerRow = headers.map(escapeCsvField).join(',') + '\n';
  let body = '';
  for (const row of rows) {
    body += toCsvRow(headers, row);
  }
  return bom + headerRow + body;
}

function toCsvStream(headers) {
  const bom = '\uFEFF';
  const headerRow = headers.map(escapeCsvField).join(',') + '\n';
  let started = false;

  function transform(row, encoding, callback) {
    if (!started) {
      started = true;
      callback(null, bom + headerRow + toCsvRow(headers, row));
    } else {
      callback(null, toCsvRow(headers, row));
    }
  }

  function flush(callback) {
    callback();
  }

  const { Transform } = require('stream');
  return new Transform({ transform, flush, writableObjectMode: true });
}

function formatDateForFilename(d) {
  const date = d instanceof Date ? d : new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function generateTaskKey(type, params) {
  const sortedParams = {};
  for (const k of Object.keys(params || {}).sort()) {
    sortedParams[k] = params[k];
  }
  const paramStr = JSON.stringify(sortedParams);
  const hash = crypto.createHash('md5').update(paramStr).digest('hex').slice(0, 16);
  return `${type}:${hash}`;
}

function generateFileName(type, params) {
  const dateStr = formatDateForFilename(new Date());
  const paramParts = [];
  if (params) {
    if (params.month) paramParts.push(params.month);
    if (params.district) paramParts.push(params.district);
    if (params.canteenId) paramParts.push(`CT${params.canteenId}`);
  }
  const typeNames = {
    SUBSIDY_LEDGER: '补贴发放台账',
    ORDER_DETAIL: '订餐明细汇总',
    MEAL_STATISTICS: '助餐统计报表',
  };
  const typeName = typeNames[type] || type;
  const suffix = paramParts.length ? `_${paramParts.join('_')}` : '';
  return `${typeName}${suffix}_${dateStr}.csv`;
}

function ensureExportDir() {
  const dir = path.join(process.cwd(), 'export_files');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getExportFilePath(fileName) {
  const dir = ensureExportDir();
  return path.join(dir, fileName);
}

function deleteExportFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

function mapOrderDetailRow(r) {
  return {
    '订单编号': r.id || '',
    '长者编号': r.elder_code || '',
    '长者姓名': r.elder_name || '',
    '补贴等级': r.subsidy_level || '',
    '助餐点': r.canteen_name || '',
    '街道': r.district || '',
    '就餐日期': r.serve_date || '',
    '餐别': formatMealType(r.meal_type),
    '菜品': r.dish_name || '',
    '就餐方式': formatDiningType(r.dining_type),
    '份数': r.qty || 0,
    '餐费(元)': centsToYuan(r.amount_cents),
    '补贴(元)': centsToYuan(r.subsidy_cents),
    '自付(元)': centsToYuan(r.pay_cents),
    '订单状态': formatOrderStatus(r.status),
    '下单时间': r.created_at || '',
  };
}

function mapSubsidyLedgerRow(r) {
  return {
    '发放月份': r.month || '',
    '街道': r.district || '',
    '助餐点': r.canteen_name || '',
    '长者编号': r.elder_code || '',
    '长者姓名': r.elder_name || '',
    '补贴等级': r.subsidy_level || '',
    '身份类别': r.identity_category || '',
    '就餐次数': r.meal_count || 0,
    '补贴总额(元)': centsToYuan(r.subsidy_total),
    '自付总额(元)': centsToYuan(r.self_pay_total),
    '餐费总额(元)': centsToYuan(r.amount_total),
  };
}

function mapMealStatisticsRow(r) {
  return {
    '统计时段': r.bucket || '',
    '街道': r.district || '',
    '助餐点': r.canteen_name || '',
    '餐别': formatMealType(r.meal_type),
    '就餐人次': r.diner_count || 0,
    '堂食人次': r.dine_in_count || 0,
    '送餐人次': r.delivery_count || 0,
    '补贴总额(元)': centsToYuan(r.subsidy_total),
    '自付总额(元)': centsToYuan(r.self_pay_total),
    '餐费总额(元)': centsToYuan(r.amount_total),
    '爽约人次': r.no_show_count || 0,
    '爽约率': formatPercent(r.no_show_rate),
  };
}

function centsToYuan(cents) {
  if (cents === null || cents === undefined) return '0.00';
  return (Number(cents) / 100).toFixed(2);
}

function formatMealType(t) {
  const map = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' };
  return map[t] || t || '';
}

function formatDiningType(t) {
  const map = { DINE_IN: '堂食', DELIVERY: '送餐' };
  return map[t] || t || '';
}

function formatOrderStatus(s) {
  const map = { RESERVED: '已订餐', SERVED: '已核销', CANCELLED: '已取消', NO_SHOW: '爽约' };
  return map[s] || s || '';
}

function formatPercent(r) {
  if (r === null || r === undefined || Number.isNaN(Number(r))) return '0.00%';
  return (Number(r) * 100).toFixed(2) + '%';
}

const EXPORT_CONFIG = {
  SUBSIDY_LEDGER: {
    headers: ['发放月份', '街道', '助餐点', '长者编号', '长者姓名', '补贴等级', '身份类别', '就餐次数', '补贴总额(元)', '自付总额(元)', '餐费总额(元)'],
    rowMapper: mapSubsidyLedgerRow,
  },
  ORDER_DETAIL: {
    headers: ['订单编号', '长者编号', '长者姓名', '补贴等级', '助餐点', '街道', '就餐日期', '餐别', '菜品', '就餐方式', '份数', '餐费(元)', '补贴(元)', '自付(元)', '订单状态', '下单时间'],
    rowMapper: mapOrderDetailRow,
  },
  MEAL_STATISTICS: {
    headers: ['统计时段', '街道', '助餐点', '餐别', '就餐人次', '堂食人次', '送餐人次', '补贴总额(元)', '自付总额(元)', '餐费总额(元)', '爽约人次', '爽约率'],
    rowMapper: mapMealStatisticsRow,
  },
};

function getExportConfig(type) {
  return EXPORT_CONFIG[type] || null;
}

module.exports = {
  escapeCsvField,
  toCsvRow,
  toCsv,
  toCsvStream,
  formatDateForFilename,
  generateTaskKey,
  generateFileName,
  ensureExportDir,
  getExportFilePath,
  deleteExportFile,
  mapOrderDetailRow,
  mapSubsidyLedgerRow,
  mapMealStatisticsRow,
  getExportConfig,
  centsToYuan,
  formatMealType,
  formatDiningType,
  formatOrderStatus,
  formatPercent,
  EXPORT_CONFIG,
};
