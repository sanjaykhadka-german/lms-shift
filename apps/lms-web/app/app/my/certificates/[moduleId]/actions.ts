"use server";

import { redirect } from "next/navigation";
import { requireLearner } from "~/lib/lms/learner";
import { getEarnedCertificate } from "~/lib/lms/certificates";
import { notifyLearnerCertificate } from "~/lib/lms/notify";

// Re-sends the certificate email to the signed-in learner (for the module they
// pass), e.g. if the original on-pass email was missed. Verifies they actually
// hold the certificate before sending.
export async function resendCertificateEmailAction(formData: FormData): Promise<void> {
  const moduleId = parseInt(String(formData.get("moduleId") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad moduleId");

  const { lmsUser, traceyTenantId } = await requireLearner();
  const cert = await getEarnedCertificate(moduleId, lmsUser.id, traceyTenantId);
  if (cert) {
    await notifyLearnerCertificate({
      learnerEmail: lmsUser.email,
      learnerName: lmsUser.name,
      moduleTitle: cert.moduleTitle,
      moduleId: cert.moduleId,
      score: cert.score,
    });
  }
  redirect(`/app/my/certificates/${moduleId}?resent=1`);
}
