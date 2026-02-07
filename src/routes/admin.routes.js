const express = require("express");
const db = require("../db/database");
const { auth, requireAdmin } = require("../middleware/auth");
const { buildInvoiceNumber, generateInvoicePDF } = require("../services/invoice.service");
const { getConfig } = require("../config/env");

const router = express.Router();
const config = getConfig();

/**
 * GET /api/admin/bookings
 */
router.get("/bookings", auth, requireAdmin, async (req, res) => {
  try {
    const r = await db.execute("SELECT * FROM bookings ORDER BY created_at DESC");
    return res.json(r.rows || []);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * GET /api/admin/bookings/:id/invoice.pdf
 * Génère la facture PDF + stocke invoice_number/invoiced_at si absent
 */
router.get("/bookings/:id/invoice.pdf", auth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const r = await db.execute("SELECT * FROM bookings WHERE id = ?", [id]);
    const b = r.rows?.[0] || null;

    if (!b) return res.status(404).json({ error: "Réservation introuvable" });

    // Si facture pas encore attribuée, on l'attribue et on persiste
    if (!b.invoice_number) {
      const invoiceNumber = buildInvoiceNumber(b.id, b.created_at);
      const invoicedAt = new Date().toISOString();

      await db.execute(
        "UPDATE bookings SET invoice_number = ?, invoiced_at = ? WHERE id = ?",
        [invoiceNumber, invoicedAt, b.id]
      );

      // Met à jour l'objet local pour le PDF
      b.invoice_number = invoiceNumber;
      b.invoiced_at = invoicedAt;
    }

    return generateInvoicePDF(res, b, {
      companyName: "DriveUs",
      companyEmail: config.ADMIN_EMAIL,
      depositEur: config.DEPOSIT_EUR
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
