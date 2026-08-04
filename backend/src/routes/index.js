const express = require('express');
const authRoutes = require('./auth.routes');
const tenantRoutes = require('./tenant.routes');
const productsRoutes = require('./products.routes');
const ordersRoutes = require('./orders.routes');
const customersRoutes = require('./customers.routes');
const promotionsRoutes = require('./promotions.routes');
const paymentsRoutes = require('./payments.routes');
const reportsRoutes = require('./reports.routes');
const whatsappRoutes = require('./whatsapp.routes');
const adminRoutes = require('./admin.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/tenant', tenantRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/customers', customersRoutes);
router.use('/promotions', promotionsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/reports', reportsRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/admin', adminRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'RectoBase API is running', timestamp: new Date().toISOString() });
});

module.exports = router;
