/**
 * UserError — expected, user-facing failures.
 * Thrown instead of process.exit(1) so that:
 *  - bin/smart-git.js can render a clean `✖ <msg>` and exit 1
 *  - in-process tests (parseAsync) can catch without killing the process
 *  - no stack trace is printed for known error paths
 */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

module.exports = { UserError };
