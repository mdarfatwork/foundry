"use client";

import { useState, type FormEvent } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Credenza,
  CredenzaTrigger,
  CredenzaContent,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaDescription,
  CredenzaBody,
  CredenzaFooter,
} from "@/components/ui/credenza";
import { createProjectAction, type ProjectRecord } from "@/app/actions/project";

type CreateProjectDialogProps = Readonly<{
  /**
   * Callback invoked when a project is successfully created.
   */
  onProjectCreated: (project: ProjectRecord) => void;
  /**
   * Optional custom trigger button element.
   */
  trigger?: React.ReactElement;
}>;

const MAX_PROJECT_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 300;

/**
 * Accessible Responsive Credenza (Modal on Desktop, Drawer on Mobile) for Project Creation.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4 (Base UI render prop), §7.1, and DESIGN.md.
 */
export function CreateProjectDialog({
  onProjectCreated,
  trigger,
}: CreateProjectDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setErrorMessage(null);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      resetForm();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setErrorMessage("Please enter a project name.");
      return;
    }

    if (trimmedName.length > MAX_PROJECT_NAME_LENGTH) {
      setErrorMessage(
        `Project name cannot exceed ${MAX_PROJECT_NAME_LENGTH} characters.`,
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await createProjectAction(
        trimmedName,
        description.trim() || undefined,
      );

      if (response.success) {
        onProjectCreated(response.data);
        setIsOpen(false);
        resetForm();
      } else {
        setErrorMessage(response.error);
      }
    } catch {
      setErrorMessage("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const defaultTrigger = (
    <Button size="sm" className="gap-1.5 shadow-xs">
      <Plus className="h-4 w-4" />
      <span>New project</span>
    </Button>
  );

  return (
    <Credenza open={isOpen} onOpenChange={handleOpenChange}>
      <CredenzaTrigger render={trigger ?? defaultTrigger} />

      <CredenzaContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <CredenzaHeader>
            <CredenzaTitle>New project</CredenzaTitle>
            <CredenzaDescription>
              Give your project a name to begin building. You can change this
              anytime.
            </CredenzaDescription>
          </CredenzaHeader>

          <CredenzaBody className="flex flex-col gap-4">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {errorMessage}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label
                htmlFor="project-name"
                className="text-xs font-medium text-foreground cursor-pointer"
              >
                Project name <span className="text-destructive">*</span>
              </label>
              <Input
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Portfolio Website, SaaS Dashboard"
                disabled={isSubmitting}
                autoFocus
                maxLength={MAX_PROJECT_NAME_LENGTH}
                aria-required="true"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="project-desc"
                className="text-xs font-medium text-foreground cursor-pointer"
              >
                Description{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <Input
                id="project-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of what this project does"
                disabled={isSubmitting}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
            </div>
          </CredenzaBody>

          <CredenzaFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create project</span>
              )}
            </Button>
          </CredenzaFooter>
        </form>
      </CredenzaContent>
    </Credenza>
  );
}
