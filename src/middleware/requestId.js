const { randomUUID } = require("crypto");

function requestId(req, res, next) {
  const id = req.headers["x-request-id"] || randomUUID();
  req.id = String(id);
  res.setHeader("X-Request-Id", req.id);
  next();
}

module.exports = { requestId };
