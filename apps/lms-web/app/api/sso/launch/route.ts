import { redirect } from "next/navigation";

// Phase 5 — the Flask SSO bridge has been retired. The original JWT-minting
// route (which POSTed to Flask /sso/callback) is preserved in
// legacy-flask/lms-web-quarantined/api/sso/launch/route.ts.original for
// reference. Anyone still hitting this URL — bookmarked admin "Open
// Training" buttons, old emails — gets sent to the in-Tracey learner
// portal, which now serves the same content Flask used to.
export function GET(): never {
  redirect("/my/modules");
}
