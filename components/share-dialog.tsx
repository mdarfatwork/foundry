"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Share2, Copy, Check } from "lucide-react";

export function ShareDialog() {
  const [copied, setCopied] = React.useState(false);
  const shareUrl = "https://foundry.build/p/aurora-devtools-v1";

  const handleCopy = () => {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 gap-1.5 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Share2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Share</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Share Project
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Anyone with this link will be able to view the live preview and
            clone the project.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 pt-2">
          <Input
            readOnly
            value={shareUrl}
            className="text-xs font-mono h-8 bg-muted/50 select-all"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5 text-xs shrink-0"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </Button>
        </div>
        <DialogFooter className="mt-4 pt-3 border-t border-border">
          <p className="text-[11px] text-muted-foreground mr-auto">
            Permissions: View and fork only
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
