'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../data/store');
const exporter = require('../data/exporter');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

const EXPORT_TYPES = ['SUBSIDY_LEDGER', 'ORDER_DETAIL', 'MEAL_STATISTICS'];

const runningTasks = new Set();

async function processExportTask(taskId) {
  if (runningTasks.has(taskId)) return;
  runningTasks.add(taskId);

  try {
    const task = await store.getExportTaskById(taskId);
    if (!task) { runningTasks.delete(taskId); return; }
    if (task.status !== 'PENDING') { runningTasks.delete(taskId); return; }

    await store.updateExportTask(taskId, { status: 'RUNNING', processedCount: 0 });

    const params = task.params || {};
    const config = exporter.getExportConfig(task.type);
    if (!config) {
      await store.updateExportTask(taskId, { status: 'FAILED', errorMessage: '不支持的导出类型' });
      runningTasks.delete(taskId);
      return;
    }

    const totalCount = await store.getExportDataCount(task.type, params);
    await store.updateExportTask(taskId, { totalCount, processedCount: 0 });

    let rawRows;
    switch (task.type) {
      case 'SUBSIDY_LEDGER':
        rawRows = await store.getSubsidyLedgerForExport(params);
        break;
      case 'MEAL_STATISTICS':
        rawRows = await store.getMealStatisticsForExport(params, params.granularity || 'day');
        break;
      case 'ORDER_DETAIL':
      default:
        rawRows = await store.getOrderDetailForExport(params);
    }

    const fileName = exporter.generateFileName(task.type, params);
    const filePath = exporter.getExportFilePath(fileName);
    exporter.ensureExportDir();

    const mappedRows = rawRows.map(config.rowMapper);
    const csvContent = exporter.toCsv(config.headers, mappedRows);

    await store.updateExportTask(taskId, { processedCount: Math.floor(rawRows.length * 0.5) });

    fs.writeFileSync(filePath, csvContent, 'utf8');

    await store.updateExportTask(taskId, {
      status: 'COMPLETED',
      processedCount: rawRows.length,
      filePath,
      fileName,
    });

    runningTasks.delete(taskId);
  } catch (e) {
    try {
      await store.updateExportTask(taskId, {
        status: 'FAILED',
        errorMessage: e.message ? e.message.slice(0, 500) : '导出失败',
      });
    } catch (_) { /* ignore */ }
    runningTasks.delete(taskId);
  }
}

function parseExportParams(query) {
  const { dateStart, dateEnd, district, canteenId, mealType, diningType, subsidyLevel, granularity } = query;
  const params = {};
  if (dateStart) params.dateStart = dateStart;
  if (dateEnd) params.dateEnd = dateEnd;
  if (district) params.district = district;
  if (canteenId !== undefined) params.canteenId = Number(canteenId);
  if (mealType) params.mealType = mealType;
  if (diningType) params.diningType = diningType;
  if (subsidyLevel) params.subsidyLevel = subsidyLevel;
  if (granularity) params.granularity = granularity;
  return params;
}

router.post('/', requireRole('ADMIN', 'OPERATOR', 'VIEWER'), async (req, res, next) => {
  try {
    const { type } = req.body || {};
    if (!EXPORT_TYPES.includes(type)) {
      return sendError(res, 400, `type 必须是 ${EXPORT_TYPES.join('/')}`);
    }

    const params = parseExportParams(req.body || {});
    const taskKey = exporter.generateTaskKey(type, params);

    const existing = await store.getExportTaskByKey(taskKey);
    if (existing) {
      return sendData(res, 200, {
        taskId: existing.id,
        status: existing.status,
        reused: true,
        totalCount: existing.totalCount,
        processedCount: existing.processedCount,
      });
    }

    const task = await store.createExportTask({
      taskKey,
      type,
      params,
      status: 'PENDING',
      fileName: exporter.generateFileName(type, params),
      createdBy: req.user ? req.user.id : null,
    });

    setImmediate(() => processExportTask(task.id));

    return sendData(res, 201, {
      taskId: task.id,
      status: task.status,
      reused: false,
    });
  } catch (e) { return next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const { type, status } = req.query;
    const tasks = await store.listExportTasks({ type, status });
    return sendData(res, 200, tasks);
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const task = await store.getExportTaskById(id);
    if (!task) return sendError(res, 404, '任务不存在');

    return sendData(res, 200, {
      taskId: task.id,
      type: task.type,
      status: task.status,
      params: task.params,
      totalCount: task.totalCount,
      processedCount: task.processedCount,
      progress: task.totalCount > 0 ? Math.round((task.processedCount / task.totalCount) * 100) : 0,
      fileName: task.fileName,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch (e) { return next(e); }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const task = await store.getExportTaskById(id);
    if (!task) return sendError(res, 404, '任务不存在');
    if (task.status !== 'COMPLETED') return sendError(res, 409, `任务未完成，当前状态: ${task.status}`);
    if (!task.filePath || !fs.existsSync(task.filePath)) {
      return sendError(res, 404, '文件不存在，请重新导出');
    }

    const fileName = encodeURIComponent(task.fileName || 'export.csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.setHeader('Cache-Control', 'no-cache');

    const fileStream = fs.createReadStream(task.filePath);
    fileStream.pipe(res);
  } catch (e) { return next(e); }
});

router.post('/:id/retry', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const task = await store.getExportTaskById(id);
    if (!task) return sendError(res, 404, '任务不存在');
    if (task.status === 'RUNNING') return sendError(res, 409, '任务正在执行中');

    if (task.filePath) {
      exporter.deleteExportFile(task.filePath);
    }

    await store.updateExportTask(id, {
      status: 'PENDING',
      totalCount: 0,
      processedCount: 0,
      filePath: null,
      errorMessage: null,
    });

    setImmediate(() => processExportTask(id));

    const updated = await store.getExportTaskById(id);
    return sendData(res, 200, {
      taskId: updated.id,
      status: updated.status,
    });
  } catch (e) { return next(e); }
});

async function startPendingTasks() {
  try {
    const pending = await store.listExportTasks({ status: 'PENDING' });
    for (const task of pending) {
      if (!runningTasks.has(task.id)) {
        setImmediate(() => processExportTask(task.id));
      }
    }
  } catch (e) {
    // ignore
  }
}

setInterval(startPendingTasks, 30000);

module.exports = {
  router,
  processExportTask,
};
