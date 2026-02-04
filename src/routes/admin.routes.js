const express = require("express");
const db = require("../db/database");
const { auth, requireAdmin } = require("../middleware/auth");
const { buildInvoiceNumber, generateInvoicePDF } = require("../services/invoice.service");
const { getConfig } = require("../config/env");
const router = express.Router();
const config = getConfig();

router.get("/bookings", auth, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM bookings ORDER BY created_at DESC").all();
  return res.json(rows);
});

router.get("/bookings/:id/invoice.pdf", auth, requireAdmin, (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE id=?").get(req.params.id);
  if (!b) return res.status(404).json({ error: "Réservation introuvable" });

  if (!b.invoice_number) {
    const invoiceNumber = buildInvoiceNumber(b.id, b.created_at);
    const invoicedAt = new Date().toISOString();
    db.prepare("UPDATE bookings SET invoice_number=?, invoiced_at=? WHERE id=?").run(invoiceNumber, invoicedAt, b.id);
    b.invoice_number = invoiceNumber;
    b.invoiced_at = invoicedAt;
  }
  return generateInvoicePDF(res, b, { companyName: "DriveUs", companyEmail: config.ADMIN_EMAIL, depositEur: config.DEPOSIT_EUR });
});

module.exports = router;
