import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, LifeBuoy, Mail, Phone, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORT } from "@/lib/support";
import { sendSupportMessage } from "@/lib/support.functions";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "24/7 Security Help Line — Sentinel Secure Banking" },
      {
        name: "description",
        content:
          "Reach the Sentinel security team by phone or email, or report unauthorised account activity around the clock.",
      },
      { property: "og:title", content: "24/7 Security Help Line" },
      { property: "og:description", content: "Phone and email support for account security." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Help,
});

function Help() {
  const router = useRouter();
  const phoneConfigured = SUPPORT.phone !== "";
  const emailConfigured = SUPPORT.email !== "";
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [emailComment, setEmailComment] = useState("");
  const [emailResult, setEmailResult] = useState<"sent" | "draft" | null>(null);
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const sendMessage = useMutation({
    mutationFn: (data: { message: string; userEmail: string }) =>
      sendSupportMessage({ data }),
    onSuccess: (result, data) => {
      if (result.delivered) {
        setEmailResult("sent");
      } else {
        const emailHref = `mailto:${SUPPORT.email}?${new URLSearchParams({
          subject: "Sentinel security support request",
          body: `Hello Sentinel Support,\n\nMessage from: ${data.userEmail}\n\n${data.message}\n\nThank you.`,
        }).toString()}`;
        setEmailResult("draft");
        window.location.href = emailHref;
      }
      setEmailComment("");
    },
  });

  function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const comment = emailComment.trim();
    const email = userEmail.trim();
    if (!comment || !email || !emailConfigured) return;

    setEmailResult(null);
    sendMessage.mutate({ message: comment, userEmail: email });
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) {
              router.history.back();
            } else {
              void router.navigate({ to: "/user/dashboard" });
            }
          }}
          className="flex items-center gap-1.5 text-sm text-accent underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </button>
        <div className="panel mt-4 p-8">
          <LifeBuoy className="size-6 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold">24/7 Security Support</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Contact details are set by the deployment owner. No number is invented here.
          </p>

          <dl className="mt-8 space-y-5">
            <Row icon={Phone} label="Phone" value={SUPPORT.phone || "Not configured"} />
            <Row icon={Mail} label="Email" value={SUPPORT.email || "Not configured"} />
            <Row
              icon={ShieldAlert}
              label="Unauthorised activity"
              value={SUPPORT.emergencyEmail || "Not configured"}
            />
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild disabled={!phoneConfigured}>
              <a href={phoneConfigured ? `tel:${SUPPORT.phone}` : undefined}>Call support</a>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!emailConfigured}
              onClick={() => {
                setEmailFormOpen((open) => !open);
                setEmailSubmitted(false);
              }}
            >
              {emailFormOpen ? "Close email form" : "Email support"}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/user/notifications">Review my alerts</Link>
            </Button>
          </div>

          {emailFormOpen && emailConfigured && (
            <form className="mt-5 rounded-md border border-border bg-background p-4" onSubmit={submitEmail}>
              <label htmlFor="support-email" className="text-sm font-medium">
                Your email address
              </label>
              <Input
                id="support-email"
                className="mt-2"
                type="email"
                placeholder="you@example.com"
                value={userEmail}
                onChange={(event) => {
                  setUserEmail(event.target.value);
                  setEmailResult(null);
                }}
                required
              />
              <label htmlFor="support-comment" className="mt-4 block text-sm font-medium">
                How can we help?
              </label>
              <Textarea
                id="support-comment"
                className="mt-2 min-h-32"
                placeholder="Describe your security question or issue"
                value={emailComment}
                onChange={(event) => {
                  setEmailComment(event.target.value);
                  setEmailResult(null);
                }}
                required
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  disabled={!userEmail.trim() || !emailComment.trim() || sendMessage.isPending}
                >
                  {sendMessage.isPending ? "Sending…" : "Submit email"}
                </Button>
                {emailResult === "sent" && (
                  <p className="text-xs text-muted-foreground">
                    Your message has been sent to the help line. You are registered for the support help line.
                  </p>
                )}
                {emailResult === "draft" && (
                  <p className="text-xs text-muted-foreground">
                    Your email app opened with the message ready to send to {SUPPORT.email}.
                  </p>
                )}
                {sendMessage.isError && (
                  <p className="text-xs text-destructive">
                    We could not process the request. Please try again.
                  </p>
                )}
              </div>
            </form>
          )}

          {(!phoneConfigured || !emailConfigured) && (
            <p className="mt-6 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              Support contacts are not configured yet. Set them in{" "}
              <code className="font-mono">src/lib/support.ts</code> before going live.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <dt className="label-caps">{label}</dt>
        <dd className="font-mono text-sm">{value}</dd>
      </div>
    </div>
  );
}
