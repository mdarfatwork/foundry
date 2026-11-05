"use client";

import { useRouter } from "next/navigation";
import { PromptComposer } from "@/components/home/prompt-composer";
import { createProjectAction } from "@/app/actions/project";

type HeroPromptComposerProps = Readonly<{
  isAuthenticated: boolean;
}>;

/**
 * Client wrapper for the landing page hero prompt composer.
 * Routes authenticated users directly into their newly created workspace,
 * or redirects unauthenticated visitors to sign in.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, §5.5, and DESIGN.md.
 */
export function HeroPromptComposer({
  isAuthenticated,
}: HeroPromptComposerProps) {
  const router = useRouter();

  const handlePromptSubmit = async (prompt: string) => {
    if (!isAuthenticated) {
      const searchParams = new URLSearchParams({
        callbackUrl: "/workspace",
      });
      router.push(`/sign-in?${searchParams.toString()}`);
      return;
    }

    // Create a concise project name from the prompt
    const words = prompt.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    const projectName = words.length > 0 ? `${words}...` : "New Project";

    const res = await createProjectAction(projectName, undefined, prompt);
    if (res.success) {
      router.push(`/workspace/${res.data.id}`);
    } else {
      router.push("/workspace");
    }
  };

  return <PromptComposer onSubmitPrompt={handlePromptSubmit} />;
}
