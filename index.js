/**
 * Host half of the attention-reminder bundle.
 *
 * The reminder needs no Host-side work: the browser half already receives the
 * events it observes (`api-session/status`, `approval/request`,
 * `user-questions/request`) over the page's existing connection, and it plays
 * the sound and shows the notification itself. This half exists so the bundle
 * has an active Loader row, which is what makes its browser module load.
 *
 * @param {import('@deepseek-ai/cordis').Context} _ctx - Host context of this row.
 */
export function apply(_ctx) {}
