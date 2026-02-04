const PDFDocument = require("pdfkit");

function buildInvoiceNumber(bookingId, createdAtISO) {
  const d = new Date(createdAtISO || Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const short = bookingId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `DU-${y}${m}${day}-${short}`;
}
function money(v) { return `${Number(v).toFixed(2)} €`; }

function generateInvoicePDF(res, booking, { companyName, companyEmail, depositEur }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="facture-${booking.invoice_number}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).text(companyName || "DriveUs");
  doc.fontSize(10).fillColor("#444").text(companyEmail || "contact@driveus.fr");
  doc.moveDown(1);

  doc.fillColor("#000").fontSize(18).text("Facture", { align: "right" });
  doc.fontSize(10).text(`N° facture: ${booking.invoice_number}`, { align: "right" });
  doc.text(`Date: ${booking.invoiced_at}`, { align: "right" });

  doc.moveDown(1.5);
  doc.fontSize(12).text("Détails réservation", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10)
    .text(`ID réservation: ${booking.id}`)
    .text(`Départ: ${booking.pickup}`)
    .text(`Arrivée: ${booking.dropoff}`)
    .text(`Distance: ${Number(booking.distance).toFixed(3)} km`)
    .text(`Date/heure: ${booking.pickup_datetime || "-"}`)
    .text(`Client: ${booking.customer_name || "-"} (${booking.customer_email || "-"})`);

  doc.moveDown(1);
  doc.fontSize(12).text("Montants", { underline: true });
  doc.moveDown(0.5);

  const total = Number(booking.price);
  const deposit = Number(booking.deposit_amount ?? depositEur ?? 10);
  const remaining = Math.max(0, Math.round((total - deposit) * 100) / 100);

  doc.fontSize(10)
    .text(`Total course: ${money(total)}`)
    .text(`Acompte: ${money(deposit)} (${booking.deposit_paid ? "PAYÉ" : "NON PAYÉ"})`)
    .text(`Solde à payer à bord: ${money(remaining)} (CB ou espèces)`);

  doc.end();
}
module.exports = { buildInvoiceNumber, generateInvoicePDF };
