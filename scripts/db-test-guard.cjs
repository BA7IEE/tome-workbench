const { URL } = require("node:url");
function guardDatabase(raw) {
  const u = new URL(raw);
  if (
    !["127.0.0.1", "localhost", "postgres"].includes(u.hostname) ||
    u.pathname !== "/tome_test" ||
    /srvf|rescue|u-nest/i.test(raw)
  )
    throw new Error(
      "TEST_DATABASE_REFUSED: tests require isolated tome_test on a local host",
    );
  return raw;
}
module.exports = { guardDatabase };
