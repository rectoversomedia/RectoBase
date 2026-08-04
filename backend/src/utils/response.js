/**
 * Standardized API response helpers
 */

function ok(res, data, message = 'OK') {
  return res.status(200).json({
    success: true,
    message,
    data,
  });
}

function created(res, data, message = 'Berhasil dibuat') {
  return res.status(201).json({
    success: true,
    message,
    data,
  });
}

function noContent(res) {
  return res.status(204).send();
}

function error(res, status = 400, message = 'Terjadi kesalahan') {
  return res.status(status).json({
    success: false,
    message,
  });
}

function validationError(res, errors) {
  return res.status(400).json({
    success: false,
    message: 'Data yang dikirim tidak valid.',
    errors,
  });
}

function paginated(res, data, pagination, message = 'OK') {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  });
}

function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({
    success: false,
    message,
  });
}

function forbidden(res, message = 'Akses ditolak') {
  return res.status(403).json({
    success: false,
    message,
  });
}

function notFound(res, message = 'Data tidak ditemukan') {
  return res.status(404).json({
    success: false,
    message,
  });
}

module.exports = {
  ok,
  created,
  noContent,
  error,
  validationError,
  paginated,
  unauthorized,
  forbidden,
  notFound,
};
