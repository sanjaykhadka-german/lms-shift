import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ClipboardCheck, Sparkles, ShieldCheck } from "lucide-react";

const features = [
  {
    icon: ClipboardCheck,
    title: "Built around your roles and responsibilities",
    description:
      "Map modules to the roles and responsibilities that actually exist in your organisation. Passing the right modules qualifies your people for the work they do — automatically.",
  },
  {
    icon: Sparkles,
    title: "AI quizzes from documents you already have",
    description:
      "Drop in your policies, procedures, and training documents and Tracey generates the quiz. Edit, version, and re-issue without rebuilding the question bank from scratch.",
  },
  {
    icon: ShieldCheck,
    title: "Audit-ready by default",
    description:
      "Every attempt, every pass, every requalification logged with timestamps. Export the whole trail when the auditor walks in.",
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Training that fits the way operations actually work
        </h2>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {features.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="mb-3 h-6 w-6 text-[color:var(--brand-600,var(--primary))]" />
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription className="pt-1">{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
