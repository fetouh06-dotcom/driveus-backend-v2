function notFound(req, res) {
  return res.status(404).json({ error: "Route introuvable" });
}
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);
  return res.status(err.statusCode || 500).json({ error: "Erreur serveur" });
}
module.exports = { notFound, errorHandler };
