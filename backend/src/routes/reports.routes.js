const express = require('express');
const { query: queryValidator } = require('express-validator');
const { validate } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateJWT } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenant');
const reportService = require('../services/report.service');
const db = require('../utils/db');
const { ok, error } = require('../utils/response');

const router = express.Router();

/**
 * GET /api/v1/reports/daily
 * Daily sales report with breakdown
 */
router.get(
  '/daily',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { start, end, outlet } = req.query;

    if (!start || !end) {
      return error(res, 400, 'Parameter start dan end wajib diisi (format: YYYY-MM-DD).');
    }

    const result = await reportService.getDailyReport(
      req.user.tenantId,
      start,
      end,
      outlet || null
    );

    return ok(res, result);
  })
);

/**
 * GET /api/v1/reports/summary
 * Summary report for today/week/month
 */
router.get(
  '/summary',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { period = 'today' } = req.query;
    const validPeriods = ['today', 'week', 'month'];
    if (!validPeriods.includes(period)) {
      return error(res, 400, 'Period harus salah satu dari: today, week, month.');
    }

    const result = await reportService.getSummaryReport(req.user.tenantId, period);
    return ok(res, result);
  })
);

/**
 * GET /api/v1/reports/customers
 * Customer acquisition and retention report
 */
router.get(
  '/customers',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { segment, start, end } = req.query;
    const result = await reportService.getCustomerReport(
      req.user.tenantId,
      { segment, start, end }
    );
    return ok(res, result);
  })
);

/**
 * GET /api/v1/reports/products
 * Top/bottom selling products report
 */
router.get(
  '/products',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { start, end, limit = 10, category_id, sort = 'quantity' } = req.query;
    const result = await reportService.getProductReport(
      req.user.tenantId,
      { start, end, limit: parseInt(limit, 10), category_id, sort }
    );
    return ok(res, result);
  })
);

/**
 * GET /api/v1/reports/revenue
 * Revenue report grouped by day/week/month
 */
router.get(
  '/revenue',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { start, end, group = 'day', outlet } = req.query;
    const validGroups = ['day', 'week', 'month'];
    if (!validGroups.includes(group)) {
      return error(res, 400, 'Group harus salah satu dari: day, week, month.');
    }

    const result = await reportService.getRevenueReport(
      req.user.tenantId,
      { start, end, group, outlet: outlet || null }
    );
    return ok(res, result);
  })
);

/**
 * GET /api/v1/reports/payments
 * Payment method breakdown report
 */
router.get(
  '/payments',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { start, end, outlet } = req.query;
    const result = await reportService.getPaymentReport(
      req.user.tenantId,
      { start, end, outlet: outlet || null }
    );
    return ok(res, result);
  })
);

/**
 * GET /api/v1/reports/churn
 * Customer churn analysis report
 */
router.get(
  '/churn',
  authenticateJWT,
  extractTenant,
  asyncHandler(async (req, res) => {
    const { start, end } = req.query;
    const result = await reportService.getChurnReport(req.user.tenantId, { start, end });
    return ok(res, result);
  })
);

module.exports = router;
