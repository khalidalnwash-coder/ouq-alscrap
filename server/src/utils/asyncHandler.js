// Express 4 does not catch rejected promises thrown inside async route
// handlers — an unhandled rejection would otherwise crash the whole process
// (Node terminates on unhandled rejections by default). Wrap every async
// handler with this so errors are forwarded to the error-handling middleware.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
