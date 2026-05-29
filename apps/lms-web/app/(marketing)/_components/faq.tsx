import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { siteConfig } from "~/lib/site-config";

const faqs = [
  {
    q: "How long is the free trial?",
    a: `${siteConfig.trialDays} days. We don't ask for a card to start, and we'll email you twice before the trial ends so nothing gets billed by surprise.`,
  },
  {
    q: "Can I bring my own training content?",
    a: "Yes. Tracey ingests your policies, procedures, and training documents and turns them into quizzes you can edit. You can also build modules from scratch.",
  },
  {
    q: "Who owns the data?",
    a: "You do. Your modules, attempts, and qualifications are yours. We provide an export at any time and on cancellation.",
  },
  {
    q: "Where is data hosted?",
    a: "Tracey runs on Render with Postgres in their Sydney region for Australian customers. We can host elsewhere on Enterprise plans.",
  },
  {
    q: "Do you support SSO?",
    a: "SSO (SAML / OIDC) is available on the Enterprise plan. Get in touch and we'll set it up.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Frequently asked questions
        </h2>
      </div>
      <Accordion type="single" collapsible className="mt-10">
        {faqs.map(({ q, a }) => (
          <AccordionItem key={q} value={q}>
            <AccordionTrigger>{q}</AccordionTrigger>
            <AccordionContent>{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
